package controller

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// 任务请求的能力校验与选路过滤。
//
// 背景：同一个模型可能同时挂在多条渠道上，各渠道能吃的素材形态不同（Kling 只接文生+单图，
// Seedance 接首尾帧/参考视频/参考音频）。此前「这条渠道接不接得住」只在适配器内部各自判断，
// 带参考视频的请求可能落到 Kling 被静默丢弃。这里把能力判断收敛成两步：
//
//	第 1 层 validateTaskInputsAgainstAnyChannel —— 提交前的跨渠道快速失败：
//	  请求要的输入形态若不在「该模型当前组下任一服务渠道的能力并集」里，说明换哪条渠道
//	  都不行，立刻 400 并给出可用模型，不浪费一次选路与重试。
//	选路谓词 buildVideoChannelTypeFilter —— 把「接不住本次素材组合」的渠道类型在选路时滤掉，
//	  带参考视频的请求因此不会落到 Kling；这同时让第 2 层（relay 内的具体渠道校验）几乎
//	  不会触发，它只是并发与缓存边界下的兜底。
//
// 两步都用 channel 包里的同一份能力声明与同一个需求提取器，与前端置灰同源。

// extractTaskVideoRequirements 解析并归一化任务请求，提取它需要的视频输入形态。
//
// 只处理 application/json 任务请求；multipart 上传类任务不涉及 metadata.content 素材组合，
// 返回零值需求（仅文生），调用方会据此跳过过滤。归一化复用 relaycommon 的公共入口，
// 与 ValidateBasicTaskRequest 走的是同一套规则 —— 两处数出来的素材必然一致。
//
// 注意：这里读请求体不会消耗它（UnmarshalBodyReusable 走 BodyStorage，可重复读）。
func extractTaskVideoRequirements(c *gin.Context) (channel.VideoInputRequirements, bool) {
	if !strings.Contains(c.GetHeader("Content-Type"), "application/json") {
		return channel.VideoInputRequirements{}, false
	}
	var req relaycommon.TaskSubmitReq
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return channel.VideoInputRequirements{}, false
	}
	relaycommon.NormalizeTaskSubmitReq(&req)
	return channel.ExtractVideoInputRequirements(&req), true
}

// validateTaskInputsAgainstAnyChannel 第 1 层：跨渠道快速失败。
//
// 请求要的输入形态若连「该模型可用的所有渠道」的并集都接不住，那换哪条渠道都没用 ——
// 直接 400，附上能接住这些输入的模型列表，让用户改请求或换模型，而不是盲试。
//
// reqs 为空（纯文生 / 非 JSON / multipart）时不校验，返回 nil。
func validateTaskInputsAgainstAnyChannel(c *gin.Context, info *relaycommon.RelayInfo, reqs channel.VideoInputRequirements) *dto.TaskError {
	needed := reqs.NeededInputs()
	if len(needed) <= 1 {
		// 仅文生：任何渠道都接得住。
		return nil
	}
	group := info.UsingGroup
	if group == "" {
		group = info.UserGroup
	}
	abilities, err := model.GetAllEnableAbilityWithChannels()
	if err != nil {
		// 查不到能力表时不拦，交给选路与第 2 层兜底，避免误伤。
		return nil
	}
	caps := make([]channel.VideoCapability, 0, 4)
	for _, ability := range abilities {
		if ability.Group != group || ability.Model != info.OriginModelName {
			continue
		}
		caps = append(caps, channel.GetVideoCapability(ability.ChannelType))
	}
	if len(caps) == 0 {
		// 该组下没有服务这个模型的渠道：交给后续选路报「无可用渠道」，语义更准确。
		return nil
	}
	merged := channel.RefineVideoCapabilityForModel(
		channel.MergeVideoCapabilities(caps), info.OriginModelName)
	mismatches := channel.CheckVideoCapability(merged, reqs)
	if len(mismatches) == 0 {
		return nil
	}
	reasons := make([]string, 0, len(mismatches))
	for _, m := range mismatches {
		reasons = append(reasons, m.Reason)
	}
	return service.TaskErrorWrapperLocal(
		fmt.Errorf("no available channel for model %s can serve the provided inputs: %s",
			info.OriginModelName, strings.Join(reasons, "; ")),
		"unsupported_input_for_model", http.StatusBadRequest)
}

// buildVideoChannelTypeFilter 构造选路谓词：把接不住本次素材组合的渠道类型滤掉。
//
// reqs 为空（纯文生 / 非 JSON / multipart）时返回 nil —— 不过滤，与既有行为一致。
// 返回的闭包在选路时对每个候选渠道类型求值（model 层不需要 import channel 包，
// 谓词在这里绑定好所有依赖）。
func buildVideoChannelTypeFilter(info *relaycommon.RelayInfo, reqs channel.VideoInputRequirements) func(channelType int) bool {
	if len(reqs.NeededInputs()) <= 1 {
		return nil
	}
	modelName := info.OriginModelName
	return func(channelType int) bool {
		return channel.ChannelSupportsVideoRequest(channelType, modelName, reqs)
	}
}

// setupTaskCapabilityGate 是任务提交前的能力闸门入口：
// 提取输入需求 → 第 1 层跨渠道快速失败 → 返回选路谓词。
// 仅对视频提交生效；其他任务类型与无素材请求返回 nil 谓词、nil 错误。
func setupTaskCapabilityGate(c *gin.Context, info *relaycommon.RelayInfo) (func(channelType int) bool, *dto.TaskError) {
	if info.RelayMode != relayconstant.RelayModeVideoSubmit {
		return nil, nil
	}
	reqs, ok := extractTaskVideoRequirements(c)
	if !ok {
		return nil, nil
	}
	if taskErr := validateTaskInputsAgainstAnyChannel(c, info, reqs); taskErr != nil {
		return nil, taskErr
	}
	return buildVideoChannelTypeFilter(info, reqs), nil
}

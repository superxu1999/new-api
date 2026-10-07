/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// VideoCapabilities 回答一个问题：**当前用户能用哪些视频模型，每个模型能吃哪些素材**。
//
// 它是「前端置灰」与「后端选路」共用的同一份事实来源：前端据此把做不到的组合直接置灰，
// 后端据此在满足条件的渠道里选路。此前两边的判定各写各的，用户只能靠提交后撞错误，
// 也就是「能不能吃参考图全凭运气」。
//
// 返回的数据刻意**不含渠道信息**：普通用户只需要选模型，渠道属于内部实现（同一模型对
// 用户的价格与分组倍率挂钩，与渠道无关）。管理员要指定渠道请走管理端渠道页。
//
// 只列出「被任务型渠道服务」的模型：本接口服务于任务式视频生成，对话/向量类模型不属于此。
func VideoCapabilities(c *gin.Context) {
	group := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if group == "" {
		resolved, err := model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		group = resolved
	}

	abilities, err := model.GetAllEnableAbilityWithChannels()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	models := buildVideoCapabilityModels(abilities, group)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"group":  group,
			"models": models,
		},
	})
}

// buildVideoCapabilityModels 把能力表聚合成「模型 → 可用输入」的列表。
// 抽成纯函数是为了能脱离数据库直接测：这条聚合规则同时决定前端置灰与后端选路。
func buildVideoCapabilityModels(abilities []model.AbilityWithChannel, group string) []gin.H {
	// model -> 服务它的渠道类型集合（同组内）
	channelTypesByModel := map[string][]int{}
	for _, ability := range abilities {
		if ability.Group != group {
			continue
		}
		if !isVideoTaskModel(ability.ChannelType, ability.Model) {
			continue
		}
		channelTypesByModel[ability.Model] = append(channelTypesByModel[ability.Model], ability.ChannelType)
	}

	models := make([]gin.H, 0, len(channelTypesByModel))
	for modelName, channelTypes := range channelTypesByModel {
		caps := make([]channel.VideoCapability, 0, len(channelTypes))
		for _, channelType := range channelTypes {
			caps = append(caps, channel.GetVideoCapability(channelType))
		}
		merged := channel.RefineVideoCapabilityForModel(
			channel.MergeVideoCapabilities(caps), modelName)
		models = append(models, gin.H{
			"model":              modelName,
			// 对外显示名（运营在系统设置里配置）：C 端界面优先展示它，
			// 真实模型名（可能带渠道后缀）只作为技术信息跟随。
			"display_name":       operation_setting.ModelDisplayName(modelName),
			"inputs":             merged.Inputs,
			"max_images":         merged.MaxImages,
			"max_videos":         merged.MaxVideos,
			"max_audios":         merged.MaxAudios,
			"returns_last_frame": merged.ReturnsLastFrame,
			"resolutions":        merged.Resolutions,
			"ratios":             merged.Ratios,
			"duration":           merged.Duration,
			"supports_audio":     merged.SupportsAudio,
			"supports_watermark": merged.SupportsWatermark,
			"supports_seed":      merged.SupportsSeed,
			"source":             merged.Source,
		})
	}
	sort.Slice(models, func(i, j int) bool {
		return models[i]["model"].(string) < models[j]["model"].(string)
	})
	return models
}

// isVideoTaskModel 判断「该渠道该模型」是否真的能跑任务式视频生成。
// 两个条件缺一不可：渠道类型要有任务适配器；且该模型声明的端点类型里包含 openai-video。
// 只看渠道类型是不够的 —— OpenAI 渠道因为有 Sora 也有任务适配器，会把 gpt-4o 这类对话
// 模型一起算成「视频模型」，在创作台里列出一堆不能生成视频的选项。
func isVideoTaskModel(channelType int, modelName string) bool {
	if relay.GetTaskAdaptor(constant.TaskPlatform(strconv.Itoa(channelType))) == nil {
		return false
	}
	for _, endpointType := range common.GetEndpointTypesByChannelType(channelType, modelName) {
		if endpointType == constant.EndpointTypeOpenAIVideo {
			return true
		}
	}
	return false
}

type videoEstimateRequest struct {
	Model      string `json:"model"`
	Seconds    int    `json:"seconds"`
	Resolution string `json:"resolution"`
	// HasReferenceVideo 影响分档单价（含视频输入档更便宜），由前端的素材托盘给出。
	HasReferenceVideo bool `json:"has_reference_video"`
}

// VideoEstimate 预估一次视频任务要消耗多少额度，供创作台在提交前展示价格。
//
// 为什么不在前端算：定价公式（分档单价 × token/1e6 × 分组倍率 × 模型倍率）必须与真实
// 计费共用同一组 helper（taskcommon.SeedanceToken/SeedanceTierPrice、helper.HandleGroupRatio）。
// 前端自己实现一份看起来更快，但迟早与计费漂移 —— 那正是「价格不可信」的根源。
//
// 三种口径，与 relay/helper.ModelPriceHelperPerCall 的判定顺序一致：
//   - model_price：模型配了固定价格 → 价格 × 分组倍率，精确
//   - video_token：seedance 系按官方 token 公式计费，精确（也是本站绝大多数视频渠道）
//   - model_ratio：其余按模型倍率估算，标 approximate=true —— 个别适配器还会叠加
//     时长/分辨率倍率，因此这里只给「下限量级」，界面需要显示 ≈ 而不是确定值
func VideoEstimate(c *gin.Context) {
	var req videoEstimateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request body"})
		return
	}
	req.Model = strings.TrimSpace(req.Model)
	if req.Model == "" || req.Seconds < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model is required"})
		return
	}
	// 与真实计费同一个上界：越界值不进公式，避免预估接口成为绕过校验的入口。
	if req.Seconds > relaycommon.MaxTaskDurationSeconds {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "seconds out of range"})
		return
	}
	// 未指定时长（前端传 0）时按上游默认秒数估算，并把折算后的秒数回给前端展示。
	if req.Seconds == 0 {
		req.Seconds = taskcommon.SeedanceDefaultSeconds(req.Model)
		if req.Seconds <= 0 {
			req.Seconds = 5
		}
	}

	userId := c.GetInt("id")
	userGroup, err := model.GetUserGroup(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	if usingGroup == "" || usingGroup == "auto" {
		usingGroup = userGroup
	}
	if !isModelAvailableInGroup(req.Model, usingGroup) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model is not available in the current group"})
		return
	}

	groupRatio := helper.HandleGroupRatio(c, &relaycommon.RelayInfo{
		UserGroup:  userGroup,
		UsingGroup: usingGroup,
	}).GroupRatio

	data := gin.H{
		"model":       req.Model,
		"seconds":     req.Seconds,
		"resolution":  req.Resolution,
		"group_ratio": groupRatio,
	}

	if modelPrice, usePrice := ratio_setting.GetModelPrice(req.Model, false); usePrice {
		data["mode"] = "model_price"
		data["approximate"] = false
		data["quota"] = common.QuotaFromFloat(modelPrice * common.QuotaPerUnit * groupRatio)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": data})
		return
	}

	if taskcommon.IsSeedanceModel(req.Model) {
		token, tokenErr := taskcommon.SeedanceToken(req.Seconds, req.Resolution, req.HasReferenceVideo)
		if tokenErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": tokenErr.Error()})
			return
		}
		tierPrice, ok := taskcommon.SeedanceTierPrice(req.Model, req.Resolution, req.HasReferenceVideo)
		if !ok || tierPrice <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "no tier price configured for this model"})
			return
		}
		if operation_setting.USDExchangeRate <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "exchange rate is not configured"})
			return
		}
		multiplier := taskcommon.SeedanceModelMultiplier(req.Model)
		quota := estimateVideoTokenQuota(tierPrice, token, multiplier, groupRatio, operation_setting.USDExchangeRate)
		data["mode"] = "video_token"
		data["approximate"] = false
		data["token"] = token
		data["tier_price"] = tierPrice
		data["multiplier"] = multiplier
		data["quota"] = quota
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": data})
		return
	}

	modelRatio, ok, _ := ratio_setting.GetModelRatio(req.Model)
	if !ok || modelRatio <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model price is not configured"})
		return
	}
	data["mode"] = "model_ratio"
	data["approximate"] = true
	data["model_ratio"] = modelRatio
	data["quota"] = common.QuotaFromFloat(modelRatio / 2 * common.QuotaPerUnit * groupRatio)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": data})
}

// isModelAvailableInGroup 判断模型是否对当前分组可用（避免预估接口被用来探测任意模型）。
func isModelAvailableInGroup(modelName, group string) bool {
	for _, name := range model.GetGroupEnabledModels(group) {
		if name == modelName {
			return true
		}
	}
	return false
}

// estimateVideoTokenQuota 计算按分档 token 计费时的预估额度。
//
// 与 relay/helper.ModelPriceHelperPerCall + taskcommon.ComputeSeedanceBillRatio 的推导等价：
//
//	baseQuota = ModelRatio/2 × QuotaPerUnit × groupRatio
//	otherRatio = 2 × tierPrice × token/1e6 × multiplier / (ModelRatio × rate)
//	最终额度 = baseQuota × otherRatio
//	         = QuotaPerUnit × groupRatio × tierPrice × token/1e6 × multiplier / rate
//
// 模型倍率被约掉，所以预估不依赖它；汇率必须为正，否则无法估算。
// 用 QuotaFromFloat 做饱和转换，异常输入最多顶到上限，绝不回绕成负数（变成给用户退款）。
func estimateVideoTokenQuota(tierPrice float64, token int, multiplier, groupRatio, rate float64) int {
	if rate <= 0 {
		return 0
	}
	return common.QuotaFromFloat(
		common.QuotaPerUnit * groupRatio * tierPrice * float64(token) / 1e6 * multiplier / rate)
}

package channel

import "fmt"

// VideoCapabilityMismatch 描述「请求要的输入 / 数量」与「渠道能力」的一处不匹配。
// Reason 是给人看的原因；Kind 是不满足的输入形态，供调用方构造结构化错误。
type VideoCapabilityMismatch struct {
	Kind   VideoInputKind
	Reason string
}

// CheckVideoCapability 判断某条渠道的能力能否接住这次请求的素材组合。
//
// 它与前端 evaluateModel 用同一套集合规则（同源、同语义），因此「界面显示可点」
// 「提交前校验通过」「这条渠道真接得住」三者是同一个判断。返回 nil 表示可以接。
//
// 数量上限只在上限 > 0 时检查（0 表示该渠道未声明上限，不作前置限制）。
func CheckVideoCapability(capability VideoCapability, reqs VideoInputRequirements) []VideoCapabilityMismatch {
	var mismatches []VideoCapabilityMismatch
	supports := func(kind VideoInputKind) bool { return capability.SupportsInput(kind) }

	for _, kind := range reqs.NeededInputs() {
		if kind == VideoInputText {
			continue
		}
		if !supports(kind) {
			mismatches = append(mismatches, VideoCapabilityMismatch{
				Kind:   kind,
				Reason: fmt.Sprintf("channel does not support %s input", kind),
			})
		}
	}

	// 输入形态过了才看数量：形态都不支持时，数量原因对用户没有信息量。
	if len(mismatches) > 0 {
		return mismatches
	}
	if capability.MaxImages > 0 && reqs.ReferenceImage > capability.MaxImages {
		mismatches = append(mismatches, VideoCapabilityMismatch{
			Kind:   VideoInputReferenceImage,
			Reason: fmt.Sprintf("channel supports at most %d reference images, got %d", capability.MaxImages, reqs.ReferenceImage),
		})
	}
	if capability.MaxVideos > 0 && reqs.Video > capability.MaxVideos {
		mismatches = append(mismatches, VideoCapabilityMismatch{
			Kind:   VideoInputReferenceVideo,
			Reason: fmt.Sprintf("channel supports at most %d reference videos, got %d", capability.MaxVideos, reqs.Video),
		})
	}
	if capability.MaxAudios > 0 && reqs.Audio > capability.MaxAudios {
		mismatches = append(mismatches, VideoCapabilityMismatch{
			Kind:   VideoInputReferenceAudio,
			Reason: fmt.Sprintf("channel supports at most %d reference audios, got %d", capability.MaxAudios, reqs.Audio),
		})
	}
	return mismatches
}

// ChannelSupportsVideoRequest 是 CheckVideoCapability 的布尔版，供选路过滤用。
// 先用 RefineVideoCapabilityForModel 按模型收紧，再判断该渠道能否接住这次请求。
func ChannelSupportsVideoRequest(channelType int, modelName string, reqs VideoInputRequirements) bool {
	capability := RefineVideoCapabilityForModel(GetVideoCapability(channelType), modelName)
	return len(CheckVideoCapability(capability, reqs)) == 0
}

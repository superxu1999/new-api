package channel

import (
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// 视频请求的「输入需求」：从客户端各种等价写法归一后的 metadata.content 推出。
//
// 为什么单独抽出来：能力声明（VideoCapability）描述「渠道能吃哪些素材」，而这里描述
// 「这次请求要带哪些素材」。选路、提交前校验、前端置灰三方都拿这两份数据做集合判断，
// 用同一个提取器才不会出现三套规则互相漂移（前端 capability.ts 的 countRoles 是它的镜像）。
type VideoInputRequirements struct {
	// Inputs 是这次请求需要的输入形态集合（去重）。
	Inputs map[VideoInputKind]bool
	// FirstFrame / LastFrame / ReferenceImage / Video / Audio 是各形态素材的张数。
	FirstFrame     int
	LastFrame      int
	ReferenceImage int
	Video          int
	Audio          int
}

// content 元素里 type 与 URL 字段名（与归一化 appendReference 写的一致）。
const (
	contentTypeImageURL = "image_url"
	contentTypeVideoURL = "video_url"
	contentTypeAudioURL = "audio_url"
)

// content 元素 role 字段取值（见 relay/common/relay_utils.go 归一化说明）。
const (
	roleFirstFrame     = "first_frame"
	roleLastFrame      = "last_frame"
	roleReferenceImage = "reference_image"
	roleReferenceVideo = "reference_video"
	roleReferenceAudio = "reference_audio"
)

// ExtractVideoInputRequirements 从归一化后的任务请求推出输入需求。
//
// 调用前必须先跑过 relaycommon 的归一化（NormalizeTaskSubmitReq / ValidateBasicTaskRequest），
// 此时所有参考素材都已并入 metadata.content，role 也已按「显式优先、缺省推断」补好。
// 归一化前的原始请求不要直接喂这里 —— 各种等价写法没被合并，会数错。
func ExtractVideoInputRequirements(req *relaycommon.TaskSubmitReq) VideoInputRequirements {
	reqs := VideoInputRequirements{Inputs: map[VideoInputKind]bool{VideoInputText: true}}
	if req == nil {
		return reqs
	}
	items, _ := req.Metadata["content"].([]interface{})
	for _, raw := range items {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		role, _ := item["role"].(string)
		switch {
		case hasContentField(item, contentTypeVideoURL):
			reqs.Video++
			reqs.Inputs[VideoInputReferenceVideo] = true
		case hasContentField(item, contentTypeAudioURL):
			reqs.Audio++
			reqs.Inputs[VideoInputReferenceAudio] = true
		case hasContentField(item, contentTypeImageURL):
			classifyImageRole(&reqs, role)
		}
	}
	return reqs
}

func hasContentField(item map[string]interface{}, key string) bool {
	_, ok := item[key]
	return ok
}

// classifyImageRole 按 role 给图片归类。归一化保证：没写 role 的单图按首帧，
// 多张已补 reference_image；显式 first_frame/last_frame 原样透传。
func classifyImageRole(reqs *VideoInputRequirements, role string) {
	switch role {
	case roleFirstFrame:
		reqs.FirstFrame++
		reqs.Inputs[VideoInputImage] = true
	case roleLastFrame:
		reqs.LastFrame++
		// 尾帧单独出现没有意义，与首帧配成才构成 first_last_frame；这里先按图片计，
		// 成对判断见 RequiresFirstLastFrame。
		reqs.Inputs[VideoInputImage] = true
	case roleReferenceImage:
		reqs.ReferenceImage++
		reqs.Inputs[VideoInputReferenceImage] = true
	default:
		// 无 role 的图片：单张按首帧（归一化已把多张的补成 reference_image）。
		reqs.FirstFrame++
		reqs.Inputs[VideoInputImage] = true
	}
}

// RequiresFirstLastFrame 是否同时带了首帧与尾帧。
func (r VideoInputRequirements) RequiresFirstLastFrame() bool {
	return r.FirstFrame > 0 && r.LastFrame > 0
}

// NeededInputs 把成对首尾帧折算成对应输入形态，返回最终要比对的集合。
// 单首帧按 image（单图生视频）；首+尾按 first_last_frame。
func (r VideoInputRequirements) NeededInputs() []VideoInputKind {
	needed := make([]VideoInputKind, 0, len(r.Inputs))
	seen := map[VideoInputKind]bool{}
	add := func(kind VideoInputKind) {
		if !seen[kind] {
			seen[kind] = true
			needed = append(needed, kind)
		}
	}
	for kind := range r.Inputs {
		if kind == VideoInputImage && r.RequiresFirstLastFrame() {
			// 成对首尾帧用专门形态表达，不再按单图判断。
			continue
		}
		add(kind)
	}
	if r.RequiresFirstLastFrame() {
		add(VideoInputFirstLastFrame)
	}
	return needed
}

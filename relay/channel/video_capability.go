package channel

import (
	"strings"

	"github.com/QuantumNous/new-api/constant"
)

// 视频任务渠道的能力声明。
//
// 为什么需要它：同一个请求打到不同渠道结果完全不同 —— Kling 的结构里没有参考视频字段，
// 会静默忽略；Vidu 按图片张数切换模式；CyAI 对没有 role 的图片直接报错；各家的分辨率与
// 时长范围也各不相同。这些差异此前一部分散落在适配器代码里、一部分**硬编码在前端组件**
// （见 web/default 的 video-parameter-controls.tsx），前端与调用方无从预知，只能提交后撞错误。
//
// 这里把差异收敛成一份**可下发的声明**：前端据此决定模型可选/置灰、参数出哪些选项，
// 后端据此过滤渠道，两边用同一份数据，避免两套判定互相漂移。
type VideoInputKind string

const (
	// VideoInputText 纯文本提示词。
	VideoInputText VideoInputKind = "text"
	// VideoInputImage 单图即首帧（无 role 的单张参考图按首帧意图处理）。
	VideoInputImage VideoInputKind = "image"
	// VideoInputReferenceImage 多图参考（角色/场景/风格等）。
	VideoInputReferenceImage VideoInputKind = "reference_image"
	// VideoInputFirstLastFrame 首帧 + 尾帧（必须恰好 2 张，且带 role）。
	VideoInputFirstLastFrame VideoInputKind = "first_last_frame"
	// VideoInputReferenceVideo 参考视频（视频生视频 / 延长 / 编辑）。
	VideoInputReferenceVideo VideoInputKind = "reference_video"
	// VideoInputReferenceAudio 参考音频（配音 / 节奏驱动）。
	VideoInputReferenceAudio VideoInputKind = "reference_audio"
)

// DurationRange 是模型可接受的输出时长范围（秒）。
type DurationRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
	// AllowAuto 表示支持 -1（交给模型自动选择时长）。
	AllowAuto bool `json:"allow_auto"`
}

// VideoCapability 是单个渠道类型的视频生成能力。
//
// 参数类字段（分辨率/比例/时长/音频…）为空或零值时表示「不作前置限制」，前端应退化成
// 自由输入而不是自己猜一组选项 —— 猜出来的选项正是本设计要消灭的东西。
type VideoCapability struct {
	Inputs           []VideoInputKind `json:"inputs"`
	MaxImages        int              `json:"max_images"`
	MaxVideos        int              `json:"max_videos"`
	MaxAudios        int              `json:"max_audios"`
	ReturnsLastFrame bool             `json:"returns_last_frame"`

	Resolutions       []string      `json:"resolutions"`
	Ratios            []string      `json:"ratios"`
	Duration          DurationRange `json:"duration"`
	SupportsAudio     bool          `json:"supports_audio"`
	SupportsWatermark bool          `json:"supports_watermark"`
	SupportsSeed      bool          `json:"supports_seed"`

	// Source 标记该能力的来源：declared（适配器声明）或 upstream（上游实时返回）。
	Source string `json:"source"`
}

// 通用参数档位。搬到后端之前，这三套取值硬编码在前端组件里按模型名子串区分。
var (
	standardResolutions = []string{"480p", "720p", "1080p"}
	standardRatios      = []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"}
	standardDuration    = DurationRange{Min: 4, Max: 15, AllowAuto: true}
	// standardParams 是大多数视频渠道的参数集（含音频/水印/seed 开关）。
	standardParams = paramSet(standardResolutions, standardRatios, standardDuration, true)
)

// paramSet 生成一份参数声明。
func paramSet(resolutions, ratios []string, duration DurationRange, audio bool) capParams {
	return capParams{
		resolutions: resolutions,
		ratios:      ratios,
		duration:    duration,
		audio:       audio,
	}
}

type capParams struct {
	resolutions []string
	ratios      []string
	duration    DurationRange
	audio       bool
}

func apply(base VideoCapability, params capParams) VideoCapability {
	base.Resolutions = params.resolutions
	base.Ratios = params.ratios
	base.Duration = params.duration
	base.SupportsAudio = params.audio
	// 水印与 seed 目前所有视频渠道都接受透传，保持与既有前端一致。
	base.SupportsWatermark = true
	base.SupportsSeed = true
	base.Source = "declared"
	return base
}

// 能力档位的复用定义，避免 14 条渠道各写一份。
var (
	// 火山 Seedance 系（含各中转）：文本 + 首帧 + 多图参考 + 首尾帧 + 参考视频/音频。
	capSeedanceFull = VideoCapability{
		Inputs:    []VideoInputKind{VideoInputText, VideoInputImage, VideoInputReferenceImage, VideoInputFirstLastFrame, VideoInputReferenceVideo, VideoInputReferenceAudio},
		MaxImages: 9, MaxVideos: 3, MaxAudios: 3,
		ReturnsLastFrame: true,
	}
	// 中转渠道复用同一套协议，但不返回尾帧。
	capSeedanceGateway = VideoCapability{
		Inputs:    []VideoInputKind{VideoInputText, VideoInputImage, VideoInputReferenceImage, VideoInputFirstLastFrame, VideoInputReferenceVideo, VideoInputReferenceAudio},
		MaxImages: 9, MaxVideos: 3, MaxAudios: 3,
	}
	// 单图生视频：只吃一张首帧图。
	capSingleImage = VideoCapability{
		Inputs:    []VideoInputKind{VideoInputText, VideoInputImage},
		MaxImages: 1,
	}
	// 图生视频 + 参考音频（阿里 wan 系）。
	capImageWithAudio = VideoCapability{
		Inputs:    []VideoInputKind{VideoInputText, VideoInputImage, VideoInputFirstLastFrame, VideoInputReferenceAudio},
		MaxImages: 2, MaxAudios: 1,
	}
	// Vidu：1 张=图生、2 张=首尾帧、多张=参考图。
	capVidu = VideoCapability{
		Inputs:    []VideoInputKind{VideoInputText, VideoInputImage, VideoInputFirstLastFrame, VideoInputReferenceImage},
		MaxImages: 7,
	}
	// 纯文生视频。
	capTextOnly = VideoCapability{
		Inputs: []VideoInputKind{VideoInputText},
	}
)

// videoCapabilityByChannelType 是渠道类型 → 能力的声明表。
// 未列入的渠道类型按「仅文生视频 + 通用参数」处理（最保守的输入面）。
var videoCapabilityByChannelType = map[int]VideoCapability{
	constant.ChannelTypeSeedance:    apply(capSeedanceFull, standardParams),
	constant.ChannelTypeDoubaoVideo: apply(capSeedanceFull, standardParams),
	constant.ChannelTypeVolcEngine:  apply(capSeedanceFull, standardParams),
	constant.ChannelTypeFoxtoken:    apply(capSeedanceGateway, standardParams),
	// GlobalAiOpc 与 CyAI 的分辨率集合按现有前端规则原样搬过来。
	constant.ChannelTypeGlobalaiopc: apply(capSeedanceGateway,
		paramSet([]string{"720p", "1080p", "2k", "4k"}, standardRatios, standardDuration, true)),
	// CyAI 上游不接受 -1（自动）时长，否则报 400 invalid_seconds。
	constant.ChannelTypeCyai: apply(capSeedanceGateway,
		paramSet([]string{"480p", "720p", "1080p", "4k"}, standardRatios,
			DurationRange{Min: 4, Max: 15}, true)),
	// 咪咕云：模型清单直接给出 4-30 秒、720p/1080p/4k、支持 adaptive 比例。
	constant.ChannelTypeMiguAigc: apply(capTextOnly,
		paramSet([]string{"720p", "1080p", "4k"},
			[]string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
			DurationRange{Min: 4, Max: 30, AllowAuto: true}, true)),
	constant.ChannelTypeKling:    apply(capSingleImage, standardParams),
	constant.ChannelTypeJimeng:   apply(capSingleImage, standardParams),
	constant.ChannelTypeSora:     apply(capSingleImage, standardParams),
	constant.ChannelTypeOpenAI:   apply(capSingleImage, standardParams),
	constant.ChannelTypeGemini:   apply(capSingleImage, standardParams),
	constant.ChannelTypeVertexAi: apply(capSingleImage, standardParams),
	constant.ChannelTypeMiniMax:  apply(capSingleImage, standardParams),
	constant.ChannelTypeAli:      apply(capImageWithAudio, standardParams),
	constant.ChannelTypeVidu:     apply(capVidu, standardParams),
	constant.ChannelTypeSunoAPI:  apply(capTextOnly, standardParams),
}

// GetVideoCapability 返回渠道类型的视频生成能力。
func GetVideoCapability(channelType int) VideoCapability {
	if capability, ok := videoCapabilityByChannelType[channelType]; ok {
		return capability
	}
	return apply(capTextOnly, standardParams)
}

// modelDurationOverrides 按模型名关键字收紧时长上限。
//
// 同一个渠道类型下不同模型的时长范围并不一致：seedance2.5 支持 30 秒，2.0 与 fast/mini
// 只到 15 秒；CyAI 连 -1（自动）都不接受。这里只做**收紧**（与渠道声明取交集），
// 绝不越过渠道自己的声明放宽，避免造出「界面上能选、上游却拒绝」的组合。
var modelDurationOverrides = []struct {
	keyword string
	value   DurationRange
}{
	{"seedance2.5", DurationRange{Min: 4, Max: 30, AllowAuto: true}},
	{"seedance-2-5", DurationRange{Min: 4, Max: 30, AllowAuto: true}},
	{"fast", DurationRange{Min: 4, Max: 15, AllowAuto: true}},
	{"mini", DurationRange{Min: 4, Max: 15, AllowAuto: true}},
	{"seedance2.0", DurationRange{Min: 4, Max: 15, AllowAuto: true}},
	{"seedance-2-0", DurationRange{Min: 4, Max: 15, AllowAuto: true}},
}

// RefineVideoCapabilityForModel 按模型名收紧时长范围（取交集，只收紧不放宽）。
func RefineVideoCapabilityForModel(capability VideoCapability, modelName string) VideoCapability {
	name := strings.ToLower(strings.TrimSpace(modelName))
	for _, override := range modelDurationOverrides {
		if !strings.Contains(name, override.keyword) {
			continue
		}
		capability.Duration = intersectDuration(capability.Duration, override.value)
		break
	}
	return capability
}

func intersectDuration(base, override DurationRange) DurationRange {
	merged := base
	if override.Min > merged.Min {
		merged.Min = override.Min
	}
	if override.Max < merged.Max {
		merged.Max = override.Max
	}
	merged.AllowAuto = merged.AllowAuto && override.AllowAuto
	if merged.Max < merged.Min {
		// 交集为空说明声明有冲突：退回更保守的一方，宁少不多。
		return override
	}
	return merged
}

// MergeVideoCapabilities 取多个渠道能力的并集。
//
// 取并集而不是交集，是因为同一个模型可能同时挂在多条渠道上：只要有一条接得住，
// 这个模型对用户就是可用的（选路由会挑到那条渠道上）。这也正是前端「亮」的含义。
func MergeVideoCapabilities(caps []VideoCapability) VideoCapability {
	merged := VideoCapability{Source: "declared"}
	seenInput := map[VideoInputKind]bool{}
	seenResolution := map[string]bool{}
	seenRatio := map[string]bool{}
	for _, capability := range caps {
		for _, input := range capability.Inputs {
			if !seenInput[input] {
				seenInput[input] = true
				merged.Inputs = append(merged.Inputs, input)
			}
		}
		for _, resolution := range capability.Resolutions {
			if !seenResolution[resolution] {
				seenResolution[resolution] = true
				merged.Resolutions = append(merged.Resolutions, resolution)
			}
		}
		for _, ratio := range capability.Ratios {
			if !seenRatio[ratio] {
				seenRatio[ratio] = true
				merged.Ratios = append(merged.Ratios, ratio)
			}
		}
		merged.MaxImages = maxInt(merged.MaxImages, capability.MaxImages)
		merged.MaxVideos = maxInt(merged.MaxVideos, capability.MaxVideos)
		merged.MaxAudios = maxInt(merged.MaxAudios, capability.MaxAudios)
		merged.ReturnsLastFrame = merged.ReturnsLastFrame || capability.ReturnsLastFrame
		merged.SupportsAudio = merged.SupportsAudio || capability.SupportsAudio
		merged.SupportsWatermark = merged.SupportsWatermark || capability.SupportsWatermark
		merged.SupportsSeed = merged.SupportsSeed || capability.SupportsSeed
		merged.Duration = unionDuration(merged.Duration, capability.Duration)
		if capability.Source == "upstream" {
			merged.Source = "upstream"
		}
	}
	if merged.Inputs == nil {
		merged.Inputs = []VideoInputKind{VideoInputText}
	}
	return merged
}

// unionDuration 取可接受的时长并集：只要有一条渠道接受该区间，用户就能选。
func unionDuration(base, next DurationRange) DurationRange {
	if next.Max == 0 {
		return base
	}
	if base.Max == 0 {
		return next
	}
	merged := DurationRange{
		Min:       minInt(base.Min, next.Min),
		Max:       maxInt(base.Max, next.Max),
		AllowAuto: base.AllowAuto || next.AllowAuto,
	}
	return merged
}

// SupportsInput 判断能力是否包含某种输入形态。
func (c VideoCapability) SupportsInput(kind VideoInputKind) bool {
	for _, input := range c.Inputs {
		if input == kind {
			return true
		}
	}
	return false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

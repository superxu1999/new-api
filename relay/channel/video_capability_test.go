package channel

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

// TestVideoCapabilityDeclarations 锁定「渠道能吃哪些素材」的声明。
// 这份声明同时驱动前端置灰与后端选路，声明错了会直接表现成「模型点了没反应」或
// 「明明不支持却可点」，因此按渠道类型逐条断言。
func TestVideoCapabilityDeclarations(t *testing.T) {
	cases := []struct {
		channelType int
		wantInputs  []VideoInputKind
		wantVideo   bool
		wantAudio   bool
		wantLastFrm bool
	}{
		{constant.ChannelTypeSeedance, []VideoInputKind{VideoInputText, VideoInputImage, VideoInputReferenceImage, VideoInputFirstLastFrame, VideoInputReferenceVideo, VideoInputReferenceAudio}, true, true, true},
		{constant.ChannelTypeCyai, []VideoInputKind{VideoInputText, VideoInputImage, VideoInputReferenceImage, VideoInputFirstLastFrame, VideoInputReferenceVideo, VideoInputReferenceAudio}, true, true, false},
		{constant.ChannelTypeKling, []VideoInputKind{VideoInputText, VideoInputImage}, false, false, false},
		{constant.ChannelTypeSora, []VideoInputKind{VideoInputText, VideoInputImage}, false, false, false},
		{constant.ChannelTypeVidu, []VideoInputKind{VideoInputText, VideoInputImage, VideoInputFirstLastFrame, VideoInputReferenceImage}, false, false, false},
		{constant.ChannelTypeAli, []VideoInputKind{VideoInputText, VideoInputImage, VideoInputFirstLastFrame, VideoInputReferenceAudio}, false, true, false},
		{constant.ChannelTypeMiguAigc, []VideoInputKind{VideoInputText}, false, false, false},
	}
	for _, tc := range cases {
		capability := GetVideoCapability(tc.channelType)
		assert.ElementsMatch(t, tc.wantInputs, capability.Inputs, "channel type %d", tc.channelType)
		assert.Equal(t, tc.wantVideo, capability.SupportsInput(VideoInputReferenceVideo), "channel type %d", tc.channelType)
		assert.Equal(t, tc.wantAudio, capability.SupportsInput(VideoInputReferenceAudio), "channel type %d", tc.channelType)
		assert.Equal(t, tc.wantLastFrm, capability.ReturnsLastFrame, "channel type %d", tc.channelType)
	}
}

// TestVideoCapabilityParameters 锁定参数声明：这些取值原本硬编码在前端组件里按模型名区分，
// 搬到后端后必须与原行为一致，否则用户会选到上游不接受的参数。
func TestVideoCapabilityParameters(t *testing.T) {
	standard := GetVideoCapability(constant.ChannelTypeSeedance)
	assert.Equal(t, []string{"480p", "720p", "1080p"}, standard.Resolutions)
	// 协议上限 30（seedance2.5 支持）；单模型到 15 的收紧由 RefineVideoCapabilityForModel 管。
	assert.Equal(t, DurationRange{Min: 4, Max: 30, AllowAuto: true}, standard.Duration)
	assert.True(t, standard.SupportsAudio)

	opc := GetVideoCapability(constant.ChannelTypeGlobalaiopc)
	assert.Equal(t, []string{"720p", "1080p", "2k", "4k"}, opc.Resolutions)

	// CyAI 不接受 -1（自动），否则上游报 400 invalid_seconds；时长上限按模型收紧：
	// 上游中转层放行到 3600 秒，真正的天花板是模型（2.5 系 30 秒）。
	cyai := GetVideoCapability(constant.ChannelTypeCyai)
	assert.Equal(t, []string{"480p", "720p", "1080p", "4k"}, cyai.Resolutions)
	assert.False(t, cyai.Duration.AllowAuto)
	assert.Equal(t, 30, cyai.Duration.Max)

	// 咪咕云上游清单给出 4-30 秒与 4k，且支持 adaptive 比例。
	migu := GetVideoCapability(constant.ChannelTypeMiguAigc)
	assert.Equal(t, DurationRange{Min: 4, Max: 30, AllowAuto: true}, migu.Duration)
	assert.Contains(t, migu.Resolutions, "4k")
	assert.Contains(t, migu.Ratios, "adaptive")
}

// TestRefineVideoCapabilityForModel 模型级收紧只做交集：既不越过渠道声明放宽，
// 也要把 2.0/fast/mini 这类只到 15 秒的模型收回来。
func TestRefineVideoCapabilityForModel(t *testing.T) {
	migu := GetVideoCapability(constant.ChannelTypeMiguAigc)
	assert.Equal(t, DurationRange{Min: 4, Max: 30, AllowAuto: true},
		RefineVideoCapabilityForModel(migu, "seedance2.5-migu").Duration)
	assert.Equal(t, DurationRange{Min: 4, Max: 15, AllowAuto: true},
		RefineVideoCapabilityForModel(migu, "seedance2.0-migu").Duration)
	assert.Equal(t, DurationRange{Min: 4, Max: 15, AllowAuto: true},
		RefineVideoCapabilityForModel(migu, "seedance2.0-migu-fast").Duration)
	// 渠道协议上限是 30（seedance2.5 支持），2.5 模型不吃收紧；2.0 被 override 收到 15。
	seedance := GetVideoCapability(constant.ChannelTypeSeedance)
	assert.Equal(t, 30, RefineVideoCapabilityForModel(seedance, "doubao-seedance-2-5-260628").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(seedance, "doubao-seedance-2-0-260128").Duration.Max)
	// 认不出的模型保持渠道声明。
	assert.Equal(t, migu.Duration, RefineVideoCapabilityForModel(migu, "unknown-model").Duration)
}

// TestRefineDurationForTwoAndHalfAliases 锁定「2.5 的马甲名不能被 2.0 规则误伤」。
//
// 各家给 seedance2.5 起的对外名里仍带着 "2.0"（seedance2.0-cyai-25-260628 等），
// 而关键字规则是命中即停；一旦 2.0 的规则排在前面，这些模型就会被压到 15 秒，
// 用户在界面上根本选不到上游明明支持的 30 秒。这里逐个模型名钉死上限。
func TestRefineDurationForTwoAndHalfAliases(t *testing.T) {
	cyai := GetVideoCapability(constant.ChannelTypeCyai)
	assert.Equal(t, 30, RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-25-260628").Duration.Max)
	assert.Equal(t, 30, RefineVideoCapabilityForModel(cyai, "doubao-seedance-2-5-260628").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-260128").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-fast-260128").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-mini-260615").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-mobile-260128").Duration.Max)

	foxtoken := GetVideoCapability(constant.ChannelTypeFoxtoken)
	assert.Equal(t, 30, RefineVideoCapabilityForModel(foxtoken, "seedance2.0-foxtoken-25").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(foxtoken, "seedance2.0-foxtoken").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(foxtoken, "seedance2.0-foxtoken-fast").Duration.Max)

	opc := GetVideoCapability(constant.ChannelTypeGlobalaiopc)
	assert.Equal(t, 30, RefineVideoCapabilityForModel(opc, "seedance2.0-globalaiopc-v25").Duration.Max)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(opc, "seedance2.0-globalaiopc").Duration.Max)

	// -1（自动）不能被模型级收紧偷偷打开：CyAI 渠道声明就不支持。
	refined := RefineVideoCapabilityForModel(cyai, "seedance2.0-cyai-25-260628")
	assert.False(t, refined.Duration.AllowAuto)
	assert.Equal(t, 4, refined.Duration.Min)
}

// 宁可让用户看到置灰，也不能把一个做不到的组合显示成可用。
func TestUnknownChannelTypeIsTextOnly(t *testing.T) {
	capability := GetVideoCapability(9999)
	assert.Equal(t, []VideoInputKind{VideoInputText}, capability.Inputs)
	assert.Equal(t, 0, capability.MaxImages)
	assert.False(t, capability.ReturnsLastFrame)
}

// TestMergeVideoCapabilities 同一个模型挂在多条渠道上时取并集：
// 只要有一条渠道接得住，这个模型对用户就是可用的。
func TestMergeVideoCapabilities(t *testing.T) {
	merged := MergeVideoCapabilities([]VideoCapability{
		GetVideoCapability(constant.ChannelTypeKling),
		GetVideoCapability(constant.ChannelTypeSeedance),
	})
	assert.True(t, merged.SupportsInput(VideoInputReferenceVideo))
	assert.True(t, merged.SupportsInput(VideoInputReferenceAudio))
	assert.True(t, merged.ReturnsLastFrame)
	// 数量上限取更宽松的一方（接了参考视频的那条渠道）。
	assert.Equal(t, 9, merged.MaxImages)
	assert.Equal(t, 3, merged.MaxVideos)

	// 空集合退化成仅文生，不留空输入列表。
	empty := MergeVideoCapabilities(nil)
	assert.Equal(t, []VideoInputKind{VideoInputText}, empty.Inputs)
}

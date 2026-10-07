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
	assert.Equal(t, DurationRange{Min: 4, Max: 15, AllowAuto: true}, standard.Duration)
	assert.True(t, standard.SupportsAudio)

	opc := GetVideoCapability(constant.ChannelTypeGlobalaiopc)
	assert.Equal(t, []string{"720p", "1080p", "2k", "4k"}, opc.Resolutions)

	// CyAI 不接受 -1（自动），否则上游报 400 invalid_seconds。
	cyai := GetVideoCapability(constant.ChannelTypeCyai)
	assert.Equal(t, []string{"480p", "720p", "1080p", "4k"}, cyai.Resolutions)
	assert.False(t, cyai.Duration.AllowAuto)

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
	// 渠道声明更小时不能被模型覆盖放宽（seedance 渠道只声明到 15）。
	seedance := GetVideoCapability(constant.ChannelTypeSeedance)
	assert.Equal(t, 15, RefineVideoCapabilityForModel(seedance, "doubao-seedance-2-5-260628").Duration.Max)
	// 认不出的模型保持渠道声明。
	assert.Equal(t, migu.Duration, RefineVideoCapabilityForModel(migu, "unknown-model").Duration)
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

package channel

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
)

// contentItem 构造一个归一化后的 content 元素（type + URL 字段 + 可选 role）。
func contentItem(typeName, role string) map[string]interface{} {
	item := map[string]interface{}{
		"type":    typeName,
		typeName:  map[string]interface{}{"url": "https://example.com/" + typeName},
	}
	if role != "" {
		item["role"] = role
	}
	return item
}

func reqWithContent(items ...map[string]interface{}) *relaycommon.TaskSubmitReq {
	arr := make([]interface{}, len(items))
	for i, item := range items {
		arr[i] = item
	}
	return &relaycommon.TaskSubmitReq{
		Prompt: "test",
		Metadata: map[string]interface{}{
			"content": arr,
		},
	}
}

// TestExtractVideoInputRequirements 锁定「归一化后的 content → 输入需求」的映射，
// 这是两层校验与选路共用的基础，数错了后面全错。
func TestExtractVideoInputRequirements(t *testing.T) {
	cases := []struct {
		name     string
		req      *relaycommon.TaskSubmitReq
		wantIn   []VideoInputKind
		wantFLF  bool
		wantRefs [3]int // refImage, video, audio
	}{
		{
			name:   "纯文生",
			req:    &relaycommon.TaskSubmitReq{Prompt: "a cat"},
			wantIn: []VideoInputKind{VideoInputText},
		},
		{
			name:    "单图无role=首帧",
			req:     reqWithContent(contentItem(contentTypeImageURL, "")),
			wantIn:  []VideoInputKind{VideoInputText, VideoInputImage},
			wantFLF: false,
		},
		{
			name: "首帧+尾帧",
			req: reqWithContent(
				contentItem(contentTypeImageURL, roleFirstFrame),
				contentItem(contentTypeImageURL, roleLastFrame),
			),
			wantIn:  []VideoInputKind{VideoInputText, VideoInputFirstLastFrame},
			wantFLF: true,
		},
		{
			name: "多张参考图",
			req: reqWithContent(
				contentItem(contentTypeImageURL, roleReferenceImage),
				contentItem(contentTypeImageURL, roleReferenceImage),
			),
			wantIn:   []VideoInputKind{VideoInputText, VideoInputReferenceImage},
			wantRefs: [3]int{2, 0, 0},
		},
		{
			name:    "参考视频+参考音频",
			req:     reqWithContent(contentItem(contentTypeVideoURL, roleReferenceVideo), contentItem(contentTypeAudioURL, roleReferenceAudio)),
			wantIn:  []VideoInputKind{VideoInputText, VideoInputReferenceVideo, VideoInputReferenceAudio},
			wantRefs: [3]int{0, 1, 1},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractVideoInputRequirements(tc.req)
			assert.ElementsMatch(t, tc.wantIn, got.NeededInputs())
			assert.Equal(t, tc.wantFLF, got.RequiresFirstLastFrame())
			assert.Equal(t, tc.wantRefs[0], got.ReferenceImage)
			assert.Equal(t, tc.wantRefs[1], got.Video)
			assert.Equal(t, tc.wantRefs[2], got.Audio)
		})
	}
}

// TestCheckVideoCapability 锁定「能力 × 请求需求 → 是否接得住」的判定，
// 与前端 evaluateModel 同源：两边对同一组合必须给出同样的能/不能。
func TestCheckVideoCapability(t *testing.T) {
	kling := GetVideoCapability(constant.ChannelTypeKling) // text+image 单图
	seedance := GetVideoCapability(constant.ChannelTypeSeedance)

	refVideoReq := ExtractVideoInputRequirements(reqWithContent(contentItem(contentTypeVideoURL, roleReferenceVideo)))
	singleImageReq := ExtractVideoInputRequirements(reqWithContent(contentItem(contentTypeImageURL, "")))

	// Kling 不接参考视频 —— 这是「静默降级」要消掉的核心场景。
	assert.NotEmpty(t, CheckVideoCapability(kling, refVideoReq))
	// Seedance 接参考视频。
	assert.Empty(t, CheckVideoCapability(seedance, refVideoReq))
	// Kling 接单图。
	assert.Empty(t, CheckVideoCapability(kling, singleImageReq))

	// 数量上限：超过 max_images 要报出来。
	manyRefImages := ExtractVideoInputRequirements(reqWithContent(
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
		contentItem(contentTypeImageURL, roleReferenceImage),
	))
	assert.NotEmpty(t, CheckVideoCapability(seedance, manyRefImages))
}

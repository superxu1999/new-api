package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
)

// contentElem 构造归一化后的 content 元素（与 channel 包测试同形，避免跨包引用测试辅助）。
func contentElem(typeName, role string) map[string]interface{} {
	item := map[string]interface{}{
		"type":   typeName,
		typeName: map[string]interface{}{"url": "https://example.com/" + typeName},
	}
	if role != "" {
		item["role"] = role
	}
	return item
}

func reqsOf(items ...map[string]interface{}) channel.VideoInputRequirements {
	arr := make([]interface{}, len(items))
	for i, item := range items {
		arr[i] = item
	}
	req := &relaycommon.TaskSubmitReq{
		Prompt:   "test",
		Metadata: map[string]interface{}{"content": arr},
	}
	return channel.ExtractVideoInputRequirements(req)
}

// TestBuildVideoChannelTypeFilter 锁定选路谓词：带参考视频的请求要滤掉 Kling（只接文生+单图），
// 保留 Seedance；纯文生请求返回 nil（不过滤），保持既有选路行为。
func TestBuildVideoChannelTypeFilter(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "seedance2.0-cyai-260128"}

	// 纯文生：不过滤（nil），选路行为与改动前完全一致。
	textOnly := reqsOf()
	assert.Nil(t, buildVideoChannelTypeFilter(info, textOnly))

	// 带参考视频：Kling 被滤掉，Seedance 保留 —— 这是消掉「静默降级」的关键。
	refVideo := reqsOf(contentElem("video_url", "reference_video"))
	filter := buildVideoChannelTypeFilter(info, refVideo)
	assert.NotNil(t, filter)
	assert.False(t, filter(constant.ChannelTypeKling), "Kling 接不住参考视频，应被滤掉")
	assert.True(t, filter(constant.ChannelTypeSeedance), "Seedance 接参考视频，应保留")

	// 带参考音频：Ali 接音频，Kling 不接。
	refAudio := reqsOf(contentElem("audio_url", "reference_audio"))
	audioFilter := buildVideoChannelTypeFilter(info, refAudio)
	assert.NotNil(t, audioFilter)
	assert.True(t, audioFilter(constant.ChannelTypeAli))
	assert.False(t, audioFilter(constant.ChannelTypeKling))

	// 单首帧图：Kling 也接得住，不应被滤。
	singleImage := reqsOf(contentElem("image_url", "first_frame"))
	imgFilter := buildVideoChannelTypeFilter(info, singleImage)
	assert.NotNil(t, imgFilter)
	assert.True(t, imgFilter(constant.ChannelTypeKling))
}

package globalaiopc

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultStatusMapping(t *testing.T) {
	adaptor := &TaskAdaptor{}
	tests := []struct {
		name       string
		body       string
		wantStatus model.TaskStatus
		wantURL    string
		wantReason string
	}{
		{name: "queued maps to queued", body: `{"id":"mcp-1","status":"queued"}`, wantStatus: model.TaskStatusQueued},
		{name: "processing maps to in progress", body: `{"id":"mcp-1","status":"processing"}`, wantStatus: model.TaskStatusInProgress},
		{
			name:       "succeeded keeps result_url",
			body:       `{"id":"mcp-1","status":"succeeded","result_url":"https://cdn.example.com/v.mp4"}`,
			wantStatus: model.TaskStatusSuccess,
			wantURL:    "https://cdn.example.com/v.mp4",
		},
		{
			name:       "succeeded falls back to video_url",
			body:       `{"id":"mcp-1","status":"success","video_url":"https://cdn.example.com/v.mp4"}`,
			wantStatus: model.TaskStatusSuccess,
			wantURL:    "https://cdn.example.com/v.mp4",
		},
		{
			name:       "completed maps to success with result_url",
			body:       `{"id":"mcp-1","status":"completed","result_url":"https://cdn.example.com/v.mp4","progress":100}`,
			wantStatus: model.TaskStatusSuccess,
			wantURL:    "https://cdn.example.com/v.mp4",
		},
		{
			name:       "failed carries upstream error",
			body:       `{"id":"mcp-1","status":"failed","error":"上游提交未返回task_id"}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "上游提交未返回task_id",
		},
		{name: "unknown status treated as in progress", body: `{"id":"mcp-1","status":"mystery"}`, wantStatus: model.TaskStatusInProgress},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := adaptor.ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			assert.Equal(t, string(tt.wantStatus), info.Status)
			assert.Equal(t, tt.wantURL, info.Url)
			assert.Equal(t, tt.wantReason, info.Reason)
		})
	}
}

// collectReferenceAssets 决定哪些参考素材会被上传给上游。只认顶层 images 的话，
// 参考视频/参考音频、以及 content 形式的参考图（含顶层 content 与扁平写法的归一结果）
// 都会被静默丢掉。
func TestCollectReferenceAssets(t *testing.T) {
	content := []interface{}{
		map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": "https://cdn/ref.png"}, "role": "reference_image"},
		map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": "https://cdn/ref.mp4"}, "role": "reference_video"},
		map[string]interface{}{"type": "audio_url", "audio_url": map[string]interface{}{"url": "https://cdn/ref.mp3"}, "role": "reference_audio"},
		map[string]interface{}{"type": "text", "text": "提示词"},
	}

	t.Run("顶层 images 按参考图收集", func(t *testing.T) {
		got := collectReferenceAssets(&relaycommon.TaskSubmitReq{Images: []string{" https://cdn/a.png "}})
		assert.Equal(t, []referenceAsset{{assetType: "Image", url: "https://cdn/a.png"}}, got)
	})

	t.Run("content 按类型分别收集图/视频/音频", func(t *testing.T) {
		got := collectReferenceAssets(&relaycommon.TaskSubmitReq{
			Metadata: map[string]interface{}{"content": content},
		})
		assert.Equal(t, []referenceAsset{
			{assetType: "Image", url: "https://cdn/ref.png"},
			{assetType: "Video", url: "https://cdn/ref.mp4"},
			{assetType: "Audio", url: "https://cdn/ref.mp3"},
		}, got)
	})

	t.Run("同一 URL 只上传一次", func(t *testing.T) {
		got := collectReferenceAssets(&relaycommon.TaskSubmitReq{
			Images: []string{"https://cdn/ref.png", "https://cdn/ref.png"},
			Metadata: map[string]interface{}{"content": []interface{}{
				map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": "https://cdn/ref.png"}},
			}},
		})
		assert.Equal(t, []referenceAsset{{assetType: "Image", url: "https://cdn/ref.png"}}, got)
	})

	t.Run("容错 {type,url} 扁平写法", func(t *testing.T) {
		got := collectReferenceAssets(&relaycommon.TaskSubmitReq{
			Metadata: map[string]interface{}{"content": []interface{}{
				map[string]interface{}{"type": "video_url", "url": "https://cdn/flat.mp4"},
			}},
		})
		assert.Equal(t, []referenceAsset{{assetType: "Video", url: "https://cdn/flat.mp4"}}, got)
	})

	t.Run("没有参考素材时为空", func(t *testing.T) {
		assert.Empty(t, collectReferenceAssets(&relaycommon.TaskSubmitReq{}))
		assert.Empty(t, collectReferenceAssets(nil))
	})
}

// 请求体应把 resolution 缺省为 720p(上游 SKU 匹配需要),duration/seed 等按 metadata 透传。
func TestConvertToRequestPayloadDefaults(t *testing.T) {
	adaptor := &TaskAdaptor{}
	req := &relaycommon.TaskSubmitReq{
		Prompt:   "日落海边",
		Model:    "sd_2.0_special",
		Duration: 5,
		Metadata: map[string]interface{}{
			"ratio":          "16:9",
			"resolution":     "1080p",
			"generate_audio": true,
		},
	}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	payload, err := adaptor.convertToRequestPayload(nil, req, info)
	require.NoError(t, err)
	assert.Equal(t, "sd_2.0_special", payload.Model)
	assert.Equal(t, "16:9", payload.AspectRatio)
	assert.Equal(t, "1080p", payload.Resolution)
	require.NotNil(t, payload.Duration)
	assert.Equal(t, 5, *payload.Duration)
	require.NotNil(t, payload.GenerateAudio)
	assert.True(t, *payload.GenerateAudio)
}

// 上游只接受 720p/1080p/2k/4k;传入非法值(如 480p)或未填时应回退到 720p,避免上游 4xx。
func TestConvertToRequestPayloadClampsInvalidResolution(t *testing.T) {
	adaptor := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}

	// 非法 480p -> 回退 720p
	payload, err := adaptor.convertToRequestPayload(nil, &relaycommon.TaskSubmitReq{
		Prompt: "x", Model: "sd_2.0_special", Duration: 5,
		Metadata: map[string]interface{}{"resolution": "480p"},
	}, info)
	require.NoError(t, err)
	assert.Equal(t, "720p", payload.Resolution)

	// 未填 -> 回退 720p
	payload, err = adaptor.convertToRequestPayload(nil, &relaycommon.TaskSubmitReq{
		Prompt: "x", Model: "sd_2.0_special", Duration: 5, Metadata: nil,
	}, info)
	require.NoError(t, err)
	assert.Equal(t, "720p", payload.Resolution)

	// 合法 4k -> 保留
	payload, err = adaptor.convertToRequestPayload(nil, &relaycommon.TaskSubmitReq{
		Prompt: "x", Model: "sd_2.0_special", Duration: 5,
		Metadata: map[string]interface{}{"resolution": "4k"},
	}, info)
	require.NoError(t, err)
	assert.Equal(t, "4k", payload.Resolution)
}

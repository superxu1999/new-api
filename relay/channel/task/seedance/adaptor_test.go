package seedance

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultStatusMapping(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name           string
		body           string
		wantStatus     model.TaskStatus
		wantURL        string
		wantReason     string
		wantTotalToken int
	}{
		{
			name:       "queued maps to queued",
			body:       `{"id":"c-1","status":"queued"}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:       "running maps to in progress",
			body:       `{"id":"c-1","status":"running"}`,
			wantStatus: model.TaskStatusInProgress,
		},
		{
			name:           "succeeded keeps url empty for proxy download",
			body:           `{"id":"c-1","status":"succeeded","content":{"video_url":"https://encrypted.example/v.mp4"},"usage":{"completion_tokens":10,"total_tokens":20}}`,
			wantStatus:     model.TaskStatusSuccess,
			wantURL:        "",
			wantTotalToken: 20,
		},
		{
			name:       "failed carries upstream error message",
			body:       `{"id":"c-1","status":"failed","error":{"code":"1001","message":"content rejected"}}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "content rejected",
		},
		{
			name:       "unknown status treated as in progress",
			body:       `{"id":"c-1","status":"mystery"}`,
			wantStatus: model.TaskStatusInProgress,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := adaptor.ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			assert.Equal(t, string(tt.wantStatus), info.Status)
			assert.Equal(t, tt.wantURL, info.Url)
			assert.Equal(t, tt.wantReason, info.Reason)
			assert.Equal(t, tt.wantTotalToken, info.TotalTokens)
		})
	}
}

func TestConvertToRequestPayload(t *testing.T) {
	adaptor := &TaskAdaptor{}

	req := &relaycommon.TaskSubmitReq{
		Prompt:  "日落时分的海边",
		Model:   "doubao-seedance-2.0",
		Seconds: "5",
		Images:  []string{"https://example.com/first-frame.png"},
		Metadata: map[string]interface{}{
			"ratio":          "16:9",
			"generate_audio": false,
			"watermark":      true,
		},
	}

	payload, err := adaptor.convertToRequestPayload(req)
	require.NoError(t, err)
	assert.Equal(t, "doubao-seedance-2.0", payload.Model)
	require.NotNil(t, payload.Duration)
	assert.Equal(t, 5, int(*payload.Duration))
	assert.Equal(t, "16:9", payload.Ratio)
	require.NotNil(t, payload.GenerateAudio)
	assert.False(t, bool(*payload.GenerateAudio))
	require.NotNil(t, payload.Watermark)
	assert.True(t, bool(*payload.Watermark))

	// 图生视频：参考图在前，文本提示词在最后
	require.Len(t, payload.Content, 2)
	assert.Equal(t, "image_url", payload.Content[0].Type)
	require.NotNil(t, payload.Content[0].ImageURL)
	assert.Equal(t, "https://example.com/first-frame.png", payload.Content[0].ImageURL.URL)
	assert.Equal(t, "text", payload.Content[1].Type)
	assert.Equal(t, "日落时分的海边", payload.Content[1].Text)

	// metadata 透传的 content 数组（多模态参考输入）应保留
	reqWithContent := &relaycommon.TaskSubmitReq{
		Prompt: "广告片",
		Model:  "doubao-seedance-2.0",
		Metadata: map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":      "video_url",
					"video_url": map[string]interface{}{"url": "https://example.com/ref.mp4"},
					"role":      "reference_video",
				},
			},
		},
	}
	payload2, err := adaptor.convertToRequestPayload(reqWithContent)
	require.NoError(t, err)
	require.Len(t, payload2.Content, 2)
	assert.Equal(t, "video_url", payload2.Content[0].Type)
	require.NotNil(t, payload2.Content[0].VideoURL)
	assert.Equal(t, "https://example.com/ref.mp4", payload2.Content[0].VideoURL.URL)
	assert.Equal(t, "reference_video", payload2.Content[0].Role)
	assert.Equal(t, "text", payload2.Content[1].Type)
}

// 序列化后的请求体必须符合代理文档的可选字段语义：
// 未提供的可选字段省略，显式 false/0 值保留。
func TestRequestPayloadMarshalOmitsUnsetOptionals(t *testing.T) {
	payload := requestPayload{
		Model: "doubao-seedance-2.0",
		Content: []ContentItem{
			{Type: "text", Text: "hello"},
		},
	}
	data, err := common.Marshal(payload)
	require.NoError(t, err)
	var decoded map[string]interface{}
	require.NoError(t, common.Unmarshal(data, &decoded))
	assert.NotContains(t, decoded, "duration")
	assert.NotContains(t, decoded, "generate_audio")
	assert.NotContains(t, decoded, "watermark")

	payload.GenerateAudio = (*dto.BoolValue)(boolPtr(false))
	data, err = common.Marshal(payload)
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(data, &decoded))
	assert.Contains(t, decoded, "generate_audio")
	assert.Equal(t, false, decoded["generate_audio"])
}

func boolPtr(b bool) *bool { return &b }

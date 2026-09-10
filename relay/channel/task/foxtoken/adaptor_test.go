package foxtoken

import (
	"testing"

	"github.com/QuantumNous/new-api/model"

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
		{
			name: "queued", body: `{"code":"success","data":{"status":"QUEUED","progress":"10%"}}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name: "success", body: `{"code":"success","data":{"status":"SUCCESS","result_url":"https://cdn/x.mp4","progress":"100%"}}`,
			wantStatus: model.TaskStatusSuccess, wantURL: "https://cdn/x.mp4",
		},
		{
			name: "failure", body: `{"code":"success","data":{"status":"FAILURE","fail_reason":"boom"}}`,
			wantStatus: model.TaskStatusFailure, wantReason: "boom",
		},
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

// 上游（new-api 实例）在轮询响应里返回官方口径的视频 token，完成后的差额结算依赖它。
// 真实报文形状取自线上任务（5 秒 720p：108900 token）。
func TestParseTaskResultReturnsUpstreamUsage(t *testing.T) {
	adaptor := &TaskAdaptor{}
	body := `{"code":"success","data":{"status":"succeeded","progress":"100%","result_url":"https://cdn/x.mp4","usage":{"completion_tokens":108900,"total_tokens":108900}},"fail_reason":""}`

	info, err := adaptor.ParseTaskResult([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
	assert.Equal(t, 108900, info.CompletionTokens)
	assert.Equal(t, 108900, info.TotalTokens)
}

// 上游未返回 usage 时必须保持 0，计费回落为预扣额度而不是按 0 token 重算。
func TestParseTaskResultWithoutUsageKeepsZeroTokens(t *testing.T) {
	adaptor := &TaskAdaptor{}
	body := `{"code":"success","data":{"status":"SUCCESS","result_url":"https://cdn/x.mp4","progress":"100%"}}`

	info, err := adaptor.ParseTaskResult([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, 0, info.CompletionTokens)
	assert.Equal(t, 0, info.TotalTokens)
}

package migu

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseTaskResultMapsUpstreamStatus 锁定「上游数字状态 → 内部任务状态」的契约。
// 状态映射直接决定任务是否被判定为终态，进而决定退款与计费，映射错了会错账。
func TestParseTaskResultMapsUpstreamStatus(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantStatus model.TaskStatus
		wantReason string
		wantURL    string
	}{
		{
			name:       "待处理映射为排队",
			body:       `{"code":"0","data":{"status":1}}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:       "排队中映射为排队",
			body:       `{"code":"0","data":{"status":2}}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:       "处理中",
			body:       `{"code":"0","data":{"status":3}}`,
			wantStatus: model.TaskStatusInProgress,
		},
		{
			name: "已完成但不可交付仍需继续轮询",
			body: `{"code":"0","data":{"status":4,"deliverable":false}}`,
			// 上游把「已完成但仍在审核」也记为 4：此时成品取不到，判成成功会拿到空 URL。
			wantStatus: model.TaskStatusInProgress,
		},
		{
			name:       "已完成且可交付",
			body:       `{"code":"0","data":{"status":4,"deliverable":true,"downloadUrl":"https://cdn.example.com/a.mp4"}}`,
			wantStatus: model.TaskStatusSuccess,
			wantURL:    "https://cdn.example.com/a.mp4",
		},
		{
			name:       "已交付时优先后端注入的下载地址",
			body:       `{"code":"0","newApiDownloadUrl":"https://cdn.example.com/injected.mp4","data":{"status":4,"deliverable":true}}`,
			wantStatus: model.TaskStatusSuccess,
			wantURL:    "https://cdn.example.com/injected.mp4",
		},
		{
			name:       "失败带上游原因",
			body:       `{"code":"0","data":{"status":5,"errorMsg":"content policy violation"}}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "content policy violation",
		},
		{
			name:       "已取消按失败处理",
			body:       `{"code":"0","data":{"status":6}}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "canceled upstream",
		},
		{
			name: "未知状态不能误判成终态",
			body: `{"code":"0","data":{"status":99}}`,
			// 上游新增状态时按进行中继续轮询，比误判成成功/失败安全。
			wantStatus: model.TaskStatusInProgress,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := &TaskAdaptor{}
			got, err := a.ParseTaskResult([]byte(tc.body))
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, model.TaskStatus(got.Status))
			assert.Equal(t, tc.wantURL, got.Url)
			if tc.wantReason != "" {
				assert.Equal(t, tc.wantReason, got.Reason)
			}
		})
	}
}

// TestParseTaskResultRejectsBusinessError 业务失败必须报错，否则轮询会把错误响应
// 当成正常状态推进，任务永远停在「进行中」。
func TestParseTaskResultRejectsBusinessError(t *testing.T) {
	a := &TaskAdaptor{}
	_, err := a.ParseTaskResult([]byte(`{"code":"401","message":"API Key invalid"}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
	assert.Contains(t, err.Error(), "API Key invalid")
}

// TestResolutionAndRatioFromSize 只传 OpenAI 视频协议 size 的请求，也必须解析出
// 上游分辨率档：分辨率是计费档位，解析不到就会按 720p 少收。
func TestResolutionAndRatioFromSize(t *testing.T) {
	req := &relaycommon.TaskSubmitReq{Size: "1920x1080"}
	assert.Equal(t, "1080p", resolutionOf(req))
	assert.Equal(t, "16:9", ratioOf(req))

	// metadata 显式取值优先于 size。
	req = &relaycommon.TaskSubmitReq{
		Size:     "1280x720",
		Metadata: map[string]interface{}{"resolution": "4k", "ratio": "21:9"},
	}
	assert.Equal(t, "4k", resolutionOf(req))
	assert.Equal(t, "21:9", ratioOf(req))

	// 无法识别的 size 不猜：交给上游默认，避免算成错误档位。
	req = &relaycommon.TaskSubmitReq{Size: "999x999"}
	assert.Empty(t, resolutionOf(req))
	assert.Empty(t, ratioOf(req))
}

// TestValidateDurationBounds 时长是计费乘数，越界必须在进入计费前被拒绝。
func TestValidateDurationBounds(t *testing.T) {
	cases := []struct {
		model    string
		duration int
		wantErr  bool
	}{
		{model: "seedance2.5", duration: 30, wantErr: false},
		{model: "seedance2.5", duration: 31, wantErr: true},
		{model: "seedance2.0", duration: 15, wantErr: false},
		{model: "seedance2.0", duration: 16, wantErr: true},
		{model: "未知模型", duration: 3, wantErr: true},
		// 渠道别名要按型号关键字兜底：别名是运营商自定的，不能只认上游原名。
		{model: "seedance2.5-migu", duration: 30, wantErr: false},
		{model: "seedance2.0-migu", duration: 15, wantErr: false},
		{model: "seedance2.0-migu", duration: 16, wantErr: true},
		{model: "seedance2.0-migu-fast", duration: 16, wantErr: true},
		// 0（未填）与 -1（自动）交给上游默认值，不在这里判非法。
		{model: "seedance2.0", duration: 0, wantErr: false},
		{model: "seedance2.0", duration: -1, wantErr: false},
	}
	for _, tc := range cases {
		taskErr := validateDuration(relaycommon.TaskSubmitReq{Model: tc.model, Duration: tc.duration})
		if tc.wantErr {
			assert.NotNil(t, taskErr, "model=%s duration=%d", tc.model, tc.duration)
		} else {
			assert.Nil(t, taskErr, "model=%s duration=%d", tc.model, tc.duration)
		}
	}
}

package foxtoken

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 保护跨实例契约的另一半：走 OpenAI 视频协议（GET /v1/videos/{id}）的下游
// 也需要 data.usage 才能做完成后的差额结算。这条路径走 ConvertToOpenAIVideo，
// 与通用 TaskDto 是两套响应结构，改动任一处都要有覆盖。
func TestConvertToOpenAIVideoCarriesSettledUsage(t *testing.T) {
	settled := &model.Task{
		TaskID:   "task_settled",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		PrivateData: model.TaskPrivateData{
			ResultURL: "https://cdn/x.mp4",
			BillingContext: &model.TaskBillingContext{
				VideoToken:       38430,
				VideoActualToken: 40594,
			},
		},
	}

	raw, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(settled)
	require.NoError(t, err)
	body := string(raw)

	t.Run("成功任务带上真实用量", func(t *testing.T) {
		assert.Contains(t, body, `"usage":{"completion_tokens":40594,"total_tokens":40594}`)
	})

	t.Run("字段仍是 OpenAI 视频格式", func(t *testing.T) {
		assert.Contains(t, body, `"object":"video"`)
		assert.Contains(t, body, `"status":"completed"`)
	})

	t.Run("不上报预估值", func(t *testing.T) {
		assert.NotContains(t, body, "38430")
	})
}

// 未结算（上游没给真实用量）时不带 usage：下游拿到 0 会保持预扣额度，
// 与我们自己的处理一致；用预估顶替只会让下游记下一个假的实际用量。
func TestConvertToOpenAIVideoOmitsUsageWhenNotSettled(t *testing.T) {
	task := &model.Task{
		TaskID:   "task_unsettled",
		Status:   model.TaskStatusSuccess,
		Progress: "100%",
		PrivateData: model.TaskPrivateData{
			ResultURL:      "https://cdn/x.mp4",
			BillingContext: &model.TaskBillingContext{VideoToken: 38430},
		},
	}

	raw, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	assert.False(t, strings.Contains(string(raw), `"usage"`))
}

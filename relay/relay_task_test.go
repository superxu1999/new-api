package relay

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestWithProxyVideoURL 锁定对外契约：OpenAI 视频响应的 metadata.url 一律指向本站
// 内容代理，而不是上游直链。
//
// 上游直链的域名与路径会暴露供应方与上游模型名（...volces.com/doubao-seedance-2-0/...），
// 而且它带签名、可直接下载，等于绕过本站代理：不计流量、不受访问控制、有效期内还能转发。
func TestWithProxyVideoURL(t *testing.T) {
	const taskID = "task_abc123"
	const want = "https://proxy.example.com/v1/videos/task_abc123/content"

	old := system_setting.ServerAddress
	system_setting.ServerAddress = "https://proxy.example.com"
	t.Cleanup(func() { system_setting.ServerAddress = old })

	t.Run("替换上游直链", func(t *testing.T) {
		body := []byte(`{"id":"task_abc123","object":"video","status":"completed",` +
			`"metadata":{"url":"https://ark-acg.tos-cn-beijing.volces.com/doubao-seedance-2-0/x.mp4?X-Tos-Signature=deadbeef"}}`)

		got := withProxyVideoURL(body, taskID)

		assert.NotContains(t, string(got), "volces.com", "上游域名不得出现在对外响应里")
		assert.NotContains(t, string(got), "X-Tos-Signature")
		assert.Contains(t, string(got), `"url":"`+want+`"`)
		// 其余字段必须原样保留。
		assert.Contains(t, string(got), `"status":"completed"`)
		assert.Contains(t, string(got), `"object":"video"`)
	})

	t.Run("metadata 缺失时补出该字段", func(t *testing.T) {
		got := withProxyVideoURL([]byte(`{"id":"task_abc123","status":"completed"}`), taskID)
		assert.Contains(t, string(got), `"metadata":{"url":"`+want+`"}`)
	})

	t.Run("不破坏非 OpenAIVideo 形状的负载", func(t *testing.T) {
		// sora 适配器直接返回上游原始负载（不是 dto.OpenAIVideo）。
		// 这里若做 unmarshal/marshal 往返就会把这些字段丢掉。
		body := []byte(`{"id":"task_abc123","status":"completed","output":{"provider_field":[1,2,3]},` +
			`"metadata":{"url":"https://upstream.example.com/v.mp4","duration":4}}`)

		got := withProxyVideoURL(body, taskID)

		assert.Contains(t, string(got), `"output":{"provider_field":[1,2,3]}`)
		assert.Contains(t, string(got), `"duration":4`)
		assert.Contains(t, string(got), `"url":"`+want+`"`)
	})

	t.Run("非 JSON 载荷原样返回", func(t *testing.T) {
		body := []byte("not json at all")
		assert.Equal(t, body, withProxyVideoURL(body, taskID))
	})

	t.Run("空载荷原样返回", func(t *testing.T) {
		assert.Empty(t, withProxyVideoURL(nil, taskID))
	})
}

// TestTaskModel2DtoCarriesSettledUsage 保护跨实例契约：下游 new-api 实例靠
// data.usage.total_tokens 判断能否在任务完成后按真实用量做差额结算。
// 字段名或层级一变，下游就会静默退化成「永远按预扣额度收费」。
func TestTaskModel2DtoCarriesSettledUsage(t *testing.T) {
	settled := &model.Task{
		TaskID:   "task_settled",
		Status:   model.TaskStatusSuccess,
		Platform: "62",
		PrivateData: model.TaskPrivateData{
			BillingContext: &model.TaskBillingContext{
				VideoToken:       129600,
				VideoActualToken: 130500,
				PreConsumedQuota: 367492,
			},
		},
	}

	payload, err := common.Marshal(dto.TaskResponse[any]{
		Code: "success",
		Data: TaskModel2Dto(settled),
	})
	require.NoError(t, err)
	body := string(payload)

	t.Run("已结算任务在 data.usage 暴露真实用量", func(t *testing.T) {
		assert.Contains(t, body, `"usage":{"completion_tokens":130500,"total_tokens":130500}`)
	})

	t.Run("上报的是真实用量而不是预估用量", func(t *testing.T) {
		assert.NotContains(t, body, "129600",
			"预估值不能出现在计费字段里，否则下游会算出一个假的实际用量")
	})
}

// TestTaskModel2DtoOmitsUsageWhenNotSettled 确认未结算的任务不返回 usage：
// 下游拿到 0 会保持预扣额度，与我们自己的处理一致；若拿预估值冒充，
// 下游会把「恰好等于预估」的假数据记成实际用量。
func TestTaskModel2DtoOmitsUsageWhenNotSettled(t *testing.T) {
	cases := []struct {
		name          string
		billingCtx    *model.TaskBillingContext
		expectAbsence bool
	}{
		{
			name:          "没有计费上下文",
			billingCtx:    nil,
			expectAbsence: true,
		},
		{
			name:          "只有预估没有实际（差额结算被跳过）",
			billingCtx:    &model.TaskBillingContext{VideoToken: 108000, PreConsumedQuota: 340273},
			expectAbsence: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			task := &model.Task{
				TaskID:      "task_unsettled",
				Status:      model.TaskStatusSuccess,
				PrivateData: model.TaskPrivateData{BillingContext: tc.billingCtx},
			}
			payload, err := common.Marshal(TaskModel2Dto(task))
			require.NoError(t, err)
			if tc.expectAbsence {
				assert.False(t, strings.Contains(string(payload), `"usage"`),
					"未结算时不应出现 usage 字段")
			}
		})
	}
}

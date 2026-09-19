package relay

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAttachLastFrameURL 锁定尾帧图的对外形状：挂在 metadata.last_frame_url，
// 与现有的 metadata.url 并列。没有尾帧时不凭空补字段。
func TestAttachLastFrameURL(t *testing.T) {
	const frame = "https://ark-acg.tos-cn-beijing.volces.com/last_frame.png?X-Tos-Signature=abc"
	body := []byte(`{"id":"task_x","object":"video","status":"completed","progress":100,` +
		`"metadata":{"url":"https://ghyc.top/v1/videos/task_x/content"}}`)

	t.Run("有尾帧时挂到 metadata 下", func(t *testing.T) {
		got := string(attachLastFrameURL(body, frame))
		assert.Contains(t, got, `"last_frame_url":"`+frame+`"`)
		// 原有字段必须保留
		assert.Contains(t, got, `"url":"https://ghyc.top/v1/videos/task_x/content"`)
		assert.Contains(t, got, `"status":"completed"`)
	})

	t.Run("没有尾帧时原样返回", func(t *testing.T) {
		assert.Equal(t, body, attachLastFrameURL(body, ""))
	})

	t.Run("metadata 缺失时补出该层级", func(t *testing.T) {
		got := string(attachLastFrameURL([]byte(`{"id":"task_x","status":"completed"}`), frame))
		assert.Contains(t, got, `"metadata":{"last_frame_url":"`+frame+`"}`)
	})

	t.Run("非 JSON 载荷原样返回", func(t *testing.T) {
		junk := []byte("not json at all")
		assert.Equal(t, junk, attachLastFrameURL(junk, frame))
	})

	t.Run("空载荷原样返回", func(t *testing.T) {
		assert.Empty(t, attachLastFrameURL(nil, frame))
	})
}

// TestTaskModel2DtoCarriesLastFrameURL 确认原生 TaskDto 格式也带得出尾帧图。
func TestTaskModel2DtoCarriesLastFrameURL(t *testing.T) {
	const frame = "https://ark-acg.tos-cn-beijing.volces.com/last_frame.png"

	withFrame := &model.Task{
		TaskID:      "task_frame",
		Status:      model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{LastFrameURL: frame},
	}
	payload, err := common.Marshal(TaskModel2Dto(withFrame))
	require.NoError(t, err)
	assert.Contains(t, string(payload), `"last_frame_url":"`+frame+`"`)

	// 没请求尾帧的任务不应该凭空多出该字段。
	withoutFrame := &model.Task{TaskID: "task_plain", Status: model.TaskStatusSuccess}
	payload, err = common.Marshal(TaskModel2Dto(withoutFrame))
	require.NoError(t, err)
	assert.NotContains(t, string(payload), "last_frame_url")
}

// TestStripCompletedAtIfUnfinished 锁定 OpenAI 视频协议里 completed_at 的语义：
// 它只在任务真正结束时才出现。各适配器无条件写 CompletedAt = UpdatedAt，
// 未完成的任务也会带上时间戳，客户端容易误判成已完成。
func TestStripCompletedAtIfUnfinished(t *testing.T) {
	// 就是线上实际返回过的形状：排队中却带着 completed_at（等于 created_at）。
	queued := []byte(`{"id":"task_x","object":"video","status":"queued","progress":0,` +
		`"created_at":1789782281,"completed_at":1789782281,"metadata":{"url":"https://ghyc.top/v1/videos/task_x/content"}}`)
	finished := []byte(`{"id":"task_x","object":"video","status":"completed","progress":100,` +
		`"created_at":1789782281,"completed_at":1789782602}`)

	t.Run("未完成时删除 completed_at", func(t *testing.T) {
		got := string(stripCompletedAtIfUnfinished(queued, model.TaskStatusNotStart))
		assert.NotContains(t, got, "completed_at")
		// 其余字段必须原样保留
		assert.Contains(t, got, `"status":"queued"`)
		assert.Contains(t, got, `"created_at":1789782281`)
		assert.Contains(t, got, `"url":"https://ghyc.top/v1/videos/task_x/content"`)
	})

	t.Run("生成中也要删除", func(t *testing.T) {
		got := string(stripCompletedAtIfUnfinished(queued, model.TaskStatusInProgress))
		assert.NotContains(t, got, "completed_at")
	})

	t.Run("成功时保留", func(t *testing.T) {
		got := string(stripCompletedAtIfUnfinished(finished, model.TaskStatusSuccess))
		assert.Contains(t, got, `"completed_at":1789782602`)
	})

	t.Run("失败也算结束，保留", func(t *testing.T) {
		got := string(stripCompletedAtIfUnfinished(finished, model.TaskStatusFailure))
		assert.Contains(t, got, "completed_at")
	})

	t.Run("本来就没有该字段时不受影响", func(t *testing.T) {
		body := []byte(`{"id":"task_x","status":"queued"}`)
		got := string(stripCompletedAtIfUnfinished(body, model.TaskStatusQueued))
		assert.Contains(t, got, `"status":"queued"`)
	})

	t.Run("非 JSON 载荷原样返回", func(t *testing.T) {
		body := []byte("not json at all")
		assert.Equal(t, body, stripCompletedAtIfUnfinished(body, model.TaskStatusNotStart))
	})

	t.Run("空载荷原样返回", func(t *testing.T) {
		assert.Empty(t, stripCompletedAtIfUnfinished(nil, model.TaskStatusNotStart))
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

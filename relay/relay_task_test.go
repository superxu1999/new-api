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

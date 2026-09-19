package model

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"

	"github.com/stretchr/testify/assert"
)

// TestTaskStatusToVideoStatus 锁定 OpenAI 视频协议的状态契约。
//
// 关键回归点：TaskStatusNotStart 是任务刚入库时的状态（InitTask 写入），要等第一次
// 轮询才会被上游状态覆盖。它一旦落到 default 就会对外返回 unknown ——
// 调用方刚提交完任务立刻查询，会以为任务出了异常（实测就是这个问题）。
func TestTaskStatusToVideoStatus(t *testing.T) {
	cases := []struct {
		name string
		in   TaskStatus
		want string
	}{
		{"未启动映射为排队", TaskStatusNotStart, dto.VideoStatusQueued},
		{"已提交映射为排队", TaskStatusSubmitted, dto.VideoStatusQueued},
		{"排队映射为排队", TaskStatusQueued, dto.VideoStatusQueued},
		{"生成中", TaskStatusInProgress, dto.VideoStatusInProgress},
		{"成功", TaskStatusSuccess, dto.VideoStatusCompleted},
		{"失败", TaskStatusFailure, dto.VideoStatusFailed},
		{"显式未知仍为未知", TaskStatusUnknown, dto.VideoStatusUnknown},
		{"空值不 panic", TaskStatus(""), dto.VideoStatusUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.in.ToVideoStatus())
		})
	}

	// 任何状态都不允许产生空字符串：客户端会拿它做 status 判断。
	for _, s := range []TaskStatus{
		TaskStatusNotStart, TaskStatusSubmitted, TaskStatusQueued,
		TaskStatusInProgress, TaskStatusSuccess, TaskStatusFailure, TaskStatusUnknown,
	} {
		assert.NotEmpty(t, s.ToVideoStatus(), "status=%s", s)
	}
}

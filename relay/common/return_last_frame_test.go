package common

import (
	"testing"

	newapicommon "github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNormalizeReturnLastFrame 锁定契约：火山方舟官方的顶层 return_last_frame
// 必须在校验阶段并入 metadata。
//
// 本站的任务适配器只透传 metadata（doubao 适配器再从 metadata 反序列化），
// 顶层写在解析阶段就会被丢掉 —— 客户按官方文档写顶层，上游一个字节都收不到，
// 尾帧图永远不返回。
func TestNormalizeReturnLastFrame(t *testing.T) {
	t.Run("顶层 true 并入 metadata", func(t *testing.T) {
		req := TaskSubmitReq{Prompt: "p", ReturnLastFrame: boolPtr(true)}
		normalizeReturnLastFrame(&req)
		require.NotNil(t, req.Metadata)
		assert.Equal(t, true, req.Metadata["return_last_frame"])
	})

	t.Run("顶层 false 也要并入（显式关闭）", func(t *testing.T) {
		req := TaskSubmitReq{Prompt: "p", ReturnLastFrame: boolPtr(false)}
		normalizeReturnLastFrame(&req)
		assert.Equal(t, false, req.Metadata["return_last_frame"])
	})

	t.Run("不传时不动 metadata", func(t *testing.T) {
		req := TaskSubmitReq{Prompt: "p", Metadata: map[string]interface{}{"resolution": "720p"}}
		normalizeReturnLastFrame(&req)
		_, exists := req.Metadata["return_last_frame"]
		assert.False(t, exists)
		assert.Equal(t, "720p", req.Metadata["resolution"])
	})

	t.Run("metadata 里已显式写的不被覆盖", func(t *testing.T) {
		req := TaskSubmitReq{
			Prompt:          "p",
			ReturnLastFrame: boolPtr(true),
			Metadata:        map[string]interface{}{"return_last_frame": false},
		}
		normalizeReturnLastFrame(&req)
		assert.Equal(t, false, req.Metadata["return_last_frame"])
	})

	t.Run("现有 metadata 的其它键保留", func(t *testing.T) {
		req := TaskSubmitReq{
			Prompt:          "p",
			ReturnLastFrame: boolPtr(true),
			Metadata:        map[string]interface{}{"resolution": "1080p", "ratio": "16:9"},
		}
		normalizeReturnLastFrame(&req)
		assert.Equal(t, true, req.Metadata["return_last_frame"])
		assert.Equal(t, "1080p", req.Metadata["resolution"])
		assert.Equal(t, "16:9", req.Metadata["ratio"])
	})

	t.Run("nil 请求不 panic", func(t *testing.T) {
		assert.NotPanics(t, func() { normalizeReturnLastFrame(nil) })
	})
}

// TestTaskSubmitReqParsesTopLevelReturnLastFrame 确认自定义 UnmarshalJSON 之后
// 顶层字段仍然能解析出来（TaskSubmitReq 自己实现了 UnmarshalJSON 处理 duration/metadata）。
func TestTaskSubmitReqParsesTopLevelReturnLastFrame(t *testing.T) {
	var req TaskSubmitReq
	require.NoError(t, newapicommon.UnmarshalJsonStr(
		`{"model":"seedance2.0-cyai-260128","prompt":"p","return_last_frame":true}`, &req))
	require.NotNil(t, req.ReturnLastFrame)
	assert.True(t, *req.ReturnLastFrame)

	var absent TaskSubmitReq
	require.NoError(t, newapicommon.UnmarshalJsonStr(`{"model":"m","prompt":"p"}`, &absent))
	assert.Nil(t, absent.ReturnLastFrame, "未传时必须是 nil，不能变成 false")
}

func boolPtr(v bool) *bool { return &v }

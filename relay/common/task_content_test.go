package common

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	newapicommon "github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNormalizeTaskContent 锁定契约：火山方舟官方的顶层 content（文本 + 参考图/视频/音频）
// 必须在校验阶段并入 metadata.content。
//
// 本站的 cyai/doubao/seedance 适配器只读 metadata.content，顶层写在解析阶段就会被丢掉，
// 上游连一张参考图都收不到 —— 实测客户按官方格式传参考图，上游收到的 content 只有一条
// text，生成的视频与参考图毫无关系。
func TestNormalizeTaskContent(t *testing.T) {
	t.Run("顶层 content 并入 metadata.content", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"seedance2.0-cyai-260128",
			"prompt":"用图1生成视频",
			"content":[
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"},
				{"type":"image_url","image_url":{"url":"https://x/b.png"},"role":"reference_image"}
			]
		}`, &req))

		normalizeTaskSubmitReq(&req)

		require.NotNil(t, req.Metadata)
		items, ok := req.Metadata["content"].([]interface{})
		require.True(t, ok, "必须是 []interface{}：doubao/seedance 适配器按该类型断言参考视频输入")
		require.Len(t, items, 2)
		first, ok := items[0].(map[string]interface{})
		require.True(t, ok)
		assert.Equal(t, "image_url", first["type"])
		assert.Equal(t, "reference_image", first["role"])
	})

	t.Run("metadata.content 已显式写好的不被覆盖", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"p",
			"metadata":{"content":[{"type":"image_url","image_url":{"url":"https://x/meta.png"}}]},
			"content":[{"type":"image_url","image_url":{"url":"https://x/top.png"}}]
		}`, &req))

		normalizeTaskSubmitReq(&req)

		items, ok := req.Metadata["content"].([]interface{})
		require.True(t, ok)
		require.Len(t, items, 1)
		entry, ok := items[0].(map[string]interface{})
		require.True(t, ok)
		imageURL, ok := entry["image_url"].(map[string]interface{})
		require.True(t, ok)
		assert.Equal(t, "https://x/meta.png", imageURL["url"])
	})

	t.Run("content 形状不是数组时按未传处理", func(t *testing.T) {
		for _, body := range []string{`{"model":"m","prompt":"p","content":"oops"}`,
			`{"model":"m","prompt":"p","content":{"type":"text"}}`,
			`{"model":"m","prompt":"p","content":[]}`,
			`{"model":"m","prompt":"p"}`} {
			var req TaskSubmitReq
			require.NoError(t, newapicommon.UnmarshalJsonStr(body, &req))
			require.NotPanics(t, func() { normalizeTaskSubmitReq(&req) })
			if req.Metadata != nil {
				_, exists := req.Metadata["content"]
				assert.False(t, exists, "body=%s", body)
			}
		}
	})

	t.Run("nil 请求不 panic", func(t *testing.T) {
		assert.NotPanics(t, func() { normalizeTaskContent(nil) })
	})
}

// TestNormalizeTaskPrompt 锁定提示词口径：顶层 prompt 与 content 里的 text 元素都算
// 提示词，合并成一条（各适配器只会发出一条 text，分两处写必然丢一处）。
func TestNormalizeTaskPrompt(t *testing.T) {
	decode := func(t *testing.T, body string) *TaskSubmitReq {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(body, &req))
		return &req
	}

	t.Run("顶层 prompt 缺省时用 content 的文本项补出", func(t *testing.T) {
		req := decode(t, `{
			"model":"m",
			"content":[
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"},
				{"type":"text","text":"官方格式的提示词"}
			]
		}`)
		normalizeTaskSubmitReq(req)
		assert.Equal(t, "官方格式的提示词", req.Prompt)
	})

	t.Run("两处都写时合并而不是丢掉一处", func(t *testing.T) {
		req := decode(t, `{
			"model":"m","prompt":"顶层提示词",
			"content":[
				{"type":"text","text":"content 里的文本"},
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}
			]
		}`)
		normalizeTaskSubmitReq(req)
		assert.Equal(t, "顶层提示词\ncontent 里的文本", req.Prompt)
	})

	t.Run("多个 text 元素全部保留", func(t *testing.T) {
		req := decode(t, `{
			"model":"m",
			"content":[
				{"type":"text","text":"第一段"},
				{"type":"text","text":"第二段"},
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}
			]
		}`)
		normalizeTaskSubmitReq(req)
		assert.Equal(t, "第一段\n第二段", req.Prompt)
	})

	t.Run("完全重复的文本只保留一次", func(t *testing.T) {
		req := decode(t, `{
			"model":"m","prompt":"同一段提示词",
			"content":[{"type":"text","text":"同一段提示词"}]
		}`)
		normalizeTaskSubmitReq(req)
		assert.Equal(t, "同一段提示词", req.Prompt)
	})

	t.Run("content 里没有文本项时不补 prompt", func(t *testing.T) {
		req := decode(t, `{
			"model":"m",
			"content":[{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}]
		}`)
		normalizeTaskSubmitReq(req)
		assert.Empty(t, req.Prompt)
	})
}

// TestNormalizeOfficialVideoParams 锁定计费不变量：火山方舟官方放在顶层的视频参数
// （其中 resolution 决定计费档）必须并入 metadata，否则按默认档计费 —— 客户传
// 1080p 会按 720p 出片并按 720p 收费。
func TestNormalizeOfficialVideoParams(t *testing.T) {
	t.Run("顶层参数并入 metadata", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"p",
			"resolution":"1080p","ratio":"9:16","frames":121,"seed":12345,
			"camera_fixed":true,"watermark":false,"generate_audio":true
		}`, &req))

		normalizeTaskSubmitReq(&req)

		assert.Equal(t, "1080p", req.Metadata["resolution"])
		assert.Equal(t, "9:16", req.Metadata["ratio"])
		assert.Equal(t, float64(121), req.Metadata["frames"])
		assert.Equal(t, float64(12345), req.Metadata["seed"])
		assert.Equal(t, true, req.Metadata["camera_fixed"])
		assert.Equal(t, false, req.Metadata["watermark"], "显式 false 也要带下去，不能被当成未传")
		assert.Equal(t, true, req.Metadata["generate_audio"])
	})

	t.Run("metadata 里已显式写好的值优先", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"p",
			"resolution":"1080p",
			"metadata":{"resolution":"480p","ratio":"16:9"}
		}`, &req))

		normalizeTaskSubmitReq(&req)

		assert.Equal(t, "480p", req.Metadata["resolution"])
		assert.Equal(t, "16:9", req.Metadata["ratio"])
	})

	t.Run("白名单之外的顶层字段不转发", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"p","callback_url":"https://evil.example/cb","安全":"x"
		}`, &req))

		normalizeTaskSubmitReq(&req)

		if req.Metadata != nil {
			_, hasCallback := req.Metadata["callback_url"]
			assert.False(t, hasCallback, "白名单之外的顶层字段不能进 metadata 转发给上游")
		}
	})

	t.Run("未传时不往 metadata 里塞默认值", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{"model":"m","prompt":"p"}`, &req))

		normalizeTaskSubmitReq(&req)

		if req.Metadata != nil {
			_, exists := req.Metadata["resolution"]
			assert.False(t, exists)
		}
	})
}

// TestValidateBasicTaskRequestAcceptsOfficialContentShape 保护调用顺序：归一化必须在
// prompt 校验之前完成，否则官方格式（提示词写在 content 里、没有顶层 prompt）会被
// 「prompt is required」400，参考图也永远到不了上游。
func TestValidateBasicTaskRequestAcceptsOfficialContentShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := `{"model":"seedance2.0-cyai-260128","seconds":"5","resolution":"1080p","content":[
		{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"},
		{"type":"text","text":"用图1人物图生成写真视频"}]}`
	request := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request

	taskErr := ValidateBasicTaskRequest(context, &RelayInfo{TaskRelayInfo: &TaskRelayInfo{}}, constant.TaskActionGenerate)

	require.Nil(t, taskErr)
	stored, err := GetTaskRequest(context)
	require.NoError(t, err)
	require.Equal(t, "用图1人物图生成写真视频", stored.Prompt)
	assert.Equal(t, "1080p", stored.Metadata["resolution"], "计费读取的清晰度档必须来自顶层 resolution")
	items, ok := stored.Metadata["content"].([]interface{})
	require.True(t, ok, "必须原样落到适配器读取的 metadata.content")
	require.Len(t, items, 2)
}

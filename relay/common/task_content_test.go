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

		normalizeTaskContent(&req)

		require.NotNil(t, req.Metadata)
		items, ok := req.Metadata["content"].([]interface{})
		require.True(t, ok, "必须是 []interface{}：doubao/seedance 适配器按该类型断言参考视频输入")
		require.Len(t, items, 2)
		first, ok := items[0].(map[string]interface{})
		require.True(t, ok)
		assert.Equal(t, "image_url", first["type"])
		assert.Equal(t, "reference_image", first["role"])
	})

	t.Run("顶层 prompt 缺省时用 content 的文本项补出", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"seedance2.0-cyai-260128",
			"content":[
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"},
				{"type":"text","text":"官方格式的提示词"}
			]
		}`, &req))

		normalizeTaskContent(&req)

		assert.Equal(t, "官方格式的提示词", req.Prompt)
	})

	t.Run("已有 prompt 不被 content 的文本项覆盖", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"顶层提示词",
			"content":[{"type":"text","text":"content 里的文本"}]
		}`, &req))

		normalizeTaskContent(&req)

		assert.Equal(t, "顶层提示词", req.Prompt)
	})

	t.Run("content 里没有文本项时不补 prompt", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m",
			"content":[{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}]
		}`, &req))

		normalizeTaskContent(&req)

		assert.Empty(t, req.Prompt)
	})

	t.Run("metadata.content 已显式写好的不被覆盖", func(t *testing.T) {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(`{
			"model":"m","prompt":"p",
			"metadata":{"content":[{"type":"image_url","image_url":{"url":"https://x/meta.png"}}]},
			"content":[{"type":"image_url","image_url":{"url":"https://x/top.png"}}]
		}`, &req))

		normalizeTaskContent(&req)

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
			require.NotPanics(t, func() { normalizeTaskContent(&req) })
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

// TestValidateBasicTaskRequestAcceptsOfficialContentShape 保护调用顺序：归一化必须在
// prompt 校验之前完成，否则官方格式（提示词写在 content 里、没有顶层 prompt）会被
// 「prompt is required」400，参考图也永远到不了上游。
func TestValidateBasicTaskRequestAcceptsOfficialContentShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := `{"model":"seedance2.0-cyai-260128","seconds":"5","content":[
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
	items, ok := stored.Metadata["content"].([]interface{})
	require.True(t, ok, "必须原样落到适配器读取的 metadata.content")
	require.Len(t, items, 2)
}

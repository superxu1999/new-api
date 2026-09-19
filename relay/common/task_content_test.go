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

// TestNormalizeTaskReferences 锁定参考素材的归一契约：显式写的 role 绝不覆盖，
// 没写 role 的按写法推断意图；各种写法归一到同一份 metadata.content，同一 URL 只留一次。
//
// 修复前各适配器各判一套：cyai 只读 metadata.content，doubao/seedance 只认顶层
// images，扁平 metadata.video_url 谁都不认（参考视频被丢掉，还漏算「含视频」档计费）。
func TestNormalizeTaskReferences(t *testing.T) {
	decode := func(t *testing.T, body string) *TaskSubmitReq {
		var req TaskSubmitReq
		require.NoError(t, newapicommon.UnmarshalJsonStr(body, &req))
		return &req
	}
	itemsOf := func(t *testing.T, req *TaskSubmitReq) []map[string]interface{} {
		raw, ok := req.Metadata["content"].([]interface{})
		require.True(t, ok, "必须是 []interface{}：doubao/seedance 按该类型断言参考视频输入")
		out := make([]map[string]interface{}, 0, len(raw))
		for _, one := range raw {
			item, ok := one.(map[string]interface{})
			require.True(t, ok)
			out = append(out, item)
		}
		return out
	}

	t.Run("顶层 content 参考图带 role 时原样保留", func(t *testing.T) {
		req := decode(t, `{
			"model":"m","prompt":"p",
			"content":[{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}]
		}`)
		normalizeTaskReferences(req)

		items := itemsOf(t, req)
		require.Len(t, items, 1)
		assert.Equal(t, "image_url", items[0]["type"])
		assert.Equal(t, "reference_image", items[0]["role"])
	})

	t.Run("单张没写 role 的图片按首帧（不带 role）", func(t *testing.T) {
		req := decode(t, `{"model":"m","prompt":"p","content":[{"type":"image_url","image_url":{"url":"https://x/a.png"}}]}`)
		normalizeTaskReferences(req)

		items := itemsOf(t, req)
		require.Len(t, items, 1)
		_, hasRole := items[0]["role"]
		assert.False(t, hasRole, "单张不带 role 是首帧意图，不能改成参考图")
	})

	t.Run("两张没写 role 的图片补齐 reference_image", func(t *testing.T) {
		req := decode(t, `{"model":"m","prompt":"p","content":[
			{"type":"image_url","image_url":{"url":"https://x/a.png"}},
			{"type":"image_url","image_url":{"url":"https://x/b.png"}}]}`)
		normalizeTaskReferences(req)

		for _, item := range itemsOf(t, req) {
			assert.Equal(t, "reference_image", item["role"], "首帧最多 1 张，多图必须带 role")
		}
	})

	t.Run("顶层 content 与 metadata.content 合并而不是丢掉一处", func(t *testing.T) {
		req := decode(t, `{
			"model":"m","prompt":"p",
			"content":[{"type":"image_url","image_url":{"url":"https://x/top.png"},"role":"reference_image"}],
			"metadata":{"content":[{"type":"video_url","video_url":{"url":"https://x/meta.mp4"},"role":"reference_video"}]}
		}`)
		normalizeTaskReferences(req)

		items := itemsOf(t, req)
		require.Len(t, items, 2)
		assert.Equal(t, "video_url", items[0]["type"], "已有的 metadata.content 顺序不变")
		assert.Equal(t, "image_url", items[1]["type"])
	})

	t.Run("images 单张按首帧、多张按参考图", func(t *testing.T) {
		single := decode(t, `{"model":"m","prompt":"p","images":["https://x/a.png"]}`)
		normalizeTaskReferences(single)
		items := itemsOf(t, single)
		require.Len(t, items, 1)
		assert.Equal(t, "image_url", items[0]["type"])
		_, hasRole := items[0]["role"]
		assert.False(t, hasRole)

		multi := decode(t, `{"model":"m","prompt":"p","images":["https://x/a.png","https://x/b.png"]}`)
		normalizeTaskReferences(multi)
		items = itemsOf(t, multi)
		require.Len(t, items, 2)
		for _, item := range items {
			assert.Equal(t, "reference_image", item["role"])
		}
	})

	t.Run("image 与 input_reference 也是图片输入", func(t *testing.T) {
		req := decode(t, `{"model":"m","prompt":"p","input_reference":"https://x/sora.png"}`)
		normalizeTaskReferences(req)
		items := itemsOf(t, req)
		require.Len(t, items, 1)
		assert.Equal(t, map[string]interface{}{"url": "https://x/sora.png"}, items[0]["image_url"])
	})

	t.Run("扁平写法按字段名推断意图", func(t *testing.T) {
		req := decode(t, `{"model":"m","prompt":"p","metadata":{
			"image_url":"https://x/a.png","video_url":{"url":"https://x/r.mp4"},"audio_url":"https://x/s.mp3"}}`)
		normalizeTaskReferences(req)

		items := itemsOf(t, req)
		require.Len(t, items, 3)
		assert.Equal(t, []string{"image_url", "video_url", "audio_url"},
			[]string{items[0]["type"].(string), items[1]["type"].(string), items[2]["type"].(string)})
		_, hasRole := items[0]["role"]
		assert.False(t, hasRole, "扁平 image_url 是首帧意图")
		assert.Equal(t, "reference_video", items[1]["role"])
		assert.Equal(t, "reference_audio", items[2]["role"])
		assert.Equal(t, map[string]interface{}{"url": "https://x/r.mp4"}, items[1]["video_url"])
		for _, key := range []string{"image_url", "video_url", "audio_url"} {
			_, exists := req.Metadata[key]
			assert.False(t, exists, "扁平字段已转成 content 元素，不能留在 metadata 里被上游当成第二处输入：%s", key)
		}
	})

	t.Run("同一 URL 只保留一次", func(t *testing.T) {
		req := decode(t, `{
			"model":"m","prompt":"p",
			"images":["https://x/a.png","https://x/a.png"],
			"metadata":{"image_url":"https://x/a.png","content":[
				{"type":"image_url","image_url":{"url":"https://x/a.png"},"role":"reference_image"}]}
		}`)
		normalizeTaskReferences(req)

		items := itemsOf(t, req)
		require.Len(t, items, 1)
		assert.Equal(t, "reference_image", items[0]["role"], "已有元素（含显式 role）优先保留")
	})

	t.Run("空值与非字符串不产生元素", func(t *testing.T) {
		for _, body := range []string{`{"model":"m","prompt":"p","metadata":{"video_url":""}}`,
			`{"model":"m","prompt":"p","metadata":{"video_url":"   "}}`,
			`{"model":"m","prompt":"p","metadata":{"video_url":123}}`,
			`{"model":"m","prompt":"p","images":["","  "]}`,
			`{"model":"m","prompt":"p","content":"oops"}`,
			`{"model":"m","prompt":"p"}`} {
			req := decode(t, body)
			require.NotPanics(t, func() { normalizeTaskReferences(req) })
			if req.Metadata != nil {
				_, exists := req.Metadata["content"]
				assert.False(t, exists, "body=%s", body)
			}
		}
	})

	t.Run("nil 请求不 panic", func(t *testing.T) {
		assert.NotPanics(t, func() { normalizeTaskReferences(nil) })
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

package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseLocalAssetRef 锁定站内素材引用写法：只有 asset://<数字>（或 asset:<数字>）算
// 站内引用；上游素材 ID 与普通 URL 都不是站内引用（前者会被 looksLikeAssetRef 拦下）。
func TestParseLocalAssetRef(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantID  int64
		wantOK  bool
		wantRef bool
	}{
		{name: "标准写法", raw: "asset://12", wantID: 12, wantOK: true, wantRef: true},
		{name: "短前缀", raw: "asset:12", wantID: 12, wantOK: true, wantRef: true},
		{name: "带空格", raw: "  asset://7  ", wantID: 7, wantOK: true, wantRef: true},
		{name: "上游素材 ID 不是站内引用", raw: "asset://asset-20260921143729-aqngz", wantOK: false, wantRef: true},
		{name: "上游裸 ID 不是引用", raw: "asset-20260921143729-aqngz", wantOK: false, wantRef: false},
		{name: "公网 URL 不是引用", raw: "https://cdn.example.com/a.png", wantOK: false, wantRef: false},
		{name: "空 ID 拒绝", raw: "asset://", wantOK: false, wantRef: true},
		{name: "零与负数拒绝", raw: "asset://0", wantOK: false, wantRef: true},
		{name: "非数字拒绝", raw: "asset://abc", wantOK: false, wantRef: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := parseLocalAssetRef(tc.raw)
			assert.Equal(t, tc.wantOK, ok)
			assert.Equal(t, tc.wantID, id)
			assert.Equal(t, tc.wantRef, looksLikeAssetRef(tc.raw))
		})
	}
}

// TestReplaceTaskAssetRefs 锁定递归替换：content 数组元素里的嵌套 URL 与扁平写法都要被改写，
// 未命中的字符串保持原样。
func TestReplaceTaskAssetRefs(t *testing.T) {
	payload := map[string]any{
		"content": []any{
			map[string]any{"type": "text", "text": "asset://99 只是文本里的字样"},
			map[string]any{
				"type":      "image_url",
				"image_url": map[string]any{"url": "asset://3"},
				"role":      "reference_image",
			},
			map[string]any{
				"type":      "video_url",
				"video_url": map[string]any{"url": "https://cdn.example.com/ref.mp4"},
			},
		},
		"metadata": map[string]any{"image_url": "asset://4"},
	}

	replaceTaskAssetRefs(payload, func(raw string) (string, bool) {
		id, ok := parseLocalAssetRef(raw)
		if !ok {
			return "", false
		}
		return "asset://asset-upstream-" + string(rune('0'+id)), true
	})

	content := payload["content"].([]any)
	require.Len(t, content, 3)

	first := content[0].(map[string]any)
	assert.Equal(t, "asset://99 只是文本里的字样", first["text"], "文本字段不做替换")

	second := content[1].(map[string]any)
	assert.Equal(t, "asset://asset-upstream-3", second["image_url"].(map[string]any)["url"])

	third := content[2].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/ref.mp4", third["video_url"].(map[string]any)["url"])

	metadata := payload["metadata"].(map[string]any)
	assert.Equal(t, "asset://asset-upstream-4", metadata["image_url"], "扁平写法同样替换")
}

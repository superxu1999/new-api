package cyai

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBuildContent 锁定 buildContent 生成的顶层 content 数组契约：
// 上游 CyAI 要求至少一条 text，且 video/audio 参考必须带 role。
func TestBuildContent(t *testing.T) {
	tests := []struct {
		name    string
		prompt  string
		meta    map[string]any
		want    []contentItem
		wantRef bool
	}{
		{
			name:    "no reference returns nothing",
			prompt:  "一只猫在奔跑",
			meta:    map[string]any{},
			want:    nil,
			wantRef: false,
		},
		{
			name:   "image reference gains leading text from prompt",
			prompt: "参考这些图生成视频",
			meta: map[string]any{
				"content": []any{
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.jpg"}},
				},
			},
			want: []contentItem{
				{Type: "text", Text: "参考这些图生成视频"},
				{Type: "image_url", ImageURL: &mediaURL{URL: "https://example.com/a.jpg"}},
			},
			wantRef: true,
		},
		{
			name:   "video reference without role gets role added",
			prompt: "参考视频",
			meta: map[string]any{
				"content": []any{
					map[string]any{"type": "video_url", "video_url": map[string]any{"url": "https://example.com/r.mp4"}},
				},
			},
			want: []contentItem{
				{Type: "text", Text: "参考视频"},
				{Type: "video_url", VideoURL: &mediaURL{URL: "https://example.com/r.mp4"}, Role: "reference_video"},
			},
			wantRef: true,
		},
		{
			name:   "audio reference gets role and cannot be sole input (upstream enforces)",
			prompt: "参考音频",
			meta: map[string]any{
				"content": []any{
					map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": "https://example.com/s.mp3"}},
				},
			},
			want: []contentItem{
				{Type: "text", Text: "参考音频"},
				{Type: "audio_url", AudioURL: &mediaURL{URL: "https://example.com/s.mp3"}, Role: "reference_audio"},
			},
			wantRef: true,
		},
		{
			name:   "existing text reference is kept and not duplicated",
			prompt: "兜底提示词",
			meta: map[string]any{
				"content": []any{
					map[string]any{"type": "text", "text": "用户自带提示词"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.jpg"}},
				},
			},
			want: []contentItem{
				{Type: "text", Text: "用户自带提示词"},
				{Type: "image_url", ImageURL: &mediaURL{URL: "https://example.com/a.jpg"}},
			},
			wantRef: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, hasRef := buildContent(tt.prompt, tt.meta)
			assert.Equal(t, tt.wantRef, hasRef)
			if tt.wantRef {
				require.Equal(t, tt.want, got)
			} else {
				assert.Empty(t, got)
			}
		})
	}
}

// TestBuildRequestBodyBackwardCompat 无参考时保持透传顶层 prompt（不产生 content 数组）。
func TestBuildRequestBodyBackwardCompat(t *testing.T) {
	// 无 content 时 buildContent 应返回 hasRef=false
	_, hasRef := buildContent("一只猫在奔跑", map[string]any{"resolution": "720p"})
	assert.False(t, hasRef)

	// normalizeResolution 仍保证非空 resolution
	meta := normalizeResolution(nil)
	assert.Equal(t, "720p", meta["resolution"])
}

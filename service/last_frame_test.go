package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestExtractLastFrameURL 锁定尾帧图的提取路径。
//
// 尾帧图只在创建任务时带了 return_last_frame=true 才由上游返回，而各渠道响应形状
// 不同，所以按已知路径逐个尝试。用真实形状做样本：
//   - 直连火山方舟：provider 响应就是顶层
//   - 上游是 new-api 实例：provider 负载嵌在 data.data 里（与取 usage 实测一致）
//   - 上游 new-api 的 OpenAI 视频格式：嵌在 data.metadata 里
func TestExtractLastFrameURL(t *testing.T) {
	const frame = "https://ark-acg.tos-cn-beijing.volces.com/last_frame.png?X-Tos-Signature=abc"

	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "直连火山：顶层 content.last_frame_url",
			body: `{"id":"cgt-1","status":"succeeded",` +
				`"content":{"video_url":"https://x/v.mp4","last_frame_url":"` + frame + `"}}`,
			want: frame,
		},
		{
			name: "上游 new-api：data.data.content.last_frame_url",
			body: `{"code":"success","message":"","data":{"task_id":"task_a","status":"SUCCESS",` +
				`"data":{"content":{"video_url":"https://x/v.mp4","last_frame_url":"` + frame + `"}}}}`,
			want: frame,
		},
		{
			name: "上游 OpenAI 视频格式：data.metadata.last_frame_url",
			body: `{"code":"success","data":{"id":"task_a","status":"completed",` +
				`"metadata":{"url":"https://x/content","last_frame_url":"` + frame + `"}}}`,
			want: frame,
		},
		{
			name: "没请求尾帧时取不到",
			body: `{"id":"cgt-1","status":"succeeded","content":{"video_url":"https://x/v.mp4"}}`,
			want: "",
		},
		{
			name: "空字符串视为取不到",
			body: `{"status":"succeeded","content":{"last_frame_url":"   "}}`,
			want: "",
		},
		{
			name: "非 JSON 不 panic",
			body: `not json at all`,
			want: "",
		},
		{
			name: "空响应不 panic",
			body: ``,
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, extractLastFrameURL([]byte(tc.body)))
		})
	}
}

// Package cyai 对接 CyAI(www.cyai.club) new-api 风格视频生成上游。
// 创建 POST /v1/video/generations,轮询 GET /v1/video/generations/{task_id},
// 查询返回 new-api TaskResponse 格式。协议与 foxtoken 一致，复用其实现。
package cyai

// ModelList 为对外暴露的模型名（与上游一致，无需额外映射）。
var ModelList = []string{
	"doubao-seedance-2-0-260128",
	"doubao-seedance-2-0-fast-260128",
	"doubao-seedance-2-0-mini-260615",
	"doubao-seedance-2-5-260628",
}

var ChannelName = "CyAI"

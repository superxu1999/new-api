// Package cyai 对接 CyAI(www.cyai.club) new-api 风格视频生成上游。
// 创建 POST /v1/video/generations,轮询 GET /v1/video/generations/{task_id},
// 查询返回 new-api TaskResponse 格式。协议与 foxtoken 一致，复用其实现。
package cyai

// ModelList 为对外暴露的模型名（统一 seedance2.0-cyai-* 格式，实际映射到上游由渠道 ModelMapping 决定）。
var ModelList = []string{
	"seedance2.0-cyai-260128",
	"seedance2.0-cyai-fast-260128",
	"seedance2.0-cyai-mini-260615",
	"seedance2.0-cyai-25-260628",
}

var ChannelName = "CyAI"

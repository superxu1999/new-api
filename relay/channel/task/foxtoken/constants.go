// Package foxtoken 对接 Foxtoken(ai.hwdrama.com) new-api 风格视频生成上游。
// 创建 POST /v1/video/generations,轮询 GET /v1/video/generations/{task_id},
// 查询返回 new-api TaskResponse 格式(内置轮询也能识别)。
package foxtoken

// ModelList 为对外暴露的模型名;实际映射到上游由渠道 ModelMapping 决定。
var ModelList = []string{
	"seedance2.0-foxtoken",
}

var ChannelName = "foxtoken"

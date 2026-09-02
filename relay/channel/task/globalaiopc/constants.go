// Package globalaiopc 对接 GlobalAiOpc(keyiyun) Seedance 视频生成自定义协议。
// 协议为两段式:参考素材先通过 /asset/seedance2/assetUpload 上传获取 assetId,
// 再 POST /v2/model-center/tasks 创建视频任务,GET /v2/model-center/tasks/{id} 轮询结果。
// 上游模型名需带 resolution 等参数才能匹配计费 SKU(如 sd_2.0_special + resolution)。
package globalaiopc

// ModelList 为渠道默认对外暴露的模型名;实际映射到上游模型由渠道 ModelMapping 决定
// (如 seedance2.0-globalaiopc -> sd_2.0_special)。
var ModelList = []string{
	"seedance2.0-globalaiopc",
}

var ChannelName = "globalaiopc"

// validResolutions 上游 GlobalAiOpc 视频生成仅接受的分辨率;其它值(如 480p)会被上游拒绝。
var validResolutions = map[string]bool{
	"720p":  true,
	"1080p": true,
	"2k":    true,
	"4k":    true,
}

package seedance

// Seedance 本地代理（seedance-proxy）的模型名由客户在控制台订购，
// 模型名采用代理端使用的简化名（如 doubao-seedance-2.0），
// 代理内部通过 /mapping/query 自动映射到火山引擎真实 endpoint。
// 移动云 MaaS 直连（base_url 以 /api/v3 结尾）时，new-api 也会在创建任务前
// 调用 /mapping/query 完成同样的解析。
// 详见 Seedance 接口文档 3.1 节。
var ModelList = []string{
	"doubao-seedance-2.0",
}

var ChannelName = "seedance"

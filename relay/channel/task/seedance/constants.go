package seedance

// Seedance 本地代理（seedance-proxy）的模型名由客户在控制台订购，
// 模型名采用代理端使用的简化名（如 doubao-seedance-2.0），
// 代理内部通过 /mapping/query 自动映射到火山引擎真实 endpoint。
// 详见 Seedance 接口文档 3.1 节。
var ModelList = []string{
	"doubao-seedance-2.0",
}

var ChannelName = "seedance"

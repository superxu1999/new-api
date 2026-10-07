package migu

// ChannelName 是渠道在后台与日志中的展示名。
const ChannelName = "Migu AIGC"

// ApiPrefix 是咪咕云 OpenAPI 的固定路径前缀。
// Base URL 只到 host（如 https://aigc.migucloud.com:449），路径在这里拼。
const ApiPrefix = "/api/open/v1"

// ModelList 是咪咕云 OpenAPI 已开通的视频模型（对应 GET /models 的 name 字段）。
// 上游按账号开通情况返回不同列表；新增模型时既可以在渠道里手动补，
// 也可以对照 GET /models 更新这里。
var ModelList = []string{
	"seedance2.5",
	"seedance2.0",
	"seedance-Fast",
}

// DurationRange 是单个模型允许的时长区间（秒），来源 GET /models 的 durationRange。
type DurationRange struct {
	Min int
	Max int
}

// 各模型的时长区间。未列出的模型按 DefaultDurationRange 处理。
var ModelDurationRanges = map[string]DurationRange{
	"seedance2.5":   {Min: 4, Max: 30},
	"seedance2.0":   {Min: 4, Max: 15},
	"seedance-Fast": {Min: 4, Max: 15},
}

// DefaultDurationRange 是未知模型的兜底时长区间：取上游全部模型的最宽范围，
// 具体合法性最终仍由上游判定。
var DefaultDurationRange = DurationRange{Min: 4, Max: 30}

// DefaultDurationSeconds 是请求未声明时长时下发的秒数（上游默认 5 秒）。
const DefaultDurationSeconds = 5

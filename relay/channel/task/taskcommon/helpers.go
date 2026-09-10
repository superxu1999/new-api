package taskcommon

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

// UnmarshalMetadata converts a map[string]any metadata to a typed struct via JSON round-trip.
// This replaces the repeated pattern: json.Marshal(metadata) → json.Unmarshal(bytes, &target).
func UnmarshalMetadata(metadata map[string]any, target any) error {
	if metadata == nil {
		return nil
	}
	// Prevent metadata from overriding model fields to avoid billing bypass.
	delete(metadata, "model")
	metaBytes, err := common.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata failed: %w", err)
	}
	if err := common.Unmarshal(metaBytes, target); err != nil {
		return fmt.Errorf("unmarshal metadata failed: %w", err)
	}
	return nil
}

// DefaultString returns val if non-empty, otherwise fallback.
func DefaultString(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}

// DefaultInt returns val if non-zero, otherwise fallback.
func DefaultInt(val, fallback int) int {
	if val == 0 {
		return fallback
	}
	return val
}

// EncodeLocalTaskID encodes an upstream operation name to a URL-safe base64 string.
// Used by Gemini/Vertex to store upstream names as task IDs.
func EncodeLocalTaskID(name string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(name))
}

// DecodeLocalTaskID decodes a base64-encoded upstream operation name.
func DecodeLocalTaskID(id string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// BuildProxyURL constructs the video proxy URL using the public task ID.
// e.g., "https://your-server.com/v1/videos/task_xxxx/content"
func BuildProxyURL(taskID string) string {
	return fmt.Sprintf("%s/v1/videos/%s/content", system_setting.ServerAddress, taskID)
}

// Status-to-progress mapping constants for polling updates.
const (
	ProgressSubmitted  = "10%"
	ProgressQueued     = "20%"
	ProgressInProgress = "30%"
	ProgressComplete   = "100%"
)

// ---------------------------------------------------------------------------
// BaseBilling — embeddable no-op implementations for TaskAdaptor billing methods.
// Adaptors that do not need custom billing can embed this struct directly.
// ---------------------------------------------------------------------------

type BaseBilling struct{}

// EstimateBilling returns nil (no extra ratios; use base model price).
func (BaseBilling) EstimateBilling(_ *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	return nil
}

// AdjustBillingOnSubmit returns nil (no submit-time adjustment).
func (BaseBilling) AdjustBillingOnSubmit(_ *relaycommon.RelayInfo, _ []byte) map[string]float64 {
	return nil
}

// AdjustBillingOnComplete returns 0 (keep pre-charged amount).
func (BaseBilling) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

// ---------------------------------------------------------------------------
// Seedance video token billing (official formula), shared by all seedance adaptors.
// 官方 token 公式: token = (输入时长 + 输出时长) × 宽 × 高 × 帧率 / 1024
// 价格 = 分档单价(元/M) × token / 1M。此处返回「相对基准价」的计费倍率，供
// EstimateBilling 作为 OtherRatio 使用。
//
//   OtherRatio = (分档单价 / 基准单价) × (token / 基准token)
//
// 其中基准 = 该模型 720p 不含视频档（基准单价），基准token = 1 秒 720p = 21600。
// ModelRatio 保持为「1 秒 720p 不含视频」对应的基准值（现状不变），
// 乘上该 OtherRatio 后即精确对齐官方分档价。
// ---------------------------------------------------------------------------

// ResolutionDimensions 返回分辨率档对应的宽高与 720p 相对倍率。
func ResolutionDimensions(res string) (w, h int, rel float64) {
	switch strings.ToLower(strings.TrimSpace(res)) {
	case "480p":
		return 854, 480, 0.4444444444 // 854*480 / (1280*720) = 409920/921600 = 0.4444
	case "1080p":
		return 1920, 1080, 2.25
	case "4k", "2k":
		return 3840, 2160, 9.0
	default: // 720p 基准
		return 1280, 720, 1.0
	}
}

// HasInputVideo 判断请求 metadata 是否携带参考视频（content 含 video_url）。
func HasInputVideo(metadata map[string]interface{}) bool {
	if metadata == nil {
		return false
	}
	raw, ok := metadata["content"]
	if !ok {
		return false
	}
	content, ok := raw.([]interface{})
	if !ok {
		return false
	}
	for _, item := range content {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		if tp, _ := m["type"].(string); tp == "video_url" {
			return true
		}
		if _, has := m["video_url"]; has {
			return true
		}
	}
	return false
}

// seedancePriceKey 分档单价表的键：输出分辨率档 + 是否含视频输入。
type seedancePriceKey struct {
	is1080p  bool
	is4k     bool
	hasVideo bool
}

// seedancePriceTable 各模型在不同 (输出分辨率档, 是否含视频输入) 下的官方单价（元/百万 token）。
// 零值键 {480p/720p, 不含视频} 为基准单价（720p 不含视频）。
var seedancePriceTable = map[string]map[seedancePriceKey]float64{
	"doubao-seedance-2.0": {
		{hasVideo: false}:                46.0,
		{hasVideo: true}:                 28.0,
		{is1080p: true, hasVideo: false}: 51.0,
		{is1080p: true, hasVideo: true}:  31.0,
		{is4k: true, hasVideo: false}:    26.0,
		{is4k: true, hasVideo: true}:     16.0,
	},
	"doubao-seedance-2-0-260128": {
		{hasVideo: false}:                46.0,
		{hasVideo: true}:                 28.0,
		{is1080p: true, hasVideo: false}: 51.0,
		{is1080p: true, hasVideo: true}:  31.0,
		{is4k: true, hasVideo: false}:    26.0,
		{is4k: true, hasVideo: true}:     16.0,
	},
	"doubao-seedance-2-5-260628": {
		{hasVideo: false}:                70.0,
		{hasVideo: true}:                 42.0,
		{is1080p: true, hasVideo: false}: 77.0,
		{is1080p: true, hasVideo: true}:  46.0,
	},
	"doubao-seedance-2-0-fast-260128": {
		{hasVideo: false}: 37.0,
		{hasVideo: true}:  22.0,
	},
	"doubao-seedance-2-0-mini-260615": {
		{hasVideo: false}: 23.0,
		{hasVideo: true}:  14.0,
	},
}

// seedancePriceAliases 将上游/渠道模型名归一化到 seedancePriceTable 的键。
// 所有 seedance 2.0 系列（含各中转渠道别名）都归一化为 doubao-seedance-2.0。
func normalizeSeedanceModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(m, "seedance-2-5") || strings.Contains(m, "seedance2.5") || strings.HasSuffix(m, "-25") || strings.Contains(m, "25-260628"):
		return "doubao-seedance-2-5-260628"
	case strings.Contains(m, "fast"):
		return "doubao-seedance-2-0-fast-260128"
	case strings.Contains(m, "mini"):
		return "doubao-seedance-2-0-mini-260615"
	case strings.Contains(m, "seedance-2-0") || strings.Contains(m, "seedance2.0") || strings.Contains(m, "seedance-2.0") || strings.Contains(m, "seedance2-0"):
		return "doubao-seedance-2-0-260128"
	default:
		return "doubao-seedance-2.0"
	}
}

// seedancePriceRatio 返回指定模型在给定输出分辨率/是否含视频输入下，相对基准单价的倍率。
// 返回 false 表示未配置价格表。
func seedancePriceRatio(modelName, resolution string, hasVideo bool) (float64, bool) {
	key := normalizeSeedanceModel(modelName)
	prices, ok := seedancePriceTable[key]
	if !ok {
		return 0, false
	}
	base := prices[seedancePriceKey{}]
	if base <= 0 {
		return 0, false
	}
	res := strings.ToLower(strings.TrimSpace(resolution))
	price, ok := prices[seedancePriceKey{is1080p: res == "1080p", is4k: res == "4k" || res == "2k", hasVideo: hasVideo}]
	if !ok {
		// 未配置的组合（如 fast/mini 无 1080p/4k 档）按基准单价计费。
		return 1.0, true
	}
	return price / base, true
}

// SeedanceBillRatio 计算 seedance 视频任务的「相对基准价」计费倍率（含分档单价因子）。
// modelName: 模型名（用于查分档单价表）；sec: 输出时长(秒)；res: 分辨率档；hasVideo: 是否含参考视频。
// 返回的倍率 = (分档单价/基准单价) × (token/21600)，其中 token 含输入+输出时长、宽高、帧率。
func SeedanceBillRatio(modelName string, sec int, res string, hasVideo bool) (ratio float64, token int, err error) {
	if sec <= 0 {
		return 0, 0, fmt.Errorf("invalid seconds: %d", sec)
	}
	w, h, _ := ResolutionDimensions(res)
	inputSec := 0
	if hasVideo {
		inputSec = sec // 方案A: 输入视频时长 = 输出时长
	}
	totalSec := inputSec + sec
	token = totalSec * w * h * 24 / 1024
	// token 相对基准(1s 720p = 21600)的倍率。
	tokenRatio := float64(token) / 21600.0
	// 分档单价相对基准单价的倍率。
	priceRatio, _ := seedancePriceRatio(modelName, res, hasVideo)
	return tokenRatio * priceRatio, token, nil
}

// ExtractSeconds 从 task 请求中读取输出时长（seconds）。
func ExtractSeconds(req *relaycommon.TaskSubmitReq) int {
	if req == nil {
		return 0
	}
	sec := req.Duration
	if sec <= 0 {
		if s, err := strconv.Atoi(req.Seconds); err == nil {
			sec = s
		}
	}
	return sec
}

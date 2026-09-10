package taskcommon

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

// seedance 分档单价档位键（与 video_pricing_setting.tiered_price_by_model 的键一致）。
// no_* 表示输入不含视频，with_* 表示输入包含视频。
const (
	tierNo720p   = "no_720p"
	tierWith720p = "with_720p"
	tierNo1080p  = "no_1080p"
	tierWith1080p = "with_1080p"
	tierNo4k     = "no_4k"
	tierWith4k   = "with_4k"
)

// seedanceDefaultPriceTable 各模型的分档官方单价（元/百万 token），未在后台配置时的内置默认。
// 键为归一化模型名（见 normalizeSeedanceModel）。
var seedanceDefaultPriceTable = map[string]map[string]float64{
	"doubao-seedance-2-0-260128": {
		tierNo720p: 46.0, tierWith720p: 28.0,
		tierNo1080p: 51.0, tierWith1080p: 31.0,
		tierNo4k: 26.0, tierWith4k: 16.0,
	},
	"doubao-seedance-2-5-260628": {
		tierNo720p: 70.0, tierWith720p: 42.0,
		tierNo1080p: 77.0, tierWith1080p: 46.0,
	},
	"doubao-seedance-2-0-fast-260128": {
		tierNo720p: 37.0, tierWith720p: 22.0,
	},
	"doubao-seedance-2-0-mini-260615": {
		tierNo720p: 23.0, tierWith720p: 14.0,
	},
}

// seedancePriceAliases 将上游/渠道模型名归一化到价目表的键。
// 所有 seedance 2.0 系列（含各中转渠道别名）都归一化为 doubao-seedance-2.0。
func normalizeSeedanceModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(m, "seedance-2-5") || strings.Contains(m, "seedance2.5") ||
		strings.HasSuffix(m, "-25") || strings.Contains(m, "25-260628") || strings.Contains(m, "v25"):
		return "doubao-seedance-2-5-260628"
	case strings.Contains(m, "fast"):
		return "doubao-seedance-2-0-fast-260128"
	case strings.Contains(m, "mini"):
		return "doubao-seedance-2-0-mini-260615"
	case strings.Contains(m, "seedance-2-0") || strings.Contains(m, "seedance2.0") || strings.Contains(m, "seedance-2.0") || strings.Contains(m, "seedance2-0"):
		return "doubao-seedance-2-0-260128"
	default:
		return "doubao-seedance-2-0-260128"
	}
}

// seedanceTierKey 把 (分辨率, 是否含视频) 转成档位键。
func seedanceTierKey(resolution string, hasVideo bool) string {
	switch strings.ToLower(strings.TrimSpace(resolution)) {
	case "1080p":
		if hasVideo {
			return tierWith1080p
		}
		return tierNo1080p
	case "4k", "2k":
		if hasVideo {
			return tierWith4k
		}
		return tierNo4k
	default: // 480p/720p
		if hasVideo {
			return tierWith720p
		}
		return tierNo720p
	}
}

// SeedanceTierPrice 返回指定模型在给定输出分辨率/是否含视频输入下的分档单价（元/百万 token）。
// 优先用后台针对【该完整模型名】的配置（video_pricing_setting.tiered_price_by_model），
// 未配置时按型号（2.0/2.5/fast/mini）回退到内置默认价目表。
func SeedanceTierPrice(modelName, resolution string, hasVideo bool) (float64, bool) {
	tierKey := seedanceTierKey(resolution, hasVideo)

	// 1) 按完整模型名的后台配置优先（每个模型独立，互不影响）
	if prices, ok := operation_setting.GetTieredPriceByModel(modelName); ok {
		if price, ok := prices[tierKey]; ok && price > 0 {
			return price, true
		}
		// 未配置的组合（如 fast/mini 无 1080p/4k 档）回退到该模型的 480p/720p 档。
		if base, ok := prices[tierNo720p]; ok && base > 0 {
			return base, true
		}
		return 0, false
	}

	// 2) 按型号回退内置默认价目表
	prices, ok := seedanceDefaultPriceTable[normalizeSeedanceModel(modelName)]
	if !ok {
		return 0, false
	}
	if price, ok := prices[tierKey]; ok && price > 0 {
		return price, true
	}
	if base, ok := prices[tierNo720p]; ok && base > 0 {
		return base, true
	}
	return 0, false
}

// ComputeSeedanceBillRatio 计算 seedance 视频任务的 OtherRatio，使最终价格等于
// 「分档单价 × token / 1e6 × multiplier」（元），从而让后台配置的分档单价绝对值
// 与模型计费倍率直接生效，与模型的 ModelRatio 无关。
//
// ── 为什么采用「约掉 ModelRatio」的方式 ────────────────────────────────
// 任务计费的框架流程是固定的（见 relay/relay_task.go）：
//
//	Step 4  helper.ModelPriceHelperPerCall 先按 ModelRatio 算出基础额度：
//	        baseQuota = ModelRatio/2 × QuotaPerUnit × groupRatio
//	Step 5  adaptor.EstimateBilling 的返回类型固定为 map[string]float64（乘数），
//	        接口签名（relay/channel/adapter.go 的 TaskAdaptor）决定了适配器
//	        无法直接设定最终额度；
//	Step 6  最终额度 = baseQuota × ∏OtherRatios
//
// 因此要让价格由「分档单价」决定，只能把已乘入的 ModelRatio 除回来（约掉）。
// 备选方案是给 TaskAdaptor 增加可选接口、由适配器直接返回额度，可彻底解耦，
// 但需改动计费核心，暂未实施。
//
// 推导：元 = ModelRatio/2 × ratio × rate（见 ModelPriceHelperPerCall 与汇率换算）
// 目标：元 = tierPrice × token/1e6 × multiplier
//
//	=> ratio = 2 × tierPrice × token/1e6 × multiplier / (ModelRatio × rate)
//
// ── 约束 ──────────────────────────────────────────────────────────────
// 本式要求 ModelRatio > 0。若 ModelRatio 为 0，函数返回 false，调用方
// EstimateBilling 返回 nil，将退化为按基础额度计费（即 0 元）。
// 前端已隐藏视频模型的「输入价格」并在保存时保留其原值（见
// model-ratio-visual-editor.tsx 对 seedance 模型的保留分支），正常使用不会为 0。
func ComputeSeedanceBillRatio(tierPrice float64, token int, modelRatio, rate, multiplier float64) (float64, bool) {
	if tierPrice <= 0 || token <= 0 || modelRatio <= 0 || rate <= 0 {
		return 0, false
	}
	if multiplier <= 0 {
		multiplier = 1.0
	}
	ratio := 2 * tierPrice * float64(token) / 1e6 * multiplier / (modelRatio * rate)
	if ratio <= 0 {
		return 0, false
	}
	return ratio, true
}

// SeedanceBillingContextKey 是 gin.Context 上的键，用于把 seedance 计费明细从
// EstimateBilling 传递到日志记录处（task_billing.LogTaskConsumption），
// 便于在「使用日志 → 任务详情」中展示费用是如何计算出来的。
const SeedanceBillingContextKey = "seedance_billing_detail"

// SeedanceBillingDetail 记录一次 seedance 视频计费的中间量，仅用于展示与排查。
type SeedanceBillingDetail struct {
	TierPrice     float64 `json:"tier_price"`       // 分档单价（元/百万 token）
	Token         int     `json:"token"`            // 官方 token 公式算出的用量
	Multiplier    float64 `json:"multiplier"`       // 模型计费倍率
	Resolution    string  `json:"resolution"`       // 输出分辨率档
	HasInputVideo bool    `json:"has_input_video"`  // 请求是否包含参考视频
	Seconds       int     `json:"seconds"`          // 输出时长（秒）
}

// EstimateSeedanceBilling 统一的 seedance 视频计费估算，供所有 seedance 系适配器复用。
//
// 流程：解析请求 → 官方 token 公式算 token → 查分档单价（按完整模型名） → 折算 OtherRatio。
// 最终价格 = 分档单价 × token/1e6 × groupRatio × 模型计费倍率。
//
// 非 seedance 模型返回 nil，调用方沿用原有计费逻辑（例如 kling 适配器同时服务
// kling 与 seedance 两类模型）。
func EstimateSeedanceBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	if info == nil || !IsSeedanceModel(info.OriginModelName) {
		return nil
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	res, _ := req.Metadata["resolution"].(string)
	hasVideo := HasInputVideo(req.Metadata)
	seconds := ExtractSeconds(&req)

	token, err := SeedanceToken(seconds, res, hasVideo)
	if err != nil || token <= 0 {
		return nil
	}
	tierPrice, ok := SeedanceTierPrice(info.OriginModelName, res, hasVideo)
	if !ok || tierPrice <= 0 {
		return nil
	}
	multiplier := SeedanceModelMultiplier(info.OriginModelName)
	ratio, ok := ComputeSeedanceBillRatio(
		tierPrice, token, info.PriceData.ModelRatio, operation_setting.USDExchangeRate, multiplier)
	if !ok {
		return nil
	}
	c.Set(SeedanceBillingContextKey, SeedanceBillingDetail{
		TierPrice:     tierPrice,
		Token:         token,
		Multiplier:    multiplier,
		Resolution:    res,
		HasInputVideo: hasVideo,
		Seconds:       seconds,
	})
	return map[string]float64{"video_billing": ratio}
}

// IsSeedanceModel 判断模型名是否属于 seedance 视频系（据此决定是否按官方 token 公式计费）。
func IsSeedanceModel(modelName string) bool {
	return strings.Contains(strings.ToLower(modelName), "seedance")
}

// SeedanceModelMultiplier 返回该模型的视频计费倍率（按【完整模型名】查配置，默认 1.0）。
// 用于针对单个模型加价/打折：最终价格 = 分档单价 × token/1e6 × groupRatio × 该倍率。
func SeedanceModelMultiplier(modelName string) float64 {
	return operation_setting.GetModelMultiplier(modelName)
}

// SeedanceToken 计算官方 token 用量：token = (输入时长+输出时长) × 宽 × 高 × 帧率 / 1024。
// 输入不含视频时输入时长=0；含视频时输入时长=输出时长（方案A）。
func SeedanceToken(sec int, res string, hasVideo bool) (int, error) {
	if sec <= 0 {
		return 0, fmt.Errorf("invalid seconds: %d", sec)
	}
	w, h, _ := ResolutionDimensions(res)
	totalSec := sec
	if hasVideo {
		totalSec = sec * 2
	}
	return totalSec * w * h * 24 / 1024, nil
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

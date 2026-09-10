package operation_setting

import "strings"

// seedance 分档单价档位键（与 video_pricing_setting.tiered_price_by_model 的键一致）。
// no_* 表示输入不含视频，with_* 表示输入包含视频。480p 与 720p 同价，共用 no_720p/with_720p。
const (
	TierNo720p    = "no_720p"
	TierWith720p  = "with_720p"
	TierNo1080p   = "no_1080p"
	TierWith1080p = "with_1080p"
	TierNo4k      = "no_4k"
	TierWith4k    = "with_4k"
)

// SeedanceTierKeys 是分档的固定展示顺序：不含视频/含视频 × 480p-720p → 1080p → 4k。
var SeedanceTierKeys = []string{
	TierNo720p, TierWith720p, TierNo1080p, TierWith1080p, TierNo4k, TierWith4k,
}

// seedanceDefaultPriceTable 各模型的分档官方单价（元/百万 token），未在后台配置时的内置默认。
// 键为归一化模型名（见 NormalizeSeedanceModel）。
var seedanceDefaultPriceTable = map[string]map[string]float64{
	"doubao-seedance-2-0-260128": {
		TierNo720p: 46.0, TierWith720p: 28.0,
		TierNo1080p: 51.0, TierWith1080p: 31.0,
		TierNo4k: 26.0, TierWith4k: 16.0,
	},
	"doubao-seedance-2-5-260628": {
		TierNo720p: 70.0, TierWith720p: 42.0,
		TierNo1080p: 77.0, TierWith1080p: 46.0,
	},
	"doubao-seedance-2-0-fast-260128": {
		TierNo720p: 37.0, TierWith720p: 22.0,
	},
	"doubao-seedance-2-0-mini-260615": {
		TierNo720p: 23.0, TierWith720p: 14.0,
	},
}

// IsSeedanceModel 判断模型名是否属于 seedance 视频系（据此决定是否按官方 token 公式计费、
// 以及在模型广场展示分档价格）。
func IsSeedanceModel(modelName string) bool {
	return strings.Contains(strings.ToLower(modelName), "seedance")
}

// NormalizeSeedanceModel 将上游/渠道模型名归一化到价目表的键。
// 所有 seedance 2.0 系列（含各中转渠道别名）都归一化为 doubao-seedance-2.0。
func NormalizeSeedanceModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(m, "seedance-2-5") || strings.Contains(m, "seedance2.5") ||
		strings.HasSuffix(m, "-25") || strings.Contains(m, "25-260628") || strings.Contains(m, "v25"):
		return "doubao-seedance-2-5-260628"
	case strings.Contains(m, "fast"):
		return "doubao-seedance-2-0-fast-260128"
	case strings.Contains(m, "mini"):
		return "doubao-seedance-2-0-mini-260615"
	case strings.Contains(m, "seedance-2-0") || strings.Contains(m, "seedance2.0") ||
		strings.Contains(m, "seedance-2.0") || strings.Contains(m, "seedance2-0"):
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
			return TierWith1080p
		}
		return TierNo1080p
	case "4k", "2k":
		if hasVideo {
			return TierWith4k
		}
		return TierNo4k
	default: // 480p/720p
		if hasVideo {
			return TierWith720p
		}
		return TierNo720p
	}
}

// SeedanceTierPrice 返回指定模型在给定输出分辨率/是否含视频输入下的分档单价（元/百万 token）。
// 优先用后台针对【该完整模型名】的配置（video_pricing_setting.tiered_price_by_model），
// 未配置时按型号（2.0/2.5/fast/mini）回退到内置默认价目表。
func SeedanceTierPrice(modelName, resolution string, hasVideo bool) (float64, bool) {
	table, ok := SeedanceTierTable(modelName)
	if !ok {
		return 0, false
	}
	if price, ok := table[seedanceTierKey(resolution, hasVideo)]; ok && price > 0 {
		return price, true
	}
	// 未配置的组合（如 fast/mini 无 1080p/4k 档）回退到该模型的 480p/720p 档。
	if base, ok := table[TierNo720p]; ok && base > 0 {
		return base, true
	}
	return 0, false
}

// SeedanceTierTable 返回某模型完整的「档位键 → 单价」表（元/百万 token）：
// 后台按完整模型名的配置优先，否则回退到该型号的内置官方默认。未命中返回 nil,false。
// 供模型广场等需要展示全部档位的地方使用。
func SeedanceTierTable(modelName string) (map[string]float64, bool) {
	if prices, ok := GetTieredPriceByModel(modelName); ok {
		return prices, true
	}
	if prices, ok := seedanceDefaultPriceTable[NormalizeSeedanceModel(modelName)]; ok {
		return prices, true
	}
	return nil, false
}

package operation_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
)

// VideoPricingSetting 视频模型分档单价配置。
// tiered_price_by_model 为「按模型的分档单价表」（元/百万 token），
// 档位键: no_720p(480p/720p 不含视频)、with_720p(含视频)、no_1080p、with_1080p、no_4k、with_4k。
// 通过系统设置存储（options 表），修改后即时生效，无需重新编译。
// 未配置的模型回退到内置官方默认价目表（relay/channel/task/taskcommon 中的 seedancePriceTable）。
type VideoPricingSetting struct {
	// TieredPriceByModel 模型 -> (档位键 -> 单价元/百万token)，按模型覆盖内置官方默认。
	TieredPriceByModel map[string]map[string]float64 `json:"tiered_price_by_model"`
	// ModelMultiplierByModel 模型 -> 计费倍率（默认 1.0，用于针对单个模型加价/打折）。
	// 最终价格 = 分档单价 × token/1e6 × groupRatio × 该倍率。
	ModelMultiplierByModel map[string]float64 `json:"model_multiplier_by_model"`
}

var videoPricingSetting = VideoPricingSetting{
	TieredPriceByModel:     map[string]map[string]float64{},
	ModelMultiplierByModel: map[string]float64{},
}

func init() {
	config.GlobalConfig.Register("video_pricing_setting", &videoPricingSetting)
}

// GetTieredPriceByModel 返回某模型的分档单价表（元/百万token）；未配置返回 nil,false。
func GetTieredPriceByModel(model string) (map[string]float64, bool) {
	if m, ok := videoPricingSetting.TieredPriceByModel[model]; ok && len(m) > 0 {
		return m, true
	}
	return nil, false
}

// GetModelMultiplier 返回某模型的计费倍率；未配置返回 1.0（原价）。
func GetModelMultiplier(model string) float64 {
	if m, ok := videoPricingSetting.ModelMultiplierByModel[model]; ok && m > 0 {
		return m
	}
	return 1.0
}

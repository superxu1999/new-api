package operation_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
)

// VideoPricingSetting 视频模型清晰度计费系数。
// resolution_ratio 为全局缺省（按清晰度），resolution_ratio_by_model 可按模型覆盖。
// 通过系统设置存储（options 表），修改后即时生效，无需重新编译。
type VideoPricingSetting struct {
	// ResolutionRatio 清晰度 -> 计费倍率（全局缺省，相对 720p）。
	ResolutionRatio map[string]float64 `json:"resolution_ratio"`
	// ResolutionRatioByModel 模型 -> (清晰度 -> 倍率)，按模型覆盖全局。
	ResolutionRatioByModel map[string]map[string]float64 `json:"resolution_ratio_by_model"`
}

var videoPricingSetting = VideoPricingSetting{
	ResolutionRatio: map[string]float64{
		"480p":  1.0,
		"720p":  1.0,
		"1080p": 1.25,
		"4k":    0.32,
	},
	ResolutionRatioByModel: map[string]map[string]float64{},
}

func init() {
	config.GlobalConfig.Register("video_pricing_setting", &videoPricingSetting)
}

// GetVideoResolutionRatio 返回清晰度->倍率映射（全局缺省）。
func GetVideoResolutionRatio() map[string]float64 {
	return videoPricingSetting.ResolutionRatio
}

// GetVideoResolutionRatioForModel 返回某个模型的清晰度倍率（按模型覆盖，无则回退全局缺省）。
func GetVideoResolutionRatioForModel(model string, res string) (float64, bool) {
	if m, ok := videoPricingSetting.ResolutionRatioByModel[model]; ok {
		if r, ok := m[res]; ok {
			return r, true
		}
	}
	if r, ok := videoPricingSetting.ResolutionRatio[res]; ok {
		return r, true
	}
	return 0, false
}

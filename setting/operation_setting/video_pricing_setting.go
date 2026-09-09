package operation_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
)

// VideoPricingSetting 视频模型清晰度计费系数。
// resolution_ratio 为全局缺省（按清晰度），resolution_ratio_by_model 可按模型覆盖。
// input_video_model_ratio 为「输入包含视频」时的独立 ModelRatio 档（与不含视频 ModelRatio 并列）。
// 通过系统设置存储（options 表），修改后即时生效，无需重新编译。
type VideoPricingSetting struct {
	// ResolutionRatio 清晰度 -> 计费倍率（全局缺省，相对 720p）。
	ResolutionRatio map[string]float64 `json:"resolution_ratio"`
	// ResolutionRatioByModel 模型 -> (清晰度 -> 倍率)，按模型覆盖全局。
	ResolutionRatioByModel map[string]map[string]float64 `json:"resolution_ratio_by_model"`
	// InputVideoModelRatio 输入包含视频时的独立 ModelRatio（全局缺省）。
	// 官方按「输入是否包含视频」分两档计价（含视频更便宜），该字段是含视频档的独立倍率。
	// 0 或未配置表示未启用含视频档（按不含视频 ModelRatio 收）。
	InputVideoModelRatio float64 `json:"input_video_model_ratio"`
	// InputVideoModelRatioByModel 模型 -> 含视频 ModelRatio，按模型覆盖全局。
	InputVideoModelRatioByModel map[string]float64 `json:"input_video_model_ratio_by_model"`
}

var videoPricingSetting = VideoPricingSetting{
	ResolutionRatio: map[string]float64{
		"480p":  1.0,
		"720p":  1.0,
		"1080p": 2.49,
		"4k":    5.08,
	},
	ResolutionRatioByModel:       map[string]map[string]float64{},
	InputVideoModelRatio:         0, // 默认不启用含视频档
	InputVideoModelRatioByModel:  map[string]float64{},
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

// GetInputVideoModelRatio 返回输入包含视频时的独立 ModelRatio（按模型覆盖，无则回退全局）。
// 返回 false 表示未启用含视频档（应按不含视频 ModelRatio 收）。
func GetInputVideoModelRatio(model string) (float64, bool) {
	if r, ok := videoPricingSetting.InputVideoModelRatioByModel[model]; ok && r > 0 {
		return r, true
	}
	if videoPricingSetting.InputVideoModelRatio > 0 {
		return videoPricingSetting.InputVideoModelRatio, true
	}
	return 0, false
}

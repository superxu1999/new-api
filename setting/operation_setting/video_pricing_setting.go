package operation_setting

import (
	"github.com/QuantumNous/new-api/setting/config"
)

// VideoPricingSetting 视频模型清晰度计费系数。
// 通过系统设置存储（options 表,key=video_pricing_setting.resolution_ratio），
// 修改后即时生效（下次请求读取），无需重新编译。
type VideoPricingSetting struct {
	// ResolutionRatio 清晰度 -> 计费倍率（相对 720p，与上游价差对齐）。
	ResolutionRatio map[string]float64 `json:"resolution_ratio"`
}

var videoPricingSetting = VideoPricingSetting{
	ResolutionRatio: map[string]float64{
		"480p":  1.0,
		"720p":  1.0,
		"1080p": 1.25,
		"4k":    0.32,
	},
}

func init() {
	config.GlobalConfig.Register("video_pricing_setting", &videoPricingSetting)
}

// GetVideoResolutionRatio 返回清晰度->倍率映射（未找到时为空）。
func GetVideoResolutionRatio() map[string]float64 {
	return videoPricingSetting.ResolutionRatio
}

package operation_setting

import "strings"

import "github.com/QuantumNous/new-api/setting/config"

// ModelDisplayNameSetting 模型对外显示名配置。
//
// 面向 C 端的产品里，用户不该看到带渠道后缀的内部模型名（如
// seedance2.0-cyai-25-260628）——那是「同一模型按渠道拆分售卖」的产物。
// 这里配置「真实模型名 → 对外显示名」，能力声明、创作台等 C 端界面优先展示
// 显示名；提交、计费、日志等内部链路仍使用真实模型名。
// 通过系统设置存储（options 表），修改后即时生效，无需重新编译。
type ModelDisplayNameSetting struct {
	// Names 真实模型名 -> 对外显示名。
	Names map[string]string `json:"names"`
}

var modelDisplayNameSetting = ModelDisplayNameSetting{
	Names: map[string]string{},
}

func init() {
	config.GlobalConfig.Register("model_display_name_setting", &modelDisplayNameSetting)
}

// ModelDisplayName 返回模型的对外显示名；未配置或配置为空串时返回 ""，
// 调用方据此回退到真实模型名。
func ModelDisplayName(modelName string) string {
	name, ok := modelDisplayNameSetting.Names[modelName]
	if !ok {
		return ""
	}
	return strings.TrimSpace(name)
}

// ModelDisplayNames 返回全部显示名映射的副本（管理端编辑用）。
func ModelDisplayNames() map[string]string {
	names := make(map[string]string, len(modelDisplayNameSetting.Names))
	for k, v := range modelDisplayNameSetting.Names {
		names[k] = v
	}
	return names
}

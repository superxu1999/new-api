package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 后台显式配置的补全倍率必须优先于硬编码默认值。
// 回归背景：gpt-5.6-* 会命中 getHardcodedCompletionModelRatio 里 "gpt-5" 前缀的 8 倍默认，
// 导致管理员原本配置的 6 倍在计费与模型广场都不生效。
func TestGetCompletionRatioPrefersConfiguredValue(t *testing.T) {
	t.Cleanup(func() {
		require.NoError(t, UpdateCompletionRatioByJSONString("{}"))
	})
	require.NoError(t, UpdateCompletionRatioByJSONString(`{"gpt-5.6-sol":6,"gpt-5.6-terra":6}`))

	assert.Equal(t, 6.0, GetCompletionRatio("gpt-5.6-sol"))
	assert.Equal(t, 6.0, GetCompletionRatio("gpt-5.6-terra"))

	// 未配置的模型仍按硬编码默认（gpt-5 前缀 = 8 倍）。
	assert.Equal(t, 8.0, GetCompletionRatio("gpt-5.2-codex"))

	// 配置项在后台应显示为可编辑（不锁定）。
	info := GetCompletionRatioInfo("gpt-5.6-sol")
	assert.Equal(t, 6.0, info.Ratio)
	assert.False(t, info.Locked)

	// 未配置的模型依然由硬编码判定为锁定。
	lockedInfo := GetCompletionRatioInfo("gpt-5.2-codex")
	assert.Equal(t, 8.0, lockedInfo.Ratio)
	assert.True(t, lockedInfo.Locked)
}

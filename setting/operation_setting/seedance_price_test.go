package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestNormalizeSeedanceModel 校验渠道别名归一化到价目表键。
func TestNormalizeSeedanceModel(t *testing.T) {
	tests := map[string]string{
		"doubao-seedance-2.0":          "doubao-seedance-2-0-260128",
		"seedance2.0-cyai-260128":      "doubao-seedance-2-0-260128",
		"seedance2.0-cyai-25-260628":   "doubao-seedance-2-5-260628",
		"seedance2.0-cyai-fast-260128": "doubao-seedance-2-0-fast-260128",
		"seedance2.0-cyai-mini-260615": "doubao-seedance-2-0-mini-260615",
		"seedance2.0-foxtoken":         "doubao-seedance-2-0-260128",
		"seedance2.0-foxtoken-25":      "doubao-seedance-2-5-260628",
		"seedance2.0-globalaiopc-v25":  "doubao-seedance-2-5-260628",
		"seedance2.0-tianyi":           "doubao-seedance-2-0-260128",
	}
	for in, want := range tests {
		assert.Equal(t, want, NormalizeSeedanceModel(in), "model=%s", in)
	}
}

// TestSeedanceTierTable 模型广场依赖完整档位表：未配置后台时回退内置官方默认，
// 且必须覆盖 480p-720p / 1080p / 4k × 不含视频/含视频 六个档位。
func TestSeedanceTierTable(t *testing.T) {
	table, ok := SeedanceTierTable("seedance2.0-cyai-260128")
	assert.True(t, ok)
	assert.Equal(t, 46.0, table[TierNo720p])
	assert.Equal(t, 28.0, table[TierWith720p])
	assert.Equal(t, 51.0, table[TierNo1080p])
	assert.Equal(t, 31.0, table[TierWith1080p])
	assert.Equal(t, 26.0, table[TierNo4k])
	assert.Equal(t, 16.0, table[TierWith4k])

	v25, ok := SeedanceTierTable("seedance2.0-cyai-25-260628")
	assert.True(t, ok)
	assert.Equal(t, 70.0, v25[TierNo720p])
	assert.Equal(t, 42.0, v25[TierWith720p])
}

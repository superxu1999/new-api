package taskcommon

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSeedanceToken 锁定官方 token 公式：
// token = (输入时长 + 输出时长) × 宽 × 高 × 帧率 / 1024（帧率 24）。
// 输入不含视频时输入时长=0；含视频时输入时长=输出时长（方案A）。
func TestSeedanceToken(t *testing.T) {
	tests := []struct {
		name     string
		sec      int
		res      string
		hasVideo bool
		want     int
	}{
		{name: "5s 480p no-video", sec: 5, res: "480p", hasVideo: false, want: 48037},
		{name: "5s 720p no-video", sec: 5, res: "720p", hasVideo: false, want: 108000},
		{name: "5s 720p with-video", sec: 5, res: "720p", hasVideo: true, want: 216000},
		{name: "5s 1080p no-video", sec: 5, res: "1080p", hasVideo: false, want: 243000},
		{name: "5s 4k no-video", sec: 5, res: "4k", hasVideo: false, want: 972000},
		{name: "10s 1080p no-video", sec: 10, res: "1080p", hasVideo: false, want: 486000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := SeedanceToken(tt.sec, tt.res, tt.hasVideo)
			require.NoError(t, err)
			assert.Equal(t, tt.want, token)
		})
	}

	_, err := SeedanceToken(0, "720p", false)
	assert.Error(t, err)
}

// TestComputeSeedanceBillRatio 校验 OtherRatio 换算后，最终价格精确等于
// 「分档单价 × token/1e6 × multiplier」元，且与 ModelRatio 无关（ModelRatio 被约掉）。
// 计费链路：元 = modelRatio/2 × ratio × rate。
func TestComputeSeedanceBillRatio(t *testing.T) {
	const rate = 7.3

	tests := []struct {
		name       string
		tierPrice  float64
		token      int
		modelRatio float64
		multiplier float64
		wantYuan   float64
	}{
		// 官方 2.0：480p/720p=46、1080p=51、4k=26；含视频 28/31/16
		{name: "2.0 5s 720p no-video", tierPrice: 46, token: 108000, modelRatio: 0.2723, multiplier: 1, wantYuan: 4.968},
		{name: "2.0 5s 1080p no-video", tierPrice: 51, token: 243000, modelRatio: 0.2723, multiplier: 1, wantYuan: 12.393},
		{name: "2.0 5s 4k no-video", tierPrice: 26, token: 972000, modelRatio: 0.2723, multiplier: 1, wantYuan: 25.272},
		{name: "2.0 5s 720p with-video", tierPrice: 28, token: 216000, modelRatio: 0.2723, multiplier: 1, wantYuan: 6.048},
		{name: "2.5 5s 720p no-video", tierPrice: 70, token: 108000, modelRatio: 0.4143, multiplier: 1, wantYuan: 7.56},
		// ModelRatio 变化不应影响最终价格（关键回归保护）
		{name: "invariant to ModelRatio", tierPrice: 46, token: 108000, modelRatio: 0.5, multiplier: 1, wantYuan: 4.968},
		// 模型计费倍率：1.5 倍加价
		{name: "multiplier 1.5", tierPrice: 46, token: 108000, modelRatio: 0.2723, multiplier: 1.5, wantYuan: 7.452},
		{name: "multiplier 0.5", tierPrice: 46, token: 108000, modelRatio: 0.2723, multiplier: 0.5, wantYuan: 2.484},
		// 倍率 <= 0 时按 1.0 处理
		{name: "multiplier 0 falls back to 1", tierPrice: 46, token: 108000, modelRatio: 0.2723, multiplier: 0, wantYuan: 4.968},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio, ok := ComputeSeedanceBillRatio(tt.tierPrice, tt.token, tt.modelRatio, rate, tt.multiplier)
			require.True(t, ok)
			yuan := tt.modelRatio / 2 * ratio * rate
			assert.InDelta(t, tt.wantYuan, yuan, 0.02)
		})
	}
}

// TestSeedanceTierPrice 校验内置官方默认价目表（未配置后台时）。
func TestSeedanceTierPrice(t *testing.T) {
	tests := []struct {
		model    string
		res      string
		hasVideo bool
		want     float64
	}{
		{"doubao-seedance-2.0", "720p", false, 46},
		{"doubao-seedance-2.0", "1080p", false, 51},
		{"doubao-seedance-2.0", "4k", false, 26},
		{"doubao-seedance-2.0", "720p", true, 28},
		{"doubao-seedance-2.0", "1080p", true, 31},
		{"doubao-seedance-2.0", "4k", true, 16},
		{"seedance2.0-cyai-25-260628", "720p", false, 70},
		{"seedance2.0-foxtoken-fast", "720p", false, 37},
		{"seedance2.0-cyai-mini-260615", "720p", false, 23},
	}

	for _, tt := range tests {
		t.Run(tt.model+" "+tt.res, func(t *testing.T) {
			price, ok := SeedanceTierPrice(tt.model, tt.res, tt.hasVideo)
			require.True(t, ok)
			assert.InDelta(t, tt.want, price, 1e-6)
		})
	}
}

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
		assert.Equal(t, want, normalizeSeedanceModel(in), "model=%s", in)
	}
}

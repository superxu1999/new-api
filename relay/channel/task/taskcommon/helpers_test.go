package taskcommon

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSeedanceBillRatio 锁定官方 token 公式计费的相对基准倍率。
// 官方公式: token = (输入时长+输出时长) × 宽 × 高 × 帧率 / 1024
// 相对基准倍率 = (分档单价/基准单价) × (token / 21600)，21600 = 1s 720p 基准token。
// 该倍率乘以基础 quota(ModelRatio/2 × QPU) 后应与官方分档价一致。
func TestSeedanceBillRatio(t *testing.T) {
	tests := []struct {
		name      string
		model     string
		sec       int
		res       string
		hasVideo  bool
		wantToken int
		// wantRatio 为完整相对基准倍率 = (分档单价/基准单价) × (token/21600)
		wantRatio float64
	}{
		// 2.0 基准单价 46；1080p=51、4k=26；含视频 720p=28
		// 480p: 5*854*480*24/1024 = 48037.5 -> int 截断 48037
		{name: "2.0 5s 480p no-video", model: "doubao-seedance-2.0", sec: 5, res: "480p", hasVideo: false, wantToken: 48037, wantRatio: 48037.0 / 21600.0},
		{name: "2.0 5s 720p no-video", model: "doubao-seedance-2.0", sec: 5, res: "720p", hasVideo: false, wantToken: 108000, wantRatio: 5.0},
		{name: "2.0 5s 720p with-video (input=output)", model: "doubao-seedance-2.0", sec: 5, res: "720p", hasVideo: true, wantToken: 216000, wantRatio: 10.0 * 28.0 / 46.0},
		{name: "2.0 5s 1080p no-video", model: "doubao-seedance-2.0", sec: 5, res: "1080p", hasVideo: false, wantToken: 243000, wantRatio: 11.25 * 51.0 / 46.0},
		{name: "2.0 5s 4k no-video", model: "doubao-seedance-2.0", sec: 5, res: "4k", hasVideo: false, wantToken: 972000, wantRatio: 45.0 * 26.0 / 46.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio, token, err := SeedanceBillRatio(tt.model, tt.sec, tt.res, tt.hasVideo)
			require.NoError(t, err)
			assert.Equal(t, tt.wantToken, token)
			assert.InDelta(t, tt.wantRatio, ratio, 1e-6)
		})
	}
}

// TestSeedanceBillRatioFullPrice 校验完整倍率(含分档单价)折算出的价格对齐官方。
// 元 = ModelRatio/2 × ratio × 7.3，其中 ModelRatio=0.2723(2.0 基准)，
// 官方 5s 720p 不含视频 = 46 × 108000/1M = 4.968 元。
func TestSeedanceBillRatioFullPrice(t *testing.T) {
	const modelRatio = 0.2723
	const exchangeRate = 7.3

	tests := []struct {
		name       string
		model      string
		sec        int
		res        string
		hasVideo   bool
		wantPrice  float64
	}{
		{"2.0 5s 720p no-video", "doubao-seedance-2.0", 5, "720p", false, 4.968},
		{"2.0 5s 1080p no-video", "doubao-seedance-2.0", 5, "1080p", false, 12.393},
		{"2.0 5s 4k no-video", "doubao-seedance-2.0", 5, "4k", false, 25.272},
		{"2.0 5s 720p with-video", "doubao-seedance-2.0", 5, "720p", true, 6.048},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio, _, err := SeedanceBillRatio(tt.model, tt.sec, tt.res, tt.hasVideo)
			require.NoError(t, err)
			price := modelRatio / 2 * ratio * exchangeRate
			assert.InDelta(t, tt.wantPrice, price, 0.02)
		})
	}
}

// TestNormalizeSeedanceModel 校验渠道别名归一化到分档单价表键。
func TestNormalizeSeedanceModel(t *testing.T) {
	tests := map[string]string{
		"doubao-seedance-2.0":            "doubao-seedance-2-0-260128",
		"doubao-seedance-2-0-260128":     "doubao-seedance-2-0-260128",
		"seedance2.0-cyai-260128":        "doubao-seedance-2-0-260128",
		"seedance2.0-cyai-25-260628":     "doubao-seedance-2-5-260628",
		"seedance2.0-cyai-fast-260128":   "doubao-seedance-2-0-fast-260128",
		"seedance2.0-cyai-mini-260615":   "doubao-seedance-2-0-mini-260615",
		"seedance2.0-foxtoken":           "doubao-seedance-2-0-260128",
	}
	for in, want := range tests {
		assert.Equal(t, want, normalizeSeedanceModel(in), "model=%s", in)
	}
}

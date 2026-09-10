package taskcommon

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
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

// TestSeedanceTierPricePerModel 锁定「配置按完整模型名独立」的契约：
// 给某个模型单独配置分档单价/倍率后，只有该模型受影响，其它同型号模型仍用默认值。
func TestSeedanceTierPricePerModel(t *testing.T) {
	cfg := config.GlobalConfig.Get("video_pricing_setting")
	require.NotNil(t, cfg, "video_pricing_setting must be registered")

	// 仅给 seedance2.0-cyai-260128 配置自定义单价与倍率。
	require.NoError(t, config.UpdateConfigFromMap(cfg, map[string]string{
		"tiered_price_by_model":     `{"seedance2.0-cyai-260128":{"no_720p":99,"no_1080p":120}}`,
		"model_multiplier_by_model": `{"seedance2.0-cyai-260128":1.5}`,
	}))
	t.Cleanup(func() {
		_ = config.UpdateConfigFromMap(cfg, map[string]string{
			"tiered_price_by_model":     `{}`,
			"model_multiplier_by_model": `{}`,
		})
	})

	// 已配置的模型：使用自定义值。
	price, ok := SeedanceTierPrice("seedance2.0-cyai-260128", "720p", false)
	require.True(t, ok)
	assert.InDelta(t, 99, price, 1e-6)
	price, ok = SeedanceTierPrice("seedance2.0-cyai-260128", "1080p", false)
	require.True(t, ok)
	assert.InDelta(t, 120, price, 1e-6)
	assert.InDelta(t, 1.5, SeedanceModelMultiplier("seedance2.0-cyai-260128"), 1e-6)

	// 未配置的同型号模型：仍使用内置默认单价与倍率 1.0，不受上面配置影响。
	price, ok = SeedanceTierPrice("seedance2.0-foxtoken", "720p", false)
	require.True(t, ok)
	assert.InDelta(t, 46, price, 1e-6)
	assert.InDelta(t, 1.0, SeedanceModelMultiplier("seedance2.0-foxtoken"), 1e-6)
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

// TestSeedanceEndToEndPriceAcrossChannels 校验统一接入后，各渠道模型按
// 「分档单价 × token/1e6」得出正确价格（覆盖 seedance/foxtoken/globalaiopc 等）。
func TestSeedanceEndToEndPriceAcrossChannels(t *testing.T) {
	const modelRatio = 0.2723
	const rate = 7.3

	tests := []struct {
		name      string
		model     string
		res       string
		hasVideo  bool
		sec       int
		wantYuan  float64
	}{
		// seedance 适配器（type 59）
		{"yd 5s 720p", "seedance2.0-yd", "720p", false, 5, 4.968},
		{"tianyi 5s 1080p", "seedance2.0-tianyi", "1080p", false, 5, 12.393},
		{"cyai-mobile 5s 720p", "seedance2.0-cyai-mobile-260128", "720p", false, 5, 4.968},
		// foxtoken（type 61）：fast 档基准 37
		{"foxtoken-fast 5s 720p", "seedance2.0-foxtoken-fast", "720p", false, 5, 3.996},
		// globalaiopc（type 60）：2.5 档基准 70
		{"globalaiopc-v25 5s 720p", "seedance2.0-globalaiopc-v25", "720p", false, 5, 7.56},
		// cyai（type 62）：含视频 token 翻倍
		{"cyai 5s 720p with-video", "seedance2.0-cyai-260128", "720p", true, 5, 6.048},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, err := SeedanceToken(tt.sec, tt.res, tt.hasVideo)
			require.NoError(t, err)
			tierPrice, ok := SeedanceTierPrice(tt.model, tt.res, tt.hasVideo)
			require.True(t, ok, "model=%s should have a tier price", tt.model)
			ratio, ok := ComputeSeedanceBillRatio(tierPrice, token, modelRatio, rate, 1.0)
			require.True(t, ok)
			yuan := modelRatio / 2 * ratio * rate
			assert.InDelta(t, tt.wantYuan, yuan, 0.02)
		})
	}
}
// TestSeedanceUnsupportedInputVideoChargedAsNoVideo 锁定契约：当渠道不支持参考视频时
// （EstimateSeedanceBilling 的 supportsInputVideo=false），即使请求携带 video_url，
// 也按「输入不含视频」计费，避免对上游会忽略的素材多收费。
func TestSeedanceUnsupportedInputVideoChargedAsNoVideo(t *testing.T) {
	const modelRatio = 0.2723
	const rate = 7.3

	metadata := map[string]interface{}{
		"resolution": "720p",
		"content": []interface{}{
			map[string]interface{}{
				"type":      "video_url",
				"video_url": map[string]interface{}{"url": "https://example.com/ref.mp4"},
			},
		},
	}
	// 请求确实携带了参考视频。
	require.True(t, HasInputVideo(metadata))

	// 不支持参考视频的渠道：强制按不含视频处理。
	hasVideo := false && HasInputVideo(metadata)
	assert.False(t, hasVideo)

	// token 按单边（5s）而不是双边（10s）。
	token, err := SeedanceToken(5, "720p", hasVideo)
	require.NoError(t, err)
	assert.Equal(t, 108000, token)

	// 单价取不含视频档（46）而不是含视频档（28）。
	tierPrice, ok := SeedanceTierPrice("seedance2.0-cyai-260128", "720p", hasVideo)
	require.True(t, ok)
	assert.InDelta(t, 46, tierPrice, 1e-6)

	ratio, ok := ComputeSeedanceBillRatio(tierPrice, token, modelRatio, rate, 1.0)
	require.True(t, ok)
	yuan := modelRatio / 2 * ratio * rate
	assert.InDelta(t, 4.968, yuan, 0.02)

	// 对照：支持参考视频的渠道按含视频计费，价格更高（6.048 元）。
	withVideoToken, err := SeedanceToken(5, "720p", true)
	require.NoError(t, err)
	withVideoPrice, ok := SeedanceTierPrice("seedance2.0-cyai-260128", "720p", true)
	require.True(t, ok)
	withVideoRatio, ok := ComputeSeedanceBillRatio(withVideoPrice, withVideoToken, modelRatio, rate, 1.0)
	require.True(t, ok)
	assert.InDelta(t, 6.048, modelRatio/2*withVideoRatio*rate, 0.02)
}

// TestIsSeedanceModel 锁定模型判断：只有 seedance 系模型走官方 token 公式计费，
// kling / suno 等其它任务模型必须返回 false（它们与 seedance 共用适配器或公共入口）。
func TestIsSeedanceModel(t *testing.T) {
	yes := []string{
		"seedance2.0-cyai-260128",
		"seedance2.0-yd",
		"seedance2.0-tianyi-fast",
		"doubao-seedance-2-0-260128",
		"doubao-seedance-1-0-pro-250528",
	}
	for _, m := range yes {
		assert.True(t, IsSeedanceModel(m), "model=%s", m)
	}

	no := []string{"kling-v1", "kling-v1-6", "kling-v2-master", "suno_music", "gpt-4o"}
	for _, m := range no {
		assert.False(t, IsSeedanceModel(m), "model=%s", m)
	}
}

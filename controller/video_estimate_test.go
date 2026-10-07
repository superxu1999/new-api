/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	"github.com/stretchr/testify/assert"
)

// TestEstimateVideoTokenQuotaScalesWithInputs 锁定预估价与真实计费同源的三条性质：
// 时长线性、分辨率按像素面积、分组倍率线性。价格会不会算错，用户一眼就能看出来，
// 所以这些性质比某个具体数字更值得钉住。
func TestEstimateVideoTokenQuotaScalesWithInputs(t *testing.T) {
	const (
		tierPrice  = 46.0
		multiplier = 1.0
		groupRatio = 1.0
		rate       = 7.3
	)
	token5s, err := taskcommon.SeedanceToken(5, "720p", false)
	assert.NoError(t, err)
	token10s, err := taskcommon.SeedanceToken(10, "720p", false)
	assert.NoError(t, err)
	token1080p, err := taskcommon.SeedanceToken(5, "1080p", false)
	assert.NoError(t, err)

	quota5s := estimateVideoTokenQuota(tierPrice, token5s, multiplier, groupRatio, rate)
	quota10s := estimateVideoTokenQuota(tierPrice, token10s, multiplier, groupRatio, rate)
	quota1080p := estimateVideoTokenQuota(tierPrice, token1080p, multiplier, groupRatio, rate)

	assert.Greater(t, quota5s, 0)
	// 时长翻倍 → 额度翻倍（允许 1 quota 的取整误差）。
	assert.InDelta(t, quota5s*2, quota10s, 1)
	// 1080p 相对 720p 的像素倍率是 2.25。
	assert.InDelta(t, float64(quota5s)*2.25, float64(quota1080p), 2)
	// 分组倍率线性。
	assert.InDelta(t, quota5s*2, estimateVideoTokenQuota(tierPrice, token5s, multiplier, 2, rate), 1)
	// 模型倍率不参与（在公式里被约掉），预估价与它无关。
	assert.Equal(t, quota5s, estimateVideoTokenQuota(tierPrice, token5s, 1, groupRatio, rate))
}

// TestEstimateVideoTokenQuotaIsSaturatingAndSafe 汇率缺失或数值异常时不能产出负额度：
// 负额度在计费里等价于「给用户退钱」，是必须守住的红线。
func TestEstimateVideoTokenQuotaIsSaturatingAndSafe(t *testing.T) {
	assert.Equal(t, 0, estimateVideoTokenQuota(46, 108000, 1, 1, 0))
	assert.Equal(t, 0, estimateVideoTokenQuota(46, 108000, 1, 1, -1))
	// 极端倍率顶到上限而不是回绕。
	assert.Equal(t, math.MaxInt32, estimateVideoTokenQuota(1e9, 1e9, 1e9, 1e9, 1))

	// 正常量级对得上：5 秒 720p、46 元/M 约为 4.97 元，换算成 quota 在 34 万上下。
	quota := estimateVideoTokenQuota(46, 108000, 1, 1, 7.3)
	expected := 46 * 108000 / 1e6 / 7.3 * common.QuotaPerUnit
	assert.InDelta(t, expected, float64(quota), 1)
}

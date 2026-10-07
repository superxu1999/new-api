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
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ability(group, modelName string, channelType int) model.AbilityWithChannel {
	return model.AbilityWithChannel{
		Ability:     model.Ability{Group: group, Model: modelName, ChannelId: channelType, Enabled: true},
		ChannelType: channelType,
	}
}

func inputsOf(t *testing.T, entry map[string]any) []channel.VideoInputKind {
	t.Helper()
	raw, ok := entry["inputs"].([]channel.VideoInputKind)
	require.True(t, ok, "inputs must be a typed slice")
	return raw
}

// TestBuildVideoCapabilityModels 锁定能力聚合规则：同组、只有任务型渠道参与、
// 同一模型跨多渠道取并集。这条规则同时决定前端置灰与后端选路，算错会直接错账或误拒。
func TestBuildVideoCapabilityModels(t *testing.T) {
	abilities := []model.AbilityWithChannel{
		ability("default", "seedance2.0-migu", constant.ChannelTypeMiguAigc),
		ability("default", "seedance2.0-cyai", constant.ChannelTypeCyai),
		ability("default", "kling-2.5", constant.ChannelTypeKling),
		// 同一模型挂在两条渠道上：一条只能文生，一条支持参考视频 → 取并集后应支持参考视频。
		ability("default", "dual-model", constant.ChannelTypeKling),
		ability("default", "dual-model", constant.ChannelTypeSeedance),
		// 其它分组与纯对话模型必须被排除。
		ability("vip", "seedance2.0-vip", constant.ChannelTypeSeedance),
		ability("default", "gpt-4o", constant.ChannelTypeOpenAI),
	}

	models := buildVideoCapabilityModels(abilities, "default")
	byName := map[string]map[string]any{}
	for _, entry := range models {
		byName[entry["model"].(string)] = entry
	}

	require.Len(t, byName, 4, "只保留 default 分组里的视频模型")
	assert.NotContains(t, byName, "gpt-4o", "对话模型不能混进视频模型列表")

	// 咪咕当前只声明文生视频。
	assert.Equal(t, []channel.VideoInputKind{channel.VideoInputText}, inputsOf(t, byName["seedance2.0-migu"]))

	// Kling 不支持参考视频。
	assert.False(t, hasInput(inputsOf(t, byName["kling-2.5"]), channel.VideoInputReferenceVideo))

	// 跨渠道并集：种子渠道补上了参考视频能力。
	assert.True(t, hasInput(inputsOf(t, byName["dual-model"]), channel.VideoInputReferenceVideo))
	assert.True(t, hasInput(inputsOf(t, byName["dual-model"]), channel.VideoInputReferenceAudio))
	assert.True(t, byName["dual-model"]["returns_last_frame"].(bool))

	// 列表按模型名排序，便于前端稳定渲染。
	assert.Equal(t, "dual-model", models[0]["model"])
	assert.Equal(t, "kling-2.5", models[1]["model"])

	// 不同分组互不影响。
	assert.Empty(t, buildVideoCapabilityModels(abilities, "not-exist"))
}

func hasInput(inputs []channel.VideoInputKind, want channel.VideoInputKind) bool {
	for _, input := range inputs {
		if input == want {
			return true
		}
	}
	return false
}

package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// 图片模型识别直接决定两件事：模型是否对外标注为图片生成、以及渠道按哪种端点调用。
// 豆包 Seedream 只提供 /v1/images/generations，一旦漏判就会被当成对话模型调用，
// 上游会回 "No available channel for model ..."，这个用例锁住该回归。
func TestIsImageGenerationModel(t *testing.T) {
	cases := []struct {
		model string
		want  bool
	}{
		{"doubao-seedream-5-0-pro-260628", true},
		{"doubao-seedream-4-0-250828", true},
		{"seedream-4-0-250828", true},
		{"gpt-image-1", true},
		{"dall-e-3", true},
		{"doubao-seedance-2-0-260128", false},
		{"gpt-4o", false},
		{"claude-sonnet-4", false},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, IsImageGenerationModel(tc.model), tc.model)
	}
}

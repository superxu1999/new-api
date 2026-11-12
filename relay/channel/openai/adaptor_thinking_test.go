package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 回归：HFSY 这类 OpenAI 兼容中转会把 reasoning_effort 翻成旧版 thinking.type="enabled"，
// 而 claude opus 5 系只接受 adaptive，因此必须在透传前改写成 thinking + output_config。
func TestConvertOpenAIRequest_ClaudeOpus55ReasoningEffortUsesAdaptive(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenAI,
	}}
	request := &dto.GeneralOpenAIRequest{
		Model:           "claude-opus-5-5",
		ReasoningEffort: "high",
	}

	converted, err := adaptor.ConvertOpenAIRequest(nil, info, request)
	require.NoError(t, err)
	require.NotNil(t, converted)

	assert.Empty(t, request.ReasoningEffort)
	assert.JSONEq(t, `{"type":"adaptive"}`, string(request.THINKING))
	assert.JSONEq(t, `{"effort":"high"}`, string(request.OutputConfig))
}

// 旧版 thinking.budget_tokens 需要折算成 effort 档位。
func TestConvertOpenAIRequest_ClaudeOpus5LegacyThinkingBudgetConvertsToEffort(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenAI,
	}}
	request := &dto.GeneralOpenAIRequest{
		Model:    "claude-opus-4-8",
		THINKING: []byte(`{"type":"enabled","budget_tokens":2048}`),
	}

	_, err := adaptor.ConvertOpenAIRequest(nil, info, request)
	require.NoError(t, err)

	assert.JSONEq(t, `{"type":"adaptive"}`, string(request.THINKING))
	assert.JSONEq(t, `{"effort":"medium"}`, string(request.OutputConfig))
}

// 不需要 adaptive 的模型保持原样透传，不能被误改写。
func TestConvertOpenAIRequest_NonAdaptiveModelKeepsReasoningEffort(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: constant.ChannelTypeOpenAI,
	}}
	request := &dto.GeneralOpenAIRequest{
		Model:           "gpt-5.6-sol",
		ReasoningEffort: "high",
	}

	_, err := adaptor.ConvertOpenAIRequest(nil, info, request)
	require.NoError(t, err)

	assert.Equal(t, "high", request.ReasoningEffort)
	assert.Empty(t, request.THINKING)
	assert.Empty(t, request.OutputConfig)
}

package model_setting

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

// 只接受 adaptive 思考的模型判定：opus 4.7/4.8/5 系必须改写，其余仍可用 enabled。
func TestRequiresAdaptiveThinking(t *testing.T) {
	for _, model := range []string{
		"claude-opus-4-7",
		"claude-opus-4-7-high",
		"claude-opus-4-8",
		"claude-opus-5",
		"claude-opus-5-5",
	} {
		assert.True(t, RequiresAdaptiveThinking(model), model)
	}
	for _, model := range []string{
		"claude-opus-4-6",
		"claude-sonnet-5",
		"claude-3-7-sonnet-20250219",
		"gpt-5",
	} {
		assert.False(t, RequiresAdaptiveThinking(model), model)
	}
}

// 旧版 budget_tokens 折算成 effort 档位。
func TestEffortFromThinkingBudget(t *testing.T) {
	tests := []struct {
		budget int
		want   string
	}{
		{1280, "low"},
		{2048, "medium"},
		{4096, "medium"},
		{8192, "high"},
		{0, "low"},
	}
	for _, tc := range tests {
		assert.Equal(t, tc.want, EffortFromThinkingBudget(tc.budget), "budget=%d", tc.budget)
	}
}

func TestClaudeSettingsWriteHeadersMergesConfiguredValuesIntoSingleHeader(t *testing.T) {
	settings := &ClaudeSettings{
		HeadersSettings: map[string]map[string][]string{
			"claude-3-7-sonnet-20250219-thinking": {
				"anthropic-beta": {
					"token-efficient-tools-2025-02-19",
				},
			},
		},
	}

	headers := http.Header{}
	headers.Set("anthropic-beta", "output-128k-2025-02-19")

	settings.WriteHeaders("claude-3-7-sonnet-20250219-thinking", &headers)

	got := headers.Values("anthropic-beta")
	if len(got) != 1 {
		t.Fatalf("expected a single merged header value, got %v", got)
	}
	expected := "output-128k-2025-02-19,token-efficient-tools-2025-02-19"
	if got[0] != expected {
		t.Fatalf("expected merged header %q, got %q", expected, got[0])
	}
}

func TestClaudeSettingsWriteHeadersDeduplicatesAcrossCommaSeparatedAndRepeatedValues(t *testing.T) {
	settings := &ClaudeSettings{
		HeadersSettings: map[string]map[string][]string{
			"claude-3-7-sonnet-20250219-thinking": {
				"anthropic-beta": {
					"token-efficient-tools-2025-02-19",
					"computer-use-2025-01-24",
				},
			},
		},
	}

	headers := http.Header{}
	headers.Add("anthropic-beta", "output-128k-2025-02-19, token-efficient-tools-2025-02-19")
	headers.Add("anthropic-beta", "token-efficient-tools-2025-02-19")

	settings.WriteHeaders("claude-3-7-sonnet-20250219-thinking", &headers)

	got := headers.Values("anthropic-beta")
	if len(got) != 1 {
		t.Fatalf("expected duplicate values to collapse into one header, got %v", got)
	}
	expected := "output-128k-2025-02-19,token-efficient-tools-2025-02-19,computer-use-2025-01-24"
	if got[0] != expected {
		t.Fatalf("expected deduplicated merged header %q, got %q", expected, got[0])
	}
}

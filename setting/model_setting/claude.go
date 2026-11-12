package model_setting

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

//var claudeHeadersSettings = map[string][]string{}
//
//var ClaudeThinkingAdapterEnabled = true
//var ClaudeThinkingAdapterMaxTokens = 8192
//var ClaudeThinkingAdapterBudgetTokensPercentage = 0.8

// ClaudeSettings 定义Claude模型的配置
type ClaudeSettings struct {
	HeadersSettings                       map[string]map[string][]string `json:"model_headers_settings"`
	DefaultMaxTokens                      map[string]int                 `json:"default_max_tokens"`
	ThinkingAdapterEnabled                bool                           `json:"thinking_adapter_enabled"`
	ThinkingAdapterBudgetTokensPercentage float64                        `json:"thinking_adapter_budget_tokens_percentage"`
}

// 默认配置
var defaultClaudeSettings = ClaudeSettings{
	HeadersSettings:        map[string]map[string][]string{},
	ThinkingAdapterEnabled: true,
	DefaultMaxTokens: map[string]int{
		"default": 8192,
	},
	ThinkingAdapterBudgetTokensPercentage: 0.8,
}

// 全局实例
var claudeSettings = defaultClaudeSettings

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("claude", &claudeSettings)
}

// GetClaudeSettings 获取Claude配置
func GetClaudeSettings() *ClaudeSettings {
	// check default max tokens must have default key
	if _, ok := claudeSettings.DefaultMaxTokens["default"]; !ok {
		claudeSettings.DefaultMaxTokens["default"] = 8192
	}
	return &claudeSettings
}

func (c *ClaudeSettings) WriteHeaders(originModel string, httpHeader *http.Header) {
	if headers, ok := c.HeadersSettings[originModel]; ok {
		for headerKey, headerValues := range headers {
			mergedValues := normalizeHeaderListValues(
				append(append([]string(nil), httpHeader.Values(headerKey)...), headerValues...),
			)
			if len(mergedValues) == 0 {
				continue
			}
			httpHeader.Set(headerKey, strings.Join(mergedValues, ","))
		}
	}
}

func normalizeHeaderListValues(values []string) []string {
	normalizedValues := make([]string, 0, len(values))
	seenValues := make(map[string]struct{}, len(values))
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			normalizedItem := strings.TrimSpace(item)
			if normalizedItem == "" {
				continue
			}
			if _, exists := seenValues[normalizedItem]; exists {
				continue
			}
			seenValues[normalizedItem] = struct{}{}
			normalizedValues = append(normalizedValues, normalizedItem)
		}
	}
	return normalizedValues
}

func (c *ClaudeSettings) GetDefaultMaxTokens(model string) int {
	if maxTokens, ok := c.DefaultMaxTokens[model]; ok {
		return maxTokens
	}
	return c.DefaultMaxTokens["default"]
}

// adaptiveOnlyThinkingModelPrefixes 列出只接受 adaptive 思考的模型前缀。
// 这些模型拒绝 thinking.type="enabled"（上游返回 400：
// "requires adaptive thinking; omit thinking or use type=adaptive and output_config.effort"），
// 推理等级必须用 thinking.type=adaptive + output_config.effort 表达。
var adaptiveOnlyThinkingModelPrefixes = []string{
	"claude-opus-4-7",
	"claude-opus-4-8",
	"claude-opus-5",
}

// RequiresAdaptiveThinking 判断该模型是否只接受 adaptive 思考。
// 注意 "claude-opus-5" 前缀同时覆盖 claude-opus-5 与 claude-opus-5-5。
func RequiresAdaptiveThinking(model string) bool {
	for _, prefix := range adaptiveOnlyThinkingModelPrefixes {
		if strings.HasPrefix(model, prefix) {
			return true
		}
	}
	return false
}

// EffortFromThinkingBudget 把旧版 thinking.budget_tokens 折算成 adaptive 模式的 effort 档位。
// 上游只接受 low/medium/high（及其它档位名以模型为准），这里按预算量级给出等价档位。
func EffortFromThinkingBudget(budgetTokens int) string {
	switch {
	case budgetTokens >= 8192:
		return "high"
	case budgetTokens >= 2048:
		return "medium"
	default:
		return "low"
	}
}

// NormalizeAdaptiveEffort 把客户端常见的推理等级归一化成 Anthropic adaptive 能接受的档位。
// 各家客户端还会发 minimal / xhigh / max / none，直接透传会被上游拒绝。
func NormalizeAdaptiveEffort(effort string) string {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "minimal":
		return "low"
	case "low":
		return "low"
	case "medium":
		return "medium"
	case "high":
		return "high"
	case "xhigh", "max":
		return "high"
	default:
		return ""
	}
}

package common

// ChannelTypeIconName maps a channel type to a LobeHub icon name used by the
// pricing (Model Square) UI. Mirrors web/default channel-utils getChannelTypeIcon.
func GetChannelTypeIconName(channelType int) string {
	switch channelType {
	// OpenAI family
	case 1, 6, 7, 8, 53, 10, 21, 12, 13, 9, 44:
		return "OpenAI"
	case 58:
		return "NewAPI"
	case 3:
		return "Azure"
	// Anthropic
	case 14:
		return "Claude"
	// Google family
	case 24, 41:
		return "Gemini"
	case 11:
		return "Google"
	// Cloud providers
	case 33:
		return "Aws"
	case 39:
		return "Cloudflare"
	// Chinese providers
	case 15, 46:
		return "Baidu"
	case 16, 26:
		return "Zhipu"
	case 17:
		return "Qwen"
	case 18:
		return "Spark"
	case 23:
		return "Hunyuan"
	case 19:
		return "Ai360"
	case 25:
		return "Moonshot"
	case 31:
		return "Yi"
	case 35:
		return "Minimax"
	case 45, 54:
		return "Volcengine"
	// Other AI providers
	case 4:
		return "Ollama"
	case 27:
		return "Perplexity"
	case 34:
		return "Cohere"
	case 42:
		return "Mistral"
	case 43:
		return "DeepSeek"
	case 48:
		return "XAI"
	case 49:
		return "Coze"
	case 40:
		return "SiliconCloud"
	case 20:
		return "OpenRouter"
	// Image/Video generation
	case 2, 5:
		return "Midjourney"
	case 50:
		return "Kling"
	case 51:
		return "Jimeng"
	case 52:
		return "Vidu"
	case 36:
		return "Suno"
	case 55:
		return "OpenAI"
	case 56:
		return "Replicate"
	case 59, 60, 61, 62:
		return "Doubao"
	// Tools & platforms
	case 37:
		return "Dify"
	case 38:
		return "Jina"
	case 22:
		return "FastGPT"
	case 47:
		return "Xinference"
	default:
		return "OpenAI"
	}
}

package cyai

import (
	"bytes"
	"io"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel/task/foxtoken"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/samber/lo"
)

// TaskAdaptor 复用 foxtoken 的 new-api OpenAI 视频协议实现（创建/轮询/解析），
// 仅覆盖渠道名称、默认模型列表，并重写 BuildRequestBody 以兼容 CyAI 上游：
// CyAI 不接受 duration=-1(自动)，统一省略交由上游默认(5s)。
type TaskAdaptor struct {
	foxtoken.TaskAdaptor
}

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }
func (a *TaskAdaptor) GetModelList() []string { return ModelList }

// 上游 CyAI 按时长×清晰度 tiered 计费；为对齐上游价格，按清晰度附加相对倍率。
// 系数可从后台配置（video_pricing_setting.resolution_ratio），缺省用下方默认。
var defaultResolutionRatio = map[string]float64{
	"480p":  1.0,
	"720p":  1.0,
	"1080p": 1.25,
	"4k":    0.32,
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	seconds := req.Duration
	if seconds <= 0 {
		seconds, _ = strconv.Atoi(req.Seconds)
	}
	ratios := map[string]float64{}
	if seconds > 0 {
		ratios["seconds"] = float64(seconds)
	}
	model := info.UpstreamModelName
	if model == "" {
		model = info.OriginModelName
	}
	if req.Metadata != nil {
		if res, _ := req.Metadata["resolution"].(string); res != "" {
			if r, ok := operation_setting.GetVideoResolutionRatioForModel(model, res); ok {
				ratios["resolution"] = r
			} else if r, ok := defaultResolutionRatio[res]; ok {
				ratios["resolution"] = r
			}
		}
	}
	if len(ratios) == 0 {
		return nil
	}
	return ratios
}

// contentItem 表示 content 数组中的单个参考项。CyAI 上游（Doubao/Seedance 风格）通过
// 顶层 content 数组携带文本与多模态参考，video/audio 必须携带 role，
// 且至少需要一条 text（否则上游返回「必须提供至少 1 条文本提示词」）。
type contentItem struct {
	Type     string    `json:"type,omitempty"`
	Text     string    `json:"text,omitempty"`
	ImageURL *mediaURL `json:"image_url,omitempty"`
	VideoURL *mediaURL `json:"video_url,omitempty"`
	AudioURL *mediaURL `json:"audio_url,omitempty"`
	Role     string    `json:"role,omitempty"`
}

// mediaURL 为参考项的 URL 载体。
type mediaURL struct {
	URL string `json:"url,omitempty"`
}

type requestPayload struct {
	Model    string         `json:"model"`
	Prompt   string         `json:"prompt,omitempty"`
	Content  []contentItem  `json:"content,omitempty"`
	Duration *int           `json:"duration,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	body := &requestPayload{Model: req.Model, Prompt: req.Prompt}
	if info.IsModelMapped {
		body.Model = info.UpstreamModelName
	} else {
		info.UpstreamModelName = body.Model
	}
	if sec, _ := strconv.Atoi(req.Seconds); sec > 0 {
		body.Duration = lo.ToPtr(sec)
	} else if req.Duration > 0 {
		body.Duration = lo.ToPtr(req.Duration)
	}
	// CyAI 上游不接受 -1(自动) 时长:此处省略 duration,交由上游默认(5s)
	// CyAI 上游必须携带非空 resolution,否则 400(does not support resolution "")
	metadata := normalizeResolution(req.Metadata)

	// CyAI 上游（Doubao/Seedance 风格）只认顶层 content 数组，不认顶层 prompt：
	// 顶层 prompt 会 400（content is required）。因此当存在多模态参考（metadata.content）时
	// 统一把 prompt 作为 content[0] 的 text，并把图/视频/音频参考追加进去；
	// 无参考时保持向后兼容，透传顶层 prompt。
	if content, hasRef := buildContent(req.Prompt, metadata); hasRef {
		body.Content = content
		body.Prompt = ""
		delete(metadata, "content")
	}
	body.Metadata = metadata

	data, err := common.Marshal(body)
	if err != nil {
		return nil, errors.Wrap(err, "marshal request body failed")
	}
	return bytes.NewReader(data), nil
}

// buildContent 把 prompt 与 metadata.content 参考项合并成 CyAI 的顶层 content 数组。
// 返回 (content, hasReference)。hasReference 表示用户是否真的传了 metadata.content 参考：
// 为 false 时调用方应保持向后兼容（透传顶层 prompt），不输出 content 数组。
// 上游要求至少一条 text，且 video/audio 必须带 role。
func buildContent(prompt string, metadata map[string]any) ([]contentItem, bool) {
	items := parseContentReferences(metadata)
	if len(items) == 0 {
		return nil, false
	}
	for i := range items {
		normalizeContentRole(&items[i])
	}
	// 上游要求至少一条 text：参考项中没有 text 时，用 prompt 作为 text 补到最前。
	hasText := false
	for _, it := range items {
		if it.Type == "text" {
			hasText = true
			break
		}
	}
	if !hasText {
		items = append([]contentItem{{Type: "text", Text: prompt}}, items...)
	}
	return items, true
}

// parseContentReferences 解析 metadata["content"] 为 []contentItem。
// content 可能是 []map[string]any 或已反序列化的切片；解析失败时返回空。
func parseContentReferences(metadata map[string]any) []contentItem {
	raw, ok := metadata["content"]
	if !ok {
		return nil
	}
	data, err := common.Marshal(raw)
	if err != nil {
		return nil
	}
	var items []contentItem
	if err := common.Unmarshal(data, &items); err != nil {
		return nil
	}
	return items
}

// normalizeContentRole 为视频/音频参考补默认 role（CyAI 上游对无 role 的
// 视频/音频返回 400：「视频 role 仅支持 reference_video」「音频 role 仅支持 reference_audio」）。
func normalizeContentRole(it *contentItem) {
	switch it.Type {
	case "video_url":
		if it.Role == "" {
			it.Role = "reference_video"
		}
	case "audio_url":
		if it.Role == "" {
			it.Role = "reference_audio"
		}
	}
}

// normalizeResolution 保证 CyAI 请求携带非空清晰度;缺省或为空统一用 720p。
func normalizeResolution(meta map[string]any) map[string]any {
	if meta == nil {
		meta = map[string]any{}
	}
	if r, _ := meta["resolution"].(string); r == "" {
		meta["resolution"] = "720p"
	}
	return meta
}

package migu

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/samber/lo"
	"github.com/tidwall/gjson"
)

// 咪咕云 OpenAPI 与火山 ARK 系的差异（这也是必须单独写适配器的原因）：
//   - 鉴权是 X-API-Key 头，不是 Authorization: Bearer
//   - 创建 POST /api/open/v1/videos（不是 /api/v3/contents/generations/tasks）
//   - 统一响应壳 {requestId, code, message, timestamp, data}，业务成功看 **字符串** code == "0"
//   - 任务状态是数字 1~6 + deliverable 布尔，不是状态字符串
//   - 成片地址在独立的 /videos/{taskId}/download-url 接口上
const (
	// contentTypeText 是文生视频的 contentType。本适配器当前只接入文生视频。
	contentTypeText = "text"

	// successCode 是响应壳里的业务成功码（字符串，与 HTTP 状态码相互独立）。
	successCode = "0"

	upstreamStatusPending    = 1 // 待处理
	upstreamStatusQueued     = 2 // 排队中
	upstreamStatusProcessing = 3 // 处理中
	upstreamStatusFinished   = 4 // 已完成（deliverable=false 时成品仍取不到）
	upstreamStatusFailed     = 5 // 失败
	upstreamStatusCancelled  = 6 // 已取消
)

// newApiDownloadURLKey 是本站注入到上游响应体根部的字段名。
//
// 轮询框架只把 FetchTask 的响应体交给 ParseTaskResult，而成片地址在独立的
// download-url 接口上，因此任务交付后由 FetchTask 补取一次并注入该字段。
// 用带前缀的名字避免与上游自身字段发生冲突。
const newApiDownloadURLKey = "newApiDownloadUrl"

// requestPayload 对应 POST /videos 的请求体（仅文生视频所需字段）。
//
// 注意：上游声明携带 callbackUrl 会直接返回 400，因此这里刻意不定义该字段，
// 也绝不要把客户端的回调地址透传下去。
type requestPayload struct {
	VideoName     string `json:"videoName"`
	ContentType   string `json:"contentType"`
	Model         string `json:"model"`
	Prompt        string `json:"prompt"`
	Duration      *int   `json:"duration,omitempty"`
	Ratio         string `json:"ratio,omitempty"`
	Resolution    string `json:"resolution,omitempty"`
	GenerateAudio *bool  `json:"generateAudio,omitempty"`
	Seed          *int64 `json:"seed,omitempty"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = strings.TrimRight(info.ChannelBaseUrl, "/")
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	if taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	// 当前只接入文生视频。带参考图的请求若被静默丢弃，用户会为「图生视频」付费
	// 却拿到纯文本生成的结果，因此这里必须显式拒绝。
	if len(req.Images) > 0 || strings.TrimSpace(req.Image) != "" || strings.TrimSpace(req.InputReference) != "" {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("this channel only supports text-to-video; reference image input is not supported"),
			"unsupported_content_type", http.StatusBadRequest)
	}
	// 上游 generateCount 1~5 会让积分按条数倍增，而本站按单条任务计费：
	// 多于一条时按一条收费会少收，直接拒绝。
	if req.N > 1 {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("n must be 1: multiple videos per task are not supported"),
			"invalid_request", http.StatusBadRequest)
	}
	if taskErr := validateDuration(req); taskErr != nil {
		return taskErr
	}
	return nil
}

// validateDuration 按模型校验时长。0（未填）与 -1（自动）交给上游默认值，
// 计费安全上界（relaycommon.MaxTaskDurationSeconds）已由前置校验保证。
func validateDuration(req relaycommon.TaskSubmitReq) *dto.TaskError {
	seconds := taskcommon.ExtractSeconds(&req)
	if seconds <= 0 {
		return nil
	}
	r := durationRangeFor(req.Model)
	if seconds < r.Min || seconds > r.Max {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("video duration must be between %d and %d seconds", r.Min, r.Max),
			"invalid_seconds", http.StatusBadRequest)
	}
	return nil
}

// durationRangeFor 取模型对应的时长区间。
//
// 渠道里通常给上游模型起别名（如 seedance2.0-migu → seedance2.0），别名是运营商
// 自己定的，适配器无法穷举，因此先精确匹配，再按型号关键字兜底，最后才用最宽范围：
// 兜底过宽会让上游在预扣费之后才拒绝，兜底过窄会误伤合法请求。
func durationRangeFor(model string) DurationRange {
	if r, ok := ModelDurationRanges[model]; ok {
		return r
	}
	name := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(name, "seedance2.5"), strings.Contains(name, "seedance-2-5"):
		return ModelDurationRanges["seedance2.5"]
	case strings.Contains(name, "fast"):
		return ModelDurationRanges["seedance-Fast"]
	case strings.Contains(name, "seedance2.0"), strings.Contains(name, "seedance-2-0"):
		return ModelDurationRanges["seedance2.0"]
	default:
		return DefaultDurationRange
	}
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return a.baseURL + ApiPrefix + "/videos", nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", a.apiKey)
	// 便于上游按请求排查：公开任务 ID 每个任务唯一。
	if info.PublicTaskID != "" {
		req.Header.Set("X-Request-Id", info.PublicTaskID)
	}
	return nil
}

// EstimateBilling 按 seedance 系的官方 token 公式计费：
// 最终额度 = 分档单价 × token/1e6 × 分组倍率 × 模型计费倍率。
//
// 为什么沿用这套价目表：咪咕按「积分」结算，而实测积分与本站内置分档单价严丝合缝 ——
// 5 秒 720p 文生视频：2.5 = 75.60 积分，而 70 元/M × 108000 token / 1e6 = 7.56 元，
// 即 1 积分 = 0.1 元；2.0（50 积分 / 4.968 元）与 Fast（40 积分 / 3.996 元）同样吻合。
// 因此不改动价目表就能把上游成本原样传导，运营商只需用分组倍率/模型倍率加价。
//
// 这里不复用 taskcommon.EstimateSeedanceBilling，是因为它只读 metadata.resolution，
// 而 OpenAI 视频协议的分辨率在 size 字段里：只传 size 的请求会被按 720p 档计费，
// 实际却可能产出 1080p/4k，属于少收。resolutionOf 与请求体用的是同一套归一逻辑。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	resolution := resolutionOf(&req)
	seconds := taskcommon.ExtractSeconds(&req)
	if seconds <= 0 {
		// 0（未填）与 -1（自动）都按上游默认秒数预扣。
		seconds = DefaultDurationSeconds
	}
	token, err := taskcommon.SeedanceToken(seconds, resolution, false)
	if err != nil || token <= 0 {
		return nil
	}
	tierPrice, ok := taskcommon.SeedanceTierPrice(info.OriginModelName, resolution, false)
	if !ok || tierPrice <= 0 {
		return nil
	}
	multiplier := taskcommon.SeedanceModelMultiplier(info.OriginModelName)
	ratio, ok := taskcommon.ComputeSeedanceBillRatio(
		tierPrice, token, info.PriceData.ModelRatio, operation_setting.USDExchangeRate, multiplier)
	if !ok {
		return nil
	}
	// 记下计费中间量：日志与任务详情要展示这笔钱怎么算出来的，
	// 同时该键会让控制器把任务标记为「按次计费」，跳过通用的 token 差额结算。
	c.Set(taskcommon.SeedanceBillingContextKey, taskcommon.SeedanceBillingDetail{
		TierPrice:  tierPrice,
		Token:      token,
		Multiplier: multiplier,
		Resolution: resolution,
		Seconds:    seconds,
	})
	return map[string]float64{taskcommon.SeedanceBillingRatioKey: ratio}
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	model := req.Model
	if info.IsModelMapped {
		model = info.UpstreamModelName
	} else {
		info.UpstreamModelName = model
	}
	seconds := taskcommon.ExtractSeconds(&req)
	if seconds <= 0 {
		// 0（未填）与 -1（自动）都按上游默认秒数下发：上游 duration 不接受 -1。
		seconds = DefaultDurationSeconds
	}
	body := &requestPayload{
		VideoName:   videoNameOf(info),
		ContentType: contentTypeText,
		Model:       model,
		Prompt:      req.Prompt,
		Duration:    lo.ToPtr(seconds),
		Resolution:  resolutionOf(&req),
		Ratio:       ratioOf(&req),
	}
	if audio, ok := req.Metadata["generate_audio"].(bool); ok {
		body.GenerateAudio = lo.ToPtr(audio)
	}
	if seed, ok := seedOf(req.Metadata); ok {
		body.Seed = lo.ToPtr(seed)
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// videoNameOf 生成上游必填的 videoName（最长 128 字符）。
// 客户端协议里没有这个字段，用公开任务 ID 命名，便于在上游控制台对上号。
func videoNameOf(info *relaycommon.RelayInfo) string {
	if info != nil && info.PublicTaskID != "" {
		return "newapi-" + info.PublicTaskID
	}
	return "newapi-task"
}

// resolutionOf 解析分辨率，优先级：metadata.resolution → 客户端 size 归一化。
// 上游接受 "720p/1080p/4k" 这类档位键，也接受 "1920x1080" 像素串。
func resolutionOf(req *relaycommon.TaskSubmitReq) string {
	if req == nil {
		return ""
	}
	if res, ok := req.Metadata["resolution"].(string); ok && strings.TrimSpace(res) != "" {
		return strings.TrimSpace(res)
	}
	return pixelToResolution[strings.TrimSpace(req.Size)]
}

// ratioOf 解析宽高比，优先级：metadata.ratio → 客户端 size 推导。
// 两者都没有时留空：上游该字段仅用于留痕展示，可以缺省。
func ratioOf(req *relaycommon.TaskSubmitReq) string {
	if req == nil {
		return ""
	}
	if ratio, ok := req.Metadata["ratio"].(string); ok && strings.TrimSpace(ratio) != "" {
		return strings.TrimSpace(ratio)
	}
	return pixelToRatio[strings.TrimSpace(req.Size)]
}

// pixelToResolution 把 OpenAI 视频协议的 size 归一化成上游的分辨率档位键。
var pixelToResolution = map[string]string{
	"854x480":   "480p",
	"1280x720":  "720p",
	"720x1280":  "720p",
	"1920x1080": "1080p",
	"1080x1920": "1080p",
	"3840x2160": "4k",
	"2160x3840": "4k",
}

// pixelToRatio 把 size 归一化成宽高比。
var pixelToRatio = map[string]string{
	"854x480":   "16:9",
	"1280x720":  "16:9",
	"1920x1080": "16:9",
	"3840x2160": "16:9",
	"720x1280":  "9:16",
	"1080x1920": "9:16",
	"2160x3840": "9:16",
	"1024x1024": "1:1",
}

// seedOf 读取非负随机种子；负数与非法值一律忽略（上游只接受非负整数）。
func seedOf(metadata map[string]interface{}) (int64, bool) {
	if metadata == nil {
		return 0, false
	}
	switch v := metadata["seed"].(type) {
	case float64:
		if v >= 0 {
			return int64(v), true
		}
	case int64:
		if v >= 0 {
			return v, true
		}
	case int:
		if v >= 0 {
			return int64(v), true
		}
	}
	return 0, false
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	if code := businessCode(responseBody); code != "" && code != successCode {
		taskErr = service.TaskErrorWrapper(
			fmt.Errorf("migu open api error(code=%s): %s", code, businessMessage(responseBody)),
			"upstream_error", http.StatusBadRequest)
		return
	}
	taskID = upstreamTaskID(responseBody)
	if taskID == "" {
		taskErr = service.TaskErrorWrapper(
			fmt.Errorf("task id is empty, body: %s", responseBody), "invalid_response", http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName
	c.JSON(http.StatusOK, ov)
	return taskID, responseBody, nil
}

// FetchTask 查询任务状态；任务已交付时顺带取回成片地址并注入响应体。
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	base := strings.TrimRight(baseUrl, "/")

	detailURI := fmt.Sprintf("%s%s/videos/%s", base, ApiPrefix, url.PathEscape(taskID))
	resp, err := doMiguGet(client, detailURI, key, taskID)
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	_ = resp.Body.Close()
	if readErr != nil {
		return nil, readErr
	}

	merged := withDownloadURL(client, base, key, taskID, raw)
	return &http.Response{
		StatusCode: resp.StatusCode,
		Status:     resp.Status,
		Header:     http.Header{"Content-Type": []string{"application/json; charset=utf-8"}},
		Body:       io.NopCloser(bytes.NewReader(merged)),
	}, nil
}

// maxResponseBytes 是读取上游响应体的上限：任务详情里可能带较长的提示词与素材地址，
// 但绝不该是无上限的。
const maxResponseBytes = 1 << 20

// withDownloadURL 在任务已交付但详情里没有成片地址时，补调 download-url 并注入
// newApiDownloadURLKey。任何一步失败都原样返回详情，让轮询按「无 URL」处理，
// 不影响状态推进。
func withDownloadURL(client *http.Client, base, key, taskID string, detail []byte) []byte {
	if businessCode(detail) != successCode {
		return detail
	}
	if gjson.GetBytes(detail, "data.status").Int() != upstreamStatusFinished ||
		!gjson.GetBytes(detail, "data.deliverable").Bool() {
		return detail
	}
	if extractDownloadURL(detail) != "" {
		return detail
	}
	uri := fmt.Sprintf("%s%s/videos/%s/download-url", base, ApiPrefix, url.PathEscape(taskID))
	resp, err := doMiguGet(client, uri, key, taskID)
	if err != nil {
		return detail
	}
	dlBody, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	_ = resp.Body.Close()
	if readErr != nil || businessCode(dlBody) != successCode {
		return detail
	}
	downloadURL := extractDownloadURL(dlBody)
	if downloadURL == "" {
		return detail
	}
	var payload map[string]any
	if err := common.Unmarshal(detail, &payload); err != nil {
		return detail
	}
	payload[newApiDownloadURLKey] = downloadURL
	merged, err := common.Marshal(payload)
	if err != nil {
		return detail
	}
	return merged
}

// CancelTask 取消进行中的任务。
//
// 上游业务错误（任务已结束、任务不存在等）走 HTTP 200 + code != "0" 返回，
// 而调用方是按 HTTP 状态码判断成功与否的，因此这里把业务失败翻译成 4xx，
// 让上层透出上游原文且不改动本地状态与额度。
func (a *TaskAdaptor) CancelTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s%s/videos/%s/cancel", strings.TrimRight(baseUrl, "/"), ApiPrefix, url.PathEscape(taskID))
	req, err := http.NewRequest(http.MethodPost, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	_ = resp.Body.Close()
	if readErr != nil {
		return nil, readErr
	}
	statusCode := resp.StatusCode
	// HTTP 层成功但业务层失败：换成 400，让上层按「上游拒绝取消」处理。
	if code := businessCode(raw); statusCode >= 200 && statusCode < 300 && code != "" && code != successCode {
		statusCode = http.StatusBadRequest
	}
	return &http.Response{
		StatusCode: statusCode,
		Status:     resp.Status,
		Header:     http.Header{"Content-Type": []string{"application/json; charset=utf-8"}},
		Body:       io.NopCloser(bytes.NewReader(raw)),
	}, nil
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

// ParseTaskResult 把上游任务状态映射成内部状态。
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	if code := businessCode(respBody); code != "" && code != successCode {
		return nil, errors.Errorf("migu open api error(code=%s): %s", code, businessMessage(respBody))
	}
	result := &relaycommon.TaskInfo{Code: 0}
	switch gjson.GetBytes(respBody, "data.status").Int() {
	case upstreamStatusPending, upstreamStatusQueued:
		result.Status = model.TaskStatusQueued
		result.Progress = taskcommon.ProgressQueued
	case upstreamStatusProcessing:
		result.Status = model.TaskStatusInProgress
		result.Progress = taskcommon.ProgressInProgress
	case upstreamStatusFinished:
		if !gjson.GetBytes(respBody, "data.deliverable").Bool() {
			// 上游把「已完成但仍在审核」也记为 status=4：成品还取不到，
			// 按进行中继续轮询，不能判成成功。
			result.Status = model.TaskStatusInProgress
			result.Progress = taskcommon.ProgressInProgress
			break
		}
		result.Status = model.TaskStatusSuccess
		result.Progress = taskcommon.ProgressComplete
		result.Url = extractDownloadURL(respBody)
	case upstreamStatusFailed:
		result.Status = model.TaskStatusFailure
		result.Progress = taskcommon.ProgressComplete
		result.Reason = firstNonEmpty(
			gjson.GetBytes(respBody, "data.errorMsg").String(),
			gjson.GetBytes(respBody, "data.failReason").String(),
			"task failed upstream")
	case upstreamStatusCancelled:
		result.Status = model.TaskStatusFailure
		result.Progress = taskcommon.ProgressComplete
		result.Reason = "canceled upstream"
	default:
		// 未知状态（含字段缺失与上游新增取值）：按进行中继续轮询，不误判成终态。
		result.Status = model.TaskStatusInProgress
		result.Progress = taskcommon.ProgressInProgress
	}
	return result, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.TaskID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	videoURL := originTask.GetResultURL()
	if videoURL == "" {
		videoURL = taskcommon.BuildProxyURL(originTask.TaskID)
	}
	openAIVideo.SetMetadata("url", videoURL)
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName
	return common.Marshal(openAIVideo)
}

func doMiguGet(client *http.Client, uri, key, requestID string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	if requestID != "" {
		req.Header.Set("X-Request-Id", requestID)
	}
	return client.Do(req)
}

// businessCode / businessMessage 读取统一响应壳。字段缺失时 code 返回空串，
// 表示「不是标准响应壳」，调用方应继续按 HTTP 语义处理。
func businessCode(body []byte) string {
	return gjson.GetBytes(body, "code").String()
}

func businessMessage(body []byte) string {
	if msg := gjson.GetBytes(body, "message").String(); msg != "" {
		return msg
	}
	return string(body)
}

// upstreamTaskID 兼容上游可能使用的几种任务 ID 字段名与数字/字符串两种类型。
func upstreamTaskID(body []byte) string {
	for _, path := range []string{"data.taskId", "data.task_id", "data.id"} {
		if id := gjson.GetBytes(body, path).String(); id != "" {
			return id
		}
	}
	return ""
}

// extractDownloadURL 按已知字段名取成片地址（含本站注入的那个）。
func extractDownloadURL(body []byte) string {
	for _, path := range []string{
		newApiDownloadURLKey,
		"data.downloadUrl",
		"data.download_url",
		"data.videoUrl",
		"data.video_url",
		"data.url",
	} {
		if v := strings.TrimSpace(gjson.GetBytes(body, path).String()); v != "" {
			return v
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

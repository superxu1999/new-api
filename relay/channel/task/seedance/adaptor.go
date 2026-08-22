// Package seedance 对接 Seedance 视频生成本地代理服务（seedance-proxy）。
// 代理的接口形状与火山 ARK /api/v3/contents/generations/tasks 一致，
// 差异在于：查询/下载任务需要通过 ?model= 传递模型名（用于代理复用 SDK Client），
// 且视频必须走代理的 /download 端点获取（代理负责 RSA 解密），
// 因此结果 URL 一律指向本系统的 /v1/videos/:task_id/content 内容代理。
package seedance

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
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

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/samber/lo"
)

// ============================
// Request / Response structures
// ============================

type ContentItem struct {
	Type     string    `json:"type,omitempty"`
	Text     string    `json:"text,omitempty"`
	ImageURL *MediaURL `json:"image_url,omitempty"`
	VideoURL *MediaURL `json:"video_url,omitempty"`
	AudioURL *MediaURL `json:"audio_url,omitempty"`
	Role     string    `json:"role,omitempty"`
}

type MediaURL struct {
	URL string `json:"url,omitempty"`
}

type requestPayload struct {
	Model         string         `json:"model"`
	Content       []ContentItem  `json:"content,omitempty"`
	GenerateAudio *dto.BoolValue `json:"generate_audio,omitempty"`
	Ratio         string         `json:"ratio,omitempty"`
	Duration      *dto.IntValue  `json:"duration,omitempty"`
	Resolution    string         `json:"resolution,omitempty"`
	Watermark     *dto.BoolValue `json:"watermark,omitempty"`
	Seed          *dto.IntValue  `json:"seed,omitempty"`
	CameraFixed   *dto.BoolValue `json:"camera_fixed,omitempty"`
	CallbackURL   string         `json:"callback_url,omitempty"`
}

type responsePayload struct {
	ID string `json:"id"` // task_id
}

type responseTask struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Status  string `json:"status"`
	Content struct {
		VideoURL string `json:"video_url"`
	} `json:"content"`
	Duration int `json:"duration"`
	Usage    struct {
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	CreatedAt int64 `json:"created_at"`
	UpdatedAt int64 `json:"updated_at"`
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// ValidateRequestAndSetAction parses body, validates fields and sets default action.
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	if taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); taskErr != nil {
		return taskErr
	}
	// 上游(移动云 MaaS)时长能力 [4,15] 或 -1,超出范围返回明确错误而非上游 4xx
	if req, err := relaycommon.GetTaskRequest(c); err == nil {
		if taskErr := relaycommon.ValidateSeedanceDurationBounds(req); taskErr != nil {
			return taskErr
		}
	}
	return nil
}

// BuildRequestURL constructs the upstream URL.
// 上游形态由 base_url 结尾判定：
//  1) 本地 seedance-proxy：base_url 含 /aicc/seedance 前缀（或为纯代理地址），
//     走 ARK 原生路径 /api/v3/contents/generations/tasks（下载需 ?model= 复用 Client）。
//  2) 云厂商网关直连（base_url 已含 API 版本前缀）：公开路径直接拼接
//     /contents/generations/tasks。包括两种：
//     - ARK 风格网关挂在 /v1 下（如天翼云息壤，base_url 以 /v1 结尾）；
//     - 移动云 MaaS 网关（base_url 以 /api/v3 结尾），/api/v3 即其版本前缀。
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	if isDirectGateway(a.baseURL) {
		return fmt.Sprintf("%s/contents/generations/tasks", a.baseURL), nil
	}
	return fmt.Sprintf("%s/api/v3/contents/generations/tasks", a.baseURL), nil
}

// isDirectGateway 判断上游是否为直连云厂商网关（base_url 已含 API 版本前缀）。
// 命中时直接拼接 /contents/generations/tasks，不再追加 /api/v3，也无需 ?model= 参数。
func isDirectGateway(baseURL string) bool {
	return strings.HasSuffix(baseURL, "/v1") || strings.HasSuffix(baseURL, "/api/v3")
}

// isCMCCMaaS 判断上游是否为移动云 MaaS 直连网关（base_url 以 /api/v3 结尾）。
// 移动云网关要求创建任务前通过 POST /mapping/query 把控制台订购的友好模型名
// （如 doubao-seedance-2.0）解析为网关内部真实 endpoint，作为请求体 model 字段。
func isCMCCMaaS(baseURL string) bool {
	return strings.HasSuffix(baseURL, "/api/v3")
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	// 移动云 MaaS 直连：当输入含参考视频时，官方 SDK 会附带 Input-Has-Video 头，
	// 网关据此路由多模态参考视频输入。
	if isCMCCMaaS(a.baseURL) {
		if taskReq, err := relaycommon.GetTaskRequest(c); err == nil && hasVideoInput(taskReq) {
			req.Header.Set("Input-Has-Video", "true")
		}
	}
	return nil
}

// EstimateBilling 按时长返回 seconds 计费乘数。
// 时长上界已由 ValidateBasicTaskRequest 按 MaxTaskDurationSeconds 校验。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	seconds := req.Duration
	if seconds <= 0 {
		seconds, _ = strconv.Atoi(req.Seconds)
	}
	if seconds <= 0 {
		return nil
	}
	return map[string]float64{"seconds": float64(seconds)}
}

// BuildRequestBody converts request into Seedance proxy format.
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}

	body, err := a.convertToRequestPayload(&req)
	if err != nil {
		return nil, errors.Wrap(err, "convert request payload failed")
	}
	if info.IsModelMapped {
		body.Model = info.UpstreamModelName
	} else {
		info.UpstreamModelName = body.Model
	}
	// 移动云 MaaS 直连：创建前用 /mapping/query 把友好模型名解析为网关内部真实 endpoint。
	// 解析失败（或返回空 endpoint）时回退使用友好模型名，与官方 SDK 行为一致。
	if isCMCCMaaS(a.baseURL) {
		if resolved, err := a.resolveModelMapping(info, body.Model); err == nil && resolved != "" {
			body.Model = resolved
		}
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response, returns taskID etc.
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	var dResp responsePayload
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	if dResp.ID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty, body: %s", responseBody), "invalid_response", http.StatusInternalServerError)
		return
	}

	ov := dto.NewOpenAIVideo()
	ov.ID = info.PublicTaskID
	ov.TaskID = info.PublicTaskID
	ov.CreatedAt = time.Now().Unix()
	ov.Model = info.OriginModelName

	c.JSON(http.StatusOK, ov)
	return dResp.ID, responseBody, nil
}

// FetchTask fetch task status.
// 本地 seedance-proxy 要求通过 ?model= 传递模型名以复用对应 SDK Client（缺省时使用代理默认模型）。
// 直连云厂商网关（base_url 以 /v1 或 /api/v3 结尾）不接受 ?model= 参数（返回 taskid is mismatch），
// 且公开路径为 /contents/generations/tasks（无 /api/v3 前缀）。
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	var uri string
	if isDirectGateway(baseUrl) {
		uri = fmt.Sprintf("%s/contents/generations/tasks/%s", baseUrl, taskID)
	} else {
		uri = fmt.Sprintf("%s/api/v3/contents/generations/tasks/%s", baseUrl, taskID)
		if modelName, _ := body["model"].(string); modelName != "" {
			uri += "?model=" + url.QueryEscape(modelName)
		}
	}

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) convertToRequestPayload(req *relaycommon.TaskSubmitReq) (*requestPayload, error) {
	r := requestPayload{
		Model:   req.Model,
		Content: []ContentItem{},
	}

	// Add images if present
	if req.HasImage() {
		for _, imgURL := range req.Images {
			r.Content = append(r.Content, ContentItem{
				Type: "image_url",
				ImageURL: &MediaURL{
					URL: imgURL,
				},
			})
		}
	}

	metadata := req.Metadata
	if err := taskcommon.UnmarshalMetadata(metadata, &r); err != nil {
		return nil, errors.Wrap(err, "unmarshal metadata failed")
	}

	if sec, _ := strconv.Atoi(req.Seconds); sec > 0 {
		r.Duration = lo.ToPtr(dto.IntValue(sec))
	} else if req.Duration > 0 {
		r.Duration = lo.ToPtr(dto.IntValue(req.Duration))
	}

	r.Content = lo.Reject(r.Content, func(c ContentItem, _ int) bool { return c.Type == "text" })
	r.Content = append(r.Content, ContentItem{
		Type: "text",
		Text: req.Prompt,
	})

	return &r, nil
}

type mappingQueryResponse struct {
	Endpoint string `json:"endpoint"`
}

// resolveModelMapping 调用移动云 MaaS 的 /mapping/query 接口，把控制台友好模型名
// （如 doubao-seedance-2.0）解析为网关内部真实 endpoint。解析失败返回错误，
// 由调用方回退使用友好模型名。
func (a *TaskAdaptor) resolveModelMapping(info *relaycommon.RelayInfo, model string) (string, error) {
	if model == "" {
		return "", nil
	}
	base := strings.TrimSuffix(a.baseURL, "/")
	payload, err := common.Marshal(map[string]string{"model": model})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, base+"/mapping/query", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	client, err := service.GetHttpClientWithProxy(info.ChannelSetting.Proxy)
	if err != nil {
		return "", fmt.Errorf("new proxy http client failed: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("mapping query failed with status %d: %s", resp.StatusCode, respBody)
	}
	var m mappingQueryResponse
	if err := common.Unmarshal(respBody, &m); err != nil {
		return "", errors.Wrapf(err, "unmarshal mapping response failed: %s", respBody)
	}
	return m.Endpoint, nil
}

// hasVideoInput 判断任务请求是否包含参考视频输入（content 中 type == "video_url"）。
func hasVideoInput(req relaycommon.TaskSubmitReq) bool {
	content, ok := req.Metadata["content"]
	if !ok {
		return false
	}
	list, ok := content.([]interface{})
	if !ok {
		return false
	}
	for _, item := range list {
		if m, ok := item.(map[string]interface{}); ok {
			if t, _ := m["type"].(string); t == "video_url" {
				return true
			}
		}
	}
	return false
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	resTask := responseTask{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{
		Code: 0,
	}

	switch resTask.Status {
	case "pending", "queued":
		taskResult.Status = model.TaskStatusQueued
		taskResult.Progress = "10%"
	case "processing", "running":
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "50%"
	case "succeeded":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Progress = "100%"
		// 直连云厂商网关（base_url 以 /v1 或 /api/v3 结尾，如天翼云息壤、移动云 MaaS）
		// 直接返回可下载的视频直链（明文模式 / TOS 签名直链），轮询逻辑会存入
		// PrivateData.ResultURL，VideoProxy default 分支原样直传；
		// 本地 seedance-proxy 形态的视频必须经代理 /download 端点 RSA 解密，
		// 留空后由轮询逻辑生成指向本系统内容代理的 URL（VideoProxy 会走 /download）。
		if isDirectGateway(a.baseURL) {
			taskResult.Url = resTask.Content.VideoURL
		}
		taskResult.CompletionTokens = resTask.Usage.CompletionTokens
		taskResult.TotalTokens = resTask.Usage.TotalTokens
	case "failed":
		taskResult.Status = model.TaskStatusFailure
		taskResult.Progress = "100%"
		taskResult.Reason = resTask.Error.Message
	default:
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "30%"
	}

	return &taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var dResp responseTask
	if err := common.Unmarshal(originTask.Data, &dResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal seedance task data failed")
	}

	openAIVideo := dto.NewOpenAIVideo()
	openAIVideo.ID = originTask.TaskID
	openAIVideo.TaskID = originTask.TaskID
	openAIVideo.Status = originTask.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(originTask.Progress)
	// 轮询逻辑负责在成功后设置 ResultURL（指向 /v1/videos/:task_id/content 代理），
	// 若轮询尚未写入，则 fallback 直接构造代理 URL 确保用户可以下载。
	videoURL := originTask.GetResultURL()
	if videoURL == "" {
		videoURL = taskcommon.BuildProxyURL(originTask.TaskID)
	}
	openAIVideo.SetMetadata("url", videoURL)
	openAIVideo.CreatedAt = originTask.CreatedAt
	openAIVideo.CompletedAt = originTask.UpdatedAt
	openAIVideo.Model = originTask.Properties.OriginModelName

	if dResp.Status == "failed" {
		openAIVideo.Error = &dto.OpenAIVideoError{
			Message: dResp.Error.Message,
			Code:    dResp.Error.Code,
		}
	}

	return common.Marshal(openAIVideo)
}

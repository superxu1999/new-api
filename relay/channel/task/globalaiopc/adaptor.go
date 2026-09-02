package globalaiopc

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
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

type assetRef struct {
	URL string `json:"url,omitempty"`
}

type requestPayload struct {
	Model           string         `json:"model"`
	Prompt          string         `json:"prompt"`
	Duration        *int           `json:"duration,omitempty"`
	AspectRatio     string         `json:"aspect_ratio,omitempty"`
	Resolution      string         `json:"resolution,omitempty"`
	GenerateAudio   *bool          `json:"generate_audio,omitempty"`
	Watermark       *bool          `json:"watermark,omitempty"`
	Seed            *int           `json:"seed,omitempty"`
	ReferenceImages []assetRef     `json:"reference_images,omitempty"`
	ReferenceVideos []assetRef     `json:"reference_videos,omitempty"`
	ReferenceAudios []assetRef     `json:"reference_audios,omitempty"`
}

type createResponse struct {
	ID     string  `json:"id"`
	Status string  `json:"status"`
	Error  *string `json:"error"`
	Model  string  `json:"model"`
}

type taskResponse struct {
	ID        string  `json:"id"`
	Status    string  `json:"status"`
	Error     *string `json:"error"`
	ResultURL string  `json:"result_url"`
	VideoURL  string  `json:"video_url"`
	Amount    float64 `json:"amount"`
}

type assetUploadResponse struct {
	AssetID string  `json:"assetId"`
	Status  string  `json:"status"`
	Error   *string `json:"errorMessage"`
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

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	if taskErr := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); taskErr != nil {
		return taskErr
	}
	// 上游 seedance 时长能力 [4,15] 或 -1;参数需匹配计费 SKU
	if req, err := relaycommon.GetTaskRequest(c); err == nil {
		if taskErr := relaycommon.ValidateSeedanceDurationBounds(req); taskErr != nil {
			return taskErr
		}
		// 分辨率只支持 720p/1080p/2k/4k;选了不支持的值直接提示,而非静默回退
		if res, ok := req.Metadata["resolution"].(string); ok && res != "" && !validResolutions[res] {
			return service.TaskErrorWrapperLocal(
				fmt.Errorf("resolution \"%s\" is not supported, supported values: 720p/1080p/2k/4k", res),
				"invalid_resolution", http.StatusBadRequest)
		}
	}
	return nil
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v2/model-center/tasks", a.baseURL), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
}

// EstimateBilling 按时长返回 seconds 乘数。
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

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}

	body, err := a.convertToRequestPayload(c, &req, info)
	if err != nil {
		return nil, errors.Wrap(err, "convert request payload failed")
	}
	if info.IsModelMapped {
		body.Model = info.UpstreamModelName
	} else {
		info.UpstreamModelName = body.Model
	}

	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
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

	var dResp createResponse
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	if dResp.ID == "" {
		msg := fmt.Sprintf("task_id is empty, body: %s", responseBody)
		if dResp.Error != nil && *dResp.Error != "" {
			msg = *dResp.Error
		}
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", msg), "invalid_response", http.StatusInternalServerError)
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

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s/v2/model-center/tasks/%s", baseUrl, taskID)
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
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

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var res taskResponse
	if err := common.Unmarshal(respBody, &res); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := &relaycommon.TaskInfo{Code: 0}
	switch strings.ToLower(res.Status) {
	case "queued", "pending", "submitted":
		taskResult.Status = model.TaskStatusQueued
		taskResult.Progress = "10%"
	case "processing", "running":
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "50%"
	case "succeeded", "success", "completed":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Progress = "100%"
		taskResult.Url = lo.Ternary(res.ResultURL != "", res.ResultURL, res.VideoURL)
	case "failed":
		taskResult.Status = model.TaskStatusFailure
		taskResult.Progress = "100%"
		if res.Error != nil {
			taskResult.Reason = *res.Error
		}
	default:
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "30%"
	}
	return taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(originTask *model.Task) ([]byte, error) {
	var res taskResponse
	if err := common.Unmarshal(originTask.Data, &res); err != nil {
		return nil, errors.Wrap(err, "unmarshal globalaiopc task data failed")
	}
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
	if strings.ToLower(res.Status) == "failed" && res.Error != nil {
		openAIVideo.Error = &dto.OpenAIVideoError{Message: *res.Error}
	}
	return common.Marshal(openAIVideo)
}

// ============================
// helpers
// ============================

func (a *TaskAdaptor) convertToRequestPayload(c *gin.Context, req *relaycommon.TaskSubmitReq, info *relaycommon.RelayInfo) (*requestPayload, error) {
	r := &requestPayload{
		Model:      req.Model,
		Prompt:     req.Prompt,
		Resolution: "720p", // 上游 SKU 匹配需要携带 resolution,缺省 720p
	}

	// duration
	if sec, _ := strconv.Atoi(req.Seconds); sec > 0 {
		r.Duration = lo.ToPtr(sec)
	} else if req.Duration > 0 {
		r.Duration = lo.ToPtr(req.Duration)
	} else if req.Duration == -1 {
		r.Duration = lo.ToPtr(-1)
	}

	// metadata: ratio/resolution/watermark/generate_audio/seed 透传
	metadata := req.Metadata
	if metadata != nil {
		if v, ok := metadata["ratio"].(string); ok && v != "" {
			r.AspectRatio = v
		}
		if v, ok := metadata["resolution"].(string); ok && v != "" {
			r.Resolution = v
		}
		if v, ok := metadata["watermark"].(bool); ok {
			r.Watermark = lo.ToPtr(v)
		}
		if v, ok := metadata["generate_audio"].(bool); ok {
			r.GenerateAudio = lo.ToPtr(v)
		}
		if v, ok := metadata["seed"].(float64); ok && v != 0 {
			r.Seed = lo.ToPtr(int(v))
		}
	}

	// 上游只接受 720p/1080p/2k/4k,不认 480p 等其它值;非法则回退 720p,避免上游 4xx
	if !validResolutions[r.Resolution] {
		r.Resolution = "720p"
	}

	// 参考素材(参考图/视频/音频):先上传获取 assetId,再用 https://{assetId} 引用
	if err := a.populateReferenceAssets(c, info, req, r); err != nil {
		return nil, err
	}
	return r, nil
}

// populateReferenceAssets 若请求带参考素材,先调上游 /asset/seedance2/assetUpload 上传,
// 再把返回的 assetId 以 https://{assetId} 形式填入 reference_images/videos/audios。
func (a *TaskAdaptor) populateReferenceAssets(c *gin.Context, info *relaycommon.RelayInfo, req *relaycommon.TaskSubmitReq, r *requestPayload) error {
	// 顶层 images 作为参考图
	for _, img := range req.Images {
		if strings.TrimSpace(img) == "" {
			continue
		}
		assetID, err := a.uploadAsset(info, "Image", img)
		if err != nil {
			return err
		}
		r.ReferenceImages = append(r.ReferenceImages, assetRef{URL: "https://" + assetID})
	}
	return nil
}

// uploadAsset 上传单个素材,返回 assetId。
func (a *TaskAdaptor) uploadAsset(info *relaycommon.RelayInfo, assetType, url string) (string, error) {
	if url == "" {
		return "", nil
	}
	payload, err := common.Marshal(map[string]string{
		"assetType": assetType,
		"url":       url,
		"name":      assetType + " reference",
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, a.baseURL+"/asset/seedance2/assetUpload", bytes.NewReader(payload))
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
	var ar assetUploadResponse
	if err := common.Unmarshal(respBody, &ar); err != nil {
		return "", errors.Wrapf(err, "unmarshal asset upload response failed: %s", respBody)
	}
	if ar.AssetID == "" {
		msg := ""
		if ar.Error != nil {
			msg = *ar.Error
		}
		if msg == "" {
			msg = string(respBody)
		}
		return "", fmt.Errorf("asset upload failed: %s", msg)
	}
	return ar.AssetID, nil
}

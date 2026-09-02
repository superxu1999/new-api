package foxtoken

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
// structures
// ============================

type requestPayload struct {
	Model     string         `json:"model"`
	Prompt    string         `json:"prompt"`
	Duration  *int           `json:"duration,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type createResponse struct {
	ID     string `json:"id"`
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

// taskData 解析 new-api TaskResponse 的 data 段
type taskData struct {
	Status     string `json:"status"`
	FailReason string `json:"fail_reason"`
	ResultURL  string `json:"result_url"`
	Progress   string `json:"progress"`
}

type taskResponse struct {
	Code string   `json:"code"`
	Data taskData `json:"data"`
}

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
	if req, err := relaycommon.GetTaskRequest(c); err == nil {
		if taskErr := relaycommon.ValidateSeedanceDurationBounds(req); taskErr != nil {
			return taskErr
		}
	}
	return nil
}

func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v1/video/generations", a.baseURL), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
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
	} else if req.Duration == -1 {
		body.Duration = lo.ToPtr(-1)
	}
	body.Metadata = req.Metadata // 透传 ratio/resolution/generate_audio/watermark/seed 等

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
	taskID = dResp.TaskID
	if taskID == "" {
		taskID = dResp.ID
	}
	if taskID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty, body: %s", responseBody), "invalid_response", http.StatusInternalServerError)
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

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s/v1/video/generations/%s", baseUrl, taskID)
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

// ParseTaskResult 解析 new-api TaskResponse 格式。
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var res taskResponse
	if err := common.Unmarshal(respBody, &res); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}
	t := &relaycommon.TaskInfo{Code: 0}
	switch strings.ToUpper(res.Data.Status) {
	case "QUEUED", "IN_PROGRESS", "NOT_START", "SUBMITTED":
		t.Status = model.TaskStatusQueued
		t.Progress = "10%"
	case "SUCCESS", "SUCCEEDED":
		t.Status = model.TaskStatusSuccess
		t.Progress = "100%"
		t.Url = res.Data.ResultURL
	case "FAILURE", "FAILED":
		t.Status = model.TaskStatusFailure
		t.Progress = "100%"
		t.Reason = res.Data.FailReason
	default:
		t.Status = model.TaskStatusInProgress
		t.Progress = "50%"
	}
	return t, nil
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

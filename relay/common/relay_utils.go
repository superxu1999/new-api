package common

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type HasPrompt interface {
	GetPrompt() string
}

type HasImage interface {
	HasImage() bool
}

func GetFullRequestURL(baseURL string, requestURL string, channelType int) string {
	fullRequestURL := fmt.Sprintf("%s%s", baseURL, requestURL)

	if strings.HasPrefix(baseURL, "https://gateway.ai.cloudflare.com") {
		switch channelType {
		case constant.ChannelTypeOpenAI:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/v1"))
		case constant.ChannelTypeAzure:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/openai/deployments"))
		}
	}
	return fullRequestURL
}

func GetAPIVersion(c *gin.Context) string {
	query := c.Request.URL.Query()
	apiVersion := query.Get("api-version")
	if apiVersion == "" {
		apiVersion = c.GetString("api_version")
	}
	return apiVersion
}

func createTaskError(err error, code string, statusCode int, localError bool) *dto.TaskError {
	return &dto.TaskError{
		Code:       code,
		Message:    err.Error(),
		StatusCode: statusCode,
		LocalError: localError,
		Error:      err,
	}
}

func storeTaskRequest(c *gin.Context, info *RelayInfo, action string, requestObj TaskSubmitReq) {
	info.Action = action
	c.Set("task_request", requestObj)
}

// officialTopLevelTaskParams 是火山方舟创建任务接口放在顶层、而本站适配器只从 metadata
// 读取的参数。只按官方写法传的请求，这些参数会在解析阶段被丢掉 —— 其中 resolution
// 还会让计费按默认档（720p）算，进而少收。白名单之外的顶层字段一律不转发。
var officialTopLevelTaskParams = []string{
	"resolution",
	"ratio",
	"frames",
	"seed",
	"camera_fixed",
	"watermark",
	"generate_audio",
}

// normalizeTaskSubmitReq 把火山方舟官方创建任务接口的顶层写法，归一到本站适配器
// 真正读取的位置。两个校验入口都要在解析之后、校验之前调用它：提示词要能在 prompt
// 必填校验之前合并出来，否则官方格式（没有顶层 prompt）会被 400。
func normalizeTaskSubmitReq(req *TaskSubmitReq) {
	normalizeTaskContent(req)
	normalizeOfficialVideoParams(req)
	normalizeReturnLastFrame(req)
	normalizeTaskPrompt(req)
}

// normalizeTaskContent 把火山方舟官方的顶层 content 数组并入 metadata.content。
//
// 官方创建任务接口把提示词与参考图/视频/音频都放在顶层 content 里；本站的
// cyai/doubao/seedance 适配器只读 metadata.content，顶层直接写会在解析阶段就被丢掉，
// 上游连一张参考图都收不到（实测客户按官方格式传 3 张参考图，上游收到的 content
// 只有一条 text，生成的视频与参考图毫无关系）。
//
// metadata.content 已显式写好的值优先，不覆盖；content 形状不是数组时按未传处理。
func normalizeTaskContent(req *TaskSubmitReq) {
	if req == nil || len(req.Content) == 0 {
		return
	}
	var items []interface{}
	if err := common.Unmarshal(req.Content, &items); err != nil || len(items) == 0 {
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]interface{}{}
	}
	if _, exists := req.Metadata["content"]; !exists {
		// 必须存 []interface{}：doubao/seedance 适配器直接对 metadata["content"]
		// 断言 []interface{} 来判断是否含参考视频（影响按含视频档计费）。
		req.Metadata["content"] = items
	}
}

// normalizeOfficialVideoParams 把火山方舟官方的顶层视频参数（见白名单）并入 metadata。
//
// 官方创建任务接口把 resolution/ratio/watermark 等放在顶层，而本站适配器只读 metadata：
// 只按官方写法传的请求，这些参数会被静默丢掉 —— 客户传顶层 resolution=1080p 时，
// 出片按默认 720p，计费也按 720p 档算，属于少收。
//
// metadata 里已显式写好的值优先，不覆盖。
func normalizeOfficialVideoParams(req *TaskSubmitReq) {
	if req == nil || len(req.officialParams) == 0 {
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]interface{}{}
	}
	for key, value := range req.officialParams {
		if _, exists := req.Metadata[key]; !exists {
			req.Metadata[key] = value
		}
	}
}

// normalizeTaskPrompt 统一提示词来源：顶层 prompt 与 content 里的 text 元素都算提示词。
//
// 各适配器最终只会发出一条 text —— doubao/seedance 丢弃 content 里的 text 元素后补
// req.Prompt，cyai 同样 —— 所以两处都写时必然有一处被静默丢掉。这里先合并成一条
// （换行拼接，完全重复的只保留一次），再交给适配器发出去。
func normalizeTaskPrompt(req *TaskSubmitReq) {
	if req == nil {
		return
	}
	var texts []string
	if prompt := strings.TrimSpace(req.Prompt); prompt != "" {
		texts = append(texts, prompt)
	}
	items, _ := req.Metadata["content"].([]interface{})
	for _, item := range items {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		text, _ := entry["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" || lo.Contains(texts, text) {
			continue
		}
		texts = append(texts, text)
	}
	if len(texts) == 0 {
		return
	}
	req.Prompt = strings.Join(texts, "\n")
}

// normalizeReturnLastFrame 把火山方舟官方的顶层 return_last_frame 并入 metadata。
//
// 官方创建任务接口把它放在顶层，而本站的任务适配器只透传 metadata —— doubao 适配器
// 再从 metadata 反序列化、其余适配器原样带出去。顶层直接写会在解析阶段就被丢掉，
// 上游一个字节都收不到（实测客户按官方文档写顶层，尾帧图一直不返回）。
//
// 已显式写在 metadata 里的值优先，不覆盖。
func normalizeReturnLastFrame(req *TaskSubmitReq) {
	if req == nil || req.ReturnLastFrame == nil {
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]interface{}{}
	}
	if _, exists := req.Metadata["return_last_frame"]; !exists {
		req.Metadata["return_last_frame"] = *req.ReturnLastFrame
	}
}

func GetTaskRequest(c *gin.Context) (TaskSubmitReq, error) {
	v, exists := c.Get("task_request")
	if !exists {
		return TaskSubmitReq{}, fmt.Errorf("request not found in context")
	}
	req, ok := v.(TaskSubmitReq)
	if !ok {
		return TaskSubmitReq{}, fmt.Errorf("invalid task request type")
	}
	return req, nil
}

func validatePrompt(prompt string) *dto.TaskError {
	if strings.TrimSpace(prompt) == "" {
		return createTaskError(fmt.Errorf("prompt is required"), "invalid_request", http.StatusBadRequest, true)
	}
	return nil
}

// MaxTaskDurationSeconds caps user-supplied video duration. Duration is used
// as a billing multiplier (OtherRatio "seconds"); an unbounded value could
// overflow quota calculation into a negative charge.
const MaxTaskDurationSeconds = 3600

// Seedance 系模型(doubao-seedance-*)上游支持的时长范围(秒)。
// 移动云 MaaS SDK 与百拓转售文档一致:支持 [SeedanceDurationMin, SeedanceDurationMax]
// 范围内的整数,或 -1 由模型自动选择;未填时上游默认 5 秒。
const (
	SeedanceDurationMin = 4
	SeedanceDurationMax = 15
)

func validateTaskDurationBounds(req TaskSubmitReq) *dto.TaskError {
	seconds := req.Duration
	if seconds == 0 && req.Seconds != "" {
		seconds, _ = strconv.Atoi(req.Seconds)
	}
	// 允许 0(未填,上游默认)与 -1(由模型自动选择);其余必须落在计费安全上界内
	if seconds < -1 || seconds > MaxTaskDurationSeconds {
		return createTaskError(fmt.Errorf("seconds must be -1 or between 1 and %d", MaxTaskDurationSeconds), "invalid_seconds", http.StatusBadRequest, true)
	}
	return nil
}

// ValidateSeedanceDurationBounds 按上游能力校验时长,供 seedance 系适配器调用。
// 允许:0(未填,上游默认 5)、-1(模型自动选择)、[SeedanceDurationMin, SeedanceDurationMax]。
// 计费安全上界(3600)已由 validateTaskDurationBounds 在前置校验中保证。
func ValidateSeedanceDurationBounds(req TaskSubmitReq) *dto.TaskError {
	seconds := req.Duration
	if seconds == 0 && req.Seconds != "" {
		seconds, _ = strconv.Atoi(req.Seconds)
	}
	if seconds == 0 || seconds == -1 {
		return nil
	}
	if seconds < SeedanceDurationMin || seconds > SeedanceDurationMax {
		return createTaskError(
			fmt.Errorf("视频时长需在 %d-%d 秒之间,或填 -1 由模型自动选择", SeedanceDurationMin, SeedanceDurationMax),
			"invalid_seconds", http.StatusBadRequest, true)
	}
	return nil
}

func validateMultipartTaskRequest(c *gin.Context, info *RelayInfo, action string) (TaskSubmitReq, error) {
	var req TaskSubmitReq
	if _, err := c.MultipartForm(); err != nil {
		return req, err
	}

	formData := c.Request.PostForm
	req = TaskSubmitReq{
		Prompt:   formData.Get("prompt"),
		Model:    formData.Get("model"),
		Mode:     formData.Get("mode"),
		Image:    formData.Get("image"),
		Size:     formData.Get("size"),
		Metadata: make(map[string]interface{}),
	}

	if durationStr := formData.Get("seconds"); durationStr != "" {
		if duration, err := strconv.Atoi(durationStr); err == nil {
			req.Duration = duration
		}
	}

	if images := formData["images"]; len(images) > 0 {
		req.Images = images
	}

	for key, values := range formData {
		if len(values) > 0 && !isKnownTaskField(key) {
			if intVal, err := strconv.Atoi(values[0]); err == nil {
				req.Metadata[key] = intVal
			} else if floatVal, err := strconv.ParseFloat(values[0], 64); err == nil {
				req.Metadata[key] = floatVal
			} else {
				req.Metadata[key] = values[0]
			}
		}
	}
	return req, nil
}

func ValidateMultipartDirect(c *gin.Context, info *RelayInfo) *dto.TaskError {
	var prompt string
	var model string
	var seconds int
	var size string
	var hasInputReference bool

	var req TaskSubmitReq
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return createTaskError(err, "invalid_json", http.StatusBadRequest, true)
	}
	normalizeTaskSubmitReq(&req)

	prompt = req.Prompt
	model = req.Model
	size = req.Size
	seconds, _ = strconv.Atoi(req.Seconds)
	if seconds == 0 {
		seconds = req.Duration
	}
	if req.InputReference != "" {
		req.Images = []string{req.InputReference}
	} else if len(req.Images) == 0 && strings.TrimSpace(req.Image) != "" {
		// 兼容单图上传
		req.Images = []string{strings.TrimSpace(req.Image)}
	}

	if strings.TrimSpace(req.Model) == "" {
		return createTaskError(fmt.Errorf("model field is required"), "missing_model", http.StatusBadRequest, true)
	}

	if req.HasImage() {
		hasInputReference = true
	}

	if taskErr := validatePrompt(prompt); taskErr != nil {
		return taskErr
	}

	if taskErr := validateTaskDurationBounds(req); taskErr != nil {
		return taskErr
	}

	action := constant.TaskActionTextGenerate
	if hasInputReference {
		action = constant.TaskActionGenerate
	}
	if strings.HasPrefix(model, "sora-2") {

		if size == "" {
			size = "720x1280"
		}

		if seconds <= 0 {
			seconds = 4
		}

		if model == "sora-2" && !lo.Contains([]string{"720x1280", "1280x720"}, size) {
			return createTaskError(fmt.Errorf("sora-2 size is invalid"), "invalid_size", http.StatusBadRequest, true)
		}
		if model == "sora-2-pro" && !lo.Contains([]string{"720x1280", "1280x720", "1792x1024", "1024x1792"}, size) {
			return createTaskError(fmt.Errorf("sora-2 size is invalid"), "invalid_size", http.StatusBadRequest, true)
		}
		// OtherRatios 已移到 Sora adaptor 的 EstimateBilling 中设置
	}

	storeTaskRequest(c, info, action, req)

	return nil
}

func isKnownTaskField(field string) bool {
	knownFields := map[string]bool{
		"prompt":          true,
		"model":           true,
		"mode":            true,
		"image":           true,
		"images":          true,
		"size":            true,
		"duration":        true,
		"input_reference": true, // Sora 特有字段
	}
	return knownFields[field]
}

func ValidateBasicTaskRequest(c *gin.Context, info *RelayInfo, action string) *dto.TaskError {
	var err error
	contentType := c.GetHeader("Content-Type")
	var req TaskSubmitReq
	if strings.HasPrefix(contentType, "multipart/form-data") {
		req, err = validateMultipartTaskRequest(c, info, action)
		if err != nil {
			return createTaskError(err, "invalid_multipart_form", http.StatusBadRequest, true)
		}
	}
	// 为了metadata字段的兼容性，统一UnmarshalBodyReusable
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return createTaskError(err, "invalid_request", http.StatusBadRequest, true)
	}
	normalizeTaskSubmitReq(&req)

	if taskErr := validatePrompt(req.Prompt); taskErr != nil {
		return taskErr
	}

	if taskErr := validateTaskDurationBounds(req); taskErr != nil {
		return taskErr
	}

	if len(req.Images) == 0 && strings.TrimSpace(req.Image) != "" {
		// 兼容单图上传
		req.Images = []string{req.Image}
	}

	storeTaskRequest(c, info, action, req)
	return nil
}

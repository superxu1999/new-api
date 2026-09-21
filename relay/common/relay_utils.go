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

// NormalizeTaskSubmitReq 是 normalizeTaskSubmitReq 的对外入口，供不走标准校验函数的
// 任务路径（如 Sora remix）复用同一套写法归一。
func NormalizeTaskSubmitReq(req *TaskSubmitReq) {
	normalizeTaskSubmitReq(req)
}

// normalizeTaskSubmitReq 把客户端各种等价写法，归一到本站适配器真正读取的位置。
// 两个校验入口都要在解析之后、校验之前调用它：提示词要能在 prompt 必填校验之前
// 合并出来，否则官方格式（没有顶层 prompt）会被 400。
func normalizeTaskSubmitReq(req *TaskSubmitReq) {
	normalizeTaskReferences(req)
	normalizeOfficialVideoParams(req)
	normalizeReturnLastFrame(req)
	normalizeTaskPrompt(req)
}

// referenceTypeKeys 是 content 元素里各素材类型对应的 URL 字段名（与 type 同名）。
var referenceTypeKeys = []string{"image_url", "video_url", "audio_url"}

// mediaURLOf 取参考素材字段里的 URL：既接受 "https://..."，也接受 {"url": "..."}。
func mediaURLOf(raw interface{}) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	case map[string]interface{}:
		url, _ := value["url"].(string)
		return strings.TrimSpace(url)
	}
	return ""
}

// referenceItemURL 取一个 content 元素里的素材 URL（文档写法 {"type":"image_url","image_url":{"url":...}}）。
func referenceItemURL(item map[string]interface{}) string {
	typeName, _ := item["type"].(string)
	if typeName == "" {
		for _, key := range referenceTypeKeys {
			if _, exists := item[key]; exists {
				typeName = key
				break
			}
		}
	}
	return mediaURLOf(item[typeName])
}

// appendReference 追加一条参考素材（新建 content 元素），同一 URL 只保留一次。
func appendReference(items []interface{}, seen map[string]bool, typeName, url, role string) []interface{} {
	if url == "" || seen[url] {
		return items
	}
	seen[url] = true
	item := map[string]interface{}{
		"type":   typeName,
		typeName: map[string]interface{}{"url": url},
	}
	if role != "" {
		item["role"] = role
	}
	return append(items, item)
}

// fillMissingImageRoles 给「没写 role 的参考图」补 reference_image，只在超过一张时补：
// 单独一张不带 role 是官方约定的「首帧图片」（首帧最多 1 张），两张及以上必须带 role，
// 否则上游只认第一张。
func fillMissingImageRoles(items []interface{}) {
	var pending []map[string]interface{}
	for _, raw := range items {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		if _, isImage := item["image_url"]; !isImage {
			continue
		}
		if role, _ := item["role"].(string); role == "" {
			pending = append(pending, item)
		}
	}
	if len(pending) < 2 {
		return
	}
	for _, item := range pending {
		item["role"] = "reference_image"
	}
}

// normalizeTaskReferences 把所有参考素材写法归一成 metadata.content 里一份带明确意图的清单。
//
// 客户端表达同一种意图有多种写法，而各适配器只读 metadata.content。这里按
// 「显式写的 role 绝不覆盖，没写 role 的按写法推断」统一收口，避免各渠道各判一套：
//
//	写法                                推断出的意图
//	content 元素带 role                 原样保留（显式优先）
//	content 里没写 role 的 image_url    一张按「首帧图片」；两张及以上补 reference_image
//	input_reference / image（单值）     首帧图片
//	images 数组                          一张按首帧；多张按参考图（首帧最多 1 张）
//	metadata.image_url                  首帧图片（对外文档 6.2 图生视频）
//	metadata.video_url                  reference_video（对外文档 6.3 视频生视频）
//	metadata.audio_url                  reference_audio
//
// 顶层 content 与 metadata.content 两处都写时合并（同一 URL 只留一次），不再二选一丢一处。
//
// 注意：推断只是「本站发出的意图」。cyai 适配器（normalizeContentRole）会把没带 role 的
// 图片补成 reference_image（其上游对无 role 的参考项报错），首帧意图因此在 CyAI 渠道上
// 无法靠「不写 role」表达；需要严格首帧语义请在请求里显式声明 role=first_frame，
// 显式声明一律原样透传（实测 first_frame 可被上游接受并正常出片）。
func normalizeTaskReferences(req *TaskSubmitReq) {
	if req == nil {
		return
	}
	if req.Metadata == nil {
		req.Metadata = map[string]interface{}{}
	}

	items, _ := req.Metadata["content"].([]interface{})
	seen := make(map[string]bool, len(items)+len(req.Images)+3)
	for _, raw := range items {
		if item, ok := raw.(map[string]interface{}); ok {
			if url := referenceItemURL(item); url != "" {
				seen[url] = true
			}
		}
	}

	// 火山方舟官方写法的顶层 content 数组：与 metadata.content 合并
	if len(req.Content) > 0 {
		var topLevel []interface{}
		if err := common.Unmarshal(req.Content, &topLevel); err == nil {
			for _, raw := range topLevel {
				item, ok := raw.(map[string]interface{})
				if !ok {
					continue
				}
				url := referenceItemURL(item)
				if url == "" || seen[url] {
					continue
				}
				seen[url] = true
				items = append(items, item)
			}
		}
	}

	// 接口字段：images 数组（image、input_reference 也归到这里）
	images := req.Images
	if len(images) == 0 && strings.TrimSpace(req.Image) != "" {
		images = []string{req.Image}
	}
	if len(images) == 0 && strings.TrimSpace(req.InputReference) != "" {
		images = []string{req.InputReference}
	}
	imageRole := ""
	if len(images) > 1 {
		imageRole = "reference_image"
	}
	for _, url := range images {
		items = appendReference(items, seen, "image_url", strings.TrimSpace(url), imageRole)
	}

	// metadata 里的扁平写法：字段名本身就表达意图。
	// 转换成功后把扁平字段删掉 —— 素材已经进了 content，留着会让上游把同一份素材
	// 看成两处输入（既占参考素材数量上限，也可能被当成两个参考）。
	for _, flat := range []struct {
		key  string
		typ  string
		role string
	}{
		{"image_url", "image_url", ""},
		{"video_url", "video_url", "reference_video"},
		{"audio_url", "audio_url", "reference_audio"},
	} {
		url := mediaURLOf(req.Metadata[flat.key])
		if url == "" {
			continue
		}
		before := len(items)
		items = appendReference(items, seen, flat.typ, url, flat.role)
		if len(items) > before {
			delete(req.Metadata, flat.key)
		}
	}

	fillMissingImageRoles(items)
	if len(items) == 0 {
		return
	}
	// 必须存 []interface{}：doubao/seedance 适配器直接对 metadata["content"]
	// 断言 []interface{} 来判断是否含参考视频（影响按含视频档计费）。
	req.Metadata["content"] = items
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

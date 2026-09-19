package dto

import (
	"encoding/json"
)

type TaskError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Data       any    `json:"data"`
	StatusCode int    `json:"-"`
	LocalError bool   `json:"-"`
	Error      error  `json:"-"`
}

type TaskData interface {
	SunoDataResponse | []SunoDataResponse | string | any
}

const TaskSuccessCode = "success"

type TaskResponse[T TaskData] struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

func (t *TaskResponse[T]) IsSuccess() bool {
	return t.Code == TaskSuccessCode
}

// TaskUsage 是上游官方口径的用量。
//
// 字段名必须与下游适配器的解析结构保持一致（relay/channel/task/foxtoken
// 与内嵌它的 cyai 读的是 data.usage.total_tokens）；下游的 new-api 实例靠它
// 在任务完成后按真实用量做差额结算，名字对不上就等于没返回。
type TaskUsage struct {
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type TaskDto struct {
	ID         int64  `json:"id"`
	CreatedAt  int64  `json:"created_at"`
	UpdatedAt  int64  `json:"updated_at"`
	TaskID     string `json:"task_id"`
	Platform   string `json:"platform"`
	UserId     int    `json:"user_id"`
	Group      string `json:"group"`
	ChannelId  int    `json:"channel_id"`
	Quota      int    `json:"quota"`
	Action     string `json:"action"`
	Status     string `json:"status"`
	FailReason string `json:"fail_reason"`
	ResultURL  string `json:"result_url,omitempty"` // 任务结果 URL（视频地址等）
	// LastFrameURL 是上游返回的尾帧图地址，只有请求带 return_last_frame=true 才有。
	// 用于 Seedance 系的续拍：拿上一段的尾帧当下一段的首帧。
	LastFrameURL string          `json:"last_frame_url,omitempty"`
	SubmitTime   int64           `json:"submit_time"`
	StartTime    int64           `json:"start_time"`
	FinishTime   int64           `json:"finish_time"`
	Progress     string          `json:"progress"`
	Properties   any             `json:"properties"`
	Username     string          `json:"username,omitempty"`
	Data         json.RawMessage `json:"data"`
	// Usage 只在「上游返回过真实用量、本站已按它完成差额结算」时填充，
	// 供下游 new-api 实例做同样的差额结算。
	// 未结算的任务绝不能拿预估值冒充：那会让下游记下一个恰好像预估的假实际用量。
	Usage *TaskUsage `json:"usage,omitempty"`
	// PreConsumedQuota 是提交时的预扣额度。Quota 是差额结算后的最终额度，
	// 想还原「预扣 → 实付 → 差额」必须把它一起返回。
	PreConsumedQuota int `json:"pre_consumed_quota,omitempty"`
	// VideoToken 是按官方公式预估的视频 token 用量。
	VideoToken int `json:"video_token,omitempty"`
	// VideoActualToken 是上游返回的真实视频 token；未做过差额结算时不填。
	VideoActualToken int `json:"video_actual_token,omitempty"`
	// Duration / Resolution 是提交时的请求参数快照（不依赖上游回显格式）。
	Duration   int    `json:"duration,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	// HasInputVideo 表示请求带了参考视频。它是计费条件（含视频与不含视频单价不同），
	// 用户本来就该知道，因此所有人都返回。
	HasInputVideo bool `json:"has_input_video,omitempty"`
	// ChannelName 便于管理员识别渠道（纯 channel_id 对人不友好），只在管理员接口填充。
	ChannelName string `json:"channel_name,omitempty"`
	// VideoBilling 是视频计费的中间量（含分档单价），属成本口径，只在管理员接口填充。
	VideoBilling any `json:"video_billing,omitempty"`
}

type FetchReq struct {
	IDs []string `json:"ids"`
}

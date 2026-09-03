package cyai

import (
	"github.com/QuantumNous/new-api/relay/channel/task/foxtoken"
)

// TaskAdaptor 复用 foxtoken 的 new-api OpenAI 视频协议实现（创建/轮询/解析），
// 仅覆盖渠道名称与默认模型列表。
type TaskAdaptor struct {
	foxtoken.TaskAdaptor
}

func (a *TaskAdaptor) GetChannelName() string { return ChannelName }
func (a *TaskAdaptor) GetModelList() []string { return ModelList }

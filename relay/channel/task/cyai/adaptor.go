package cyai

import (
	"bytes"
	"io"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel/task/foxtoken"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

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

type requestPayload struct {
	Model    string         `json:"model"`
	Prompt   string         `json:"prompt"`
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
	body.Metadata = req.Metadata

	data, err := common.Marshal(body)
	if err != nil {
		return nil, errors.Wrap(err, "marshal request body failed")
	}
	return bytes.NewReader(data), nil
}

package seedance

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultStatusMapping(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name           string
		body           string
		wantStatus     model.TaskStatus
		wantURL        string
		wantReason     string
		wantTotalToken int
	}{
		{
			name:       "queued maps to queued",
			body:       `{"id":"c-1","status":"queued"}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:       "running maps to in progress",
			body:       `{"id":"c-1","status":"running"}`,
			wantStatus: model.TaskStatusInProgress,
		},
		{
			name:           "succeeded keeps url empty for proxy download",
			body:           `{"id":"c-1","status":"succeeded","content":{"video_url":"https://encrypted.example/v.mp4"},"usage":{"completion_tokens":10,"total_tokens":20}}`,
			wantStatus:     model.TaskStatusSuccess,
			wantURL:        "",
			wantTotalToken: 20,
		},
		{
			name:       "failed carries upstream error message",
			body:       `{"id":"c-1","status":"failed","error":{"code":"1001","message":"content rejected"}}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "content rejected",
		},
		{
			name:       "unknown status treated as in progress",
			body:       `{"id":"c-1","status":"mystery"}`,
			wantStatus: model.TaskStatusInProgress,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := adaptor.ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			assert.Equal(t, string(tt.wantStatus), info.Status)
			assert.Equal(t, tt.wantURL, info.Url)
			assert.Equal(t, tt.wantReason, info.Reason)
			assert.Equal(t, tt.wantTotalToken, info.TotalTokens)
		})
	}
}

func TestConvertToRequestPayload(t *testing.T) {
	adaptor := &TaskAdaptor{}

	req := &relaycommon.TaskSubmitReq{
		Prompt:  "日落时分的海边",
		Model:   "doubao-seedance-2.0",
		Seconds: "5",
		Images:  []string{"https://example.com/first-frame.png"},
		Metadata: map[string]interface{}{
			"ratio":          "16:9",
			"generate_audio": false,
			"watermark":      true,
		},
	}

	payload, err := adaptor.convertToRequestPayload(req)
	require.NoError(t, err)
	assert.Equal(t, "doubao-seedance-2.0", payload.Model)
	require.NotNil(t, payload.Duration)
	assert.Equal(t, 5, int(*payload.Duration))
	assert.Equal(t, "16:9", payload.Ratio)
	require.NotNil(t, payload.GenerateAudio)
	assert.False(t, bool(*payload.GenerateAudio))
	require.NotNil(t, payload.Watermark)
	assert.True(t, bool(*payload.Watermark))

	// 图生视频：参考图在前，文本提示词在最后
	require.Len(t, payload.Content, 2)
	assert.Equal(t, "image_url", payload.Content[0].Type)
	require.NotNil(t, payload.Content[0].ImageURL)
	assert.Equal(t, "https://example.com/first-frame.png", payload.Content[0].ImageURL.URL)
	assert.Equal(t, "text", payload.Content[1].Type)
	assert.Equal(t, "日落时分的海边", payload.Content[1].Text)

	// metadata 透传的 content 数组（多模态参考输入）应保留
	reqWithContent := &relaycommon.TaskSubmitReq{
		Prompt: "广告片",
		Model:  "doubao-seedance-2.0",
		Metadata: map[string]interface{}{
			"content": []interface{}{
				map[string]interface{}{
					"type":      "video_url",
					"video_url": map[string]interface{}{"url": "https://example.com/ref.mp4"},
					"role":      "reference_video",
				},
			},
		},
	}
	payload2, err := adaptor.convertToRequestPayload(reqWithContent)
	require.NoError(t, err)
	require.Len(t, payload2.Content, 2)
	assert.Equal(t, "video_url", payload2.Content[0].Type)
	require.NotNil(t, payload2.Content[0].VideoURL)
	assert.Equal(t, "https://example.com/ref.mp4", payload2.Content[0].VideoURL.URL)
	assert.Equal(t, "reference_video", payload2.Content[0].Role)
	assert.Equal(t, "text", payload2.Content[1].Type)
}

// 序列化后的请求体必须符合代理文档的可选字段语义：
// 未提供的可选字段省略，显式 false/0 值保留。
func TestRequestPayloadMarshalOmitsUnsetOptionals(t *testing.T) {
	payload := requestPayload{
		Model: "doubao-seedance-2.0",
		Content: []ContentItem{
			{Type: "text", Text: "hello"},
		},
	}
	data, err := common.Marshal(payload)
	require.NoError(t, err)
	var decoded map[string]interface{}
	require.NoError(t, common.Unmarshal(data, &decoded))
	assert.NotContains(t, decoded, "duration")
	assert.NotContains(t, decoded, "generate_audio")
	assert.NotContains(t, decoded, "watermark")

	payload.GenerateAudio = (*dto.BoolValue)(boolPtr(false))
	data, err = common.Marshal(payload)
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(data, &decoded))
	assert.Contains(t, decoded, "generate_audio")
	assert.Equal(t, false, decoded["generate_audio"])
}

func boolPtr(b bool) *bool { return &b }

// 直连云厂商网关（base_url 以 /v1 或 /api/v3 结尾，如天翼云息壤、移动云 MaaS）与本地
// seedance-proxy 两种形态的 URL 构造差异：直连形态走 /contents/generations/tasks（无 /api/v3 前缀）。
func TestBuildRequestURLDirectGateway(t *testing.T) {
	proxyAdaptor := &TaskAdaptor{baseURL: "http://127.0.0.1:8080/aicc/seedance"}
	url, err := proxyAdaptor.BuildRequestURL(nil)
	require.NoError(t, err)
	assert.Equal(t, "http://127.0.0.1:8080/aicc/seedance/api/v3/contents/generations/tasks", url)

	directAdaptor := &TaskAdaptor{baseURL: "https://ai.ctaigw.cn/v1"}
	url, err = directAdaptor.BuildRequestURL(nil)
	require.NoError(t, err)
	assert.Equal(t, "https://ai.ctaigw.cn/v1/contents/generations/tasks", url)

	// 移动云 MaaS 直连：base_url 已含 /api/v3 版本前缀，不再追加
	cmccAdaptor := &TaskAdaptor{baseURL: "https://zhenze-huhehaote.cmecloud.cn/api/v3"}
	url, err = cmccAdaptor.BuildRequestURL(nil)
	require.NoError(t, err)
	assert.Equal(t, "https://zhenze-huhehaote.cmecloud.cn/api/v3/contents/generations/tasks", url)
}

// 直连形态的轮询 URL 不带 ?model= 参数（网关返回 taskid is mismatch），
// 本地 seedance-proxy 形态必须带 ?model= 复用 SDK Client。
func TestFetchTaskURLByGatewayMode(t *testing.T) {
	// FetchTask 使用 service 包启动期初始化的 httpClient，单测需先行初始化
	service.InitHttpClient()

	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		w.Write([]byte(`{"id":"c-1","status":"queued"}`))
	}))
	defer srv.Close()

	adaptor := &TaskAdaptor{}

	// 直连：无 ?model=
	resp, err := adaptor.FetchTask(srv.URL+"/v1", "sk-test", map[string]any{"task_id": "c-1", "model": "cdance2.0-0611"}, "")
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	assert.Equal(t, "/v1/contents/generations/tasks/c-1", gotPath)

	// 本地代理：保留 ?model=
	gotPath = ""
	resp, err = adaptor.FetchTask(srv.URL+"/aicc/seedance", "maas-key", map[string]any{"task_id": "c-1", "model": "doubao-seedance-2.0"}, "")
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	assert.Equal(t, "/aicc/seedance/api/v3/contents/generations/tasks/c-1?model=doubao-seedance-2.0", gotPath)
}

// 直连形态成功时保留上游返回的 TOS 签名直链（轮询存入 ResultURL 直传），
// 本地代理形态仍留空走 /download RSA 解密链路。
func TestParseTaskResultSucceededDirectGatewayKeepsVideoURL(t *testing.T) {
	body := `{"id":"c-1","status":"succeeded","content":{"video_url":"https://tos.example.com/v.mp4"},"usage":{"completion_tokens":10,"total_tokens":20}}`

	proxyAdaptor := &TaskAdaptor{baseURL: "http://127.0.0.1:8080/aicc/seedance"}
	info, err := proxyAdaptor.ParseTaskResult([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
	assert.Equal(t, "", info.Url)
	assert.Equal(t, 20, info.TotalTokens)

	directAdaptor := &TaskAdaptor{baseURL: "https://ai.ctaigw.cn/v1"}
	info, err = directAdaptor.ParseTaskResult([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
	assert.Equal(t, "https://tos.example.com/v.mp4", info.Url)
	assert.Equal(t, 20, info.TotalTokens)
}

// 移动云 MaaS 直连（base_url 以 /api/v3 结尾）也被视为直连形态：
// 轮询 URL 不带 ?model=，成功时保留上游返回的明文/签名视频直链。
func TestCMCCMaaSURLsAndResult(t *testing.T) {
	service.InitHttpClient()

	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		w.Write([]byte(`{"id":"c-1","status":"queued"}`))
	}))
	defer srv.Close()

	adaptor := &TaskAdaptor{baseURL: srv.URL + "/api/v3"}
	resp, err := adaptor.FetchTask(srv.URL+"/api/v3", "maas-key", map[string]any{"task_id": "c-1", "model": "doubao-seedance-2.0"}, "")
	require.NoError(t, err)
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	assert.Equal(t, "/api/v3/contents/generations/tasks/c-1", gotPath)

	// 成功时保留视频直链（明文模式）
	body := `{"id":"c-1","status":"succeeded","content":{"video_url":"https://tos.example.com/v.mp4"},"usage":{"total_tokens":20}}`
	info, err := adaptor.ParseTaskResult([]byte(body))
	require.NoError(t, err)
	assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
	assert.Equal(t, "https://tos.example.com/v.mp4", info.Url)
	assert.Equal(t, 20, info.TotalTokens)
}

func TestHasVideoInput(t *testing.T) {
	assert.False(t, hasVideoInput(relaycommon.TaskSubmitReq{Metadata: map[string]interface{}{}}))
	assert.False(t, hasVideoInput(relaycommon.TaskSubmitReq{Metadata: map[string]interface{}{
		"content": []interface{}{map[string]interface{}{"type": "image_url"}},
	}}))
	assert.True(t, hasVideoInput(relaycommon.TaskSubmitReq{Metadata: map[string]interface{}{
		"content": []interface{}{map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": "http://x/v.mp4"}}},
	}}))
}

func TestResolveModelMapping(t *testing.T) {
	service.InitHttpClient()
	var gotPath, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Write([]byte(`{"endpoint":"cdance2.0-0611"}`))
	}))
	defer srv.Close()

	adaptor := &TaskAdaptor{baseURL: srv.URL + "/api/v3", apiKey: "maas-key"}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	endpoint, err := adaptor.resolveModelMapping(info, "doubao-seedance-2.0")
	require.NoError(t, err)
	assert.Equal(t, "cdance2.0-0611", endpoint)
	assert.Equal(t, "/api/v3/mapping/query", gotPath)
	assert.Equal(t, "Bearer maas-key", gotAuth)
	assert.Contains(t, gotBody, "doubao-seedance-2.0")
}

// 移动云 MaaS 直连时，BuildRequestBody 会先经 /mapping/query 把友好模型名解析为
// 网关内部 endpoint，并作为请求体 model 字段。
func TestBuildRequestBodyCMCCMaaSResolvesMapping(t *testing.T) {
	service.InitHttpClient()
	var path string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		w.Write([]byte(`{"endpoint":"cdance2.0-0611"}`))
	}))
	defer srv.Close()

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt:  "日落时分的海边",
		Model:   "doubao-seedance-2.0",
		Seconds: "5",
	})

	adaptor := &TaskAdaptor{baseURL: srv.URL + "/api/v3", apiKey: "maas-key"}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	reader, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	body, _ := io.ReadAll(reader)
	assert.Contains(t, string(body), `"model":"cdance2.0-0611"`)
	assert.Equal(t, "/api/v3/mapping/query", path)
}

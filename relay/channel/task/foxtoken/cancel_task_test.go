package foxtoken

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCancelTaskRequestShape 锁定「取消任务」打到上游的形式：
// 中转上游（CyAI / Foxtoken，new-api 系）只在火山 ARK 原生路径上暴露删除接口，
// 与创建/查询用的 /v1/video/generations 不是同一个前缀——路径写错会 404
// "Invalid URL"，而任务会继续跑并继续计费。
func TestCancelTaskRequestShape(t *testing.T) {
	service.InitHttpClient()

	var gotMethod, gotPath, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":"success","message":"","data":null}`))
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	resp, err := adaptor.CancelTask(server.URL, "sk-test", map[string]any{
		"task_id": "task_abc123",
	}, "")
	require.NoError(t, err)
	require.NotNil(t, resp)
	defer resp.Body.Close()

	assert.Equal(t, http.MethodDelete, gotMethod)
	assert.Equal(t, "/api/v3/contents/generations/tasks/task_abc123", gotPath)
	assert.Equal(t, "Bearer sk-test", gotAuth)
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

// TestCancelTaskRejectsEmptyTaskID 缺 task_id 时不能带着空路径去请求上游。
func TestCancelTaskRejectsEmptyTaskID(t *testing.T) {
	adaptor := &TaskAdaptor{}
	for _, body := range []map[string]any{nil, {}, {"task_id": ""}, {"task_id": "   "}} {
		_, err := adaptor.CancelTask("http://127.0.0.1:1", "sk-test", body, "")
		require.Error(t, err)
	}
}

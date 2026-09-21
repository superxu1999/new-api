package seedance

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCancelTaskRequestShape 锁定 seedance 适配器的取消 URL 规则：
// 直连云厂商网关（base 以 /v1 或 /api/v3 结尾）用 {base}/contents/generations/tasks/{id}；
// 本地 seedance-proxy 用 {base}/api/v3/contents/generations/tasks/{id}?model=<上游模型名>。
func TestCancelTaskRequestShape(t *testing.T) {
	service.InitHttpClient()

	var gotMethod, gotPath, gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}

	t.Run("直连网关不加 /api/v3", func(t *testing.T) {
		resp, err := adaptor.CancelTask(server.URL+"/api/v3", "key", map[string]any{"task_id": "t1"}, "")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.MethodDelete, gotMethod)
		assert.Equal(t, "/api/v3/contents/generations/tasks/t1", gotPath)
		assert.Empty(t, gotQuery)
	})

	t.Run("代理形态补 /api/v3 并带 model", func(t *testing.T) {
		resp, err := adaptor.CancelTask(server.URL, "key", map[string]any{
			"task_id": "t2",
			"model":   "doubao-seedance-2.0",
		}, "")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.MethodDelete, gotMethod)
		assert.Equal(t, "/api/v3/contents/generations/tasks/t2", gotPath)
		assert.Equal(t, "model=doubao-seedance-2.0", gotQuery)
	})
}

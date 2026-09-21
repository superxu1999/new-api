package doubao

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/service"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCancelTaskRequestShape 锁定火山原生渠道的取消形式：DELETE
// {base}/api/v3/contents/generations/tasks/{task_id}（与查询同前缀）。
func TestCancelTaskRequestShape(t *testing.T) {
	service.InitHttpClient()

	var gotMethod, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	resp, err := adaptor.CancelTask(server.URL, "key-1", map[string]any{"task_id": "task_xyz"}, "")
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.MethodDelete, gotMethod)
	assert.Equal(t, "/api/v3/contents/generations/tasks/task_xyz", gotPath)
}

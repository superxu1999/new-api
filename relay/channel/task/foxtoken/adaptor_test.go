package foxtoken

import (
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultStatusMapping(t *testing.T) {
	adaptor := &TaskAdaptor{}
	tests := []struct {
		name       string
		body       string
		wantStatus model.TaskStatus
		wantURL    string
		wantReason string
	}{
		{
			name: "queued", body: `{"code":"success","data":{"status":"QUEUED","progress":"10%"}}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name: "success", body: `{"code":"success","data":{"status":"SUCCESS","result_url":"https://cdn/x.mp4","progress":"100%"}}`,
			wantStatus: model.TaskStatusSuccess, wantURL: "https://cdn/x.mp4",
		},
		{
			name: "failure", body: `{"code":"success","data":{"status":"FAILURE","fail_reason":"boom"}}`,
			wantStatus: model.TaskStatusFailure, wantReason: "boom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, err := adaptor.ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			assert.Equal(t, string(tt.wantStatus), info.Status)
			assert.Equal(t, tt.wantURL, info.Url)
			assert.Equal(t, tt.wantReason, info.Reason)
		})
	}
}

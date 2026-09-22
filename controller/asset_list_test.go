package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// TestAssetListPage 锁定列表分页参数：页码从 1 开始、每页有上限，
// 非法或缺失时回落到默认值——避免用户用超大 page_size 一次拉全表。
func TestAssetListPage(t *testing.T) {
	cases := []struct {
		name         string
		query        string
		wantPage     int
		wantPageSize int
	}{
		{name: "缺省", query: "", wantPage: 1, wantPageSize: assetListDefaultPageSize},
		{name: "常规", query: "?page=3&page_size=50", wantPage: 3, wantPageSize: 50},
		{name: "页码非数字", query: "?page=abc&page_size=10", wantPage: 1, wantPageSize: 10},
		{name: "页码为 0", query: "?page=0&page_size=10", wantPage: 1, wantPageSize: 10},
		{name: "负数页码", query: "?page=-5&page_size=10", wantPage: 1, wantPageSize: 10},
		{name: "每页为 0 回落默认", query: "?page=2&page_size=0", wantPage: 2, wantPageSize: assetListDefaultPageSize},
		{name: "每页为负数回落默认", query: "?page=2&page_size=-1", wantPage: 2, wantPageSize: assetListDefaultPageSize},
		{name: "超出上限被夹住", query: "?page=1&page_size=100000", wantPage: 1, wantPageSize: assetListMaxPageSize},
	}

	gin.SetMode(gin.TestMode)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/v1/assets"+tc.query, nil)
			page, pageSize := assetListPage(c)
			assert.Equal(t, tc.wantPage, page)
			assert.Equal(t, tc.wantPageSize, pageSize)
		})
	}
}

// TestParseAssetStatuses 锁定状态筛选的解析：逗号分隔、大小写归一、空值忽略。
func TestParseAssetStatuses(t *testing.T) {
	assert.Nil(t, parseAssetStatuses(""))
	assert.Nil(t, parseAssetStatuses("  , ,"))
	assert.Equal(t, []string{"ACTIVE"}, parseAssetStatuses("active"))
	assert.Equal(t, []string{"ACTIVE", "FAILED"}, parseAssetStatuses(" Active , Failed "))
}

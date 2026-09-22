package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAssetUploadTypes 锁定扩展名到上游素材类型的映射：白名单外的扩展名必须拒绝，
// 图片/视频/音频分别映射到上游的 Image / Video / Audio。
func TestAssetUploadTypes(t *testing.T) {
	cases := []struct {
		ext      string
		wantType string
		wantOK   bool
	}{
		{ext: ".png", wantType: model.AssetTypeImage, wantOK: true},
		{ext: ".jpg", wantType: model.AssetTypeImage, wantOK: true},
		{ext: ".webp", wantType: model.AssetTypeImage, wantOK: true},
		{ext: ".mp4", wantType: model.AssetTypeVideo, wantOK: true},
		{ext: ".mov", wantType: model.AssetTypeVideo, wantOK: true},
		{ext: ".mp3", wantType: model.AssetTypeAudio, wantOK: true},
		{ext: ".flac", wantType: model.AssetTypeAudio, wantOK: true},
		{ext: ".exe", wantOK: false},
		{ext: ".html", wantOK: false},
		{ext: "", wantOK: false},
	}

	for _, tc := range cases {
		t.Run(tc.ext, func(t *testing.T) {
			gotType, ok := assetUploadTypes[tc.ext]
			assert.Equal(t, tc.wantOK, ok)
			if tc.wantOK {
				assert.Equal(t, tc.wantType, gotType)
			}
		})
	}
}

// TestIsAssetMediaKey 锁定暂存文件名的形状校验（随机串 + 白名单扩展名），
// 顺带确认路径穿越与非法扩展名都被拒绝。
func TestIsAssetMediaKey(t *testing.T) {
	valid := "abcdefghijklmnopqrstuvwx.png"
	assert.True(t, isAssetMediaKey(valid))

	cases := []struct {
		name string
		key  string
	}{
		{name: "路径穿越", key: "../../etc/passwd"},
		{name: "带路径分隔", key: "sub/abcdefghijklmnopqrstuvwx.png"},
		{name: "扩展名不允许", key: "abcdefghijklmnopqrstuvwx.exe"},
		{name: "长度不足", key: "abc.png"},
		{name: "长度超出", key: "abcdefghijklmnopqrstuvwxy.png"},
		{name: "含非法字符", key: "ABCDEFGHIJKLMNOPQRSTUVWX.png"},
		{name: "空字符串", key: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.False(t, isAssetMediaKey(tc.key))
		})
	}
}

// TestAssetBaseNotServedReason 锁定对外地址的可用性判断：上游无法访问回环、内网与内网短名，
// 这类地址必须在调用上游之前就被拦住。
func TestAssetBaseNotServedReason(t *testing.T) {
	unusable := []string{
		"http://localhost:3099",
		"http://127.0.0.1:3000",
		"http://[::1]:3000",
		"http://192.168.9.123:3099",
		"http://10.0.0.5",
		"http://172.16.3.4:8080",
		"http://169.254.1.1",
		"http://new-api.internal",
		"http://minio:9000",
		"http://baseadd.local",
		"",
		"not-a-url",
		"ghyc.top",
	}
	for _, base := range unusable {
		t.Run("拒绝 "+base, func(t *testing.T) {
			assert.NotEmpty(t, assetBaseNotServedReason(base))
		})
	}

	usable := []string{
		"https://ghyc.top",
		"https://baseadd.vip:8443",
		"https://cdn.example.com",
		"http://8.8.8.8",
	}
	for _, base := range usable {
		t.Run("放行 "+base, func(t *testing.T) {
			assert.Empty(t, assetBaseNotServedReason(base))
		})
	}
}

// TestAssetFetchProblem 锁定「上游抓不到这个地址」的归类：这些错误要与上游自身的参数错误区分开，
// 前者提示地址不可达（路由未部署、只在内网可达、被拒私有地址），后者按上游原文返回。
func TestAssetFetchProblem(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "抓到网页被拒", err: errors.New(`upstream CreateAsset failed: HTTP 400 {"Error":{"Message":"FormatUnsupported"}}`), want: true},
		{name: "地址非法", err: errors.New("InvalidURL"), want: true},
		{name: "下载失败", err: errors.New("download failed: 404"), want: true},
		{name: "上游拒绝私有地址", err: errors.New("URL must not target a private network"), want: true},
		{name: "上游参数错误", err: errors.New(`{"Error":{"Message":"asset type invalid"}}`), want: false},
		{name: "无错误", err: nil, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, assetFetchProblem(tc.err))
		})
	}
}

// TestVerifyAssetPublicUrl 锁定入库前的自检：地址必须真的返回这份文件。
// 返回网页（路由未部署）或 404 属于确定不可用，应当拦下；本站自己连不上时不确定，放行给上游。
func TestVerifyAssetPublicUrl(t *testing.T) {
	dir := t.TempDir()
	fullPath := filepath.Join(dir, "abcdefghijklmnopqrstuvwx.png")
	content := make([]byte, 4096)
	for i := range content {
		content[i] = byte(i % 251)
	}
	require.NoError(t, os.WriteFile(fullPath, content, 0o644))
	size := int64(len(content))

	t.Run("内容一致放行", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(content)
		}))
		defer server.Close()

		problem, certain := verifyAssetPublicUrl(server.URL+"/asset-media/x.png", fullPath, size)
		assert.Empty(t, problem)
		assert.False(t, certain)
	})

	t.Run("返回网页时拦下", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<!doctype html><html></html>"))
		}))
		defer server.Close()

		problem, certain := verifyAssetPublicUrl(server.URL+"/asset-media/x.png", fullPath, size)
		assert.True(t, certain)
		assert.Contains(t, problem, "text/html")
	})

	t.Run("路由缺失时拦下", func(t *testing.T) {
		server := httptest.NewServer(http.NotFoundHandler())
		defer server.Close()

		problem, certain := verifyAssetPublicUrl(server.URL+"/asset-media/x.png", fullPath, size)
		assert.True(t, certain)
		assert.Contains(t, problem, "404")
	})

	t.Run("长度不符时拦下", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)+10))
			_, _ = w.Write(content)
		}))
		defer server.Close()

		problem, certain := verifyAssetPublicUrl(server.URL+"/asset-media/x.png", fullPath, size)
		assert.True(t, certain)
		assert.Contains(t, problem, "bytes")
	})

	t.Run("本站连不上时放行", func(t *testing.T) {
		server := httptest.NewServer(http.NotFoundHandler())
		url := server.URL + "/asset-media/x.png"
		server.Close()

		problem, certain := verifyAssetPublicUrl(url, fullPath, size)
		assert.Empty(t, problem)
		assert.False(t, certain)
	})
}

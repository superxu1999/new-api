package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
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

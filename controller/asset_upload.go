/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	systemsetting "github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

// 直接上传素材：用户把本地文件交给本站，本站先落盘暂存，再把这个文件的公网地址交给
// 上游入库（上游只接受公网可下载的 URL，不支持文件直传）。
//
// 因此这里有三条硬约束：
//  1. 文件必须能通过公网访问（上游服务端会来下载），默认用请求的 scheme://host，
//     可用环境变量 ASSET_UPLOAD_PUBLIC_BASE 或系统设置里的服务器地址覆盖；
//  2. 上传是额外开销（占用本站磁盘与带宽），所以单独一个开关控制，默认关闭；
//  3. 素材删除时同步删除本地暂存文件，避免文件长期滞留。
const (
	// assetUploadMaxMB 单个文件大小上限（MB）。
	assetUploadMaxMB = 100
	// assetMediaPrefix 本地暂存文件的对外下载前缀（无需鉴权，靠随机文件名防猜）。
	assetMediaPrefix = "/asset-media/"
	// assetUploadDirName 暂存目录（相对进程工作目录）。
	assetUploadDirName = "asset-uploads"
)

// assetUploadTypes 扩展名 → 上游素材类型（Image / Video / Audio）。
var assetUploadTypes = map[string]string{
	".jpg":  model.AssetTypeImage,
	".jpeg": model.AssetTypeImage,
	".png":  model.AssetTypeImage,
	".webp": model.AssetTypeImage,
	".gif":  model.AssetTypeImage,
	".bmp":  model.AssetTypeImage,
	".mp4":  model.AssetTypeVideo,
	".mov":  model.AssetTypeVideo,
	".webm": model.AssetTypeVideo,
	".mkv":  model.AssetTypeVideo,
	".mp3":  model.AssetTypeAudio,
	".wav":  model.AssetTypeAudio,
	".m4a":  model.AssetTypeAudio,
	".aac":  model.AssetTypeAudio,
	".ogg":  model.AssetTypeAudio,
	".flac": model.AssetTypeAudio,
}

// assetUploadDir 返回暂存目录（不存在时创建）。
func assetUploadDir() (string, error) {
	dir := assetUploadDirName
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create asset upload dir: %w", err)
	}
	return dir, nil
}

// requestOrigin 取请求的 scheme://host，用于拼公网可达地址。
func requestOrigin(c *gin.Context) string {
	scheme := "https"
	host := c.Request.Host
	if strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.0.0.1") {
		scheme = "http"
	}
	if forwarded := c.GetHeader("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return scheme + "://" + host
}

// assetPublicBase 决定交给上游抓取的公网前缀。
//
// 顺序：环境变量 ASSET_UPLOAD_PUBLIC_BASE → 系统设置里的服务器地址（排除 localhost 默认值）
// → 当前请求的 scheme://host。上游必须能访问到这个地址，否则素材入库会失败。
func assetPublicBase(c *gin.Context) string {
	if value := strings.TrimSpace(os.Getenv("ASSET_UPLOAD_PUBLIC_BASE")); value != "" {
		return strings.TrimRight(value, "/")
	}
	if value := strings.TrimSpace(systemsetting.ServerAddress); value != "" &&
		!strings.Contains(value, "localhost") && !strings.Contains(value, "127.0.0.1") {
		return strings.TrimRight(value, "/")
	}
	return requestOrigin(c)
}

// requireAssetUploadPermission 校验直传权限：管理员始终允许，普通用户需要
// 「素材库」与「直传」两个开关都打开（直传是素材库的子能力）。
func requireAssetUploadPermission(c *gin.Context) bool {
	if c.GetInt("role") >= common.RoleAdminUser {
		return true
	}
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil || user == nil || user.AssetLibraryEnabled != 1 || user.AssetUploadEnabled != 1 {
		assetError(c, http.StatusForbidden, "asset_upload_disabled",
			"direct upload is not enabled for this account, please contact the administrator")
		return false
	}
	return true
}

// UploadAsset 接收 multipart 上传（字段名 file），落盘后交给上游入库。
func UploadAsset(c *gin.Context) {
	if !requireAssetUploadPermission(c) {
		return
	}
	maxBytes := int64(assetUploadMaxMB) << 20
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+(1<<20))

	fileHeader, err := c.FormFile("file")
	if err != nil {
		if strings.Contains(err.Error(), "too large") {
			assetError(c, http.StatusBadRequest, "asset_file_too_large",
				fmt.Sprintf("file exceeds the %d MB limit", assetUploadMaxMB))
			return
		}
		assetError(c, http.StatusBadRequest, "invalid_request",
			"file is required (multipart/form-data, field name: file)")
		return
	}
	if fileHeader.Size > maxBytes {
		assetError(c, http.StatusBadRequest, "asset_file_too_large",
			fmt.Sprintf("file exceeds the %d MB limit", assetUploadMaxMB))
		return
	}
	ext := strings.ToLower(path.Ext(fileHeader.Filename))
	assetType, ok := assetUploadTypes[ext]
	if !ok {
		assetError(c, http.StatusBadRequest, "asset_file_type_not_allowed",
			fmt.Sprintf("unsupported file type %q", ext))
		return
	}
	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = fileHeader.Filename
	}
	groupId, _ := strconv.ParseInt(strings.TrimSpace(c.PostForm("group_id")), 10, 64)

	dir, err := assetUploadDir()
	if err != nil {
		assetError(c, http.StatusInternalServerError, "asset_upload_failed", err.Error())
		return
	}
	key := strings.ToLower(common.GetRandomString(24)) + ext
	fullPath := filepath.Join(dir, key)

	src, err := fileHeader.Open()
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_upload_failed", "failed to read uploaded file")
		return
	}
	defer src.Close()
	dst, err := os.Create(fullPath)
	if err != nil {
		assetError(c, http.StatusInternalServerError, "asset_upload_failed", err.Error())
		return
	}
	if _, err = io.Copy(dst, src); err != nil {
		_ = dst.Close()
		_ = os.Remove(fullPath)
		assetError(c, http.StatusInternalServerError, "asset_upload_failed", err.Error())
		return
	}
	_ = dst.Close()

	// 到这里之后任何失败都要把暂存文件删掉，避免留下孤儿文件。
	discard := func() { _ = os.Remove(fullPath) }

	group, ac, err := ensureAssetGroup(c, 0, strings.TrimSpace(c.PostForm("model")), groupId)
	if err != nil {
		discard()
		assetFailure(c, err)
		return
	}
	publicUrl := assetPublicBase(c) + assetMediaPrefix + key
	result, err := assetAction(ac, "CreateAsset", map[string]any{
		"GroupId":     group.UpstreamGroupId,
		"Name":        name,
		"URL":         publicUrl,
		"AssetType":   assetType,
		"ProjectName": "default",
	})
	if err != nil {
		discard()
		assetFailure(c, err)
		return
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		upstreamId = stringField(result, "asset_id")
	}
	if upstreamId == "" {
		discard()
		assetError(c, http.StatusBadGateway, "asset_upstream_error", "upstream did not return asset id")
		return
	}
	status := strings.ToUpper(stringField(result, "Status"))
	if status == "" {
		status = model.AssetStatusProcessing
	}

	asset := &model.Asset{
		UserId:          c.GetInt("id"),
		ChannelId:       ac.channelId,
		GroupId:         group.Id,
		UpstreamGroupId: group.UpstreamGroupId,
		UpstreamAssetId: upstreamId,
		Name:            name,
		AssetType:       assetType,
		SourceUrl:       publicUrl,
		LocalKey:        key,
		Status:          status,
	}
	if err := model.CreateAsset(asset); err != nil {
		discard()
		assetError(c, http.StatusInternalServerError, "create_asset_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": asset})
}

// ServeAssetMedia 提供暂存文件下载：上游服务端要能匿名抓取，所以这条路由不鉴权，
// 安全依赖随机文件名（24 位随机字符）与扩展名白名单。
func ServeAssetMedia(c *gin.Context) {
	key := path.Base(strings.TrimSpace(c.Param("key")))
	if !isAssetMediaKey(key) {
		c.Status(http.StatusNotFound)
		return
	}
	fullPath := filepath.Join(assetUploadDirName, key)
	if _, err := os.Stat(fullPath); err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.File(fullPath)
}

// isAssetMediaKey 校验文件名形状：随机串 + 白名单扩展名，顺带挡掉路径穿越。
func isAssetMediaKey(key string) bool {
	if key == "" || key != filepath.Base(key) {
		return false
	}
	ext := strings.ToLower(path.Ext(key))
	if _, ok := assetUploadTypes[ext]; !ok {
		return false
	}
	stem := strings.TrimSuffix(key, ext)
	if len(stem) != 24 {
		return false
	}
	for _, char := range stem {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') {
			return false
		}
	}
	return true
}

// removeAssetLocalFile 删除素材时一并清理本站暂存文件。
func removeAssetLocalFile(localKey string) {
	if localKey == "" || !isAssetMediaKey(localKey) {
		return
	}
	_ = os.Remove(filepath.Join(assetUploadDirName, localKey))
}

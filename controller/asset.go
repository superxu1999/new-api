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
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel"

	"github.com/gin-gonic/gin"
)

// 云端素材库控制台接口（/v1/assets）。
//
// 素材实体、转码、审核与真人活体认证全部由上游渠道托管，本站只做三件事：
//  1. 用本地 ID 记录「素材组 / 素材 / 真人认证会话」与「用户 + 渠道」的绑定；
//  2. 代理到上游的动作式接口（见 channel.AssetLibrary）；
//  3. 校验权限与状态，保证用户只能引用自己且已 ACTIVE 的素材。
//
// 素材绑在渠道上（上游素材组按渠道凭证隔离），因此所有写操作都先解析渠道并落库，
// 生成任务引用素材时也必须锁到同一渠道。
type assetChannel struct {
	channel   *model.Channel
	adaptor   channel.AssetLibrary
	baseUrl   string
	key       string
	proxy     string
	channelId int
}

// assetError 返回与任务类接口一致的扁平错误结构。
func assetError(c *gin.Context, status int, code string, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "new_api_error",
			"code":    code,
		},
	})
}

// requireAssetPermission 校验当前用户是否被允许使用云端素材库。
//
// 规则：管理员及以上始终允许；普通用户必须由管理员在用户配置里显式开启
// （user.asset_library_enabled），默认关闭，避免被当作免费网盘使用。
func requireAssetPermission(c *gin.Context) bool {
	if c.GetInt("role") >= common.RoleAdminUser {
		return true
	}
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil || user == nil || user.AssetLibraryEnabled != 1 {
		assetError(c, http.StatusForbidden, "asset_library_disabled",
			"cloud asset library is not enabled for this account, please contact the administrator")
		return false
	}
	return true
}

// resolveAssetChannel 解析素材操作要落到哪条渠道。
//
// 顺序：显式 channelId → 按 model 在该用户分组下的候选渠道里挑第一条支持素材库的渠道。
// 候选顺序确定性（优先级降序、渠道 id 升序），保证同一模型每次解析结果一致。
func resolveAssetChannel(c *gin.Context, channelId int, modelName string) (*assetChannel, error) {
	group := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if group == "" {
		userGroup, err := model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			return nil, fmt.Errorf("failed to query user group: %w", err)
		}
		group = userGroup
	}

	var candidates []int
	if channelId > 0 {
		candidates = []int{channelId}
	} else {
		ids, err := model.ListAssetCandidateChannelIds(group, modelName)
		if err != nil {
			return nil, fmt.Errorf("failed to list candidate channels: %w", err)
		}
		candidates = ids
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no channel available for asset library")
	}

	var lastErr error
	for _, id := range candidates {
		ch, err := model.CacheGetChannel(id)
		if err != nil || ch == nil {
			lastErr = fmt.Errorf("channel %d not found", id)
			continue
		}
		if ch.Status != common.ChannelStatusEnabled {
			lastErr = fmt.Errorf("channel %d is disabled", id)
			continue
		}
		adaptor := relay.GetTaskAdaptor(constant.TaskPlatform(strconv.Itoa(ch.Type)))
		if adaptor == nil {
			lastErr = fmt.Errorf("channel %d has no task adaptor", id)
			continue
		}
		lib, ok := adaptor.(channel.AssetLibrary)
		if !ok {
			lastErr = fmt.Errorf("channel %d does not support asset library", id)
			continue
		}
		key := ch.Key
		if key == "" {
			if k, _, apiErr := ch.GetNextEnabledKey(); apiErr == nil {
				key = k
			}
		}
		return &assetChannel{
			channel:   ch,
			adaptor:   lib,
			baseUrl:   ch.GetBaseURL(),
			key:       key,
			proxy:     ch.GetSetting().Proxy,
			channelId: id,
		}, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no channel supports asset library")
	}
	return nil, lastErr
}

// assetAction 调用上游动作并解析响应。
//
// 兼容两种响应形态：火山方舟的 {"ResponseMetadata":…,"Result":{…}}（失败在
// ResponseMetadata.Error 里）与中转的 {"ok":true,"data":{…}}；返回业务结果部分。
func assetAction(ac *assetChannel, action string, payload map[string]any) (map[string]any, error) {
	resp, err := ac.adaptor.AssetAction(ac.baseUrl, ac.key, ac.proxy, action, payload)
	if err != nil {
		return nil, fmt.Errorf("failed to call upstream %s: %w", action, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream %s failed: HTTP %d %s", action, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var parsed map[string]any
	if err := common.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("invalid upstream response for %s: %s", action, strings.TrimSpace(string(body)))
	}
	if meta, ok := parsed["ResponseMetadata"].(map[string]any); ok {
		if errObj, ok := meta["Error"].(map[string]any); ok {
			return nil, fmt.Errorf("upstream %s error: %v", action, errObj["Message"])
		}
	}
	if result, ok := parsed["Result"].(map[string]any); ok {
		return result, nil
	}
	if data, ok := parsed["data"].(map[string]any); ok {
		return data, nil
	}
	return parsed, nil
}

// stringField 读字符串字段，兼容非字符串标量。
func stringField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	switch value := m[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(value, 10)
	}
	return ""
}

// ensureAssetGroup 找到（必要时创建）用户在该渠道上的默认 AIGC 素材组。
func ensureAssetGroup(c *gin.Context, ac *assetChannel, groupId int64) (*model.AssetGroup, error) {
	userId := c.GetInt("id")
	if groupId > 0 {
		return model.GetAssetGroupById(userId, groupId)
	}
	groups, err := model.ListAssetGroups(userId, ac.channelId, model.AssetGroupTypeAIGC)
	if err != nil {
		return nil, err
	}
	if len(groups) > 0 {
		return groups[0], nil
	}
	name := "默认素材组"
	result, err := assetAction(ac, "CreateAssetGroup", map[string]any{
		"Name":        name,
		"Description": "",
		"GroupType":   model.AssetGroupTypeAIGC,
		"ProjectName": "default",
	})
	if err != nil {
		return nil, err
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		return nil, fmt.Errorf("upstream did not return group id")
	}
	group := &model.AssetGroup{
		UserId:          userId,
		ChannelId:       ac.channelId,
		UpstreamGroupId: upstreamId,
		GroupType:       model.AssetGroupTypeAIGC,
		Name:            name,
	}
	if err := model.CreateAssetGroup(group); err != nil {
		return nil, err
	}
	return group, nil
}

// ============================
// 素材组
// ============================

type createAssetGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	GroupType   string `json:"group_type"`
	ChannelId   int    `json:"channel_id"`
	Model       string `json:"model"`
}

// ListAssetGroups 返回当前用户在本站登记过的素材组。
func ListAssetGroups(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	groups, err := model.ListAssetGroups(c.GetInt("id"), channelId, c.Query("group_type"))
	if err != nil {
		assetError(c, http.StatusInternalServerError, "query_asset_group_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": groups})
}

// CreateAssetGroup 创建素材组（上游仅支持 AIGC；真人组只能由活体认证流程产生）。
func CreateAssetGroup(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	var req createAssetGroupRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		assetError(c, http.StatusBadRequest, "invalid_request", "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		assetError(c, http.StatusBadRequest, "invalid_request", "name is required")
		return
	}
	groupType := strings.TrimSpace(req.GroupType)
	if groupType == "" {
		groupType = model.AssetGroupTypeAIGC
	}
	if groupType != model.AssetGroupTypeAIGC {
		assetError(c, http.StatusBadRequest, "invalid_request",
			"only AIGC asset groups can be created here; real-person groups come from the liveness verification flow")
		return
	}

	ac, err := resolveAssetChannel(c, req.ChannelId, req.Model)
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	result, err := assetAction(ac, "CreateAssetGroup", map[string]any{
		"Name":        req.Name,
		"Description": req.Description,
		"GroupType":   groupType,
		"ProjectName": "default",
	})
	if err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", "upstream did not return group id")
		return
	}

	group := &model.AssetGroup{
		UserId:          c.GetInt("id"),
		ChannelId:       ac.channelId,
		UpstreamGroupId: upstreamId,
		GroupType:       groupType,
		Name:            req.Name,
		Description:     req.Description,
	}
	if err := model.CreateAssetGroup(group); err != nil {
		assetError(c, http.StatusInternalServerError, "create_asset_group_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": group})
}

// GetAssetGroup 返回单个素材组。
func GetAssetGroup(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	group, err := model.GetAssetGroupById(c.GetInt("id"), id)
	if err != nil {
		assetError(c, http.StatusNotFound, "asset_group_not_found", "asset group not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": group})
}

// DeleteAssetGroup 删除素材组（上游删除成功后再软删本地映射）。
func DeleteAssetGroup(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	userId := c.GetInt("id")
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	group, err := model.GetAssetGroupById(userId, id)
	if err != nil {
		assetError(c, http.StatusNotFound, "asset_group_not_found", "asset group not found")
		return
	}
	ac, err := resolveAssetChannel(c, group.ChannelId, "")
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	if _, err := assetAction(ac, "DeleteAssetGroup", map[string]any{
		"Id":          group.UpstreamGroupId,
		"ProjectName": "default",
	}); err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	if err := model.DeleteAssetGroup(userId, id); err != nil {
		assetError(c, http.StatusInternalServerError, "delete_asset_group_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// ============================
// 素材
// ============================

type createAssetRequest struct {
	GroupId   int64  `json:"group_id"`
	Name      string `json:"name"`
	Url       string `json:"url"`
	AssetType string `json:"asset_type"`
	ChannelId int    `json:"channel_id"`
	Model     string `json:"model"`
}

// ListAssets 返回当前用户的素材列表（状态为本站最近一次同步的结果）。
func ListAssets(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	groupId, _ := strconv.ParseInt(c.Query("group_id"), 10, 64)
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	var statuses []string
	if raw := strings.TrimSpace(c.Query("status")); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			if s = strings.ToUpper(strings.TrimSpace(s)); s != "" {
				statuses = append(statuses, s)
			}
		}
	}
	assets, err := model.ListAssets(c.GetInt("id"), channelId, groupId, statuses, strings.TrimSpace(c.Query("keyword")))
	if err != nil {
		assetError(c, http.StatusInternalServerError, "query_asset_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": assets})
}

// CreateAsset 创建素材：上游异步入库，本地先记为 PROCESSING。
//
// 上游只接受公网可下载的 HTTP(S) URL（不支持文件直传），因此这里只做格式校验。
func CreateAsset(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	var req createAssetRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		assetError(c, http.StatusBadRequest, "invalid_request", "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Url = strings.TrimSpace(req.Url)
	req.AssetType = strings.TrimSpace(req.AssetType)
	if req.Name == "" {
		assetError(c, http.StatusBadRequest, "invalid_request", "name is required")
		return
	}
	if !strings.HasPrefix(req.Url, "http://") && !strings.HasPrefix(req.Url, "https://") {
		assetError(c, http.StatusBadRequest, "invalid_request", "url must be a public http(s) url")
		return
	}
	if !model.AllowedAssetTypes[req.AssetType] {
		assetError(c, http.StatusBadRequest, "invalid_request", "asset_type must be Image, Video or Audio")
		return
	}

	channelId := req.ChannelId
	if req.GroupId > 0 {
		group, err := model.GetAssetGroupById(c.GetInt("id"), req.GroupId)
		if err != nil {
			assetError(c, http.StatusNotFound, "asset_group_not_found", "asset group not found")
			return
		}
		channelId = group.ChannelId
	}
	ac, err := resolveAssetChannel(c, channelId, req.Model)
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	group, err := ensureAssetGroup(c, ac, req.GroupId)
	if err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}

	result, err := assetAction(ac, "CreateAsset", map[string]any{
		"GroupId":     group.UpstreamGroupId,
		"Name":        req.Name,
		"URL":         req.Url,
		"AssetType":   req.AssetType,
		"ProjectName": "default",
	})
	if err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		upstreamId = stringField(result, "asset_id")
	}
	if upstreamId == "" {
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
		Name:            req.Name,
		AssetType:       req.AssetType,
		SourceUrl:       req.Url,
		Status:          status,
	}
	if err := model.CreateAsset(asset); err != nil {
		assetError(c, http.StatusInternalServerError, "create_asset_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": asset})
}

// GetAsset 返回素材详情，并从上游刷新一次状态。
func GetAsset(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	userId := c.GetInt("id")
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	asset, err := model.GetAssetById(userId, id)
	if err != nil {
		assetError(c, http.StatusNotFound, "asset_not_found", "asset not found")
		return
	}
	ac, err := resolveAssetChannel(c, asset.ChannelId, "")
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	result, err := assetAction(ac, "GetAsset", map[string]any{
		"Id":          asset.UpstreamAssetId,
		"ProjectName": "default",
	})
	if err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	if status := strings.ToUpper(stringField(result, "Status")); status != "" && status != asset.Status {
		failReason := stringField(result, "Error")
		if err := model.UpdateAssetStatus(asset.Id, status, failReason); err == nil {
			asset.Status = status
			asset.FailReason = failReason
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": asset})
}

// UpdateAsset 更新素材名称。
func UpdateAsset(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	userId := c.GetInt("id")
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var req struct {
		Name string `json:"name"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || strings.TrimSpace(req.Name) == "" {
		assetError(c, http.StatusBadRequest, "invalid_request", "name is required")
		return
	}
	asset, err := model.GetAssetById(userId, id)
	if err != nil {
		assetError(c, http.StatusNotFound, "asset_not_found", "asset not found")
		return
	}
	ac, err := resolveAssetChannel(c, asset.ChannelId, "")
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	if _, err := assetAction(ac, "UpdateAsset", map[string]any{
		"Id":          asset.UpstreamAssetId,
		"Name":        strings.TrimSpace(req.Name),
		"ProjectName": "default",
	}); err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	if err := model.UpdateAssetName(userId, id, strings.TrimSpace(req.Name)); err != nil {
		assetError(c, http.StatusInternalServerError, "update_asset_failed", err.Error())
		return
	}
	asset.Name = strings.TrimSpace(req.Name)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": asset})
}

// DeleteAsset 删除素材。
func DeleteAsset(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	userId := c.GetInt("id")
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	asset, err := model.GetAssetById(userId, id)
	if err != nil {
		assetError(c, http.StatusNotFound, "asset_not_found", "asset not found")
		return
	}
	ac, err := resolveAssetChannel(c, asset.ChannelId, "")
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	if _, err := assetAction(ac, "DeleteAsset", map[string]any{
		"Id":          asset.UpstreamAssetId,
		"ProjectName": "default",
	}); err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	if err := model.DeleteAsset(userId, id); err != nil {
		assetError(c, http.StatusInternalServerError, "delete_asset_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// ============================
// 真人认证
// ============================

type createRealPersonSessionRequest struct {
	ChannelId   int    `json:"channel_id"`
	Model       string `json:"model"`
	CallbackUrl string `json:"callback_url"`
}

// defaultRealPersonCallback 兜底回调地址：认证完成后浏览器落到本站素材库页，
// 由页面轮询认证结果。调用方可用 callback_url 覆盖。
func defaultRealPersonCallback(c *gin.Context) string {
	scheme := "https"
	if strings.HasPrefix(c.Request.Host, "localhost") || strings.HasPrefix(c.Request.Host, "127.0.0.1") {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/assets", scheme, c.Request.Host)
}

// CreateRealPersonSession 创建真人活体认证会话，返回 H5 链接。
//
// 认证必须由真人在手机上完成，不可绕过；有效期较短，前端需支持重新生成。
func CreateRealPersonSession(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	var req createRealPersonSessionRequest
	_ = common.DecodeJson(c.Request.Body, &req)
	ac, err := resolveAssetChannel(c, req.ChannelId, req.Model)
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	callbackUrl := strings.TrimSpace(req.CallbackUrl)
	if callbackUrl == "" {
		callbackUrl = defaultRealPersonCallback(c)
	}
	result, err := assetAction(ac, "CreateVisualValidateSession", map[string]any{
		"CallbackURL": callbackUrl,
		"ProjectName": "default",
	})
	if err != nil {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	bytedToken := stringField(result, "BytedToken")
	h5Link := stringField(result, "H5Link")
	if bytedToken == "" || h5Link == "" {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", "upstream did not return real-person session")
		return
	}
	expiresIn := 0
	if v, ok := result["ExpiresIn"].(float64); ok {
		expiresIn = int(v)
	}
	session := &model.RealPersonSession{
		UserId:     c.GetInt("id"),
		ChannelId:  ac.channelId,
		BytedToken: bytedToken,
		H5Link:     h5Link,
		Status:     model.RealPersonStatusPending,
		ExpiresAt:  time.Now().Unix() + int64(expiresIn),
	}
	if err := model.CreateRealPersonSession(session); err != nil {
		assetError(c, http.StatusInternalServerError, "create_real_person_session_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"session_id": session.Id,
			"h5_link":    session.H5Link,
			"expires_at": session.ExpiresAt,
			"status":     session.Status,
		},
	})
}

// GetRealPersonSession 查询认证结果；认证通过后把真人素材组登记到本地。
func GetRealPersonSession(c *gin.Context) {
	if !requireAssetPermission(c) {
		return
	}
	userId := c.GetInt("id")
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	session, err := model.GetRealPersonSession(userId, id)
	if err != nil {
		assetError(c, http.StatusNotFound, "real_person_session_not_found", "session not found")
		return
	}
	ac, err := resolveAssetChannel(c, session.ChannelId, "")
	if err != nil {
		assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
		return
	}
	result, err := assetAction(ac, "GetVisualValidateResult", map[string]any{
		"BytedToken": session.BytedToken,
	})
	if err != nil {
		// 尚未完成认证时上游会报错（会话不存在/过期），按未完成返回而不是失败。
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"session_id": session.Id,
				"status":     session.Status,
				"group_id":   session.GroupId,
				"message":    err.Error(),
			},
		})
		return
	}
	upstreamGroupId := stringField(result, "GroupId")
	if upstreamGroupId == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"session_id": session.Id,
				"status":     session.Status,
				"group_id":   session.GroupId,
			},
		})
		return
	}

	group, exist, err := model.GetAssetGroupByUpstream(ac.channelId, upstreamGroupId)
	if err != nil {
		assetError(c, http.StatusInternalServerError, "query_asset_group_failed", err.Error())
		return
	}
	if !exist {
		group = &model.AssetGroup{
			UserId:          userId,
			ChannelId:       ac.channelId,
			UpstreamGroupId: upstreamGroupId,
			GroupType:       model.AssetGroupTypeLivenessFace,
			Name:            "真人素材组",
		}
		if err := model.CreateAssetGroup(group); err != nil {
			assetError(c, http.StatusInternalServerError, "create_asset_group_failed", err.Error())
			return
		}
	}
	if err := model.MarkRealPersonSessionVerified(session.Id, group.Id, model.AssetGroupTypeLivenessFace); err != nil {
		assetError(c, http.StatusInternalServerError, "update_real_person_session_failed", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"session_id": session.Id,
			"status":     model.RealPersonStatusVerified,
			"group_id":   group.Id,
		},
	})
}

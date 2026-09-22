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
	"errors"
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
// 规则：按账号开关判定（user.asset_library_enabled），管理员及以上同样需要开启，
// 默认关闭，避免被当作免费网盘使用。开关只有超级管理员能在用户配置里修改。
func requireAssetPermission(c *gin.Context) bool {
	user, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil || user == nil || user.AssetLibraryEnabled != 1 {
		assetError(c, http.StatusForbidden, "asset_library_disabled",
			"cloud asset library is not enabled for this account, please contact the administrator")
		return false
	}
	return true
}

// assetChannelCandidates 返回素材操作可用的候选渠道，顺序确定（优先级降序、渠道 id 升序）。
//
// 只保留「渠道启用且适配器实现了 AssetLibrary」的渠道。之所以返回列表而不是单条：有些中转
// （例如 Foxtoken 这类 new-api 中转）复用了同一适配器，但上游并没有开放素材动作接口，
// 只有实际调用时才会返回「没有这个路由」，因此需要按顺序换下一条（见 assetActionWithFallback）。
func assetChannelCandidates(c *gin.Context, channelId int, modelName string) ([]*assetChannel, error) {
	group := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if group == "" {
		userGroup, err := model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			return nil, fmt.Errorf("failed to query user group: %w", err)
		}
		group = userGroup
	}

	var ids []int
	if channelId > 0 {
		ids = []int{channelId}
	} else {
		candidates, err := model.ListAssetCandidateChannelIds(group, modelName)
		if err != nil {
			return nil, fmt.Errorf("failed to list candidate channels: %w", err)
		}
		ids = candidates
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("no channel available for asset library")
	}

	var lastErr error
	result := make([]*assetChannel, 0, len(ids))
	for _, id := range ids {
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
		result = append(result, &assetChannel{
			channel:   ch,
			adaptor:   lib,
			baseUrl:   ch.GetBaseURL(),
			key:       key,
			proxy:     ch.GetSetting().Proxy,
			channelId: id,
		})
	}
	if len(result) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("no channel supports asset library")
		}
		return nil, lastErr
	}
	return result, nil
}

// resolveAssetChannel 取第一条候选渠道，用于已经绑定具体渠道的操作（素材组、素材）。
func resolveAssetChannel(c *gin.Context, channelId int, modelName string) (*assetChannel, error) {
	candidates, err := assetChannelCandidates(c, channelId, modelName)
	if err != nil {
		return nil, err
	}
	return candidates[0], nil
}

// assetUpstreamError 保留上游状态码与原文，便于判定「上游没有这个路由」。
type assetUpstreamError struct {
	action string
	status int
	body   string
}

func (e *assetUpstreamError) Error() string {
	return fmt.Sprintf("upstream %s failed: HTTP %d %s", e.action, e.status, e.body)
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
		return nil, &assetUpstreamError{action: action, status: resp.StatusCode, body: strings.TrimSpace(string(body))}
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

// assetRouteMissing 判断错误是否属于「上游根本没有这个路由」。
//
// 现象：new-api 系中转对 /api 返回 {"error":{"message":"Invalid URL (POST /api)"}}，
// 网关则返回裸 404/405。这类错误说明该渠道没开放素材动作接口，换下一条候选渠道即可；
// 其它错误（参数错误、鉴权失败、业务报错）一律原样上抛，不掩盖真实问题。
func assetRouteMissing(err error) bool {
	var upstreamErr *assetUpstreamError
	if !errors.As(err, &upstreamErr) {
		return false
	}
	if upstreamErr.status != http.StatusNotFound && upstreamErr.status != http.StatusMethodNotAllowed {
		return false
	}
	body := upstreamErr.body
	return strings.Contains(body, "Invalid URL") ||
		strings.Contains(body, "Not Found") ||
		strings.Contains(body, "resource_not_found")
}

// assetActionWithFallback 依次在候选渠道上执行动作，自动跳过没有素材接口的上游。
//
// 仅在「未指定渠道」时允许换渠道：一旦素材落在某条渠道上，后续素材组/素材操作都必须
// 固定在同一条渠道（上游素材按渠道凭证隔离）。返回实际执行成功的渠道，便于落库。
func assetActionWithFallback(c *gin.Context, channelId int, modelName string, action string, payload map[string]any) (map[string]any, *assetChannel, error) {
	candidates, err := assetChannelCandidates(c, channelId, modelName)
	if err != nil {
		return nil, nil, err
	}
	var lastErr error
	tried := make([]string, 0, len(candidates))
	for _, ac := range candidates {
		result, err := assetAction(ac, action, payload)
		if err == nil {
			return result, ac, nil
		}
		if channelId == 0 && assetRouteMissing(err) {
			tried = append(tried, strconv.Itoa(ac.channelId))
			lastErr = err
			continue
		}
		return nil, nil, err
	}
	if len(tried) > 0 {
		return nil, nil, fmt.Errorf("no channel exposes the asset library interface (tried channels %s), last error: %w",
			strings.Join(tried, ", "), lastErr)
	}
	return nil, nil, lastErr
}

// assetFailure 按错误类型选择错误码：上游报错 → 502 asset_upstream_error；
// 其余（没有可用渠道、渠道不支持素材接口）→ 400 asset_not_supported。
func assetFailure(c *gin.Context, err error) {
	var upstreamErr *assetUpstreamError
	if errors.As(err, &upstreamErr) {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", err.Error())
		return
	}
	assetError(c, http.StatusBadRequest, "asset_not_supported", err.Error())
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

// ensureAssetGroup 找到（必要时创建）默认 AIGC 素材组，并返回该组所在的渠道。
//
// 传了 groupId 时按既有组走（渠道由组决定，不再换渠道）；否则优先复用用户已有的 AIGC 组，
// 都没有时才在候选渠道上新建一个默认组 —— 新建时会自动跳过没有素材接口的上游。
func ensureAssetGroup(c *gin.Context, channelId int, modelName string, groupId int64) (*model.AssetGroup, *assetChannel, error) {
	userId := c.GetInt("id")
	if groupId > 0 {
		group, err := model.GetAssetGroupById(userId, groupId)
		if err != nil {
			return nil, nil, err
		}
		ac, err := resolveAssetChannel(c, group.ChannelId, "")
		if err != nil {
			return nil, nil, err
		}
		return group, ac, nil
	}

	groups, err := model.ListAssetGroups(userId, channelId, model.AssetGroupTypeAIGC)
	if err != nil {
		return nil, nil, err
	}
	if len(groups) > 0 {
		ac, err := resolveAssetChannel(c, groups[0].ChannelId, "")
		if err != nil {
			return nil, nil, err
		}
		return groups[0], ac, nil
	}

	name := "默认素材组"
	result, used, err := assetActionWithFallback(c, channelId, modelName, "CreateAssetGroup", map[string]any{
		"Name":        name,
		"Description": "",
		"GroupType":   model.AssetGroupTypeAIGC,
		"ProjectName": "default",
	})
	if err != nil {
		return nil, nil, err
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		return nil, nil, fmt.Errorf("upstream did not return group id")
	}
	group := &model.AssetGroup{
		UserId:          userId,
		ChannelId:       used.channelId,
		UpstreamGroupId: upstreamId,
		GroupType:       model.AssetGroupTypeAIGC,
		Name:            name,
	}
	if err := model.CreateAssetGroup(group); err != nil {
		return nil, nil, err
	}
	return group, used, nil
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

	result, used, err := assetActionWithFallback(c, req.ChannelId, req.Model, "CreateAssetGroup", map[string]any{
		"Name":        req.Name,
		"Description": req.Description,
		"GroupType":   groupType,
		"ProjectName": "default",
	})
	if err != nil {
		assetFailure(c, err)
		return
	}
	upstreamId := stringField(result, "Id")
	if upstreamId == "" {
		assetError(c, http.StatusBadGateway, "asset_upstream_error", "upstream did not return group id")
		return
	}

	group := &model.AssetGroup{
		UserId:          c.GetInt("id"),
		ChannelId:       used.channelId,
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
	group, ac, err := ensureAssetGroup(c, channelId, req.Model, req.GroupId)
	if err != nil {
		assetFailure(c, err)
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
	// 直传素材在本站有暂存文件，随素材一起清理。
	removeAssetLocalFile(asset.LocalKey)
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
	return requestOrigin(c) + "/asset-library"
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
	callbackUrl := strings.TrimSpace(req.CallbackUrl)
	if callbackUrl == "" {
		callbackUrl = defaultRealPersonCallback(c)
	}
	result, used, err := assetActionWithFallback(c, req.ChannelId, req.Model, "CreateVisualValidateSession", map[string]any{
		"CallbackURL": callbackUrl,
		"ProjectName": "default",
	})
	if err != nil {
		assetFailure(c, err)
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
		ChannelId:  used.channelId,
		BytedToken: bytedToken,
		H5Link:     h5Link,
		ShortCode:  strings.ToLower(common.GetRandomString(10)),
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
			// 短链给前端生成二维码用：上游链接很长，直接编码会让二维码过密。
			"short_link": requestOrigin(c) + realPersonShortPath + session.ShortCode,
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

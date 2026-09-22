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
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// 站内素材引用写法：asset://<本地素材 ID>（数字部分是本地 assets 表的主键）。
// 上游自己的素材 ID 不是纯数字，遇到时原样放行，便于直接透传上游 ID 排障。
const (
	assetRefSchemeFull  = "asset://"
	assetRefSchemeShort = "asset:"
)

// resolveTaskAssets 在渠道选择之前把请求体里的站内素材引用换成上游素材 ID，并把任务锁到
// 素材所属渠道。
//
// 为什么必须在选渠道之前做：素材组与素材在上游按渠道凭证隔离，同一条素材换渠道后上游
// 解析不到，因此引用了素材的任务必须落到素材所在渠道（复用 Remix 的 LockedChannel 机制，
// 见 RelayTask 重试循环）。
//
// 只有 application/json 的任务请求会走这里；multipart 上传类任务不涉及素材引用。
func resolveTaskAssets(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if !strings.Contains(c.GetHeader("Content-Type"), "application/json") {
		return nil
	}

	var payload map[string]any
	if err := common.UnmarshalBodyReusable(c, &payload); err != nil || len(payload) == 0 {
		return nil
	}

	userId := c.GetInt("id")
	referenced := make(map[string]*model.Asset)
	channelIds := make(map[int]bool)
	var resolveErr *dto.TaskError

	replaceTaskAssetRefs(payload, func(raw string) (string, bool) {
		id, ok := parseLocalAssetRef(raw)
		if !ok {
			return "", false
		}
		asset, exist := referenced[raw]
		if !exist {
			found, err := model.GetAssetById(userId, id)
			if err != nil || found == nil || found.UserId != userId {
				// 管理员也按「自己的素材」处理：跨用户引用一律拒绝，避免越权。
				resolveErr = service.TaskErrorWrapperLocal(
					fmt.Errorf("asset %d not found", id), "asset_not_found", 400)
				return "", false
			}
			if found.Status != model.AssetStatusActive {
				resolveErr = service.TaskErrorWrapperLocal(
					fmt.Errorf("asset %d is %s, only ACTIVE assets can be used", id, found.Status),
					"asset_not_active", 400)
				return "", false
			}
			referenced[raw] = found
			channelIds[found.ChannelId] = true
			asset = found
		}
		return assetRefSchemeFull + asset.UpstreamAssetId, true
	})

	if resolveErr != nil {
		return resolveErr
	}
	if len(referenced) == 0 {
		return nil
	}

	if user, err := model.GetUserById(userId, false); err != nil || user == nil || user.AssetLibraryEnabled != 1 {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("cloud asset library is not enabled for this account"),
			"asset_library_disabled", 403)
	}

	if len(channelIds) != 1 {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("referenced assets belong to different channels, use assets from one channel"),
			"asset_channel_mismatch", 400)
	}
	var channelId int
	for id := range channelIds {
		channelId = id
	}
	if taskErr := lockTaskAssetsChannel(c, info, channelId); taskErr != nil {
		return taskErr
	}

	// 回写改写后的请求体：下游的校验、归一化与适配器都只看得到上游素材 ID。
	rewritten, err := common.Marshal(payload)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "rewrite_asset_reference_failed", 500)
	}
	storage, err := common.CreateBodyStorage(rewritten)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "rewrite_asset_reference_failed", 500)
	}
	if old, oldErr := common.GetBodyStorage(c); oldErr == nil && old != nil {
		_ = old.Close()
	}
	c.Set(common.KeyBodyStorage, storage)
	c.Request.ContentLength = int64(len(rewritten))
	return nil
}

// lockTaskAssetsChannel 把任务锁到素材所属渠道，机制与 Remix 锁原任务渠道一致：
// 复用 SetupContextForSelectedChannel 写全渠道上下文，再重建 ChannelMeta 并设置 LockedChannel。
func lockTaskAssetsChannel(c *gin.Context, info *relaycommon.RelayInfo, channelId int) *dto.TaskError {
	if common.GetContextKeyInt(c, constant.ContextKeyChannelId) == channelId {
		return nil
	}
	ch, err := model.GetChannelById(channelId, true)
	if err != nil || ch == nil {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("failed to load asset channel %d: %v", channelId, err),
			"asset_channel_unavailable", 400)
	}
	if ch.Status != common.ChannelStatusEnabled {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("the channel of the referenced asset is disabled"),
			"asset_channel_disable", 400)
	}
	if newAPIError := middleware.SetupContextForSelectedChannel(c, ch, info.OriginModelName); newAPIError != nil {
		return service.TaskErrorWrapper(newAPIError, "asset_channel_setup_failed", newAPIError.StatusCode)
	}
	// ChannelMeta 在选渠道之前是空的，这里按刚写入的上下文重建，适配器随后才能读到
	// 正确的 base url / key / 渠道类型。
	info.InitChannelMeta(c)
	info.LockedChannel = ch
	return nil
}

// parseLocalAssetRef 解析 asset://<数字> 形式的站内素材引用。
func parseLocalAssetRef(raw string) (int64, bool) {
	value := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(value, assetRefSchemeFull):
		value = strings.TrimPrefix(value, assetRefSchemeFull)
	case strings.HasPrefix(value, assetRefSchemeShort):
		value = strings.TrimPrefix(value, assetRefSchemeShort)
	default:
		return 0, false
	}
	if value == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// replaceTaskAssetRefs 只改写「参考素材」字段里的站内素材引用，不做全文档字符串替换 ——
// 否则提示词正文里出现的同名文字也会被改掉。
//
// 覆盖的写法（与 relaycommon 的归一化口径一致）：
//   - content / metadata.content 数组元素里的 image_url / video_url / audio_url（字符串或 {url}）
//   - metadata 扁平写法：image_url / video_url / audio_url（字符串或 {url}）
//   - images 数组、image / input_reference 单值
func replaceTaskAssetRefs(payload map[string]any, resolve func(string) (string, bool)) {
	replaceContentRefs(payload["content"], resolve)
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		return
	}
	replaceContentRefs(metadata["content"], resolve)
	for _, key := range []string{"image_url", "video_url", "audio_url"} {
		replaceMediaField(metadata, key, resolve)
	}
	for _, key := range []string{"image", "input_reference"} {
		if str, ok := metadata[key].(string); ok {
			if replaced, hit := resolve(str); hit {
				metadata[key] = replaced
			}
		}
	}
	if list, ok := metadata["images"].([]any); ok {
		for index, item := range list {
			if str, ok := item.(string); ok {
				if replaced, hit := resolve(str); hit {
					list[index] = replaced
				}
			}
		}
	}
}

// replaceContentRefs 处理 content 数组：元素的素材 URL 既可能是字符串，也可能是 {url: ...}。
func replaceContentRefs(node any, resolve func(string) (string, bool)) {
	items, ok := node.([]any)
	if !ok {
		return
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{"image_url", "video_url", "audio_url"} {
			replaceMediaField(item, key, resolve)
		}
	}
}

// replaceMediaField 改写单个素材字段的 URL。
func replaceMediaField(holder map[string]any, key string, resolve func(string) (string, bool)) {
	switch value := holder[key].(type) {
	case string:
		if replaced, hit := resolve(value); hit {
			holder[key] = replaced
		}
	case map[string]any:
		if url, ok := value["url"].(string); ok {
			if replaced, hit := resolve(url); hit {
				value["url"] = replaced
			}
		}
	}
}

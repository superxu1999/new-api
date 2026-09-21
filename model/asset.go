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
package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// 云端素材库的本地账本。素材实体（文件、转码、审核、真人活体认证）全部由上游渠道
// 托管，本地只保存映射与归属：
//   - 素材与素材组都绑定在「用户 + 渠道」上：上游的素材组是按渠道凭证隔离的，
//     换一条渠道后同一素材 ID 不可用，因此生成任务必须锁到素材所属的渠道。
//   - 真人素材组（LivenessFace）不能由本地创建，只能通过上游的 H5 活体认证流程产生。
const (
	AssetGroupTypeAIGC         = "AIGC"         // 虚拟人像素材组
	AssetGroupTypeLivenessFace = "LivenessFace" // 真人素材组（只能由真人认证产生）

	AssetStatusProcessing = "PROCESSING"
	AssetStatusActive     = "ACTIVE"
	AssetStatusFailed     = "FAILED"

	AssetTypeImage = "Image"
	AssetTypeVideo = "Video"
	AssetTypeAudio = "Audio"

	RealPersonStatusPending  = "pending"
	RealPersonStatusVerified = "verified"
)

// AssetGroup 是上游素材组在本地的一行映射。
type AssetGroup struct {
	Id              int64          `json:"id" gorm:"primaryKey"`
	UserId          int            `json:"user_id" gorm:"index"`
	ChannelId       int            `json:"channel_id" gorm:"index"`
	UpstreamGroupId string         `json:"upstream_group_id" gorm:"type:varchar(191);index"`
	GroupType       string         `json:"group_type" gorm:"type:varchar(32);index"`
	Name            string         `json:"name" gorm:"type:varchar(191)"`
	Description     string         `json:"description" gorm:"type:varchar(255)"`
	CreatedAt       int64          `json:"created_at" gorm:"index"`
	UpdatedAt       int64          `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `json:"-" gorm:"index"`
}

// Asset 是上游素材在本地的一行映射；文件本身不落在本站。
type Asset struct {
	Id              int64          `json:"id" gorm:"primaryKey"`
	UserId          int            `json:"user_id" gorm:"index"`
	ChannelId       int            `json:"channel_id" gorm:"index"`
	GroupId         int64          `json:"group_id" gorm:"index"`
	UpstreamGroupId string         `json:"upstream_group_id" gorm:"type:varchar(191);index"`
	UpstreamAssetId string         `json:"upstream_asset_id" gorm:"type:varchar(191);index"`
	Name            string         `json:"name" gorm:"type:varchar(191)"`
	AssetType       string         `json:"asset_type" gorm:"type:varchar(16)"`
	SourceUrl       string         `json:"source_url" gorm:"type:text"`
	// LocalKey 仅在「用户直接上传文件」时有值：本站暂存文件的随机文件名，
	// 通过 /asset-media/<LocalKey> 对外提供下载（上游也用它来抓取素材）。
	LocalKey   string         `json:"local_key" gorm:"type:varchar(191);index"`
	Status     string         `json:"status" gorm:"type:varchar(32);index"`
	FailReason      string         `json:"fail_reason" gorm:"type:varchar(255)"`
	CreatedAt       int64          `json:"created_at" gorm:"index"`
	UpdatedAt       int64          `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `json:"-" gorm:"index"`
}

// RealPersonSession 记录一次真人活体认证会话：上游返回 byted_token 与 H5 链接，
// 终端客户在手机上完成认证后，用 byted_token 换取真人素材组。
type RealPersonSession struct {
	Id         int64          `json:"id" gorm:"primaryKey"`
	UserId     int            `json:"user_id" gorm:"index"`
	ChannelId  int            `json:"channel_id" gorm:"index"`
	BytedToken string         `json:"-" gorm:"type:varchar(191);index"`
	H5Link     string         `json:"h5_link" gorm:"type:text"`
	GroupId    int64          `json:"group_id"`
	GroupType  string         `json:"group_type" gorm:"type:varchar(32)"`
	Status     string         `json:"status" gorm:"type:varchar(32);index"`
	ExpiresAt  int64          `json:"expires_at"`
	CreatedAt  int64          `json:"created_at" gorm:"index"`
	UpdatedAt  int64          `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `json:"-" gorm:"index"`
}

// AllowedAssetTypes 是上游素材类型白名单。
var AllowedAssetTypes = map[string]bool{
	AssetTypeImage: true,
	AssetTypeVideo: true,
	AssetTypeAudio: true,
}

func nowUnix() int64 {
	return time.Now().Unix()
}

// ============================
// 渠道解析
// ============================

// ListAssetCandidateChannelIds 按分组与模型返回候选渠道 id，按优先级降序、渠道 id 升序
// 排序 —— 素材必须绑在固定渠道上，所以这里要确定性顺序，不能用带随机/重试的选路函数。
func ListAssetCandidateChannelIds(group string, modelName string) ([]int, error) {
	if group == "" {
		return nil, errors.New("group is empty")
	}
	var ids []int
	query := DB.Model(&Ability{}).Where(commonGroupCol+" = ?", group).Where("enabled = ?", true)
	if modelName != "" {
		query = query.Where("model = ?", modelName)
	}
	err := query.Order("priority desc, channel_id asc").Pluck("channel_id", &ids).Error
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// ============================
// 素材组
// ============================

// ListAssetGroups 返回某用户在某渠道下的素材组，groupType 为空时不过滤。
func ListAssetGroups(userId int, channelId int, groupType string) ([]*AssetGroup, error) {
	var groups []*AssetGroup
	query := DB.Where("user_id = ?", userId)
	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}
	if groupType != "" {
		query = query.Where("group_type = ?", groupType)
	}
	err := query.Order("id desc").Find(&groups).Error
	return groups, err
}

// GetAssetGroupById 按本地 ID 取素材组，并校验归属。
func GetAssetGroupById(userId int, id int64) (*AssetGroup, error) {
	group := &AssetGroup{}
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(group).Error
	if err != nil {
		return nil, err
	}
	return group, nil
}

// GetAssetGroupByUpstream 按上游组 ID + 渠道取本地素材组（认证流程回填时会用）。
func GetAssetGroupByUpstream(channelId int, upstreamGroupId string) (*AssetGroup, bool, error) {
	if upstreamGroupId == "" {
		return nil, false, nil
	}
	group := &AssetGroup{}
	err := DB.Where("channel_id = ? AND upstream_group_id = ?", channelId, upstreamGroupId).First(group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return group, true, nil
}

// CreateAssetGroup 落一行本地素材组映射。
func CreateAssetGroup(group *AssetGroup) error {
	now := nowUnix()
	group.CreatedAt = now
	group.UpdatedAt = now
	return DB.Create(group).Error
}

// UpdateAssetGroup 更新名称与描述。
func UpdateAssetGroup(userId int, id int64, name string, description string) error {
	updates := map[string]any{"updated_at": nowUnix()}
	if name != "" {
		updates["name"] = name
	}
	if description != "" {
		updates["description"] = description
	}
	return DB.Model(&AssetGroup{}).Where("id = ? AND user_id = ?", id, userId).Updates(updates).Error
}

// DeleteAssetGroup 软删素材组。
func DeleteAssetGroup(userId int, id int64) error {
	return DB.Where("id = ? AND user_id = ?", id, userId).Delete(&AssetGroup{}).Error
}

// ============================
// 素材
// ============================

// ListAssets 返回素材列表，groupType 通过所属素材组过滤。
func ListAssets(userId int, channelId int, groupId int64, statuses []string, keyword string) ([]*Asset, error) {
	var assets []*Asset
	query := DB.Where("user_id = ?", userId)
	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}
	if groupId > 0 {
		query = query.Where("group_id = ?", groupId)
	}
	if len(statuses) > 0 {
		query = query.Where("status IN ?", statuses)
	}
	if keyword != "" {
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}
	err := query.Order("id desc").Find(&assets).Error
	return assets, err
}

// GetAssetById 按本地 ID 取素材，并校验归属。
func GetAssetById(userId int, id int64) (*Asset, error) {
	asset := &Asset{}
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(asset).Error
	if err != nil {
		return nil, err
	}
	return asset, nil
}

// CreateAsset 落一行本地素材映射。
func CreateAsset(asset *Asset) error {
	now := nowUnix()
	asset.CreatedAt = now
	asset.UpdatedAt = now
	return DB.Create(asset).Error
}

// UpdateAssetStatus 回写上游素材状态。
func UpdateAssetStatus(id int64, status string, failReason string) error {
	return DB.Model(&Asset{}).Where("id = ?", id).Updates(map[string]any{
		"status":      status,
		"fail_reason": failReason,
		"updated_at":  nowUnix(),
	}).Error
}

// UpdateAssetName 更新素材名称。
func UpdateAssetName(userId int, id int64, name string) error {
	return DB.Model(&Asset{}).Where("id = ? AND user_id = ?", id, userId).Updates(map[string]any{
		"name":       name,
		"updated_at": nowUnix(),
	}).Error
}

// DeleteAsset 软删素材。
func DeleteAsset(userId int, id int64) error {
	return DB.Where("id = ? AND user_id = ?", id, userId).Delete(&Asset{}).Error
}

// ============================
// 真人认证会话
// ============================

// CreateRealPersonSession 落一条认证会话。
func CreateRealPersonSession(session *RealPersonSession) error {
	now := nowUnix()
	session.CreatedAt = now
	session.UpdatedAt = now
	if session.Status == "" {
		session.Status = RealPersonStatusPending
	}
	return DB.Create(session).Error
}

// GetRealPersonSession 按本地 ID 取会话，并校验归属。
func GetRealPersonSession(userId int, id int64) (*RealPersonSession, error) {
	session := &RealPersonSession{}
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(session).Error
	if err != nil {
		return nil, err
	}
	return session, nil
}

// MarkRealPersonSessionVerified 记录认证成功并回填真人素材组。
func MarkRealPersonSessionVerified(id int64, groupId int64, groupType string) error {
	return DB.Model(&RealPersonSession{}).Where("id = ?", id).Updates(map[string]any{
		"status":     RealPersonStatusVerified,
		"group_id":   groupId,
		"group_type": groupType,
		"updated_at": nowUnix(),
	}).Error
}

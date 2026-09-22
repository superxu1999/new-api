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
export type AssetStatus = 'PROCESSING' | 'ACTIVE' | 'FAILED'

export type AssetType = 'Image' | 'Video' | 'Audio'

/** 素材组：本地只记录映射，实体在上游渠道。 */
export interface AssetGroup {
  id: number
  user_id: number
  channel_id: number
  upstream_group_id: string
  group_type: 'AIGC' | 'LivenessFace'
  name: string
  description: string
  created_at: number
}

/** 素材：文件托管在上游，本地保存归属与状态。 */
export interface Asset {
  id: number
  user_id: number
  channel_id: number
  group_id: number
  upstream_group_id: string
  upstream_asset_id: string
  name: string
  asset_type: AssetType
  source_url: string
  /** 直传素材在本站的暂存文件名（公网 URL 方式入库时为空） */
  local_key: string
  status: AssetStatus
  fail_reason: string
  created_at: number
}

/** 真人认证会话：h5_link 交给真人在手机上完成活体认证。 */
export interface RealPersonSession {
  session_id: number
  h5_link: string
  /** 本站短链（二维码编码用），未返回时退回 h5_link */
  short_link?: string
  expires_at: number
  status: string
  group_id: number
  message?: string
}

/** 真人认证历史行：列表接口返回的是会话记录本身。 */
export interface RealPersonSessionRow {
  id: number
  channel_id: number
  short_code: string
  h5_link: string
  group_id: number
  group_type: string
  status: string
  expires_at: number
  created_at: number
}

/** 素材列表结果：列表接口带分页信息。 */
export interface AssetListResult {
  items: Asset[]
  total: number
  page: number
  page_size: number
}

/** 账号素材能力：开关状态 + 可用于素材的渠道与模型。 */
export interface AssetCapabilities {
  asset_library_enabled: boolean
  asset_upload_enabled: boolean
  channels: {
    channel_id: number
    channel_name?: string
    models?: string[]
  }[]
  models: string[]
  real_person_available: boolean
}

export interface CreateAssetPayload {
  group_id: number
  name: string
  url: string
  asset_type: AssetType
}

/** 直传：文件走 multipart，其余参数与公网 URL 方式一致。 */
export interface UploadAssetPayload {
  file: File
  name: string
  groupId: number
}

export interface CreateAssetGroupPayload {
  name: string
  description?: string
}

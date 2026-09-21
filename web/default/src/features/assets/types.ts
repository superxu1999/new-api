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
  expires_at: number
  status: string
  group_id: number
  message?: string
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

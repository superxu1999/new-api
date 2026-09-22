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
import { api } from '@/lib/api'

import type {
  Asset,
  AssetCapabilities,
  AssetGroup,
  AssetListResult,
  CreateAssetGroupPayload,
  CreateAssetPayload,
  RealPersonSession,
  RealPersonSessionRow,
  UploadAssetPayload,
} from './types'

// 素材接口的错误由调用方统一 toast（带后端 code/message），这里关掉全局错误提示，
// 否则同一次失败会弹两个 toast。
const NO_GLOBAL_TOAST = { skipErrorHandler: true }

/** 后端错误体：{ error: { message, code } }；403/asset_library_disabled 表示未开通权限。 */
export function extractAssetError(error: unknown): {
  message: string
  code: string
} {
  const fallback = { message: 'Request failed', code: '' }
  if (!error || typeof error !== 'object') return fallback
  const response = (error as { response?: { data?: unknown } }).response
  if (!response || !response.data || typeof response.data !== 'object') {
    return fallback
  }
  const body = response.data as { error?: { message?: string; code?: string } }
  if (!body.error) return fallback
  return {
    message: body.error.message ?? fallback.message,
    code: body.error.code ?? '',
  }
}

export async function listAssetGroups(): Promise<AssetGroup[]> {
  const res = await api.get('/v1/assets/groups', NO_GLOBAL_TOAST)
  return (res.data?.data ?? []) as AssetGroup[]
}

export async function createAssetGroup(
  payload: CreateAssetGroupPayload
): Promise<AssetGroup> {
  const res = await api.post('/v1/assets/groups', payload, NO_GLOBAL_TOAST)
  return res.data?.data as AssetGroup
}

export async function deleteAssetGroup(id: number): Promise<void> {
  await api.delete(`/v1/assets/groups/${id}`, NO_GLOBAL_TOAST)
}

/** 更新素材组名称/描述（空值表示不改）。 */
export async function updateAssetGroup(
  id: number,
  payload: { name?: string; description?: string }
): Promise<AssetGroup> {
  const res = await api.put(`/v1/assets/groups/${id}`, payload, NO_GLOBAL_TOAST)
  return res.data?.data as AssetGroup
}

export interface ListAssetsParams {
  groupId?: number
  assetType?: string
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}

/** 素材列表：本站登记数据，支持按素材组/类型/状态/名称筛选与分页。 */
export async function listAssets(
  params: ListAssetsParams = {}
): Promise<AssetListResult> {
  const res = await api.get('/v1/assets', {
    ...NO_GLOBAL_TOAST,
    params: {
      group_id: params.groupId && params.groupId > 0 ? params.groupId : undefined,
      asset_type: params.assetType || undefined,
      status: params.status || undefined,
      keyword: params.keyword || undefined,
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
    },
  })
  const body = res.data ?? {}
  return {
    items: (body.data ?? []) as Asset[],
    total: Number(body.total ?? 0),
    page: Number(body.page ?? 1),
    page_size: Number(body.page_size ?? 20),
  }
}

export async function createAsset(
  payload: CreateAssetPayload
): Promise<Asset> {
  const res = await api.post('/v1/assets', payload, NO_GLOBAL_TOAST)
  return res.data?.data as Asset
}

export async function getAsset(id: number): Promise<Asset> {
  const res = await api.get(`/v1/assets/${id}`, NO_GLOBAL_TOAST)
  return res.data?.data as Asset
}

export async function deleteAsset(id: number): Promise<void> {
  await api.delete(`/v1/assets/${id}`, NO_GLOBAL_TOAST)
}

/** 重命名素材（上游只支持改名称）。 */
export async function updateAsset(
  id: number,
  payload: { name: string }
): Promise<Asset> {
  const res = await api.put(`/v1/assets/${id}`, payload, NO_GLOBAL_TOAST)
  return res.data?.data as Asset
}

/** 账号素材能力：用于回答「我能不能用素材、哪些模型支持素材」。 */
export async function getAssetCapabilities(): Promise<AssetCapabilities> {
  const res = await api.get('/v1/assets/capabilities', NO_GLOBAL_TOAST)
  return res.data?.data as AssetCapabilities
}

/** 真人认证历史（最近的在前）。 */
export async function listRealPersonSessions(): Promise<RealPersonSessionRow[]> {
  const res = await api.get(
    '/v1/assets/real-person/sessions',
    NO_GLOBAL_TOAST
  )
  return (res.data?.data ?? []) as RealPersonSessionRow[]
}

export async function createRealPersonSession(): Promise<RealPersonSession> {
  const res = await api.post('/v1/assets/real-person/sessions', {}, NO_GLOBAL_TOAST)
  return res.data?.data as RealPersonSession
}

export async function getRealPersonSession(
  id: number
): Promise<RealPersonSession> {
  const res = await api.get(
    `/v1/assets/real-person/sessions/${id}`,
    NO_GLOBAL_TOAST
  )
  return res.data?.data as RealPersonSession
}

/**
 * 直接上传本地文件：先交给本站暂存，再由本站把该文件的公网地址交给上游入库。
 * 该能力默认关闭，需要管理员给账号开通（未开通时后端返回 403 asset_upload_disabled）。
 */
export async function uploadAsset(
  payload: UploadAssetPayload
): Promise<Asset> {
  const form = new FormData()
  form.append('file', payload.file)
  form.append('name', payload.name)
  if (payload.groupId > 0) {
    form.append('group_id', String(payload.groupId))
  }
  if (payload.channelId && payload.channelId > 0) {
    form.append('channel_id', String(payload.channelId))
  }
  const res = await api.post('/v1/assets/upload', form, NO_GLOBAL_TOAST)
  return res.data?.data as Asset
}

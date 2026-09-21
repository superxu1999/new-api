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
  AssetGroup,
  CreateAssetGroupPayload,
  CreateAssetPayload,
  RealPersonSession,
} from './types'

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
  const res = await api.get('/v1/assets/groups')
  return (res.data?.data ?? []) as AssetGroup[]
}

export async function createAssetGroup(
  payload: CreateAssetGroupPayload
): Promise<AssetGroup> {
  const res = await api.post('/v1/assets/groups', payload)
  return res.data?.data as AssetGroup
}

export async function deleteAssetGroup(id: number): Promise<void> {
  await api.delete(`/v1/assets/groups/${id}`)
}

export async function listAssets(): Promise<Asset[]> {
  const res = await api.get('/v1/assets')
  return (res.data?.data ?? []) as Asset[]
}

export async function createAsset(
  payload: CreateAssetPayload
): Promise<Asset> {
  const res = await api.post('/v1/assets', payload)
  return res.data?.data as Asset
}

export async function getAsset(id: number): Promise<Asset> {
  const res = await api.get(`/v1/assets/${id}`)
  return res.data?.data as Asset
}

export async function deleteAsset(id: number): Promise<void> {
  await api.delete(`/v1/assets/${id}`)
}

export async function createRealPersonSession(): Promise<RealPersonSession> {
  const res = await api.post('/v1/assets/real-person/sessions', {})
  return res.data?.data as RealPersonSession
}

export async function getRealPersonSession(
  id: number
): Promise<RealPersonSession> {
  const res = await api.get(`/v1/assets/real-person/sessions/${id}`)
  return res.data?.data as RealPersonSession
}

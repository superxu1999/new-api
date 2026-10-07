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
import type { Asset } from '@/features/assets/types'

/**
 * 素材预览地址：直传素材走本站暂存（/asset-media），公网素材直接用其来源地址。
 * 取不到时返回空串，调用方据此退化成类型占位图。
 */
export function assetPreviewUrl(asset: Asset): string {
  if (asset.local_key) {
    return `/asset-media/${asset.local_key}`
  }
  return asset.source_url || ''
}

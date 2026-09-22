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
import { ROLE } from '@/lib/roles'
import type { AuthUser } from '@/stores/auth-store'

/**
 * 素材库与直传是账号级权限：管理员及以上始终可用，普通用户由管理端在用户配置里开通。
 *
 * 这里只决定界面是否显示对应入口，接口始终会再校验一次（素材库未开通返回 403
 * asset_library_disabled，直传未开通返回 403 asset_upload_disabled）。字段缺失
 * （升级前写入的本地会话缓存）时按可用处理，避免把已开通的账号挡在外面。
 */
export function canUseAssetLibrary(user?: Partial<AuthUser> | null): boolean {
  if (!user) return false
  if ((user.role ?? 0) >= ROLE.ADMIN) return true
  return user.asset_library_enabled !== 0
}

/** 直传是素材库的子能力：显示上传入口还要求账号已开通直传。 */
export function canUploadAsset(user?: Partial<AuthUser> | null): boolean {
  if (!user) return false
  if ((user.role ?? 0) >= ROLE.ADMIN) return true
  return user.asset_upload_enabled !== 0
}

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
import { z } from 'zod'

import {
  type PermissionCatalog,
  type AdminPermissionMatrix,
  normalizeAdminPermissions,
} from '@/lib/admin-permissions'
import { quotaUnitsToDollars } from '@/lib/format'
import { ROLE } from '@/lib/roles'

import { DEFAULT_GROUP } from '../constants'
import { type UserFormData, type User } from '../types'

// ============================================================================
// Form Schema
// ============================================================================

export const userFormSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  display_name: z.string().optional(),
  password: z.string().optional(),
  role: z.number().optional(),
  quota_dollars: z.number().min(0).optional(),
  group: z.string().optional(),
  remark: z.string().optional(),
  admin_permissions: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
  // 云端素材库使用权限（0 关闭 / 1 开启），仅超级管理员可改
  asset_library_enabled: z.number().optional(),
  // 素材库直接上传权限（0 关闭 / 1 开启），仅超级管理员可改
  asset_upload_enabled: z.number().optional(),
})

export type UserFormValues = z.infer<typeof userFormSchema>

// ============================================================================
// Form Defaults
// ============================================================================

export const USER_FORM_DEFAULT_VALUES: UserFormValues = {
  username: '',
  display_name: '',
  password: '',
  role: 1, // Default to common user
  quota_dollars: 0,
  group: DEFAULT_GROUP,
  remark: '',
  // Filled against the backend catalog at render time; see UsersMutateDrawer.
  admin_permissions: {},
  asset_library_enabled: 0,
  asset_upload_enabled: 0,
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: UserFormValues,
  userId?: number,
  catalog?: PermissionCatalog
): UserFormData & { id?: number } {
  const payload: UserFormData & { id?: number } = {
    username: data.username,
    display_name: data.display_name || data.username,
    password: data.password || undefined,
  }

  const role = userId === undefined ? data.role || 1 : (data.role ?? 0)

  // Only send the permission matrix when the target is an admin and the catalog
  // is available; without the catalog we cannot build a full matrix, so we omit
  // the field (the backend then leaves existing permissions untouched).
  if (role >= ROLE.ADMIN && catalog) {
    payload.admin_permissions = normalizeAdminPermissions(
      data.admin_permissions as AdminPermissionMatrix | undefined,
      catalog
    )
  }

  // For create: only send required fields
  if (userId === undefined) {
    payload.role = role
  } else {
    // For update: quota is adjusted atomically via /api/user/manage, not sent here
    payload.group = data.group
    payload.remark = data.remark || undefined
    payload.asset_library_enabled = data.asset_library_enabled ? 1 : 0
    payload.asset_upload_enabled = data.asset_upload_enabled ? 1 : 0
    payload.id = userId
  }

  return payload
}

/**
 * Transform user data to form defaults. The admin permission matrix is passed
 * through as-is (the backend already returns a full matrix); it is filled against
 * the catalog at render time in UsersMutateDrawer.
 */
export function transformUserToFormDefaults(user: User): UserFormValues {
  return {
    username: user.username,
    display_name: user.display_name,
    // 后端在管理端详情接口里解密回显当前密码；未启用可逆存储或历史数据时为空串。
    password: user.password_plain ?? '',
    role: user.role,
    quota_dollars: quotaUnitsToDollars(user.quota),
    group: user.group || DEFAULT_GROUP,
    remark: user.remark || '',
    admin_permissions: user.admin_permissions ?? {},
    asset_library_enabled: user.asset_library_enabled ?? 0,
    asset_upload_enabled: user.asset_upload_enabled ?? 0,
  }
}

// ============================================================================
// Credential Generation
// ============================================================================

// 去掉 0/O/o、1/l/I 等易混字符：生成的凭据要能口头转交或手抄。
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
// 用户名随机段只用小写字母与数字，不含下划线，便于口头转述。
const USERNAME_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

function randomString(length: number, alphabet: string): string {
  const randomValues = new Uint32Array(length)
  crypto.getRandomValues(randomValues)
  let result = ''
  for (const value of randomValues) {
    result += alphabet[value % alphabet.length]
  }
  return result
}

// 后端对密码有 validate:"min=8,max=20" 的硬约束；默认取 10 位，比下限多留一点强度。
const DEFAULT_PASSWORD_LENGTH = 10
// 用户名随机段长度：32^6 ≈ 1.07e9，千级用户量下碰撞概率约万分之五，再短就会明显容易撞名。
const USERNAME_SUFFIX_LENGTH = 6

/**
 * 生成一个随机初始密码（默认 10 位，落在后端的 8-20 位区间内）。
 *
 * 保存后可在「编辑用户」里回显：后端既存 bcrypt 哈希（登录校验），
 * 也存一份可解密副本（仅管理端详情接口返回）。
 */
export function generateRandomPassword(
  length = DEFAULT_PASSWORD_LENGTH
): string {
  return randomString(length, PASSWORD_ALPHABET)
}

/**
 * 生成一个随机用户名（`user_` + 6 位，共 11 位，满足后端 max=20 的长度限制）。
 *
 * 唯一性由后端的唯一索引兜底：撞名时接口会返回唯一约束错误，重新生成一次即可。
 */
export function generateRandomUsername(): string {
  return `user_${randomString(USERNAME_SUFFIX_LENGTH, USERNAME_ALPHABET)}`
}

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
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/**
 * 链接是否只有电脑本机可访问。
 *
 * 回环地址在手机上指向手机自己，扫码后必然打不开；此时二维码应改用上游认证链接
 * （上游页面是公网地址，手机可直接打开）。无法解析的链接按不可用处理。
 */
export function isLoopbackLink(link: string): boolean {
  if (link === '') return false
  try {
    return LOOPBACK_HOSTS.has(new URL(link).hostname.toLowerCase())
  } catch {
    return true
  }
}

/** 真人认证状态：已通过绿、已取消红、待完成灰。 */
export function realPersonStatusVariant(status: string) {
  if (status === 'verified') return 'default' as const
  if (status === 'cancelled') return 'destructive' as const
  return 'secondary' as const
}

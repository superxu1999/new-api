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
import type { TaskLog } from '../types'

/** 兼容对象/字符串，尝试解析成 JS 对象；失败返回 null。 */
export function toObj(raw: unknown): Record<string, unknown> | null {
  if (raw != null && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed != null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return null
}

/** 把各种值格式化成 pretty 字符串（兼容对象/字符串）。 */
export function toPretty(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

/**
 * 提取「请求入参」。请求体通常在上游返回 data 的 data.properties.input 里
 * （上游会把我们的请求回显一遍），部分任务也在顶层 properties.input。
 * 优先从 data 提取，其次顶层 properties。
 */
export function extractRequestInput(
  properties?: unknown,
  data?: unknown
): string {
  const fromData = extractInputFromNested(data)
  if (fromData) return fromData

  if (properties != null) {
    const obj = toObj(properties)
    if (obj != null) {
      const input = obj.input
      if (input != null) {
        const pretty = toPretty(input)
        if (pretty) return pretty
      }
    }
  }
  return ''
}

/** 在上游返回 data 里找请求入参 input（逐层往 data 子层钻）。 */
function extractInputFromNested(data: unknown): string {
  let cur: unknown = data
  for (let i = 0; i < 5; i++) {
    const obj = toObj(cur)
    if (obj == null) return ''
    if (obj.input != null) {
      const p = toPretty(obj.input)
      if (p) return p
    }
    const props = toObj(obj.properties)
    if (props?.input != null) {
      const p = toPretty(props.input)
      if (p) return p
    }
    cur = obj.data
    if (cur == null) return ''
  }
  return ''
}

/**
 * 提示词长度。上游回显的 input 有两种形态：
 *  - 转义后的请求体 JSON（如 CyAI）→ 解析后取 prompt / content 文本的长度
 *  - 纯提示词文本（如 Foxtoken）→ 直接取字符串长度
 * 取错形态会把整个 JSON 的长度当成提示词长度，所以必须区分。
 */
export function extractTaskPromptLength(log: TaskLog): number | null {
  const input = extractRequestInput(log.properties, log.data).trim()
  if (!input) return null

  if (input.startsWith('{')) {
    const body = toObj(input)
    if (body == null) return input.length
    if (typeof body.prompt === 'string') return body.prompt.length
    if (Array.isArray(body.content)) {
      const text = body.content
        .map((item) => {
          const obj = toObj(item)
          return typeof obj?.text === 'string' ? obj.text : ''
        })
        .join('')
      if (text) return text.length
    }
    return null
  }
  return input.length
}

/** 上游身份字段：会暴露供应方（如 group「火山原生」、上游的渠道与用户 ID）。 */
const UPSTREAM_IDENTITY_FIELDS = [
  'group',
  'channel_id',
  'user_id',
  'platform',
  'id',
]

/**
 * 展示给普通用户的上游返回：删掉供应方身份字段，保留对排查有用的部分
 * （provider 原始响应仍在该层级的 data 里、请求回显、失败原因等）。
 */
export function sanitizeUpstreamResponse(raw: string): string {
  if (!raw) return raw
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  const root = toObj(parsed)
  if (root == null) return raw
  const data = toObj(root.data)
  if (data != null) {
    for (const key of UPSTREAM_IDENTITY_FIELDS) {
      delete data[key]
    }
  }
  return JSON.stringify(root, null, 2)
}

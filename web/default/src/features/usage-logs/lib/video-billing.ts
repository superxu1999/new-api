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

/**
 * seedance 视频计费的中间量，由后端在日志 other 字段的 video_billing 中记录
 * （见 relay/channel/task/taskcommon.SeedanceBillingDetail）。
 */
export type VideoBillingDetail = {
  /** 分档单价（元/百万 token） */
  tierPrice: number
  /** 官方 token 公式算出的计费用量 */
  token: number
  /** 模型计费倍率（1.0 = 原价） */
  multiplier: number
  /** 输出分辨率档（720p/1080p/4k…） */
  resolution: string
  /** 请求是否包含参考视频 */
  hasInputVideo: boolean
  /** 输出时长（秒） */
  seconds: number | null
}

function asObject(raw: unknown): Record<string, unknown> | null {
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

/** 兼容数字/数字字符串，转成 number；失败返回 null。 */
export function toNum(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * 从日志的 other 字段解析后端记录的 seedance 计费明细。
 * 非 seedance 视频任务（或旧日志）返回 null。
 */
export function extractVideoBilling(other: unknown): VideoBillingDetail | null {
  const otherObj = asObject(other)
  const vb = asObject(otherObj?.video_billing)
  if (!vb) return null

  const tierPrice = toNum(vb.tier_price)
  const token = toNum(vb.token)
  if (tierPrice == null || token == null || tierPrice <= 0 || token <= 0) {
    return null
  }

  return {
    tierPrice,
    token,
    multiplier: toNum(vb.multiplier) ?? 1,
    resolution: typeof vb.resolution === 'string' ? vb.resolution : '',
    hasInputVideo: vb.has_input_video === true,
    seconds: toNum(vb.seconds),
  }
}
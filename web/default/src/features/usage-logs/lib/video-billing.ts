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
 * 解析一个 { tier_price, token, multiplier, resolution, has_input_video, seconds }
 * 形态的计费明细对象（日志 other.video_billing，或任务 DTO 的 video_billing 快照）。
 */
export function extractVideoBillingDetail(
  raw: unknown
): VideoBillingDetail | null {
  const vb = asObject(raw)
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

/**
 * 从日志的 other 字段解析后端记录的 seedance 计费明细。
 * 非 seedance 视频任务（或旧日志）返回 null。
 */
export function extractVideoBilling(other: unknown): VideoBillingDetail | null {
  const otherObj = asObject(other)
  return extractVideoBillingDetail(otherObj?.video_billing)
}

/**
 * 任务日志（TaskDto）的预扣 / 实付额度。后端直接给出 pre_consumed_quota 与
 * quota（quota 已是差额结算后的最终额度），无需先扣再算。
 */
export function extractTaskSettlement(
  preConsumed: unknown,
  settled: unknown
): VideoSettlement | null {
  const pre = toNum(preConsumed)
  const actual = toNum(settled)
  if (pre == null || actual == null) return null
  if (pre <= 0 || actual <= 0) return null
  return { preConsumedQuota: pre, actualQuota: actual, deltaQuota: actual - pre }
}

/**
 * 视频任务完成后的差额结算信息，由后端写入「视频token重算」日志的 other
 * （见 service.RecalculateTaskQuota）。
 */
export type VideoSettlement = {
  /** 提交时预扣的额度 */
  preConsumedQuota: number
  /** 按上游真实 token 结算后的额度 */
  actualQuota: number
  /** 实际 − 预扣：正数表示补扣，负数表示退款 */
  deltaQuota: number
}

/** 从日志的 other 字段解析视频差额结算信息；非重算日志返回 null。 */
export function extractVideoSettlement(other: unknown): VideoSettlement | null {
  const otherObj = asObject(other)
  if (!otherObj) return null

  const preConsumedQuota = toNum(otherObj.pre_consumed_quota)
  const actualQuota = toNum(otherObj.actual_quota)
  if (preConsumedQuota == null || actualQuota == null) return null
  if (preConsumedQuota <= 0 || actualQuota <= 0) return null

  return {
    preConsumedQuota,
    actualQuota,
    deltaQuota: actualQuota - preConsumedQuota,
  }
}

/**
 * 判断是否为视频 token 公式计费的日志。预扣日志的 video_billing 是明细对象，
 * 重算日志的 video_billing 是计费倍率数字，两种都必须按视频口径展示，
 * 否则会落到通用的「输入/输出价格」分支——那些基于 ModelRatio 的单价对视频是误导。
 */
export function isVideoBillingLog(other: unknown): boolean {
  return asObject(other)?.video_billing != null
}
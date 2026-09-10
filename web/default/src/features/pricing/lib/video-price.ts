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
import type { VideoBilling } from '../types'

/** 档位键的展示顺序，与后端 operation_setting.SeedanceTierKeys 保持一致。 */
export const VIDEO_TIER_KEYS = [
  'no_720p',
  'with_720p',
  'no_1080p',
  'with_1080p',
  'no_4k',
  'with_4k',
] as const

/** 档位键 → 分辨率标签（480p 与 720p 同价，合并展示）。 */
const TIER_RESOLUTION: Record<string, string> = {
  no_720p: '480p/720p',
  with_720p: '480p/720p',
  no_1080p: '1080p',
  with_1080p: '1080p',
  no_4k: '4k',
  with_4k: '4k',
}

export type VideoTierRow = {
  key: string
  resolution: string
  withVideo: boolean
  /** 元/百万 token */
  price: number
}

/** 视频模型的最低价档（480p/720p 不含参考视频）单价，用作卡片「起价」。 */
export function videoBasePrice(video: VideoBilling): number | null {
  const price = video?.tier_prices?.no_720p
  return typeof price === 'number' && price > 0 ? price : null
}

/** 按档位顺序返回已配置的档位，供定价表渲染。 */
export function videoTierRows(video: VideoBilling): VideoTierRow[] {
  return VIDEO_TIER_KEYS.filter((key) => {
    const price = video?.tier_prices?.[key]
    return typeof price === 'number' && price > 0
  }).map((key) => ({
    key,
    resolution: TIER_RESOLUTION[key] ?? key,
    withVideo: key.startsWith('with_'),
    price: video.tier_prices[key],
  }))
}

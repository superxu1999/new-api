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
import type { VideoModelCapability } from './api'

/** 视频生成的参数取值。空串表示不传（由上游用默认值），duration 的 -1 表示自动。 */
export interface VideoParams {
  duration: string
  ratio: string
  resolution: string
  generateAudio: boolean
  watermark: boolean
  seed: string
}

export const EMPTY_VIDEO_PARAMS: VideoParams = {
  duration: '',
  ratio: '',
  resolution: '',
  generateAudio: true,
  watermark: false,
  seed: '',
}

/** 时长选项：能力声明的 [min,max] 区间，支持时带上 -1（自动）。 */
export function durationOptionsFor(
  capability?: VideoModelCapability
): number[] {
  if (!capability || capability.duration.max <= 0) {
    return []
  }
  const options: number[] = []
  if (capability.duration.allow_auto) {
    options.push(-1)
  }
  for (let second = capability.duration.min; second <= capability.duration.max; second += 1) {
    options.push(second)
  }
  return options
}

/** 常用时长档：从能力区间里挑出少数代表值做快捷按钮，避免下拉渲染几十个选项。 */
const DURATION_PRESET_CANDIDATES = [4, 5, 6, 8, 10, 12, 15, 20, 30]

/**
 * 时长快捷档：取能力区间 [min,max] 与常用档的交集；保证 min、max 总在里头
 * （它们是边界，用户最常点的就是最短/最长）。返回不含 -1（自动单独成一个档）。
 */
export function durationPresetsFor(
  capability?: VideoModelCapability
): number[] {
  if (!capability || capability.duration.max <= 0) {
    return []
  }
  const { min, max } = capability.duration
  const inRange = DURATION_PRESET_CANDIDATES.filter(
    (second) => second >= min && second <= max
  )
  const presets = new Set<number>([min, max, ...inRange])
  return [...presets].sort((a, b) => a - b)
}

/** 校验一个时长值是否落在能力区间内（数字输入用）；空串与 -1（若允许自动）也合法。 */
export function isDurationValid(
  value: string,
  capability?: VideoModelCapability
): boolean {
  if (!capability || value === '') {
    return true
  }
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return false
  }
  if (num === -1) {
    return capability.duration.allow_auto
  }
  return num >= capability.duration.min && num <= capability.duration.max
}

/** 模型切换后把不在新选项里的取值清掉，避免把上一个模型的参数带过去。 */
export function normalizeParamsForModel(
  params: VideoParams,
  capability?: VideoModelCapability
): VideoParams {
  if (!capability) {
    return { ...EMPTY_VIDEO_PARAMS }
  }
  const durations = durationOptionsFor(capability)
  const duration =
    params.duration !== '' && durations.includes(Number(params.duration))
      ? params.duration
      : ''
  const resolution = capability.resolutions.includes(params.resolution)
    ? params.resolution
    : ''
  const ratio = capability.ratios.includes(params.ratio) ? params.ratio : ''
  return {
    duration,
    resolution,
    ratio,
    generateAudio: capability.supports_audio ? params.generateAudio : false,
    watermark: capability.supports_watermark ? params.watermark : false,
    seed: capability.supports_seed ? params.seed : '',
  }
}

/**
 * 参数 → 任务请求体。
 *
 * 与老游乐场页保持同一套约定：时长走顶层 `duration`，其余走 `metadata`，
 * 由适配器透传给上游。
 */
export function buildVideoRequestBody(
  model: string,
  prompt: string,
  params: VideoParams,
  capability?: VideoModelCapability
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt }
  const metadata: Record<string, unknown> = {}

  const seconds = Number(params.duration)
  if (params.duration !== '' && Number.isFinite(seconds) && seconds !== 0) {
    body.duration = seconds
  }
  if (params.ratio) {
    metadata.ratio = params.ratio
  }
  if (params.resolution) {
    metadata.resolution = params.resolution
  }
  if (params.seed !== '' && Number.isFinite(Number(params.seed))) {
    metadata.seed = Math.trunc(Number(params.seed))
  }
  if (capability?.supports_watermark) {
    metadata.watermark = params.watermark
  }
  if (capability?.supports_audio) {
    metadata.generate_audio = params.generateAudio
  }
  // 尾帧：只有上游确实会返回尾帧的渠道才请求这个字段（能力声明里 returns_last_frame）。
  // 不请求的话「取尾帧续拍」永远拿不到尾帧；对不支持的渠道乱发该字段则可能被上游拒绝。
  // 该字段走顶层，由后端 normalizeReturnLastFrame 并入 metadata。
  if (capability?.returns_last_frame) {
    body.return_last_frame = true
  }
  if (Object.keys(metadata).length > 0) {
    body.metadata = metadata
  }
  return body
}

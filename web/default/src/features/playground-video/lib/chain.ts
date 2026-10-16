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
import type { TrayItem } from './capability'
import { EMPTY_VIDEO_PARAMS, type VideoParams } from './params'

/**
 * 连拍（自动续拍）的领域模型。
 *
 * 连拍 = 把上一段成片的尾帧当作下一段的首帧，一段接一段自动跑完。
 * 每一段都是一次真实的收费任务，所以段数必须有明确上界；跑的过程中任何一步
 * 不符合预期（上游没给尾帧、登记素材失败、某段失败）都要停下来并把原因摆到界面上，
 * 绝不静默降级成「用整段视频当参考」继续扣费。
 */
export const MIN_CHAIN_SEGMENTS = 2

/** 连拍段数上限：每一段都会真实计费，6 段已经是一次很长的连续镜头。 */
export const MAX_CHAIN_SEGMENTS = 6

export type ChainSegmentStatus = 'pending' | 'running' | 'success' | 'failed'

export interface ChainSegment {
  /** 1 起始的段号（展示用，不用数组下标，避免中途改段数导致文案错位）。 */
  index: number
  prompt: string
  /** 该段对应的任务 ID；尚未提交时为空串。 */
  taskId: string
  status: ChainSegmentStatus
  /** 失败原因（上游原文），仅失败段展示。 */
  failReason?: string
}

/**
 * running  = 正在推进（提交或等待中）
 * paused   = 上次刷新/关页时中断，等用户决定是否接着跑（不在无人看管时继续扣费）
 * done     = 所有段都成功
 * failed   = 某一段失败或链路断了，已停止
 * canceled = 用户主动停止
 */
export type ChainStatus = 'running' | 'paused' | 'done' | 'failed' | 'canceled'

/**
 * 衔接方式。
 *
 * last_frame      上一段尾帧 → 下一段首帧。画面最连贯（同机位、同光线），但只有
 *                  声明 ReturnsLastFrame 的渠道（多为火山官方）能做到，中转渠道拿不到。
 * reference_video 上一段成片 → 下一段参考视频。成片 URL 是公网可拉的，上游都能收；
 *                  代价是它是一段被重新编码的视频而非一帧，运动连续性不如尾帧，
 *                  而且会触发「含视频输入」的计费档。
 *
 * 两者都是「上一段的产物喂给下一段」，但语义与代价不同，所以让用户显式选，
 * 不做静默降级——降级会让人以为拿到了尾帧级连续性。
 */
export type ChainLinkMode = 'last_frame' | 'reference_video'

/** 面向用户的原因：key 是 i18n 文案，由界面用 t() 渲染，这里不做文案拼接。 */
export interface ChainReason {
  key: string
  params?: Record<string, unknown>
}

export interface VideoChain {
  id: string
  model: string
  params: VideoParams
  /** 链式首帧之外的托盘素材，每一段都带上。 */
  baseItems: TrayItem[]
  /**
   * 上一段换来的衔接素材；第一段为空。持久化下来，刷新后续跑不用重复登记素材。
   * 字段名不写死「首帧」：成片续接模式下它是参考视频。
   */
  linkItem?: TrayItem
  /** 衔接方式：尾帧续接（画面最连续）还是成片续接（不依赖尾帧，但有损）。 */
  linkMode: ChainLinkMode
  segments: ChainSegment[]
  status: ChainStatus
  reason?: ChainReason
  createdAt: number
}

/** 已跑完的段数（成功或失败都算「不再需要等」）。 */
export function chainProgress(chain: VideoChain): {
  done: number
  succeeded: number
  total: number
} {
  let succeeded = 0
  let done = 0
  for (const segment of chain.segments) {
    if (segment.status === 'success') {
      succeeded += 1
      done += 1
    } else if (segment.status === 'failed') {
      done += 1
    }
  }
  return { done, succeeded, total: chain.segments.length }
}

/** 连拍是否还在推进（正在跑或等用户决定续跑）。 */
export function isChainActive(chain: VideoChain | null): boolean {
  return chain !== null && (chain.status === 'running' || chain.status === 'paused')
}

/** 用补丁更新某一段，返回新对象（链上其它段原样保留）。 */
export function patchSegment(
  chain: VideoChain,
  index: number,
  patch: Partial<ChainSegment>
): VideoChain {
  return {
    ...chain,
    segments: chain.segments.map((segment) =>
      segment.index === index ? { ...segment, ...patch } : segment
    ),
  }
}

/** 按提示词列表建一条连拍链。 */
export function createChain(input: {
  model: string
  params: VideoParams
  baseItems: TrayItem[]
  prompts: string[]
  linkMode: ChainLinkMode
}): VideoChain {
  return {
    id: `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    model: input.model,
    params: input.params,
    baseItems: input.baseItems,
    linkMode: input.linkMode,
    segments: input.prompts.map((prompt, position) => ({
      index: position + 1,
      prompt,
      taskId: '',
      status: 'pending',
    })),
    status: 'running',
    createdAt: Math.floor(Date.now() / 1000),
  }
}

const CHAIN_KEY = 'playground_video_chain'

/**
 * 连拍状态只存 localStorage：它是「这台浏览器上正在跑的编排进度」，不涉及跨端同步。
 * 存下来的意义是刷新/误关页面后能看清跑到哪了，并且可以接着跑，而不是从第一段重扣一次钱。
 */
export function loadChain(): VideoChain | null {
  try {
    const raw = window.localStorage.getItem(CHAIN_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<VideoChain> | null
    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
      return null
    }
    // 旧持久化数据把衔接素材记在 firstFrame 下，读时兼容；linkMode 缺失的老链
    // 按尾帧续接解读（它本来就是尾帧链跑出来的）。
    const legacy = parsed as Partial<VideoChain> & { firstFrame?: TrayItem }
    return {
      id: typeof parsed.id === 'string' ? parsed.id : `chain-${Date.now()}`,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      params: { ...EMPTY_VIDEO_PARAMS, ...parsed.params },
      baseItems: Array.isArray(parsed.baseItems) ? parsed.baseItems : [],
      // 旧持久化数据里衔接素材记在 firstFrame 下；缺 linkMode 的老链一律按尾帧续接解读
      // （它本来就是尾帧链跑出来的），不该被当成成片续接。
      linkItem: parsed.linkItem ?? legacy.firstFrame,
      linkMode: parsed.linkMode === 'reference_video' ? 'reference_video' : 'last_frame',
      segments: parsed.segments.map((segment, position) => ({
        index: typeof segment.index === 'number' ? segment.index : position + 1,
        prompt: typeof segment.prompt === 'string' ? segment.prompt : '',
        taskId: typeof segment.taskId === 'string' ? segment.taskId : '',
        status: segment.status ?? 'pending',
        failReason: segment.failReason,
      })),
      status: parsed.status ?? 'paused',
      reason: parsed.reason,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
    }
  } catch {
    return null
  }
}

export function saveChain(chain: VideoChain): void {
  try {
    window.localStorage.setItem(CHAIN_KEY, JSON.stringify(chain))
  } catch {
    // 存储不可用（隐私模式、配额满）时静默降级：连拍照常跑，只是刷新后看不到进度。
  }
}

export function clearChain(): void {
  try {
    window.localStorage.removeItem(CHAIN_KEY)
  } catch {
    // 同上，忽略。
  }
}

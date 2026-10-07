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

import type { VideoInputKind, VideoModelCapability } from './api'

/** 托盘里一张素材承担的角色，决定它被送进上游时的字段与 role。 */
export type AssetRole =
  | 'first_frame'
  | 'last_frame'
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'

export interface TrayItem {
  /** 托盘内部唯一键（同一素材可承担多个角色，故不能用素材 ID 当键）。 */
  key: string
  asset: Asset
  role: AssetRole
}

/** 角色 → 上游 content 元素的 type 与 URL 字段名。 */
const roleToContentType: Record<AssetRole, string> = {
  first_frame: 'image_url',
  last_frame: 'image_url',
  reference_image: 'image_url',
  reference_video: 'video_url',
  reference_audio: 'audio_url',
}

/**
 * 把托盘内容编成任务请求的 metadata.content。
 *
 * 用 `asset://<本地素材ID>` 引用：后端在选渠道之前会把它换成上游素材 ID，并把任务锁到
 * 素材所属渠道（见 controller/asset_task.go）。role 必须显式带上——不写 role 的单张图
 * 被约定为「首帧」，多张图不写 role 会被部分上游拒绝。
 */
export function buildAssetContent(items: TrayItem[]): unknown[] {
  return items.map((item) => {
    const type = roleToContentType[item.role]
    return {
      type,
      [type]: { url: `asset://${item.asset.id}` },
      role: item.role,
    }
  })
}

function countRoles(items: TrayItem[]) {
  let firstFrame = 0
  let lastFrame = 0
  let referenceImage = 0
  let video = 0
  let audio = 0
  for (const item of items) {
    switch (item.role) {
      case 'first_frame':
        firstFrame += 1
        break
      case 'last_frame':
        lastFrame += 1
        break
      case 'reference_image':
        referenceImage += 1
        break
      case 'reference_video':
        video += 1
        break
      case 'reference_audio':
        audio += 1
        break
    }
  }
  return { firstFrame, lastFrame, referenceImage, video, audio }
}

export interface TargetReason {
  key: string
  params?: Record<string, unknown>
}

export interface Eligibility {
  enabled: boolean
  reason?: TargetReason
}

/**
 * 判断某个模型能否满足当前托盘里的素材组合。
 *
 * 规则与后端声明同源（inputs/上限），前端只做集合判断，不发明新规则。
 * 返回的 reason 是 i18n key，调用方用 t() 渲染，因此这里不做文案拼接。
 */
export function evaluateModel(
  capability: VideoModelCapability,
  items: TrayItem[]
): Eligibility {
  if (items.length === 0) {
    return { enabled: true }
  }
  const supports = (kind: VideoInputKind) => capability.inputs.includes(kind)
  const { firstFrame, lastFrame, referenceImage, video, audio } =
    countRoles(items)

  if (video > 0 && !supports('reference_video')) {
    return { enabled: false, reason: { key: 'This model does not support reference video' } }
  }
  if (audio > 0 && !supports('reference_audio')) {
    return { enabled: false, reason: { key: 'This model does not support reference audio' } }
  }
  if (referenceImage > 0 && !supports('reference_image')) {
    return { enabled: false, reason: { key: 'This model does not support reference images' } }
  }
  if (firstFrame + lastFrame > 0) {
    // 首尾帧要求成对出现；只给首帧时按「单图生视频」处理。
    const wantsPair = firstFrame > 0 && lastFrame > 0
    if (wantsPair && !supports('first_last_frame')) {
      return { enabled: false, reason: { key: 'This model does not support first/last frame' } }
    }
    if (!wantsPair && !supports('image') && !supports('first_last_frame')) {
      return { enabled: false, reason: { key: 'This model does not support image input' } }
    }
  }
  if (referenceImage > 0 && capability.max_images > 0 && referenceImage > capability.max_images) {
    return {
      enabled: false,
      reason: {
        key: 'This model supports at most {{count}} reference images',
        params: { count: capability.max_images },
      },
    }
  }
  if (video > 0 && capability.max_videos > 0 && video > capability.max_videos) {
    return {
      enabled: false,
      reason: {
        key: 'This model supports at most {{count}} reference videos',
        params: { count: capability.max_videos },
      },
    }
  }
  if (audio > 0 && capability.max_audios > 0 && audio > capability.max_audios) {
    return {
      enabled: false,
      reason: {
        key: 'This model supports at most {{count}} reference audios',
        params: { count: capability.max_audios },
      },
    }
  }
  return { enabled: true }
}

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
 * 创作台草稿：提示词、参数、模型与素材托盘。
 *
 * 只存 localStorage：草稿是「这台浏览器上还没提交的编辑态」，不涉及跨端同步，
 * 也不该进后端（否则每个用户的每次输入都会产生写库）。素材托盘按整对象存，
 * 刷新后即便素材库接口不可用也能继续编辑；真被删掉的素材会在提交时由后端明确报错。
 */
export interface StudioDraft {
  model: string
  prompt: string
  params: VideoParams
  items: TrayItem[]
}

const DRAFT_KEY = 'playground_video_draft'

/** 读取草稿；数据损坏或字段缺失时返回 null，绝不让草稿把页面带崩。 */
export function loadDraft(): StudioDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<StudioDraft> | null
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return {
      model: typeof parsed.model === 'string' ? parsed.model : '',
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      params: { ...EMPTY_VIDEO_PARAMS, ...parsed.params },
      items: Array.isArray(parsed.items) ? parsed.items : [],
    }
  } catch {
    return null
  }
}

export function saveDraft(draft: StudioDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 存储不可用（隐私模式、配额满）时静默降级：草稿只是便利功能，不影响生成。
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // 同上，忽略。
  }
}

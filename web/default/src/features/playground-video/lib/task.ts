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
import type { TaskLog } from '@/features/usage-logs/types'

/**
 * 从任务上取尾帧图地址，用于「取尾帧续拍」与连拍。
 *
 * 后端任务表本身存了尾帧（TaskDto.last_frame_url），这是最可靠的来源；
 * 老任务或从别的入口拿到的对象可能只有上游响应原文，所以再按已知路径兜底。
 * 取不到返回空串，由调用方明确提示用户，而不是悄悄退化成「用整段视频当参考」。
 * 与后端 service/task_polling.go 的 extractLastFrameURL 保持同一组路径。
 */
export function extractLastFrameUrl(task: TaskLog): string {
  if (typeof task.last_frame_url === 'string' && task.last_frame_url.trim()) {
    return task.last_frame_url.trim()
  }
  if (!task.data) {
    return ''
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(task.data)
  } catch {
    return ''
  }
  for (const path of [
    ['content', 'last_frame_url'],
    ['data', 'content', 'last_frame_url'],
    ['data', 'data', 'content', 'last_frame_url'],
    ['metadata', 'last_frame_url'],
    ['data', 'metadata', 'last_frame_url'],
    ['last_frame_url'],
    ['data', 'last_frame_url'],
  ]) {
    const found = readPath(parsed, path)
    if (found) {
      return found
    }
  }
  return ''
}

/** 任务提示词摘要：通知、列表等地方需要一行能认出「这是哪个任务」的文字。 */
export function taskPromptPreview(task: TaskLog, max = 40): string {
  if (!task.properties) {
    return task.task_id
  }
  try {
    const props = JSON.parse(task.properties) as { prompt?: string }
    const prompt = (props.prompt || '').trim()
    if (!prompt) {
      return task.task_id
    }
    return prompt.length > max ? `${prompt.slice(0, max)}…` : prompt
  } catch {
    return task.task_id
  }
}

/**
 * 任务用的模型名：优先取本站在提交时记下的 model，
 * 旧任务回退到上游回显的 origin_model_name。
 */
export function taskModelName(task: TaskLog): string {
  if (!task.properties) {
    return ''
  }
  try {
    const props = JSON.parse(task.properties) as {
      model?: string
      origin_model_name?: string
    }
    return props.model || props.origin_model_name || ''
  } catch {
    return ''
  }
}

function readPath(root: unknown, path: string[]): string {
  let cursor: unknown = root
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') {
      return ''
    }
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return typeof cursor === 'string' && cursor.trim() !== '' ? cursor.trim() : ''
}

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
import { api } from '@/lib/api'

/** 与后端 dto.ImageResponse 对齐。 */
export interface ImageGenerationItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

export interface ImageGenerationResponse {
  created?: number
  data?: ImageGenerationItem[]
}

export interface ImageGenerationRequest {
  model: string
  prompt: string
  n?: number
  size?: string
  response_format?: string
}

/**
 * 会话鉴权的图片生成（走 /pg 组，用户不用自己签发令牌）。
 *
 * 图片接口是同步的：一次请求直接拿回结果，没有任务轮询，所以游乐场的图片链路
 * 只需要「发一次请求 → 把图片填进消息」。
 */
export async function generateImage(
  payload: ImageGenerationRequest,
  signal?: AbortSignal
): Promise<ImageGenerationResponse> {
  let res
  try {
    res = await api.post('/pg/images/generations', payload, {
      signal,
      skipErrorHandler: true,
    } as Record<string, unknown>)
  } catch (error: unknown) {
    // axios 的默认文案只有 "Request failed with status code 400"，对排查毫无帮助；
    // 后端把原因放在 body.error.message 里，这里取出来往上抛。
    const response = (
      error as { response?: { data?: { error?: { message?: unknown } } } }
    ).response
    const message = response?.data?.error?.message
    if (typeof message === 'string' && message.length > 0) {
      throw new Error(message)
    }
    throw error
  }
  const body = res.data
  if (body?.error) {
    throw new Error(body.error.message || 'Image generation failed')
  }
  return body as ImageGenerationResponse
}

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
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { generateImage } from '../lib/image-api'

import { MESSAGE_STATUS } from '../constants'
import { completeAssistantMessage, updateLastAssistantMessage } from '../lib'
import type { Message } from '../types'

interface ImageGenerationParams {
  model: string
  prompt: string
}

/**
 * 图像模型在游乐场里的发送链路。
 *
 * 图片接口是同步的：一次请求直接拿回图片地址，没有任务轮询，所以这里比视频链路简单，
 * 只需要「占位 → 用结果填充消息」两步，全部复用对话消息的既有更新工具。
 */
export function useImageChatHandler() {
  const { t } = useTranslation()
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsGenerating(false)
  }, [])

  const sendImageGeneration = useCallback(
    async (
      params: ImageGenerationParams,
      onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
    ) => {
      const abortController = new AbortController()
      abortRef.current = abortController
      setIsGenerating(true)

      onMessageUpdate((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          status: MESSAGE_STATUS.LOADING,
          versions: [
            {
              ...message.versions[0],
              content: t('Generating image...'),
            },
          ],
        }))
      )

      try {
        const data = await generateImage(
          { model: params.model, prompt: params.prompt, n: 1 },
          abortController.signal
        )
        if (abortController.signal.aborted) {
          return
        }

        const urls = (data.data ?? [])
          .map((item) => {
            if (item.url) {
              return item.url
            }
            if (item.b64_json) {
              return `data:image/png;base64,${item.b64_json}`
            }
            return ''
          })
          .filter((url) => url !== '')

        if (urls.length === 0) {
          throw new Error(t('No image was returned by the upstream'))
        }

        onMessageUpdate((prev) =>
          updateLastAssistantMessage(prev, (message) =>
            completeAssistantMessage({
              ...message,
              status: MESSAGE_STATUS.COMPLETE,
              imageUrls: urls,
              imageModel: params.model,
              versions: [
                {
                  ...message.versions[0],
                  content: params.prompt,
                },
              ],
            })
          )
        )
      } catch (error: unknown) {
        if (abortController.signal.aborted) {
          return
        }
        const reason =
          error instanceof Error && error.message
            ? error.message
            : t('Image generation failed')
        onMessageUpdate((prev) =>
          updateLastAssistantMessage(prev, (message) => ({
            ...message,
            status: MESSAGE_STATUS.ERROR,
            errorCode: null,
            versions: [
              {
                ...message.versions[0],
                content: reason,
              },
            ],
          }))
        )
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null
          setIsGenerating(false)
        }
      }
    },
    [t]
  )

  return { sendImageGeneration, stopGeneration, isGenerating }
}

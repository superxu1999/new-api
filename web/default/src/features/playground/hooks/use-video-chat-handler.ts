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
import { toast } from 'sonner'

import { api } from '@/lib/api'

import {
  completeAssistantTiming,
  updateLastAssistantMessage,
  updateMessageByKey,
} from '../lib'
import { MESSAGE_STATUS } from '../constants'
import type { Message } from '../types'

const POLL_INTERVAL_MS = 3000

type VideoGenerationOptions = {
  model: string
  prompt: string
  duration?: number
}

type MessageUpdater = (updater: (prev: Message[]) => Message[]) => void

/**
 * Hook for handling video generation task submission and polling.
 * Used when a video/task model (e.g. seedance) is selected in the playground.
 */
export function useVideoChatHandler() {
  const { t } = useTranslation()
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef(false)

  // Poll a video task until it reaches a terminal status, updating the target
  // assistant message along the way. `prompt` is only available for tasks
  // submitted in this session; for resumed tasks the existing content is kept.
  const pollVideoTask = useCallback(
    (
      taskId: string,
      prompt: string | undefined,
      onMessageUpdate: MessageUpdater,
      messageKey?: string
    ) =>
      new Promise<void>((resolve) => {
        const updateTarget = (
          prev: Message[],
          updater: (message: Message) => Message
        ) =>
          messageKey
            ? updateMessageByKey(prev, messageKey, updater)
            : updateLastAssistantMessage(prev, updater)

        const poll = async () => {
          if (abortRef.current) {
            resolve()
            return
          }

          try {
            const pollRes = await api.get(
              `/pg/video/generations/${taskId}`,
              { skipErrorHandler: true } as Record<string, unknown>
            )
            const data = pollRes.data?.data

            if (!data) {
              setTimeout(poll, POLL_INTERVAL_MS)
              return
            }

            const status = data.status || ''

            // Update progress message
            onMessageUpdate((prev) =>
              updateTarget(prev, (message) => ({
                ...message,
                versions: [
                  {
                    ...message.versions[0],
                    content: data.progress
                      ? t('Generating video... ({{progress}})', {
                          progress: data.progress,
                        })
                      : t('Generating video...'),
                  },
                ],
              }))
            )

            if (status === 'SUCCESS') {
              const videoUrl = `/v1/videos/${taskId}/content`
              onMessageUpdate((prev) =>
                updateTarget(prev, (message) =>
                  completeAssistantTiming({
                    ...message,
                    status: MESSAGE_STATUS.COMPLETE,
                    videoUrl,
                    videoTaskId: undefined,
                    versions: [
                      {
                        ...message.versions[0],
                        content: prompt ?? message.versions[0].content,
                      },
                    ],
                  })
                )
              )
              resolve()
            } else if (status === 'FAILURE') {
              const failReason = data.fail_reason || 'Video generation failed'
              onMessageUpdate((prev) =>
                updateTarget(prev, (message) =>
                  completeAssistantTiming({
                    ...message,
                    status: MESSAGE_STATUS.ERROR,
                    errorCode: null,
                    videoTaskId: undefined,
                    versions: [
                      {
                        ...message.versions[0],
                        content: `Error: ${failReason}`,
                      },
                    ],
                  })
                )
              )
              resolve()
            } else {
              setTimeout(poll, POLL_INTERVAL_MS)
            }
          } catch {
            if (abortRef.current) {
              resolve()
              return
            }
            setTimeout(poll, POLL_INTERVAL_MS)
          }
        }

        // First poll after an initial delay
        setTimeout(poll, POLL_INTERVAL_MS)
      }),
    [t]
  )

  const sendVideoGeneration = useCallback(
    (options: VideoGenerationOptions, onMessageUpdate: MessageUpdater) => {
      abortRef.current = false
      setIsGenerating(true)

      const submitTask = async () => {
        try {
          const body: Record<string, unknown> = {
            model: options.model,
            prompt: options.prompt,
          }
          if (options.duration && options.duration > 0) {
            body.duration = options.duration
          }

          const res = await api.post('/pg/video/generations', body)
          const taskId = res.data?.task_id ?? res.data?.data?.task_id

          if (!taskId) {
            throw new Error('No task_id in response')
          }

          // Persist the task ID on the message so polling can resume after reload
          let messageKey: string | undefined
          onMessageUpdate((prev) =>
            updateLastAssistantMessage(prev, (message) => {
              messageKey = message.key
              return {
                ...message,
                videoTaskId: taskId,
                videoDuration:
                  options.duration && options.duration > 0
                    ? options.duration
                    : undefined,
              }
            })
          )

          await pollVideoTask(taskId, options.prompt, onMessageUpdate, messageKey)
        } catch (error: unknown) {
          if (abortRef.current) return

          const errorMessage =
            error instanceof Error ? error.message : 'Video generation failed'
          toast.error(errorMessage)

          onMessageUpdate((prev) =>
            updateLastAssistantMessage(prev, (message) =>
              completeAssistantTiming({
                ...message,
                status: MESSAGE_STATUS.ERROR,
                errorCode: null,
                videoTaskId: undefined,
                versions: [
                  {
                    ...message.versions[0],
                    content: `Error: ${errorMessage}`,
                  },
                ],
              })
            )
          )
        } finally {
          if (!abortRef.current) {
            setIsGenerating(false)
          }
        }
      }

      submitTask()
    },
    [pollVideoTask]
  )

  // Resume polling for video tasks that were still in flight when the page
  // was last closed (message has a task ID but no result yet).
  const resumePendingVideoTasks = useCallback(
    (messages: Message[], onMessageUpdate: MessageUpdater) => {
      const pending = messages.filter(
        (message) =>
          message.videoTaskId &&
          !message.videoUrl &&
          message.status !== MESSAGE_STATUS.ERROR
      )

      if (pending.length === 0) return
      setIsGenerating(true)

      void Promise.all(
        pending.map((message) =>
          pollVideoTask(
            message.videoTaskId as string,
            undefined,
            onMessageUpdate,
            message.key
          )
        )
      ).finally(() => {
        if (!abortRef.current) {
          setIsGenerating(false)
        }
      })
    },
    [pollVideoTask]
  )

  const stopGeneration = useCallback(() => {
    // no-op
  }, [])

  return {
    sendVideoGeneration,
    resumePendingVideoTasks,
    stopGeneration,
    isGenerating,
  }
}

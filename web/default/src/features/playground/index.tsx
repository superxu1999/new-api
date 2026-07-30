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
import { useEffect, useRef } from 'react'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
  useVideoChatHandler,
} from './hooks'
import { appendUserMessagePair, getMessageContent } from './lib'
import { MESSAGE_ROLES } from './constants'
import { isVideoModel } from './hooks/use-playground-options'

export function Playground() {
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    clearMessages,
  } = usePlaygroundState()

  const { sendChat, stopGeneration, isGenerating: isChatGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })

  const currentModelIsVideo = isVideoModel(config.model)

  const {
    sendVideoGeneration,
    resumePendingVideoTasks,
    stopGeneration: stopVideoGeneration,
    isGenerating: isVideoGenerating,
  } = useVideoChatHandler()

  // After messages are restored from storage, resume polling for video
  // tasks that were still running when the page was last closed.
  const videoResumeDoneRef = useRef(false)
  useEffect(() => {
    if (isLoadingMessages || videoResumeDoneRef.current) return
    videoResumeDoneRef.current = true
    resumePendingVideoTasks(messages, updateMessages)
  }, [isLoadingMessages, messages, resumePendingVideoTasks, updateMessages])

  const handleVideoSubmit = (text: string, duration: number) => {
    const nextMessages = appendUserMessagePair(messages, text)
    updateMessages(nextMessages)
    sendVideoGeneration(
      { model: config.model, prompt: text, duration },
      updateMessages
    )
  }

  // 视频模型的重新生成/编辑后重发：从消息列表取最后一条用户消息作为提示词，
  // 并沿用被替换的原视频消息上保存的时长（未设置过则用服务端默认值 0）。
  const sendVideoChat = (nextMessages: typeof messages) => {
    const lastUserMessage = [...nextMessages]
      .reverse()
      .find((message) => message.from === MESSAGE_ROLES.USER)
    const prompt = lastUserMessage
      ? getMessageContent(lastUserMessage).trim()
      : ''
    if (!prompt) return
    let duration = 0
    if (lastUserMessage) {
      const userIndex = messages.findIndex(
        (message) => message.key === lastUserMessage.key
      )
      const originAssistant = userIndex >= 0 ? messages[userIndex + 1] : undefined
      if (originAssistant?.videoDuration) {
        duration = originAssistant.videoDuration
      }
    }
    sendVideoGeneration(
      { model: config.model, prompt, duration },
      updateMessages
    )
  }

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat: currentModelIsVideo ? sendVideoChat : sendChat,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  const isGenerating = currentModelIsVideo ? isVideoGenerating : isChatGenerating
  const handleStop = currentModelIsVideo ? stopVideoGeneration : stopGeneration

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <PlaygroundChat
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          onRegenerateMessage={handleRegenerateMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onSelectPrompt={handleSendMessage}
          isGenerating={isGenerating}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          disabled={isGenerating}
          groups={groups}
          groupValue={config.group}
          isGenerating={isGenerating}
          isModelLoading={isLoadingModels}
          isVideoModel={currentModelIsVideo}
          modelValue={config.model}
          models={models}
          onGroupChange={(value) => updateConfig('group', value)}
          onClearMessages={handleClearMessages}
          onModelChange={(value) => updateConfig('model', value)}
          onStop={handleStop}
          onSubmit={handleSendMessage}
          onVideoSubmit={currentModelIsVideo ? handleVideoSubmit : undefined}
          hasMessages={messages.length > 0}
        />
      </div>
    </div>
  )
}

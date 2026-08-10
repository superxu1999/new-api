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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'

import { getSubmittableInputText } from '../../lib'
import type {
  ModelOption,
  GroupOption,
  VideoGenerationParams,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'
import { VideoParameterControls } from './video-parameter-controls'

interface PlaygroundInputProps {
  onSubmit: (text: string) => void
  onVideoSubmit?: (
    text: string,
    duration: number,
    params?: VideoGenerationParams
  ) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  isVideoModel?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onClearMessages?: () => void
}

export function PlaygroundInput({
  onSubmit,
  onVideoSubmit,
  onStop,
  disabled,
  isGenerating,
  isVideoModel = false,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onClearMessages,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  // 默认 11 秒(常用档位):显示值即提交值,避免"提示与提交脱节"的误解;
  // 想由模型自动选择时填 -1,范围为 4-15。
  const [videoDuration, setVideoDuration] = useState('11')
  // 视频生成参数(经 body.metadata 透传);空值不发送,由上游默认
  const [videoParams, setVideoParams] = useState<VideoGenerationParams>({
    generateAudio: true,
  })

  const handleSubmit = (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (!submittableText) return

    if (isVideoModel && onVideoSubmit) {
      const seconds = Number(videoDuration)
      // 保留 -1(自动选择)原值;空/非法输入兜底为 0(不传,上游自动)
      onVideoSubmit(
        submittableText,
        Number.isFinite(seconds) && seconds !== 0 ? seconds : 0,
        videoParams
      )
      setText('')
      setVideoDuration('11')
      return
    }

    onSubmit(submittableText)
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        onSubmit={handleSubmit}
      >
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />

        {isVideoModel && (
          <VideoParameterControls
            disabled={disabled}
            onChange={setVideoParams}
            value={videoParams}
          />
        )}

        <PromptInputFooter className='border-border/60 bg-muted/20 dark:bg-muted/10 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            isVideoModel={isVideoModel}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            onVideoDurationChange={setVideoDuration}
            text={text}
            videoDuration={videoDuration}
            tools={
              <PlaygroundInputTools
                disabled={disabled}
                hasMessages={hasMessages}
                onClearMessages={onClearMessages}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}

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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Loader } from '@/components/ai-elements/loader'
import { MessageContent } from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { Response } from '@/components/ai-elements/response'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources'
import { cn } from '@/lib/utils'

import { MESSAGE_STATUS } from '../../constants'
import {
  getMessageAlignmentClass,
  getMessageContentState,
  isErrorMessage,
  type MessageAlignment,
} from '../../lib'
import { getMessageContentStyles } from '../../lib/message/message-styles'
import type { Message } from '../../types'
import { MessageError } from './message-error'
import { MessageMetadata } from './message-metadata'

type PlaygroundMessageContentProps = {
  actions: ReactNode
  alignment: MessageAlignment
  errorActions?: ReactNode
  isSourceVisible?: boolean
  message: Message
  versionContent: string
}

export function PlaygroundMessageContent({
  actions,
  alignment,
  errorActions,
  isSourceVisible = false,
  message,
  versionContent,
}: PlaygroundMessageContentProps) {
  const { t } = useTranslation()
  const {
    displayContent,
    hasReasoning,
    hasSources,
    reasoningContent,
    showLoader,
    showMessageContent,
    sources,
  } = getMessageContentState(message, versionContent)
  const isError = isErrorMessage(message)
  const isMessageFinal =
    message.status !== MESSAGE_STATUS.LOADING &&
    message.status !== MESSAGE_STATUS.STREAMING
  const hasImages = Boolean(message.imageUrls && message.imageUrls.length > 0)

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        getMessageAlignmentClass(alignment)
      )}
    >
      {hasSources && (
        <Sources>
          <SourcesTrigger count={sources.length} />
          <SourcesContent>
            {sources.map((source) => (
              <Source
                href={source.href}
                key={`${source.href}-${source.title}`}
                title={source.title}
              />
            ))}
          </SourcesContent>
        </Sources>
      )}

      {hasReasoning && (
        <Reasoning
          defaultOpen
          duration={message.reasoning?.duration}
          isStreaming={message.isReasoningStreaming}
        >
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {showLoader && (
        <div className='flex items-center gap-2 py-2'>
          <Loader />
          <Shimmer className='text-sm' duration={1}>
            {t('Responding...')}
          </Shimmer>
        </div>
      )}

      {isError && (
        <>
          <MessageError message={message} className='mb-2' />
          <MessageMetadata alignment={alignment} message={message} />
          {errorActions}
        </>
      )}

      {!isError && showMessageContent && (
        <>
          {/* 图片模型：同步接口直接返回图片地址，渲染成一组可点击的图片 */}
          {hasImages && (
            <div className='my-2'>
              <div className='flex flex-wrap gap-3'>
                {(message.imageUrls ?? []).map((url) => (
                  <a
                    key={url.slice(0, 64)}
                    href={url}
                    target='_blank'
                    rel='noreferrer'
                    className='block overflow-hidden rounded-lg border'
                  >
                    <img
                      src={url}
                      alt={versionContent}
                      className='h-64 w-64 object-cover'
                      loading='lazy'
                    />
                  </a>
                ))}
              </div>
              <div className='text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                {message.imageModel && (
                  <span className='inline-flex items-center gap-1'>
                    {t('Model')}: {message.imageModel}
                  </span>
                )}
                <a
                  className='hover:text-foreground inline-flex items-center gap-1'
                  download
                  href={(message.imageUrls ?? [])[0]}
                  target='_blank'
                  rel='noreferrer'
                >
                  <Download className='size-3.5' />
                  {t('Download image')}
                </a>
              </div>
            </div>
          )}
          {!hasImages && message.videoUrl && (
            <div className='my-2'>
              <div className='overflow-hidden rounded-lg'>
                <video
                  controls
                  className='w-full max-w-2xl rounded-md'
                  src={message.videoUrl}
                >
                  <track kind='captions' />
                </video>
              </div>
              <div className='mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                {message.videoModel && (
                  <span className='inline-flex items-center gap-1'>
                    {t('Model')}: {message.videoModel}
                  </span>
                )}
                <a
                  className='hover:text-foreground inline-flex items-center gap-1'
                  download={`${message.videoUrl.split('/').at(-2) ?? 'video'}.mp4`}
                  href={message.videoUrl}
                >
                  <Download className='size-3.5' />
                  {t('Download video')}
                </a>
              </div>
            </div>
          )}
          {!hasImages && !message.videoUrl && isSourceVisible && (
            <CodeBlock
              code={versionContent}
              className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch]'
              collapsedLines={24}
              defaultCollapsed={false}
              language='markdown'
              maxExpandedLines={48}
              showLineNumbers
              showToolbar
              title={t('Raw response')}
            >
              <CodeBlockCopyButton />
            </CodeBlock>
          )}
          {!hasImages && !message.videoUrl && !isSourceVisible && (
            <MessageContent
              variant='flat'
              className={cn(getMessageContentStyles())}
            >
              <Response final={isMessageFinal}>{displayContent}</Response>
            </MessageContent>
          )}
          <MessageMetadata alignment={alignment} message={message} />
          {actions}
        </>
      )}
    </div>
  )
}

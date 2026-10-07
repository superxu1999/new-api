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
import { Ban, Clapperboard, Download, Film, Info, RotateCcw, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import type { TaskLog } from '@/features/usage-logs/types'
import {
  formatLogQuota,
  formatTimestampRelative,
  formatUseTime,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { friendlyTaskError } from '../lib/error-copy'

const TERMINAL_STATUS = new Set(['SUCCESS', 'FAILURE'])

function statusVariant(status: string) {
  if (status === 'SUCCESS') return 'default' as const
  if (status === 'FAILURE') return 'destructive' as const
  return 'secondary' as const
}

/** 任务耗时：用 finish-start；未结束的用「已等待」另算。 */
function taskDurationText(task: TaskLog): string {
  const start = task.start_time || task.submit_time || 0
  const finish = task.finish_time || 0
  if (start > 0 && finish > start) {
    return formatUseTime(finish - start)
  }
  return ''
}

interface TaskCardProps {
  task: TaskLog
  /**
   * 模型对外显示名（产品名）。C 端用户看到的是它，
   * 真实模型名保留在任务详情里供排查。
   */
  displayName?: string
  /** 失败任务的重试入口；无提交快照（历史任务）时不显示。 */
  onRetry?: () => void
  onCancel?: () => void
  onSaveAsAsset?: () => void
  /** 查看任务详情：请求参数 / 计费明细 / 上游响应（复用任务日志页的详情弹窗）。 */
  onShowDetail?: () => void
  /** 把成片作为参考视频加入素材托盘，继续二次创作。 */
  onContinue?: () => void
  /** 取这段视频的尾帧作为下一段的首帧（仅上游返回过尾帧时可用）。 */
  onContinueFromLastFrame?: () => void
  canceling?: boolean
  saving?: boolean
  continuing?: boolean
  /** 提交中的任务禁用重试，避免连点。 */
  retryDisabled?: boolean
}

/**
 * 任务卡片：状态、提示词、耗时/费用、错误原因，以及按状态出现的操作
 * （进行中可取消、失败可重试、成功可播放/下载/存为素材/继续创作）。
 */
export function TaskCard(props: TaskCardProps) {
  const { t } = useTranslation()
  const task = props.task
  const running = !TERMINAL_STATUS.has(task.status)
  const durationText = taskDurationText(task)

  return (
    <div className='flex flex-col gap-3 rounded-xl border p-4'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <Badge variant={statusVariant(task.status)}>
            {task.status}
            {task.progress && running ? ` ${task.progress}` : ''}
          </Badge>
          {task.submit_time ? (
            <span className='text-muted-foreground text-xs'>
              {formatTimestampRelative(task.submit_time)}
            </span>
          ) : null}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {props.onShowDetail && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={props.onShowDetail}
              title={t('View task details, request payload, upstream response and video')}
            >
              <Info className='mr-1 h-3.5 w-3.5' />
              {t('Details')}
            </Button>
          )}
          {running && props.onCancel && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={props.canceling}
              onClick={props.onCancel}
              title={t('Cancel this task')}
            >
              <Ban className='mr-1 h-3.5 w-3.5' />
              {props.canceling ? t('Canceling...') : t('Cancel')}
            </Button>
          )}
          {task.status === 'FAILURE' && props.onRetry && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={props.retryDisabled}
              onClick={props.onRetry}
              title={t('Submit again with the same parameters')}
            >
              <RotateCcw className='mr-1 h-3.5 w-3.5' />
              {t('Retry')}
            </Button>
          )}
        </div>
      </div>

      {/* 元信息：模型 / 耗时 / 消耗额度 / 分辨率时长 */}
      <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        {props.displayName && <span>{props.displayName}</span>}
        {durationText && (
          <span>
            {t('Duration')}: {durationText}
          </span>
        )}
        {task.quota ? (
          <span>
            {t('Cost')}: {formatLogQuota(task.quota)}
          </span>
        ) : null}
        {task.duration ? (
          <span>
            {t('Length')}: {task.duration}s
          </span>
        ) : null}
        {task.resolution ? <span>{task.resolution}</span> : null}
      </div>

      {task.fail_reason && task.status === 'FAILURE' && (
        <FailReasonBlock reason={task.fail_reason} />
      )}

      {task.status === 'SUCCESS' && (
        <>
          <video
            controls
            className='w-full rounded-md'
            src={`/v1/videos/${task.task_id}/content`}
          />
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={props.saving}
              onClick={props.onSaveAsAsset}
            >
              <Save className='mr-1 h-3.5 w-3.5' />
              {props.saving ? t('Saving...') : t('Save to material library')}
            </Button>
            <a
              href={`/v1/videos/${task.task_id}/content`}
              download={`${task.task_id}.mp4`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Download className='mr-1 h-3.5 w-3.5' />
              {t('Download')}
            </a>
            {props.onContinue && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={props.continuing}
                onClick={props.onContinue}
                title={t('Add this clip as a reference video and keep creating')}
              >
                <Clapperboard className='mr-1 h-3.5 w-3.5' />
                {t('Continue creating')}
              </Button>
            )}
            {props.onContinueFromLastFrame && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={props.continuing}
                onClick={props.onContinueFromLastFrame}
                title={t('Use the last frame of this clip as the first frame')}
              >
                <Film className='mr-1 h-3.5 w-3.5' />
                {t('Continue from last frame')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 失败原因展示：人话标题 + 行动建议为主，上游原文（含 Request ID）折叠进
 * <details>——C 端用户第一眼看到的是「怎么办」，运维需要原文时也能展开复制。
 */
function FailReasonBlock(props: { reason: string }) {
  const { t } = useTranslation()
  const friendly = friendlyTaskError(props.reason)
  return (
    <div className='flex flex-col gap-1'>
      <p className='text-destructive text-sm font-medium'>
        {friendly.titleKey ? t(friendly.titleKey) : t('Generation failed')}
      </p>
      {friendly.hintKey && (
        <p className='text-muted-foreground text-xs'>{t(friendly.hintKey)}</p>
      )}
      <details className='text-muted-foreground/80 text-xs'>
        <summary className='cursor-pointer select-none'>
          {t('Technical details')}
        </summary>
        <p className='mt-1 break-all'>{friendly.raw}</p>
      </details>
    </div>
  )
}

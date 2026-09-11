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
import type { ColumnDef } from '@tanstack/react-table'
import { Music, Video } from 'lucide-react'
/* eslint-disable react-refresh/only-export-components */
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableColumnHeader } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatLogQuota, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TASK_ACTIONS, TASK_STATUS } from '../../constants'
import { taskActionMapper, taskStatusMapper } from '../../lib/mappers'
import type { TaskLog } from '../../types'
import {
  AudioPreviewDialog,
  type AudioClip,
} from '../dialogs/audio-preview-dialog'
import { TaskDetailDialog } from '../dialogs/task-detail-dialog'
import { TaskFeeDialog } from '../dialogs/task-fee-dialog'
import { useUsageLogsContext } from '../usage-logs-provider'
import {
  createDurationColumn,
  createChannelColumn,
  progressSortWeight,
  StatusProgressCell,
} from './column-helpers'

function parseTaskData(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** 视频类任务动作（与任务详情弹窗的判断保持一致）。 */
function isVideoAction(action: string): boolean {
  return (
    action === TASK_ACTIONS.GENERATE ||
    action === TASK_ACTIONS.TEXT_GENERATE ||
    action === TASK_ACTIONS.FIRST_TAIL_GENERATE ||
    action === TASK_ACTIONS.REFERENCE_GENERATE ||
    action === TASK_ACTIONS.REMIX_GENERATE
  )
}

/**
 * 从任务快照里取「用户请求的模型名」。properties 可能是对象或 JSON 字符串，
 * 两种情况都要兼容（后端 TaskDto.Properties 是 any）。
 */
function taskModelName(log: TaskLog): string {
  let raw: unknown = log.properties
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return ''
    }
  }
  if (raw == null || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  return typeof obj.origin_model_name === 'string' ? obj.origin_model_name : ''
}

/** 视频内容代理地址（与任务详情弹窗一致，走同源相对路径，避免 ServerAddress 配错）。 */
function taskVideoSrc(log: TaskLog): string | undefined {
  if (log.status !== TASK_STATUS.SUCCESS) return undefined
  if (!isVideoAction(log.action)) return undefined
  return `/v1/videos/${log.task_id}/content`
}

function AudioPreviewCell({ log }: { log: TaskLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const clips = useMemo(() => {
    const data = parseTaskData(log.data)
    return data.filter(
      (c) =>
        c && typeof c === 'object' && (c as Record<string, unknown>).audio_url
    )
  }, [log.data])

  if (clips.length === 0) return null

  return (
    <>
      <button
        type='button'
        className='group flex items-center gap-1 text-left text-xs'
        onClick={() => setOpen(true)}
      >
        <Music className='text-muted-foreground size-3' />
        <span className='text-foreground leading-snug group-hover:underline'>
          {t('Click to preview audio')}
        </span>
      </button>
      <AudioPreviewDialog
        open={open}
        onOpenChange={setOpen}
        clips={clips as AudioClip[]}
      />
    </>
  )
}

export function useTaskLogsColumns(isAdmin: boolean): ColumnDef<TaskLog>[] {
  const { t } = useTranslation()
  const columns: ColumnDef<TaskLog>[] = [
    {
      accessorKey: 'submit_time',
      header: t('Submit Time'),
      cell: ({ row }) => {
        const log = row.original
        const submitTime = row.getValue('submit_time') as number

        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-xs tabular-nums'>
              {formatTimestampToDate(submitTime, 'seconds')}
            </span>
            {log.finish_time ? (
              <span className='text-muted-foreground/60 truncate font-mono text-[11px] tabular-nums'>
                {formatTimestampToDate(log.finish_time, 'seconds')}
              </span>
            ) : (
              <span className='text-muted-foreground/50 text-[11px]'>-</span>
            )}
          </div>
        )
      },
      size: 180,
    },
  ]

  if (isAdmin) {
    columns.push(createChannelColumn<TaskLog>({ headerLabel: t('Channel') }), {
      id: 'user',
      header: t('User'),
      accessorFn: (row) => row.username || row.user_id,
      cell: function UserCell({ row }) {
        const { sensitiveVisible, setSelectedUserId, setUserInfoDialogOpen } =
          useUsageLogsContext()
        const log = row.original
        const displayName = log.username || String(log.user_id || '?')

        return (
          <button
            type='button'
            className='flex items-center gap-1.5 text-left'
            onClick={(e) => {
              e.stopPropagation()
              setSelectedUserId(log.user_id)
              setUserInfoDialogOpen(true)
            }}
          >
            <Avatar className='ring-border/60 size-6 ring-1 max-sm:hidden'>
              <AvatarFallback
                className={cn(
                  'text-[11px] font-semibold',
                  !sensitiveVisible && 'bg-muted text-muted-foreground'
                )}
                style={
                  sensitiveVisible ? getUserAvatarStyle(displayName) : undefined
                }
              >
                {sensitiveVisible ? getUserAvatarFallback(displayName) : '•'}
              </AvatarFallback>
            </Avatar>
            <span className='text-muted-foreground truncate text-sm hover:underline'>
              {sensitiveVisible ? displayName : '••••'}
            </span>
          </button>
        )
      },
    })
  }

  columns.push(
    {
      accessorKey: 'task_id',
      header: t('Task ID'),
      cell: ({ row }) => {
        const taskId = row.getValue('task_id') as string
        if (!taskId) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        // 任务ID 只做「标识 + 复制」；打开详情交给「模型」列，避免一个控件三个动作。
        return (
          <StatusBadge
            label={taskId}
            variant='neutral'
            size='sm'
            copyable
            className='border-border/60 bg-muted/30 !text-foreground max-w-[170px] rounded-md border px-1.5 py-0.5 font-mono'
          />
        )
      },
      meta: { mobileTitle: true },
    },
    {
      id: 'model',
      header: t('Model'),
      accessorFn: (row) => taskModelName(row),
      cell: function ModelCell({ row }) {
        const log = row.original
        const [dialogOpen, setDialogOpen] = useState(false)
        const modelName = taskModelName(log)

        return (
          <>
            <button
              type='button'
              onClick={() => setDialogOpen(true)}
              className='group flex max-w-[190px] min-w-0 flex-col gap-0.5 text-left'
              title={t('Click to view task details')}
            >
              <span className='text-foreground truncate text-xs leading-snug group-hover:underline'>
                {modelName || '-'}
              </span>
              <span className='text-muted-foreground/60 truncate text-[11px]'>
                {t(log.platform)} · {t(taskActionMapper.getLabel(log.action))}
              </span>
            </button>
            <TaskDetailDialog
              log={log}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              isAdmin={isAdmin}
            />
          </>
        )
      },
      size: 190,
    },
    createDurationColumn<TaskLog>({
      submitTimeKey: 'submit_time',
      finishTimeKey: 'finish_time',
      unit: 'seconds',
      headerLabel: t('Duration'),
      warningThresholdSec: 300,
    }),
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Status')} />
      ),
      // 状态与进度是同一个生命周期维度，合并成一列；进度条的排序权重按百分比数值，
      // 默认的字符串排序是错的（"100%" < "30%"）。
      sortingFn: (a, b) =>
        progressSortWeight(a.original.progress) -
        progressSortWeight(b.original.progress),
      cell: ({ row }) => {
        const log = row.original
        const status = row.getValue('status') as string
        return (
          <StatusProgressCell
            progress={log.progress}
            badge={
              <StatusBadge
                label={t(taskStatusMapper.getLabel(status, status || 'Submitting'))}
                variant={taskStatusMapper.getVariant(status)}
                size='sm'
                copyable={false}
                className='-ml-1.5'
              />
            }
          />
        )
      },
      size: 120,
    },
    {
      id: 'preview',
      header: t('Preview'),
      cell: function PreviewCell({ row }) {
        const log = row.original
        const videoSrc = taskVideoSrc(log)
        const isSunoSuccess =
          log.platform === 'suno' && log.status === TASK_STATUS.SUCCESS

        if (isSunoSuccess) return <AudioPreviewCell log={log} />

        if (videoSrc) {
          return (
            <a
              href={videoSrc}
              target='_blank'
              rel='noreferrer'
              className='text-foreground inline-flex items-center gap-1 text-xs hover:underline'
            >
              <Video className='size-3.5' aria-hidden='true' />
              {t('Preview')}
            </a>
          )
        }

        // 无结果的任务显式占位，避免整列空白看起来像加载失败
        return <span className='text-muted-foreground/60 text-xs'>-</span>
      },
      size: 100,
    },
    {
      id: 'fee',
      header: t('Fee'),
      accessorFn: (row) => row.quota ?? 0,
      cell: function FeeCell({ row }) {
        const log = row.original
        const [dialogOpen, setDialogOpen] = useState(false)
        const quota = log.quota
        if (quota == null) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        return (
          <>
            <button
              type='button'
              onClick={() => setDialogOpen(true)}
              className='group text-left'
              title={t('How this fee is calculated')}
            >
              <span className='text-foreground font-mono text-xs group-hover:underline'>
                {formatLogQuota(quota)}
              </span>
            </button>
            <TaskFeeDialog
              log={log}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              isAdmin={isAdmin}
            />
          </>
        )
      },
      size: 110,
    }
  )

  return columns
}

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
import { Copy, Check, Download, PlayCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TASK_ACTIONS, TASK_STATUS } from '../../constants'
import { taskActionMapper, taskStatusMapper } from '../../lib/mappers'
import type { TaskLog } from '../../types'

interface TaskDetailDialogProps {
  log: TaskLog
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 管理员可见上游模型名与计费口径（分档单价 / 计费倍率 / 计算公式）。 */
  isAdmin?: boolean
}

/** 提取"请求入参"（用户提交给系统的请求体）。
 *  实际请求体通常存在上游返回 data 的 data.properties.input（JSON 字符串）里；
 *  部分任务也会在顶层 properties.input 里。优先从 data 提取，其次顶层 properties。 */
function extractRequestInput(properties?: unknown, data?: unknown): string {
  // 1. 从 data 里提取 data.properties.input（实际存储请求体的位置）
  const fromData = extractInputFromNested(data)
  if (fromData) return fromData

  // 2. 顶层 properties.input
  if (properties != null) {
    const obj = toObj(properties)
    if (obj != null) {
      const input = (obj as Record<string, unknown>).input
      if (input != null) {
        const pretty = toPretty(input)
        if (pretty) return pretty
      }
    }
  }
  return ''
}

/** 在上游返回 data 里找请求入参 input。
 *  请求体常存放在 data.data.properties.input（或 data.properties.input）里。 */
function extractInputFromNested(data: unknown): string {
  let cur: unknown = data
  for (let i = 0; i < 5; i++) {
    const obj = toObj(cur)
    if (obj == null) return ''
    // 1) 本层直接有 input
    if (obj.input != null) {
      const p = toPretty(obj.input)
      if (p) return p
    }
    // 2) 本层的 properties.input
    const props = toObj(obj.properties)
    if (props?.input != null) {
      const p = toPretty(props.input)
      if (p) return p
    }
    // 3) 往 data 子层钻
    cur = obj.data
    if (cur == null) return ''
  }
  return ''
}

/** 兼容对象/字符串，尝试解析成 JS 对象；失败返回 null。 */
function toObj(raw: unknown): Record<string, unknown> | null {
  if (raw != null && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed != null && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/** 把各种值格式化成 pretty 字符串（兼容对象/字符串）。 */
function toPretty(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  }
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

function formatData(data?: unknown): string {
  if (data == null) return ''
  return toPretty(data)
}

type TaskBillingInfo = {
  tokens?: number
  durationSec?: number
  resolution?: string
  hasInputVideo?: boolean
}

/** 从上游响应与请求入参提取计费相关信息（token 用量、时长、分辨率、是否含视频）。 */
function extractBillingInfo(requestInput: string, upstreamData: string): TaskBillingInfo {
  const info: TaskBillingInfo = {}

  // token 用量：上游响应 usage.completion_tokens / total_tokens
  try {
    const parsed = JSON.parse(upstreamData)
    const usage = findUsage(parsed)
    if (usage) {
      const tokens = usage.completion_tokens ?? usage.total_tokens
      if (typeof tokens === 'number') info.tokens = tokens
    }
  } catch {
    /* 忽略解析失败 */
  }

  // 时长 / 分辨率 / 是否含视频：请求入参
  try {
    const input = JSON.parse(requestInput)
    const duration = input?.duration ?? input?.metadata?.duration
    if (typeof duration === 'number') info.durationSec = duration
    if (typeof duration === 'string') {
      const n = Number(duration)
      if (Number.isFinite(n)) info.durationSec = n
    }
    const res = input?.metadata?.resolution ?? input?.resolution
    if (typeof res === 'string' && res) info.resolution = res
    const content = input?.metadata?.content
    if (Array.isArray(content)) {
      info.hasInputVideo = content.some(
        (item: unknown) => toObj(item)?.type === 'video_url' || toObj(item)?.video_url != null
      )
    }
  } catch {
    /* 忽略解析失败 */
  }

  return info
}

/** 在嵌套的上游响应里找 usage 对象。 */
function findUsage(node: unknown): Record<string, number> | null {
  let cur: unknown = node
  for (let i = 0; i < 6; i++) {
    const obj = toObj(cur)
    if (obj == null) return null
    const usage = toObj(obj.usage)
    if (usage != null) return usage as Record<string, number>
    cur = obj.data
    if (cur == null) return null
  }
  return null
}

function DetailRow(props: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className='grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-2.5'>
      <span className='text-muted-foreground min-w-0 text-xs'>{props.label}</span>
      <span
        className={cn(
          'max-w-full min-w-0 text-xs break-all sm:wrap-break-word',
          props.mono && 'font-mono'
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

function JsonBlock({
  title,
  raw,
  copyText,
}: {
  title: string
  raw: string
  copyText: string
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  if (!raw) return null
  return (
    <div className='min-w-0 space-y-1.5'>
      <Label className='text-xs font-semibold'>{title}</Label>
      <div className='bg-muted/30 relative min-w-0 rounded-md border p-2.5'>
        <Button
          variant='ghost'
          size='sm'
          className='absolute top-1.5 right-1.5 h-6 w-6 p-0'
          onClick={() => copyToClipboard(copyText)}
          title={t('Copy to clipboard')}
          aria-label={t('Copy to clipboard')}
        >
          {copiedText === copyText ? (
            <Check className='size-3.5 text-green-600' />
          ) : (
            <Copy className='size-3.5' />
          )}
        </Button>
        <pre className='min-w-0 overflow-x-auto pr-7 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap'>
          {raw}
        </pre>
      </div>
    </div>
  )
}

function isVideoTaskAction(action: string): boolean {
  return (
    action === TASK_ACTIONS.GENERATE ||
    action === TASK_ACTIONS.TEXT_GENERATE ||
    action === TASK_ACTIONS.FIRST_TAIL_GENERATE ||
    action === TASK_ACTIONS.REFERENCE_GENERATE ||
    action === TASK_ACTIONS.REMIX_GENERATE
  )
}

export function TaskDetailDialog({
  log,
  open,
  onOpenChange,
  isAdmin = false,
}: TaskDetailDialogProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  const requestInput = useMemo(
    () => extractRequestInput(log.properties, log.data),
    [log.properties, log.data]
  )
  const upstreamData = useMemo(() => formatData(log.data), [log.data])

  const billingInfo = useMemo(
    () => extractBillingInfo(requestInput, upstreamData),
    [requestInput, upstreamData]
  )

  let inputVideoLabel = '-'
  if (billingInfo.hasInputVideo === true) {
    inputVideoLabel = t('Yes')
  } else if (billingInfo.hasInputVideo === false) {
    inputVideoLabel = t('No')
  }

  const propsObj = useMemo(() => toObj(log.properties), [log.properties])
  const originModel = propsObj?.origin_model_name as string | undefined
  const upstreamModel = propsObj?.upstream_model_name as string | undefined

  const statusLabel = t(taskStatusMapper.getLabel(log.status, log.status || 'Submitting'))
  const statusVariant = taskStatusMapper.getVariant(log.status) as StatusBadgeProps['variant']
  const actionLabel = t(taskActionMapper.getLabel(log.action))

  const isSuccess = log.status === TASK_STATUS.SUCCESS
  const isVideo = isVideoTaskAction(log.action)
  const videoSrc = isSuccess && isVideo ? `/v1/videos/${log.task_id}/content` : undefined

  const timeRow = (key: string, ts?: number) =>
    ts ? (
      <DetailRow
        label={t(key)}
        value={formatTimestampToDate(ts, 'seconds')}
        mono
      />
    ) : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Task Details')}
      description={t('View task details, request payload, upstream response and video')}
      contentClassName='sm:max-w-3xl'
      contentHeight='min(80dvh, 760px)'
      bodyClassName='pr-2 sm:pr-4'
      titleClassName='flex items-center gap-2 text-base'
    >
      <div className='flex flex-col gap-5 py-1'>
        {/* 元数据区 */}
        <div className='grid min-w-0 gap-2 sm:grid-cols-2'>
          <DetailRow
            label={t('Task ID')}
            value={
              <span className='flex items-center gap-1'>
                <span className='font-mono'>{log.task_id}</span>
                <button
                  type='button'
                  onClick={() => copyToClipboard(log.task_id)}
                  title={t('Copy to clipboard')}
                  className='text-muted-foreground hover:text-foreground'
                >
                  {copiedText === log.task_id ? (
                    <Check className='size-3 text-green-600' />
                  ) : (
                    <Copy className='size-3' />
                  )}
                </button>
              </span>
            }
            mono
          />
          <DetailRow label={t('Action')} value={actionLabel} />
          {originModel && (
            <DetailRow label={t('Origin Model')} value={originModel} mono />
          )}
          {isAdmin && upstreamModel && (
            <DetailRow label={t('Upstream Model')} value={upstreamModel} mono />
          )}
          <DetailRow
            label={t('Status')}
            value={
              <StatusBadge
                label={statusLabel}
                variant={statusVariant}
                size='sm'
                copyable={false}
              />
            }
          />
          {/* 当前任务的请求参数（原先只在计费明细块里，那里已移除） */}
          <DetailRow
            label={t('Resolution')}
            value={billingInfo.resolution ?? '-'}
            mono
          />
          <DetailRow
            label={t('Duration')}
            value={
              billingInfo.durationSec != null ? `${billingInfo.durationSec}s` : '-'
            }
            mono
          />
          <DetailRow label={t('Input video')} value={inputVideoLabel} />
          {log.username && (
            <DetailRow
              label={t('User')}
              value={
                <span className='flex items-center gap-1'>
                  {log.username}
                  <span className='text-muted-foreground'>
                    #{log.user_id}
                  </span>
                </span>
              }
            />
          )}
          {log.channel_id > 0 && (
            <DetailRow label={t('Channel')} value={String(log.channel_id)} mono />
          )}
          {log.group && <DetailRow label={t('Group')} value={log.group} mono />}
          {timeRow('Submit Time', log.submit_time)}
          {timeRow('Start Time', log.start_time)}
          {timeRow('Finish Time', log.finish_time)}
        </div>

        {/* 结果 URL / 视频预览 */}
        {(log.result_url || videoSrc) && (
          <div className='min-w-0 space-y-2'>
            {log.result_url && (
              <DetailRow
                label={t('Result URL')}
                value={
                  <span className='flex items-center gap-1.5'>
                    <span className='min-w-0 break-all font-mono text-[11px]'>
                      {log.result_url}
                    </span>
                    <button
                      type='button'
                      onClick={() => copyToClipboard(log.result_url || '')}
                      title={t('Copy to clipboard')}
                      className='text-muted-foreground hover:text-foreground'
                    >
                      {copiedText === log.result_url ? (
                        <Check className='size-3 text-green-600' />
                      ) : (
                        <Copy className='size-3' />
                      )}
                    </button>
                  </span>
                }
              />
            )}

            {videoSrc && (
              <div className='space-y-2'>
                <Label className='flex items-center gap-1.5 text-xs font-semibold'>
                  <PlayCircle className='size-3.5' aria-hidden='true' />
                  {t('Video Preview')}
                </Label>
                <div className='bg-muted/30 overflow-hidden rounded-md border p-3'>
                  <video
                    controls
                    className='max-h-80 w-full rounded'
                    src={videoSrc}
                  />
                </div>
                <a
                  href={videoSrc}
                  download
                  className='inline-flex items-center gap-1.5 text-xs hover:underline'
                >
                  <Download className='size-3.5' aria-hidden='true' />
                  {t('Download video')}
                </a>
              </div>
            )}
          </div>
        )}


        {/* 失败原因 */}
        {log.fail_reason && (
          <DetailRow
            label={t('Fail Reason')}
            value={
              <span className='min-w-0 break-all text-xs text-red-600 dark:text-red-400'>
                {log.fail_reason}
              </span>
            }
          />
        )}

        <ScrollArea className='max-h-[38vh] pr-2'>
          <div className='space-y-3'>
            <JsonBlock
              title={t('Request Input')}
              raw={requestInput}
              copyText={requestInput}
            />
            {/* 上游原始响应里有上游自己的 channel_id / group / user_id / platform，
                会暴露供应方，仅管理员可见 */}
            {isAdmin && (
              <JsonBlock
                title={t('Upstream Response')}
                raw={upstreamData}
                copyText={upstreamData}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </Dialog>
  )
}

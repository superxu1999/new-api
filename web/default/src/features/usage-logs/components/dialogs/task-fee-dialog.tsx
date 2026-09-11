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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Label } from '@/components/ui/label'
import { formatLogQuota, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TASK_STATUS } from '../../constants'
import type { TaskLog } from '../../types'

interface TaskFeeDialogProps {
  log: TaskLog
  open: boolean
  onOpenChange: (open: boolean) => void
  isAdmin?: boolean
}

function FeeRow(props: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className='grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-sm'>
      <span className='text-muted-foreground'>{props.label}</span>
      <span className={cn('min-w-0 font-mono break-all', props.className)}>
        {props.value}
      </span>
    </div>
  )
}

/**
 * 任务费用明细弹窗：解释这一笔任务的钱是怎么来的。
 * 预扣费 / 实付金额 / 差额对所有人可见；分档单价等成本口径仅管理员可见。
 */
export function TaskFeeDialog({
  log,
  open,
  onOpenChange,
  isAdmin = false,
}: TaskFeeDialogProps) {
  const { t } = useTranslation()

  const settled = log.quota
  const preConsumed = log.pre_consumed_quota
  const hasSettlement = preConsumed != null && settled != null
  const delta = hasSettlement ? settled - preConsumed : null
  const isFailure = log.status === TASK_STATUS.FAILURE
  const billing = isAdmin ? log.video_billing : null
  const feeYuanPlain =
    billing != null && billing.tier_price > 0 && billing.token > 0
      ? ((billing.tier_price * billing.token) / 1e6) * billing.multiplier
      : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Billing Details')}
      description={t('How this fee is calculated')}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='space-y-2'>
        <Label className='text-xs font-semibold'>{t('Task ID')}</Label>
        <div className='bg-muted/30 rounded-md border p-3 font-mono text-xs break-all'>
          {log.task_id || '-'}
        </div>
      </div>

      <div className='space-y-2'>
        <Label className='text-xs font-semibold'>{t('Fee')}</Label>
        <div className='bg-muted/30 space-y-2 rounded-md border p-3'>
          {isFailure ? (
            <FeeRow
              label={t('Refund')}
              value={formatLogQuota(settled ?? 0)}
              className='text-green-600 dark:text-green-400'
            />
          ) : (
            <>
              {preConsumed != null && (
                <FeeRow
                  label={t('Pre-consumed')}
                  value={formatLogQuota(preConsumed)}
                />
              )}
              <FeeRow
                label={t('Actual Amount')}
                value={formatLogQuota(settled ?? 0)}
              />
              {delta != null && delta !== 0 && (
                <FeeRow
                  label={t('Difference')}
                  value={`${delta >= 0 ? '+' : '-'}${formatLogQuota(Math.abs(delta))}`}
                  className={
                    delta >= 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-green-600 dark:text-green-400'
                  }
                />
              )}
            </>
          )}
          {log.video_token != null && log.video_token > 0 && (
            <FeeRow
              label={t('Token Usage')}
              value={`${formatTokens(log.video_token)} (${t('Estimated')})`}
            />
          )}
        </div>
      </div>

      {billing && (
        <div className='space-y-2'>
          <Label className='text-xs font-semibold'>
            {t('How this fee is calculated')}
          </Label>
          <div className='bg-muted/30 space-y-2 rounded-md border p-3'>
            <FeeRow
              label={t('Tier price')}
              value={`${billing.tier_price} ${t('CNY per 1M tokens')}${
                billing.resolution ? ` · ${billing.resolution}` : ''
              }${
                billing.has_input_video
                  ? ` · ${t('Input with video')}`
                  : ` · ${t('Input without video')}`
              }`}
            />
            <FeeRow
              label={t('Billing multiplier')}
              value={`${billing.multiplier}×`}
            />
            {feeYuanPlain != null && (
              <FeeRow
                label={t('Formula')}
                value={
                  <span className='text-[11px]'>
                    {billing.tier_price} × {billing.token.toLocaleString()} ÷
                    1,000,000 × {billing.multiplier} = {feeYuanPlain.toFixed(4)}{' '}
                    {t('CNY')}
                  </span>
                }
              />
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}

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
import { Download, FileSpreadsheet } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  dateToUnixTimestamp,
  getEndOfDay,
  getNormalizedDateRange,
  getStartOfDay,
} from '@/lib/time'
import { cn } from '@/lib/utils'

import { exportUsageBill } from '../../api'

type BillRange = { start?: Date; end?: Date }

/** 某个月的首末时刻；offset 为 0 表示本月，-1 表示上月。 */
function monthRange(offset: number): BillRange {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { start: getStartOfDay(first), end: getEndOfDay(last) }
}

const RANGE_PRESETS: Array<{ key: string; label: string; range: () => BillRange }> =
  [
    { key: 'this-month', label: 'This month', range: () => monthRange(0) },
    { key: 'last-month', label: 'Last month', range: () => monthRange(-1) },
    {
      key: 'last-30',
      label: 'Last 30 days',
      range: () => getNormalizedDateRange(30),
    },
    {
      key: 'last-90',
      label: 'Last 90 days',
      range: () => getNormalizedDateRange(90),
    },
  ]

/** 从 Content-Disposition 里取服务端给的文件名；取不到就回退。 */
function downloadFileName(disposition: unknown): string {
  if (typeof disposition !== 'string') {
    return 'usage-bill.csv'
  }
  const matched = /filename="?([^";]+)"?/.exec(disposition)
  return matched?.[1] ?? 'usage-bill.csv'
}

/** 下载接口用 400 + JSON 表达失败，blob 里其实是错误报文，读出来当提示。 */
async function readBlobErrorMessage(error: unknown): Promise<string | null> {
  const data = (error as { response?: { data?: unknown } })?.response?.data
  if (!(data instanceof Blob)) {
    return null
  }
  try {
    const parsed = JSON.parse(await data.text()) as { message?: string }
    return parsed.message ?? null
  } catch {
    return null
  }
}

/**
 * 消费账单导出弹窗。
 *
 * scope='all'（默认，管理员）：导出所有用户 × 模型的汇总，可按用户名过滤。
 * scope='self'（普通用户）：只导出自己的账单——服务端按登录态限定用户维度，
 * 因此这里不显示用户名输入框，传了也会被忽略。
 */
export function UsageBillExportDialog(props: { scope?: 'all' | 'self' }) {
  const { t } = useTranslation()
  const isSelf = props.scope === 'self'
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<BillRange>(() => monthRange(0))
  const [presetKey, setPresetKey] = useState<string | null>('this-month')
  const [username, setUsername] = useState('')
  const [exporting, setExporting] = useState(false)

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) {
      setRange(monthRange(0))
      setPresetKey('this-month')
      setUsername('')
    }
    setOpen(next)
  }, [])

  const handlePreset = useCallback((key: string, preset: () => BillRange) => {
    setRange(preset())
    setPresetKey(key)
  }, [])

  const handleExport = async () => {
    if (!range.start || !range.end) {
      toast.error(t('Select a time range first'))
      return
    }

    setExporting(true)
    try {
      const response = await exportUsageBill(
        {
          start_timestamp: dateToUnixTimestamp(range.start),
          end_timestamp: dateToUnixTimestamp(range.end),
          username: isSelf ? undefined : username.trim() || undefined,
        },
        !isSelf
      )

      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadFileName(
        response.headers['content-disposition']
      )
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      toast.success(t('Bill exported'))
      setOpen(false)
    } catch (error) {
      const message = await readBlobErrorMessage(error)
      toast.error(message || t('Failed to export the bill'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant='outline' size='sm'>
          <FileSpreadsheet className='mr-2 h-4 w-4' />
          {t('Export bill')}
        </Button>
      }
      title={t('Export consumption bill')}
      description={
        isSelf
          ? t('Download a CSV with your own usage total per model for the selected period.')
          : t(
              'Download a CSV with each user and model total for the selected period.'
            )
      }
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => setOpen(false)}
            disabled={exporting}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={handleExport} disabled={exporting}>
            <Download className='mr-2 h-4 w-4' />
            {exporting ? t('Exporting...') : t('Export CSV')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label>{t('Quick Range')}</Label>
          <div className='grid grid-cols-2 gap-2 sm:flex'>
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type='button'
                size='sm'
                variant={presetKey === preset.key ? 'default' : 'outline'}
                onClick={() => handlePreset(preset.key, preset.range)}
                className={cn(
                  'flex-1',
                  presetKey === preset.key &&
                    'ring-ring ring-2 ring-offset-2'
                )}
              >
                {t(preset.label)}
              </Button>
            ))}
          </div>
        </div>

        <div className='grid gap-2.5 sm:grid-cols-2'>
          <div className='grid gap-2'>
            <Label htmlFor='bill-start'>{t('Start Time')}</Label>
            <DateTimePicker
              value={range.start}
              onChange={(date) => {
                setRange((prev) => ({ ...prev, start: date }))
                setPresetKey(null)
              }}
              placeholder={t('Select start time')}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='bill-end'>{t('End Time')}</Label>
            <DateTimePicker
              value={range.end}
              onChange={(date) => {
                setRange((prev) => ({ ...prev, end: date }))
                setPresetKey(null)
              }}
              placeholder={t('Select end time')}
            />
          </div>
        </div>

        {isSelf ? null : (
          <div className='grid gap-2'>
            <Label htmlFor='bill-username'>{t('Username')}</Label>
            <Input
              id='bill-username'
              placeholder={t('Leave empty to export every user')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        )}
      </div>
    </Dialog>
  )
}

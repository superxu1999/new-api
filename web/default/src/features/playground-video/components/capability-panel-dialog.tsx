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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getAssetCapabilities } from '@/features/assets/api'
import { getSelf } from '@/lib/api'
import { formatLogQuota } from '@/lib/format'

import type { VideoInputKind, VideoModelCapability } from '../lib/api'

const INPUT_LABELS: { kind: VideoInputKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'reference_image', label: 'Ref image' },
  { kind: 'first_last_frame', label: 'First/last frame' },
  { kind: 'reference_video', label: 'Ref video' },
  { kind: 'reference_audio', label: 'Ref audio' },
]

interface CapabilityPanelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 与模型列表同源的能力声明，避免这里再拉一份。 */
  capabilities: VideoModelCapability[]
}

/**
 * 「我的能力」面板：回答用户在最开始就会问的三个问题 ——
 * 我有哪些权限、我还剩多少额度、我能用哪些模型（各自能吃什么）。
 *
 * 数据全部来自后端（权限开关与配额由服务端判定，模型能力与模型列表同源），
 * 前端只做展示，不自行推断「我应该有什么权限」。
 */
export function CapabilityPanelDialog(props: CapabilityPanelDialogProps) {
  const { t } = useTranslation()
  const { data: account } = useQuery({
    queryKey: ['studio-account'],
    queryFn: getSelf,
    enabled: props.open,
  })
  const { data: assetCapabilities } = useQuery({
    queryKey: ['studio-asset-capabilities'],
    queryFn: getAssetCapabilities,
    enabled: props.open,
  })
  const user = account?.data as
    | { quota?: number; used_quota?: number; group?: string }
    | undefined

  const switchRow = (label: string, enabled: boolean | undefined) => (
    <div className='flex items-center justify-between gap-3 py-1'>
      <span className='text-sm'>{label}</span>
      <Badge variant={enabled ? 'default' : 'secondary'}>
        {enabled ? t('Available') : t('Not available')}
      </Badge>
    </div>
  )

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('My capabilities')}
      description={t(
        'Your permissions and the video models available to your account.'
      )}
      contentClassName='sm:max-w-2xl'
    >
      <div className='flex flex-col gap-5'>
        <section className='flex flex-col gap-1'>
          <h4 className='text-sm font-medium'>{t('Account permissions')}</h4>
          {switchRow(
            t('Material library'),
            assetCapabilities?.asset_library_enabled
          )}
          {switchRow(
            t('Upload materials'),
            assetCapabilities?.asset_upload_enabled
          )}
          {switchRow(t('Real-person verification'), assetCapabilities?.real_person_available)}
          {user?.group && (
            <div className='flex items-center justify-between gap-3 py-1'>
              <span className='text-sm'>{t('Group')}</span>
              <span className='text-muted-foreground text-sm'>{user.group}</span>
            </div>
          )}
        </section>

        <section className='flex flex-col gap-1'>
          <h4 className='text-sm font-medium'>{t('Quota')}</h4>
          <div className='flex items-center justify-between gap-3 py-1'>
            <span className='text-sm'>{t('Remaining')}</span>
            <span className='text-sm'>
              {user?.quota === undefined ? '-' : formatLogQuota(user.quota)}
            </span>
          </div>
          <div className='flex items-center justify-between gap-3 py-1'>
            <span className='text-sm'>{t('Used')}</span>
            <span className='text-muted-foreground text-sm'>
              {user?.used_quota === undefined
                ? '-'
                : formatLogQuota(user.used_quota)}
            </span>
          </div>
        </section>

        <section className='flex flex-col gap-2'>
          <div className='flex items-center justify-between gap-2'>
            <h4 className='text-sm font-medium'>{t('Video models')}</h4>
            <span className='text-muted-foreground text-xs'>
              {t('{{count}} available', { count: props.capabilities.length })}
            </span>
          </div>
          {props.capabilities.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {t('No video models are available for your account.')}
            </p>
          ) : (
            <ScrollArea className='max-h-[40vh] pr-2'>
              <div className='flex flex-col gap-2'>
                {props.capabilities.map((item) => (
                  <div
                    key={item.model}
                    className='flex flex-col gap-1 rounded-lg border p-2.5'
                  >
                    <span className='truncate text-sm font-medium'>
                      {item.model}
                    </span>
                    <span className='flex flex-wrap gap-1'>
                      {INPUT_LABELS.filter((option) =>
                        item.inputs.includes(option.kind)
                      ).map((option) => (
                        <Badge
                          key={option.kind}
                          variant='secondary'
                          className='text-[10px] font-normal'
                        >
                          {t(option.label)}
                        </Badge>
                      ))}
                      {item.returns_last_frame && (
                        <Badge variant='outline' className='text-[10px] font-normal'>
                          {t('Returns last frame')}
                        </Badge>
                      )}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {item.duration.max > 0
                        ? `${item.duration.min}-${item.duration.max}s`
                        : '-'}
                      {item.resolutions.length > 0
                        ? ` · ${item.resolutions.join(' / ')}`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </section>
      </div>
    </Dialog>
  )
}

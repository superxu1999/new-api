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

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { formatTimestampToDate } from '@/lib/format'

import { getAsset } from '../api'
import { assetStatusVariant } from '../lib/asset-status'

interface AssetDetailDialogProps {
  assetId: number
  onOpenChange: (open: boolean) => void
}

/**
 * 素材详情：打开时向 `GET /v1/assets/{id}` 取一次，顺带同步上游状态。
 * 直传素材的来源地址是本站在线地址，公网 URL 方式入库的则是用户提交的地址。
 */
export function AssetDetailDialog(props: AssetDetailDialogProps) {
  const { t } = useTranslation()
  const open = props.assetId > 0
  const detailQuery = useQuery({
    queryKey: ['asset-detail', props.assetId],
    queryFn: () => getAsset(props.assetId),
    enabled: open,
    retry: false,
  })
  const asset = detailQuery.data

  const rows: [string, string][] = asset
    ? [
        [t('ID'), `asset://${asset.id}`],
        [t('Name'), asset.name],
        [t('Type'), asset.asset_type],
        [t('Channel'), `#${asset.channel_id}`],
        [t('Created At'), formatTimestampToDate(asset.created_at)],
      ]
    : []

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Material detail')}</DialogTitle>
        </DialogHeader>
        {detailQuery.isLoading && (
          <div className='text-muted-foreground flex items-center gap-2 text-sm'>
            <Spinner /> {t('Loading...')}
          </div>
        )}
        {asset && (
          <div className='space-y-3 text-sm'>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground'>{t('Status')}</span>
              <Badge variant={assetStatusVariant(asset.status)}>
                {asset.status}
              </Badge>
              {asset.fail_reason !== '' && (
                <span className='text-destructive text-xs'>
                  {asset.fail_reason}
                </span>
              )}
            </div>
            <div className='space-y-1'>
              {rows.map(([label, value]) => (
                <div key={label} className='flex items-start gap-2'>
                  <span className='text-muted-foreground w-20 shrink-0'>
                    {label}
                  </span>
                  <span className='min-w-0 flex-1 break-all'>{value}</span>
                  {label === t('ID') && (
                    <CopyButton value={value} size='sm' variant='outline' />
                  )}
                </div>
              ))}
            </div>
            {asset.source_url !== '' && (
              <div className='space-y-1'>
                <span className='text-muted-foreground'>{t('Source')}</span>
                <div className='flex items-center gap-2'>
                  <a
                    className='text-primary min-w-0 flex-1 truncate text-xs underline'
                    href={asset.source_url}
                    target='_blank'
                    rel='noreferrer'
                  >
                    {asset.source_url}
                  </a>
                  <CopyButton
                    value={asset.source_url}
                    size='sm'
                    variant='outline'
                  />
                </div>
              </div>
            )}
            {asset.asset_type === 'Image' && asset.source_url !== '' && (
              <img
                src={asset.source_url}
                alt={asset.name}
                className='max-h-64 w-full rounded-md border object-contain'
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

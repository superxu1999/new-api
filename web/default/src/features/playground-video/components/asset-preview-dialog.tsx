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
import { Badge } from '@/components/ui/badge'
import type { Asset } from '@/features/assets/types'

import { assetPreviewUrl } from '../lib/asset'

interface AssetPreviewDialogProps {
  asset: Asset | null
  onOpenChange: (open: boolean) => void
}

/** 按素材类型选渲染器；没有可访问地址时给一句说明，不留白框。 */
function renderPreview(asset: Asset, url: string, emptyText: string) {
  if (!url) {
    return <span className='text-muted-foreground p-8 text-sm'>{emptyText}</span>
  }
  if (asset.asset_type === 'Video') {
    return <video controls className='max-h-[60vh] w-full' src={url} />
  }
  if (asset.asset_type === 'Audio') {
    return <audio controls className='w-full p-4' src={url} />
  }
  return (
    <img
      src={url}
      alt={asset.name}
      className='max-h-[60vh] w-full object-contain'
    />
  )
}

/** 素材大图预览：缩略图太小，挑素材时经常需要放大确认人物/构图是否可用。 */
export function AssetPreviewDialog(props: AssetPreviewDialogProps) {
  const { t } = useTranslation()
  const asset = props.asset
  const url = asset ? assetPreviewUrl(asset) : ''

  return (
    <Dialog
      open={asset !== null}
      onOpenChange={props.onOpenChange}
      title={asset?.name ?? ''}
      description={asset ? t(asset.asset_type) : undefined}
      contentClassName='sm:max-w-3xl'
    >
      {asset && (
        <div className='flex flex-col gap-3'>
          <div className='bg-muted flex max-h-[60vh] items-center justify-center overflow-hidden rounded-lg border'>
            {renderPreview(asset, url, t('No preview available'))}
          </div>
          <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-xs'>
            <Badge variant='secondary'>{t(asset.asset_type)}</Badge>
            <Badge variant={asset.status === 'ACTIVE' ? 'default' : 'secondary'}>
              {asset.status}
            </Badge>
            <span>
              {t('Material ID')}: {asset.id}
            </span>
          </div>
        </div>
      )}
    </Dialog>
  )
}

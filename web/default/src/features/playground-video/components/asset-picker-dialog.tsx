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
import { Check, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Asset, AssetType } from '@/features/assets/types'
import { cn } from '@/lib/utils'

import { listLibraryAssets } from '../lib/api'
import { AssetThumb } from './asset-thumb'

/** 类型筛选（含「全部」）。素材库里的东西按类型筛最直观。 */
const TYPE_FILTERS: Array<{ value: AssetType | 'all'; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'Image', label: 'Image' },
  { value: 'Video', label: 'Video' },
  { value: 'Audio', label: 'Audio' },
]

interface AssetPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 批量引入：返回用户勾选的素材（按素材库顺序）。 */
  onPick: (assets: Asset[]) => void
}

/**
 * 从素材库引入素材：搜索 + 类型筛选 + 多选。
 *
 * 素材多了以后「只能翻前 100 条」等于没有选择器，所以搜索与筛选是底线功能；
 * 多选是因为真实用法是一次给首帧/尾帧/参考图各挑一张，逐个点开效率太低。
 */
export function AssetPickerDialog(props: AssetPickerDialogProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all')
  // 用 id 集合而不是数组：勾选/取消是集合操作，渲染时再按素材库顺序输出。
  const [pickedIds, setPickedIds] = useState<Set<number>>(() => new Set())

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['playground-video-asset-picker', keyword],
    queryFn: () => listLibraryAssets(keyword.trim() || undefined),
    enabled: props.open,
  })

  const visible = useMemo(() => {
    if (typeFilter === 'all') {
      return assets
    }
    return assets.filter((asset) => asset.asset_type === typeFilter)
  }, [assets, typeFilter])

  const toggle = (id: number) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const confirm = () => {
    const picked = assets.filter((asset) => pickedIds.has(asset.id))
    if (picked.length === 0) {
      return
    }
    props.onPick(picked)
    setPickedIds(new Set())
    setKeyword('')
    setTypeFilter('all')
  }

  let content: ReactNode
  if (isLoading) {
    content = (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        {t('Loading...')}
      </p>
    )
  } else if (visible.length === 0) {
    content = (
      <p className='text-muted-foreground py-8 text-center text-sm'>
        {assets.length === 0
          ? t('No ready materials yet. Upload one first.')
          : t('No materials match your search.')}
      </p>
    )
  } else {
    content = (
      <div className='grid max-h-[50vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4'>
        {visible.map((asset) => {
          const picked = pickedIds.has(asset.id)
          return (
            <button
              key={asset.id}
              type='button'
              onClick={() => toggle(asset.id)}
              className={cn(
                'relative flex flex-col gap-1 rounded-lg border p-2 text-left transition-colors',
                picked
                  ? 'border-primary ring-primary/30 ring-2'
                  : 'hover:border-primary/60'
              )}
            >
              {picked && (
                <span className='bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full'>
                  <Check className='h-3 w-3' />
                </span>
              )}
              <div className='bg-muted flex h-20 items-center justify-center overflow-hidden rounded-md'>
                <AssetThumb asset={asset} />
              </div>
              <span className='truncate text-xs font-medium'>{asset.name}</span>
              <Badge variant='secondary' className='w-fit text-[10px]'>
                {t(asset.asset_type)}
              </Badge>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Import from library')}
      description={t(
        'Search and select one or more materials. Only materials that are ready to use are listed.'
      )}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => setPickedIds(new Set())}
            disabled={pickedIds.size === 0}
          >
            {t('Clear selection')}
          </Button>
          <Button type='button' disabled={pickedIds.size === 0} onClick={confirm}>
            {pickedIds.size > 0
              ? t('Add {{count}} materials', { count: pickedIds.size })
              : t('Add materials')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <div className='relative'>
          <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('Search materials')}
            className='pl-8'
          />
        </div>
        <div className='flex flex-wrap gap-1'>
          {TYPE_FILTERS.map((item) => {
            const active = typeFilter === item.value
            return (
              <button
                key={item.value}
                type='button'
                onClick={() => setTypeFilter(item.value)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground border-border/60 hover:border-primary/50'
                )}
              >
                {t(item.label)}
              </button>
            )
          })}
        </div>
        {content}
      </div>
    </Dialog>
  )
}

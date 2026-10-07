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
import { Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Asset } from '@/features/assets/types'
import { cn } from '@/lib/utils'

import type { AssetRole, TrayItem } from '../lib/capability'
import {
  fetchAssetGroups,
  resolveDefaultAssetGroup,
  uploadAndPersistAsset,
} from '../lib/api'
import { AssetPickerDialog } from './asset-picker-dialog'
import { AssetPreviewDialog } from './asset-preview-dialog'
import { AssetThumb } from './asset-thumb'

const ROLE_OPTIONS: { value: AssetRole; label: string }[] = [
  { value: 'first_frame', label: 'First frame' },
  { value: 'last_frame', label: 'Last frame' },
  { value: 'reference_image', label: 'Reference image' },
  { value: 'reference_video', label: 'Reference video' },
  { value: 'reference_audio', label: 'Reference audio' },
]

/** 依据素材类型给出默认角色：图片默认首帧，视频/音频默认参考。 */
function defaultRoleFor(asset: Asset): AssetRole {
  if (asset.asset_type === 'Video') {
    return 'reference_video'
  }
  if (asset.asset_type === 'Audio') {
    return 'reference_audio'
  }
  return 'first_frame'
}

interface AssetTrayProps {
  items: TrayItem[]
  onChange: (items: TrayItem[]) => void
}

/**
 * 素材托盘：两个入口——从素材库引入、直接上传。
 *
 * 上传即入库（本站暂存 + 登记素材库），因此传一次就能在后续任务里复用；
 * 上传能力默认关闭，未开通时后端会返回明确错误，这里只负责把错误展示出来。
 */
export function AssetTray(props: AssetTrayProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null)

  const appendAsset = (asset: Asset) => {
    props.onChange([
      ...props.items,
      {
        key: `${asset.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        asset,
        role: defaultRoleFor(asset),
      },
    ])
  }

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return
      }
      setUploading(true)
      try {
        // 组只解析一次，整批文件共用：避免多选上传时并发建出多个默认组。
        const group = await resolveDefaultAssetGroup(await fetchAssetGroups())
        for (const file of files) {
          const asset = await uploadAndPersistAsset(file, group)
          appendAsset(asset)
        }
        toast.success(t('Material uploaded'))
      } catch {
        // 具体原因（未开通上传能力、格式不支持等）由接口层统一提示。
      } finally {
        setUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    // appendAsset 依赖 props.items，items 变化本就该重建，无需额外依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.items, t]
  )

  // 粘贴上传：截图后直接 Ctrl+V 是最常用的动作。
  // 只在剪贴板里真的有文件时才接管（纯文本粘贴一律放行，不影响正常输入）。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files || files.length === 0) {
        return
      }
      event.preventDefault()
      void uploadFiles([...files])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploadFiles])

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) {
      return
    }
    void uploadFiles([...files])
  }

  const updateRole = (key: string, role: AssetRole) => {
    props.onChange(
      props.items.map((item) => (item.key === key ? { ...item, role } : item))
    )
  }

  const removeItem = (key: string) => {
    props.onChange(props.items.filter((item) => item.key !== key))
  }

  // 后端要求一次任务里所有素材来自同一渠道（asset_channel_mismatch 会拒绝提交）。
  // 素材落在哪个渠道是入库时决定的，用户无感知；托盘里提前暴露这个冲突，
  // 比提交后才报错友好得多。
  const channelConflict =
    new Set(props.items.map((item) => item.asset.channel_id)).size > 1

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg transition-colors',
        dragActive && 'bg-primary/5 ring-primary/40 ring-2'
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-sm font-medium'>{t('Materials')}</h3>
        <span className='text-muted-foreground text-xs'>
          {props.items.length > 0
            ? t('{{count}} selected', { count: props.items.length })
            : t('Optional')}
        </span>
      </div>

      {props.items.length === 0 ? (
        <div className='text-muted-foreground border-muted-foreground/30 flex h-24 items-center justify-center rounded-lg border border-dashed px-3 text-center text-xs'>
          {dragActive
            ? t('Drop files here to upload')
            : t('Add materials to generate from images or videos')}
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {channelConflict && (
            <p className='text-destructive text-xs'>
              {t(
                'Materials in one task must come from the same channel. Remove some to continue.'
              )}
            </p>
          )}
          {props.items.map((item) => (
            <div
              key={item.key}
              className='flex items-center gap-2 rounded-lg border p-2'
            >
              <button
                type='button'
                className='bg-muted h-10 w-10 shrink-0 overflow-hidden rounded-md'
                title={t('Preview')}
                onClick={() => setPreviewAsset(item.asset)}
              >
                <AssetThumb asset={item.asset} />
              </button>
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <span className='truncate text-xs font-medium'>
                  {item.asset.name}
                </span>
                <Select
                  value={item.role}
                  onValueChange={(value) =>
                    value && updateRole(item.key, value as AssetRole)
                  }
                >
                  <SelectTrigger className='h-6 text-xs'>
                    {/* 显式给文本：角色的 value 是内部枚举（first_frame 等），
                        交给 SelectValue 自动反查有概率把原始值亮给用户。 */}
                    <SelectValue>
                      {t(
                        ROLE_OPTIONS.find(
                          (option) => option.value === item.role
                        )?.label ?? 'First frame'
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='text-muted-foreground h-7 w-7 shrink-0'
                aria-label={t('Remove')}
                onClick={() => removeItem(item.key)}
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='flex-1'
          onClick={() => setPickerOpen(true)}
        >
          {t('Import from library')}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='flex-1'
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className='h-4 w-4' />
          {uploading ? t('Uploading...') : t('Upload')}
        </Button>
        <input
          ref={fileInputRef}
          type='file'
          accept='image/*,video/*,audio/*'
          multiple
          className='hidden'
          onChange={(event) => {
            const files = event.target.files
            if (files) {
              void uploadFiles([...files])
            }
          }}
        />
      </div>

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(assets) => {
          // 批量引入：每张素材都过一遍 appendAsset，角色按类型给默认值，用户再逐个调整。
          for (const asset of assets) {
            appendAsset(asset)
          }
          setPickerOpen(false)
        }}
      />

      <AssetPreviewDialog
        asset={previewAsset}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAsset(null)
          }
        }}
      />
    </div>
  )
}

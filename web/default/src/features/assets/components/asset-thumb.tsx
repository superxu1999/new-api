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
import { Film, Music } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { assetPreviewUrl } from '../lib/asset-preview-url'
import type { Asset } from '../types'

interface AssetThumbProps {
  asset: Asset
  className?: string
}

/**
 * 素材缩略图：图片直接出图，视频出首帧，音频出图标+时长。
 *
 * 视频用 <video preload="metadata"> 让浏览器只拉首帧而不是整段文件；
 * 音频时长同样只读 metadata，拿不到时就退化成纯图标。
 */
export function AssetThumb(props: AssetThumbProps) {
  const { t } = useTranslation()
  const url = assetPreviewUrl(props.asset)

  if (props.asset.asset_type === 'Image' && url) {
    return (
      <img
        src={url}
        alt={props.asset.name}
        className={cn('h-full w-full object-cover', props.className)}
      />
    )
  }

  if (props.asset.asset_type === 'Video' && url) {
    return (
      <div
        className={cn(
          'bg-muted relative flex h-full w-full items-center justify-center overflow-hidden',
          props.className
        )}
      >
        <video
          src={`${url}#t=0.1`}
          preload='metadata'
          muted
          playsInline
          className='h-full w-full object-cover'
        />
        <Film className='text-background/90 absolute right-1 bottom-1 h-3 w-3 drop-shadow' />
      </div>
    )
  }

  if (props.asset.asset_type === 'Audio' && url) {
    return <AudioThumb url={url} className={props.className} />
  }

  return (
    <span className='text-muted-foreground flex h-full w-full items-center justify-center text-[10px]'>
      {t(props.asset.asset_type)}
    </span>
  )
}

/** 音频占位：音符图标 + 时长（只加载 metadata，不下载整段音频）。 */
function AudioThumb(props: { url: string; className?: string }) {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.src = props.url
    const onLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setSeconds(Math.round(audio.duration))
      }
    }
    audio.addEventListener('loadedmetadata', onLoaded)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.src = ''
    }
  }, [props.url])

  return (
    <div
      className={cn(
        'bg-muted text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-0.5',
        props.className
      )}
    >
      <Music className='h-4 w-4' />
      {seconds !== null && (
        <span className='text-[10px] leading-none'>{seconds}s</span>
      )}
    </div>
  )
}

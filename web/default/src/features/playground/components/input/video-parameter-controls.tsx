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

import type { VideoGenerationParams } from '../../types'

const RATIO_OPTIONS = ['', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const RESOLUTION_OPTIONS = ['', '480p', '720p', '1080p']

type VideoParameterControlsProps = {
  disabled?: boolean
  value: VideoGenerationParams
  onChange: (params: VideoGenerationParams) => void
}

/**
 * 视频生成参数行(仅视频模型显示):比例/分辨率/水印/音频/seed。
 * 值通过 body.metadata 透传给上游(移动云/百拓)。
 */
export function VideoParameterControls({
  disabled,
  value,
  onChange,
}: VideoParameterControlsProps) {
  const { t } = useTranslation()

  const set = (patch: Partial<VideoGenerationParams>) =>
    onChange({ ...value, ...patch })

  // 控件统一 h-8,与 footer 时长输入/按钮同高,保证整条输入区基准线一致
  const controlCls =
    'border-border/40 bg-background h-8 rounded-md border px-2 text-xs'

  const selectCls = `${controlCls} min-w-16`

  const divider = (
    <div
      aria-hidden='true'
      className='bg-border/70 hidden h-4 w-px md:block'
    />
  )

  return (
    <div className='border-border/40 bg-muted/10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-xs text-muted-foreground'>
      {/* 输入型参数:比例 / 分辨率 / 随机种子 */}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <label className='flex items-center gap-1.5'>
          <span className='shrink-0'>{t('Aspect ratio')}</span>
          <select
            className={selectCls}
            disabled={disabled}
            onChange={(e) => set({ ratio: e.target.value || undefined })}
            value={value.ratio ?? ''}
          >
            {RATIO_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === '' ? t('Adaptive') : r}
              </option>
            ))}
          </select>
        </label>

        <label className='flex items-center gap-1.5'>
          <span className='shrink-0'>{t('Resolution')}</span>
          <select
            className={selectCls}
            disabled={disabled}
            onChange={(e) => set({ resolution: e.target.value || undefined })}
            value={value.resolution ?? ''}
          >
            {RESOLUTION_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === '' ? t('Default') : r}
              </option>
            ))}
          </select>
        </label>

        <label className='flex items-center gap-1.5'>
          <span className='shrink-0'>{t('Seed')}</span>
          <input
            className={`${controlCls} w-20`}
            disabled={disabled}
            min={-1}
            onChange={(e) => {
              const raw = e.target.value
              set({ seed: raw === '' ? undefined : Number(raw) })
            }}
            placeholder='-1'
            type='number'
            value={value.seed ?? ''}
          />
        </label>
      </div>

      {divider}

      {/* 开关型参数:水印 / 生成音频 */}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <label className='flex h-8 cursor-pointer items-center gap-1.5'>
          <input
            checked={value.watermark ?? false}
            className='size-3.5'
            disabled={disabled}
            onChange={(e) => set({ watermark: e.target.checked })}
            type='checkbox'
          />
          {t('Watermark')}
        </label>

        <label className='flex h-8 cursor-pointer items-center gap-1.5'>
          <input
            checked={value.generateAudio ?? true}
            className='size-3.5'
            disabled={disabled}
            onChange={(e) => set({ generateAudio: e.target.checked })}
            type='checkbox'
          />
          {t('Generate audio')}
        </label>
      </div>
    </div>
  )
}

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
// 各上游支持的分辨率不同:多数 seedance 源支持 480p/720p/1080p,GlobalAiOpc 只认 720p/1080p/2k/4k,CyAI 只认 480p/720p/1080p/4k(不接受 2k)
const RESOLUTION_OPTIONS = ['', '480p', '720p', '1080p']
const GLOBALAIOPC_RESOLUTION_OPTIONS = ['', '720p', '1080p', '2k', '4k']
const CYAI_RESOLUTION_OPTIONS = ['', '480p', '720p', '1080p', '4k']
// Seed 为非负随机种子;留空表示随机,相同 seed + prompt 结果更接近
const SEED_MIN = 0
const SEED_MAX = 2147483647

function resolutionOptionsFor(model?: string): string[] {
  if (model?.includes('globalaiopc')) return GLOBALAIOPC_RESOLUTION_OPTIONS
  if (model?.includes('cyai')) return CYAI_RESOLUTION_OPTIONS
  return RESOLUTION_OPTIONS
}

type VideoParameterControlsProps = {
  disabled?: boolean
  model?: string
  value: VideoGenerationParams
  onChange: (params: VideoGenerationParams) => void
  videoDuration?: string
  onVideoDurationChange?: (value: string) => void
}

/** 时长为选中项之一;其它取值(如空串)时回退到 11,避免显示为空 */
const DURATION_OPTIONS = [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
// CyAI 上游不支持 -1(自动) 时长,去掉该项,避免上报 400 invalid_seconds
const CYAI_DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

function durationOptionsFor(model?: string): number[] {
  return model?.includes('cyai') ? CYAI_DURATION_OPTIONS : DURATION_OPTIONS
}

/**
 * 视频生成参数行(仅视频模型显示):时长/比例/分辨率/水印/音频/seed。
 * 值通过 body.metadata 透传给上游(移动云/百拓/GlobalAiOpc)。
 */
export function VideoParameterControls({
  disabled,
  model,
  value,
  onChange,
  videoDuration = '11',
  onVideoDurationChange,
}: VideoParameterControlsProps) {
  const { t } = useTranslation()

  const set = (patch: Partial<VideoGenerationParams>) =>
    onChange({ ...value, ...patch })

  // 当前模型对应的合法分辨率选项;若已选值不在其中,回退到默认(空=上游默认)
  const resolutionOptions = resolutionOptionsFor(model)
  const curResolution = resolutionOptions.includes(value.resolution ?? '')
    ? (value.resolution ?? '')
    : ''

  // 当前模型对应的合法时长选项(CyAI 不支持 -1 自动)
  const durationOptions = durationOptionsFor(model)

  // 控件统一 h-8,与 footer 输入/按钮同高,保证整条输入区基准线一致
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
      {/* 输入型参数:时长 / 比例 / 分辨率 / 随机种子 */}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <label className='flex items-center gap-1.5'>
          <span className='shrink-0'>{t('Duration (s)')}</span>
          <select
            className={selectCls}
            disabled={disabled}
            onChange={(e) => onVideoDurationChange?.(e.target.value)}
            title={t('4-15 seconds, or -1 for automatic')}
            value={durationOptions.includes(Number(videoDuration))
              ? videoDuration
              : '11'}
          >
            {durationOptions.map((s) => (
              <option key={s} value={String(s)}>
                {s === -1 ? t('Auto') : s}
              </option>
            ))}
          </select>
        </label>

        <label className='flex items-center gap-1.5'>
          <span className='shrink-0'>{t('Aspect ratio')}</span>
          <select
            className={selectCls}
            disabled={disabled}
            onChange={(e) => set({ ratio: e.target.value || undefined })}
            title={t('Aspect ratio of the generated video')}
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
            title={t('Resolution of the generated video')}
            value={curResolution}
          >
            {resolutionOptions.map((r) => (
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
            max={SEED_MAX}
            min={SEED_MIN}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                set({ seed: undefined })
                return
              }
              const num = Number(raw)
              set({ seed: Number.isNaN(num) ? undefined : Math.trunc(num) })
            }}
            placeholder='0'
            step={1}
            title={t('Random seed; leave empty for random')}
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

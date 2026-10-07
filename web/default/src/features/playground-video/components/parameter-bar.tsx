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

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import type { VideoModelCapability } from '../lib/api'
import {
  durationPresetsFor,
  isDurationValid,
  type VideoParams,
} from '../lib/params'

const controlClassName =
  'border-border/60 bg-background h-8 rounded-md border px-2 text-xs'

interface ParameterBarProps {
  capability?: VideoModelCapability
  value: VideoParams
  onChange: (next: VideoParams) => void
  disabled?: boolean
}

/** 档位按钮：选中态用主色描边，未选中是普通描边，禁用时降透明度。 */
function OptionChip(props: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  title?: string
}) {
  return (
    <button
      type='button'
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      className={cn(
        'h-8 rounded-md border px-2.5 text-xs transition-colors',
        props.active
          ? 'border-primary bg-primary/10 text-primary font-medium'
          : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-foreground',
        props.disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {props.label}
    </button>
  )
}

/**
 * 参数区：选项全部来自模型能力声明。
 *
 * 时长用「常用档按钮 + 数字输入」：能力区间大的模型（如 4-30s）不会再渲染一长串下拉项。
 * 分辨率/比例用按钮组，一眼看清全部可选值，不用点开下拉。
 * 能力声明给什么就出什么，不支持的开关不显示——「能选的一定能提交」。
 */
export function ParameterBar(props: ParameterBarProps) {
  const { t } = useTranslation()
  const capability = props.capability
  const patch = (next: Partial<VideoParams>) =>
    props.onChange({ ...props.value, ...next })

  if (!capability) {
    // 没选模型时不留一片空白：把接下来要做的三步写出来，新用户才知道从哪下手。
    return (
      <div className='flex flex-col gap-2'>
        <h3 className='text-sm font-medium'>{t('Parameters')}</h3>
        <ol className='text-muted-foreground flex list-inside list-decimal flex-col gap-1 text-xs'>
          <li>{t('Add materials from the library or upload them (optional)')}</li>
          <li>{t('Pick a model on the right')}</li>
          <li>{t('Write a prompt and generate')}</li>
        </ol>
      </div>
    )
  }

  const presets = durationPresetsFor(capability)
  const hasDuration = capability.duration.max > 0
  const durationInvalid =
    props.value.duration !== '' &&
    !isDurationValid(props.value.duration, capability)

  return (
    <div className='flex flex-col gap-4'>
      {/* 时长：快捷档 + 数字输入 */}
      {hasDuration && (
        <div className='flex flex-col gap-1.5'>
          <Label className='text-xs'>
            {t('Duration (s)')}
            <span className='text-muted-foreground ml-2 font-normal'>
              {capability.duration.allow_auto
                ? t('{{min}}-{{max}} seconds, or -1 for automatic', {
                    min: capability.duration.min,
                    max: capability.duration.max,
                  })
                : t('{{min}}-{{max}} seconds', {
                    min: capability.duration.min,
                    max: capability.duration.max,
                  })}
            </span>
          </Label>
          <div className='flex flex-wrap items-center gap-1.5'>
            {capability.duration.allow_auto && (
              <OptionChip
                active={props.value.duration === '-1'}
                disabled={props.disabled}
                onClick={() => patch({ duration: '-1' })}
                label={t('Auto')}
                title={t('Let the model choose the duration')}
              />
            )}
            {presets.map((second) => (
              <OptionChip
                key={second}
                active={props.value.duration === String(second)}
                disabled={props.disabled}
                onClick={() => patch({ duration: String(second) })}
                label={`${second}s`}
              />
            ))}
            <input
              className={cn(
                controlClassName,
                'w-20',
                durationInvalid && 'border-destructive'
              )}
              disabled={props.disabled}
              min={capability.duration.min}
              max={capability.duration.max}
              step={1}
              type='number'
              placeholder={t('Custom')}
              title={t('Custom duration in seconds')}
              value={
                props.value.duration === '-1' ? '' : props.value.duration
              }
              onChange={(event) => patch({ duration: event.target.value })}
            />
          </div>
          {durationInvalid && (
            <p className='text-destructive text-xs'>
              {t('Duration must be between {{min}} and {{max}} seconds', {
                min: capability.duration.min,
                max: capability.duration.max,
              })}
            </p>
          )}
        </div>
      )}

      <div className='flex flex-wrap items-end gap-x-6 gap-y-4'>
        {/* 分辨率：按钮组 */}
        {capability.resolutions.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>{t('Resolution')}</Label>
            <div className='flex flex-wrap items-center gap-1.5'>
              <OptionChip
                active={props.value.resolution === ''}
                disabled={props.disabled}
                onClick={() => patch({ resolution: '' })}
                label={t('Default')}
              />
              {capability.resolutions.map((resolution) => (
                <OptionChip
                  key={resolution}
                  active={props.value.resolution === resolution}
                  disabled={props.disabled}
                  onClick={() => patch({ resolution })}
                  label={resolution}
                />
              ))}
            </div>
          </div>
        )}

        {/* 比例：按钮组 */}
        {capability.ratios.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>{t('Aspect ratio')}</Label>
            <div className='flex flex-wrap items-center gap-1.5'>
              <OptionChip
                active={props.value.ratio === ''}
                disabled={props.disabled}
                onClick={() => patch({ ratio: '' })}
                label={t('Default')}
              />
              {capability.ratios.map((ratio) => (
                <OptionChip
                  key={ratio}
                  active={props.value.ratio === ratio}
                  disabled={props.disabled}
                  onClick={() => patch({ ratio })}
                  label={ratio === 'adaptive' ? t('Adaptive') : ratio}
                />
              ))}
            </div>
          </div>
        )}

        {/* Seed */}
        {capability.supports_seed && (
          <div className='flex flex-col gap-1.5'>
            <Label className='text-xs'>{t('Seed')}</Label>
            <input
              className={`${controlClassName} w-24`}
              disabled={props.disabled}
              min={0}
              step={1}
              type='number'
              placeholder='0'
              title={t('Random seed; leave empty for random')}
              value={props.value.seed}
              onChange={(event) => patch({ seed: event.target.value })}
            />
          </div>
        )}
      </div>

      {(capability.supports_audio || capability.supports_watermark) && (
        <div className='flex flex-wrap items-center gap-6'>
          {capability.supports_audio && (
            <label className='flex items-center gap-2 text-xs'>
              <Switch
                disabled={props.disabled}
                checked={props.value.generateAudio}
                onCheckedChange={(checked) => patch({ generateAudio: checked })}
              />
              {t('Generate audio')}
            </label>
          )}
          {capability.supports_watermark && (
            <label className='flex items-center gap-2 text-xs'>
              <Switch
                disabled={props.disabled}
                checked={props.value.watermark}
                onCheckedChange={(checked) => patch({ watermark: checked })}
              />
              {t('Watermark')}
            </label>
          )}
        </div>
      )}
    </div>
  )
}

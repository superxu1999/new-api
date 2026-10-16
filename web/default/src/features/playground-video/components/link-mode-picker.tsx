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

import { cn } from '@/lib/utils'

import type { ChainLinkMode } from '../lib/chain'

interface LinkModePickerProps {
  value: ChainLinkMode
  onChange: (value: ChainLinkMode) => void
  /** 模型会返回尾帧（能力声明 returns_last_frame）。 */
  supportsLastFrame: boolean
  /** 模型收参考视频（能力声明 inputs 含 reference_video）。 */
  supportsReferenceVideo: boolean
  className?: string
}

/**
 * 衔接方式选择：尾帧续接 / 成片续接。
 *
 * 两种方式的语义与代价都不同（尾帧连贯但只有部分渠道给得出；成片通用但有损且
 * 计费档不同），所以必须让用户显式选——静默降级会让人以为拿到了尾帧级连续性。
 * 两种都不支持时整块置灰，由调用方决定是否还显示这段 UI。
 */
export function LinkModePicker(props: LinkModePickerProps) {
  const { t } = useTranslation()

  const options: Array<{
    value: ChainLinkMode
    label: string
    available: boolean
    hint: string
  }> = [
    {
      value: 'last_frame',
      label: t('Last frame'),
      available: props.supportsLastFrame,
      hint: props.supportsLastFrame
        ? t('Each segment starts from the previous last frame. Smoothest continuity.')
        : t('Unavailable: this model does not return a last frame.'),
    },
    {
      value: 'reference_video',
      label: t('Previous clip'),
      available: props.supportsReferenceVideo,
      hint: props.supportsReferenceVideo
        ? t(
            'Each segment takes the previous clip as a reference video. Works without last frames, but continuity is weaker and video input is billed differently.'
          )
        : t('Unavailable: this model does not accept reference videos.'),
    },
  ]

  return (
    <div
      className={cn(
        'bg-muted/40 flex flex-col gap-2 rounded-lg border p-3',
        props.className
      )}
    >
      <span className='text-xs font-medium'>
        {t('How segments connect')}
      </span>
      <div className='flex flex-col gap-1.5'>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex items-start gap-2 text-xs',
              option.available ? 'cursor-pointer' : 'opacity-50'
            )}
          >
            <input
              type='radio'
              name='chain-link-mode'
              className='mt-0.5'
              checked={props.value === option.value}
              disabled={!option.available}
              onChange={() => props.onChange(option.value)}
            />
            <span>
              <span className='font-medium'>{option.label}</span>
              <span className='text-muted-foreground block'>
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

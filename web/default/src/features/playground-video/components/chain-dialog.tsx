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
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatLogQuota } from '@/lib/format'

import { MAX_CHAIN_SEGMENTS, MIN_CHAIN_SEGMENTS } from '../lib/chain'

interface ChainDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前编辑器里的提示词：「沿用同一提示词」模式直接取自它。 */
  prompt: string
  /** 模型是否支持尾帧续拍（能力声明里的 returns_last_frame）。 */
  supported: boolean
  /** 每一段的预估额度；用于把「一共要花多少」在开始之前讲清楚。 */
  unitQuota?: number
  unitApproximate?: boolean
  onSubmit: (prompts: string[]) => void
}

interface Segment {
  id: number
  text: string
}

/**
 * 连拍设置：把一段长镜头拆成连续的多段，用上一段的尾帧接下一段。
 *
 * 两种写法都保留，因为连拍实际有两种用法：广告片那种「一个镜头一直延续」
 * 只需要重复同一句提示词；叙事则每一段都要写不同的动作。段数上限写死在
 * 界面上（每一段都是真实计费任务），并在这里就把总价摆出来。
 */
export function ChainDialog(props: ChainDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'repeat' | 'script'>('repeat')
  const [count, setCount] = useState(3)
  const [segments, setSegments] = useState<Segment[]>(() => [
    { id: 1, text: '' },
    { id: 2, text: '' },
  ])
  const [nextId, setNextId] = useState(3)

  const scriptPrompts = segments.map((segment) => segment.text.trim())
  const scriptReady = scriptPrompts.every((text) => text !== '')
  const repeatPrompt = props.prompt.trim()
  const segmentCount = mode === 'repeat' ? count : segments.length
  // 总价按「实际会提交的段数」算：逐段模式里空行不会被提交。
  const billedCount =
    mode === 'repeat'
      ? count
      : scriptPrompts.filter((text) => text !== '').length
  const canSubmit =
    props.supported &&
    segmentCount >= MIN_CHAIN_SEGMENTS &&
    (mode === 'repeat' ? repeatPrompt !== '' : scriptReady)

  const switchToScript = () => {
    setMode('script')
    // 首次进入逐段模式时用当前提示词打底，用户不用再抄一遍。
    setSegments((prev) =>
      prev
        .map((segment, position) =>
          position === 0 && segment.text.trim() === '' && repeatPrompt !== ''
            ? { ...segment, text: repeatPrompt }
            : segment
        )
    )
  }

  const applyCount = (next: number) => {
    setCount(Math.min(MAX_CHAIN_SEGMENTS, Math.max(MIN_CHAIN_SEGMENTS, next)))
  }

  const addSegment = () => {
    if (segments.length >= MAX_CHAIN_SEGMENTS) {
      return
    }
    setSegments((prev) => [...prev, { id: nextId, text: '' }])
    setNextId((prev) => prev + 1)
  }

  const removeSegment = (id: number) => {
    setSegments((prev) =>
      prev.length <= MIN_CHAIN_SEGMENTS
        ? prev
        : prev.filter((segment) => segment.id !== id)
    )
  }

  const updateSegment = (id: number, text: string) => {
    setSegments((prev) =>
      prev.map((segment) => (segment.id === id ? { ...segment, text } : segment))
    )
  }

  const handleSubmit = () => {
    if (!canSubmit) {
      return
    }
    if (mode === 'repeat') {
      props.onSubmit(Array.from({ length: count }, () => repeatPrompt))
      return
    }
    props.onSubmit(segments.map((segment) => segment.text.trim()))
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Continuous chain')}
      description={t(
        'Run several segments back to back: the last frame of each one becomes the first frame of the next.'
      )}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          {mode === 'script' && (
            <Button
              type='button'
              variant='outline'
              onClick={addSegment}
              disabled={segments.length >= MAX_CHAIN_SEGMENTS}
            >
              <Plus className='mr-1 h-4 w-4' />
              {t('Add segment')}
            </Button>
          )}
          <EstimateLabel
            quota={props.unitQuota}
            approximate={props.unitApproximate}
            total={billedCount}
          />
          <Button type='button' disabled={!canSubmit} onClick={handleSubmit}>
            {t('Start chaining')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {!props.supported && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'This model does not return a last frame, so segments cannot be chained'
            )}
          </p>
        )}

        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            size='sm'
            variant={mode === 'repeat' ? 'default' : 'outline'}
            onClick={() => setMode('repeat')}
          >
            {t('Repeat current prompt')}
          </Button>
          <Button
            type='button'
            size='sm'
            variant={mode === 'script' ? 'default' : 'outline'}
            onClick={switchToScript}
          >
            {t('Write each segment separately')}
          </Button>
        </div>

        {mode === 'repeat' ? (
          <div className='flex flex-col gap-2'>
            <Label className='text-xs'>{t('Segments')}</Label>
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                size='icon'
                className='h-8 w-8'
                aria-label={t('Remove segment')}
                disabled={count <= MIN_CHAIN_SEGMENTS}
                onClick={() => applyCount(count - 1)}
              >
                <Minus className='h-3.5 w-3.5' />
              </Button>
              <span className='w-8 text-center text-sm tabular-nums'>
                {count}
              </span>
              <Button
                type='button'
                variant='outline'
                size='icon'
                className='h-8 w-8'
                aria-label={t('Add segment')}
                disabled={count >= MAX_CHAIN_SEGMENTS}
                onClick={() => applyCount(count + 1)}
              >
                <Plus className='h-3.5 w-3.5' />
              </Button>
              <span className='text-muted-foreground text-xs'>
                {repeatPrompt === ''
                  ? t('Enter a prompt to generate')
                  : repeatPrompt}
              </span>
            </div>
          </div>
        ) : (
          <div className='flex max-h-[45vh] flex-col gap-3 overflow-y-auto pr-1'>
            {segments.map((segment, position) => (
              <div key={segment.id} className='flex flex-col gap-1.5'>
                <div className='flex items-center justify-between gap-2'>
                  <Label className='text-xs'>
                    {t('Segment {{index}}', { index: position + 1 })}
                  </Label>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='text-muted-foreground h-6 w-6'
                    disabled={segments.length <= MIN_CHAIN_SEGMENTS}
                    aria-label={t('Remove segment')}
                    onClick={() => removeSegment(segment.id)}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  value={segment.text}
                  onChange={(event) =>
                    updateSegment(segment.id, event.target.value)
                  }
                  placeholder={t('Describe this segment')}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** 总价：单价来自后端预估价接口，这里只做乘法，不复制任何定价规则。 */
function EstimateLabel(props: {
  quota?: number
  approximate?: boolean
  total: number
}) {
  const { t } = useTranslation()
  if (props.quota === undefined || props.total <= 0) {
    return null
  }
  const total = props.quota * props.total
  return (
    <span className='text-muted-foreground mr-auto text-xs'>
      {t('Estimated total')}: {props.approximate ? '≈ ' : ''}
      {formatLogQuota(total)}
      {' · '}
      {t('Billed per segment as each one settles')}
    </span>
  )
}

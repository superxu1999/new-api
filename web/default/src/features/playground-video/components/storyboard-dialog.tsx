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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatLogQuota } from '@/lib/format'

import { MAX_CHAIN_SEGMENTS, type ChainLinkMode } from '../lib/chain'
import { LinkModePicker } from './link-mode-picker'

/** 单次分镜的镜头数上限：并发提交会同时预扣额度，必须给用户一个明确上界。 */
export const MAX_SHOTS = 8

/** 空镜头的时长：跟随当前参数区设置，不在此处覆盖。 */
const DURATION_FOLLOW = 'follow'

// 「跟随参数区」固定打头；数字档来自能力声明（durationOptions），不再写死——
// 写死 15 会让 seedance2.5 这类支持 30 秒的模型在分镜里选不到长时长，
// 写死 3 则会给出提交侧必然拒绝（时长下界 4 秒）的越界档。

interface Shot {
  id: number
  text: string
  duration: string
}

interface StoryboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 提交若干镜头；chainable 为真时按连拍模式串行相接。返回实际提交成功的数量。 */
  onSubmit: (
    shots: Array<{ prompt: string; duration?: string }>,
    chainable: boolean
  ) => Promise<number>
  /** 单镜预估价（额度）；有值时按镜头数汇总成总花费，避免用户盲扣。 */
  unitQuota?: number
  unitApproximate?: boolean
  /** 模型是否支持尾帧续拍：相接模式下由连拍驱动器负责衔接，不支持则开关禁用。 */
  chainableSupported?: boolean
  /** 相接模式下的衔接方式（尾帧 / 成片）。 */
  linkMode: ChainLinkMode
  onLinkModeChange: (value: ChainLinkMode) => void
  /** 成片续接门槛：模型收参考视频。 */
  supportsReferenceVideo?: boolean
  /** 时长快捷档（秒，与主参数区同源），来自当前模型的能力声明；3 秒这类越界档不该出现。 */
  durationOptions?: number[]
  /** 受控：整组镜头是否首尾相接。 */
  chainable: boolean
  onChainableChange: (value: boolean) => void
  disabled?: boolean
}

/**
 * 分镜编排：一个脚本拆成多个镜头，逐个提交。
 *
 * 为什么逐个提交而不是并发：每个镜头都会预扣额度，并发提交会让用户在毫无预期的情况下
 * 同时扣掉 N 份钱。串行提交还有个好处：额度不足时能立刻停下，已经提交的部分照常出片。
 *
 * 每镜可以单独设时长并调整顺序：短剧的节奏控制权在剪辑手里，
 * 「两镜都是 8 秒」和「快切 3 秒 + 长镜头 10 秒」是两种完全不同的表达。
 */
export function StoryboardDialog(props: StoryboardDialogProps) {
  const { t } = useTranslation()
  // 每个镜头带稳定 id：用数组下标当 key 会在删除中间镜头时让 React 复用错行，
  // 表现为「删了第 2 行，第 3 行的文字跑到第 2 行」。
  const [shots, setShots] = useState<Shot[]>(() => [
    { id: 1, text: '', duration: DURATION_FOLLOW },
    { id: 2, text: '', duration: DURATION_FOLLOW },
  ])
  const [nextId, setNextId] = useState(3)
  const [submitting, setSubmitting] = useState(false)
  // 开启相接却超段数时的提示：直接摆在开关下面，不用 toast（弹窗内更显眼）。
  const [chainableBlocked, setChainableBlocked] = useState(false)

  // 时长档：「跟随」固定打头，数字档来自模型能力（durationOptions）。
  const durationOptions = ['follow', ...(props.durationOptions ?? [])]

  // 相接模式由连拍驱动器推进，它的段数上限更严（每段都是一次真实计费任务），
  // 所以这里的添加上限跟着收敛，避免提交后才发现第 7 段跑不了。
  const shotLimit = props.chainable ? MAX_CHAIN_SEGMENTS : MAX_SHOTS

  const updateShot = (id: number, patch: Partial<Shot>) => {
    setShots((prev) =>
      prev.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot))
    )
  }

  const addShot = () => {
    if (shots.length >= shotLimit) {
      return
    }
    setShots((prev) => [...prev, { id: nextId, text: '', duration: DURATION_FOLLOW }])
    setNextId((prev) => prev + 1)
  }

  const removeShot = (id: number) => {
    setShots((prev) =>
      prev.length <= 1 ? prev : prev.filter((shot) => shot.id !== id)
    )
  }

  /** 镜头顺序即播放顺序，所以只能相邻交换。 */
  const moveShot = (id: number, direction: -1 | 1) => {
    setShots((prev) => {
      const index = prev.findIndex((shot) => shot.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) {
        return prev
      }
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  const filled = shots.filter((shot) => shot.text.trim())

  // 相接开关下方的说明文案：不可用 / 已开启 / 未开启三种状态互斥，if-else
  // 比嵌套三元更好读（oxlint no-nested-ternary）。
  // 可用门槛是「尾帧续接或成片续接任一成立」——只要有一种衔接方式能用，相接就有意义。
  const chainAvailable = Boolean(
    props.chainableSupported || props.supportsReferenceVideo
  )
  let chainableHintKey =
    'Off: shots are independent. Turn it on to make each shot continue from the previous last frame.'
  if (!chainAvailable) {
    chainableHintKey =
      'This model can neither return a last frame nor accept reference videos, so shots stay independent.'
  } else if (props.chainable) {
    chainableHintKey =
      'Each shot continues from the previous one. Shots run one by one, and all of them share the parameters above.'
  }

  const handleSubmit = async () => {
    if (filled.length === 0) {
      return
    }
    setSubmitting(true)
    try {
      const submitted = await props.onSubmit(
        filled.map((shot) => ({
          prompt: shot.text.trim(),
          duration:
            shot.duration === DURATION_FOLLOW ? undefined : shot.duration,
        })),
        props.chainable
      )
      if (submitted > 0) {
        props.onOpenChange(false)
        setShots([
          { id: nextId, text: '', duration: DURATION_FOLLOW },
          { id: nextId + 1, text: '', duration: DURATION_FOLLOW },
        ])
        setNextId((prev) => prev + 2)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Storyboard')}
      description={t(
        'Split one script into several shots. They share the selected model, parameters and materials.'
      )}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={addShot}
            disabled={shots.length >= shotLimit}
          >
            <Plus className='mr-1 h-4 w-4' />
            {t('Add shot')}
          </Button>
          <div className='flex flex-1 items-center justify-end gap-3'>
            {props.unitQuota !== undefined && filled.length > 0 && (
              <span className='text-muted-foreground text-xs'>
                {t('Estimated total')}: {props.unitApproximate ? '≈ ' : ''}
                {formatLogQuota(props.unitQuota * filled.length)}
              </span>
            )}
            <Button
              type='button'
              disabled={props.disabled || submitting || filled.length === 0}
              onClick={handleSubmit}
            >
              {submitting
                ? t('Submitting...')
                : t('Generate {{count}} shots', { count: filled.length })}
            </Button>
          </div>
        </>
      }
    >
      <div className='flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-1'>
        {/* 首尾相接：把上一镜的产物接到下一镜（尾帧或成片），画面连续。
            交给连拍驱动器串行推进（取产物 → 登记素材 → 作为下一镜输入），
            因此这一模式下所有镜头共用参数区的一套参数，逐镜时长不可用。 */}
        <div className='bg-muted/40 flex flex-col gap-1.5 rounded-lg border p-3'>
          <div className='flex items-center justify-between gap-2'>
            <Label htmlFor='storyboard-chainable' className='text-xs'>
              {t('Chain shots end to end')}
            </Label>
            <Switch
              id='storyboard-chainable'
              checked={props.chainable}
              disabled={!chainAvailable}
              onCheckedChange={(value) => {
                // 超段数时不开：宁可提示用户先删几个镜头，也不静默截断已填内容。
                if (value && shots.length > MAX_CHAIN_SEGMENTS) {
                  setChainableBlocked(true)
                  return
                }
                setChainableBlocked(false)
                props.onChainableChange(value)
              }}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(chainableHintKey)}
          </p>
          {chainableBlocked && (
            <p className='text-destructive text-xs'>
              {t(
                'End-to-end chaining supports up to {{count}} shots. Remove some shots first.',
                { count: MAX_CHAIN_SEGMENTS }
              )}
            </p>
          )}
          {props.chainable && (
            <LinkModePicker
              className='bg-background/60 mt-1'
              value={props.linkMode}
              onChange={props.onLinkModeChange}
              supportsLastFrame={Boolean(props.chainableSupported)}
              supportsReferenceVideo={Boolean(props.supportsReferenceVideo)}
            />
          )}
        </div>

        {shots.map((shot, index) => (
          <div key={shot.id} className='flex flex-col gap-1.5'>
            <div className='flex items-center justify-between gap-2'>
              <Label className='text-xs'>
                {t('Shot {{index}}', { index: index + 1 })}
              </Label>
              <div className='flex items-center gap-1'>
                <Select
                  value={shot.duration}
                  onValueChange={(value) =>
                    value && updateShot(shot.id, { duration: value })
                  }
                  disabled={props.chainable}
                >
                  <SelectTrigger className='h-6 w-24 text-xs'>
                    {/* 显式给文本：SelectValue 自动反查依赖已注册的选项，
                        时序不巧就会把 'follow' 这类原始值直接亮出来。 */}
                    <SelectValue>
                      {shot.duration === DURATION_FOLLOW
                        ? t('Same as parameters')
                        : `${shot.duration}s`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {durationOptions.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value === DURATION_FOLLOW
                          ? t('Same as parameters')
                          : `${value}s`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground h-6 w-6'
                  disabled={index === 0}
                  aria-label={t('Move shot up')}
                  onClick={() => moveShot(shot.id, -1)}
                >
                  <ArrowUp className='h-3.5 w-3.5' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground h-6 w-6'
                  disabled={index === shots.length - 1}
                  aria-label={t('Move shot down')}
                  onClick={() => moveShot(shot.id, 1)}
                >
                  <ArrowDown className='h-3.5 w-3.5' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground h-6 w-6'
                  disabled={shots.length <= 1}
                  aria-label={t('Remove shot')}
                  onClick={() => removeShot(shot.id)}
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
            <Textarea
              rows={2}
              value={shot.text}
              onChange={(event) => updateShot(shot.id, { text: event.target.value })}
              placeholder={t('Describe this shot')}
            />
          </div>
        ))}
      </div>
    </Dialog>
  )
}

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
import { Textarea } from '@/components/ui/textarea'
import { formatLogQuota } from '@/lib/format'

/** 单次分镜的镜头数上限：并发提交会同时预扣额度，必须给用户一个明确上界。 */
export const MAX_SHOTS = 8

/** 空镜头的时长：跟随当前参数区设置，不在此处覆盖。 */
const DURATION_FOLLOW = 'follow'

/** 常用镜头时长档（短剧节奏以秒计，档位比自由输入更好用）。 */
const DURATION_OPTIONS = ['follow', '3', '5', '8', '10', '15']

interface Shot {
  id: number
  text: string
  duration: string
}

interface StoryboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 提交若干镜头；返回实际提交成功的数量。 */
  onSubmit: (shots: Array<{ prompt: string; duration?: string }>) => Promise<number>
  /** 单镜预估价（额度）；有值时按镜头数汇总成总花费，避免用户盲扣。 */
  unitQuota?: number
  unitApproximate?: boolean
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

  const updateShot = (id: number, patch: Partial<Shot>) => {
    setShots((prev) =>
      prev.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot))
    )
  }

  const addShot = () => {
    if (shots.length >= MAX_SHOTS) {
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
        }))
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
            disabled={shots.length >= MAX_SHOTS}
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
                    {DURATION_OPTIONS.map((value) => (
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

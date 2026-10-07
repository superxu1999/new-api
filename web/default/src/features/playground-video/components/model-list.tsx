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
import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { VideoInputKind, VideoModelCapability } from '../lib/api'
import { evaluateModel, type TrayItem } from '../lib/capability'

const INPUT_LABELS: { kind: VideoInputKind; label: string }[] = [
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'reference_image', label: 'Ref image' },
  { kind: 'first_last_frame', label: 'First/last frame' },
  { kind: 'reference_video', label: 'Ref video' },
  { kind: 'reference_audio', label: 'Ref audio' },
]

/** 能力快速筛选：只列「素材类」输入（文生是所有模型的底线，筛它没意义）。 */
const FILTERABLE_INPUTS: { kind: VideoInputKind; label: string }[] = [
  { kind: 'image', label: 'Image' },
  { kind: 'first_last_frame', label: 'First/last frame' },
  { kind: 'reference_image', label: 'Ref image' },
  { kind: 'reference_video', label: 'Ref video' },
  { kind: 'reference_audio', label: 'Ref audio' },
]

interface ModelListProps {
  models: VideoModelCapability[]
  selected: string
  onSelect: (model: string) => void
  items: TrayItem[]
  /**
   * 「模型 → 渠道名列表」映射，仅管理员传入（数据走权限保护的管理员接口）。
   * 为 null/undefined 时不渲染渠道筛选——普通用户看不到任何渠道概念。
   */
  channelMap?: Record<string, string[]> | null
}

/** 渠道下拉的「不过滤」哨兵值：Select 的 value 不能是空串，用显式哨兵最稳。 */
const CHANNEL_ALL = '__all__'

/**
 * 模型列表：全量列出，不可用的置灰且不可点，并说明原因。
 * 顶部支持按名称搜索、按输入能力筛选（模型多时不用靠滚动找）。
 *
 * 刻意不隐藏不可用的模型 —— 用户需要知道「有哪些、为什么不能用」，而不是面对一个
 * 悄悄变短的列表。置灰规则与后端同源（同一份能力声明），所以亮的一定提交得上去。
 */
export function ModelList(props: ModelListProps) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [requiredInputs, setRequiredInputs] = useState<VideoInputKind[]>([])
  const [channelFilter, setChannelFilter] = useState(CHANNEL_ALL)

  const toggleInputFilter = (kind: VideoInputKind) => {
    setRequiredInputs((prev) =>
      prev.includes(kind)
        ? prev.filter((item) => item !== kind)
        : [...prev, kind]
    )
  }

  // 渠道下拉只列「至少接得住一个可见模型」的渠道：列出一堆空渠道只会制造噪音。
  const channelOptions = useMemo(() => {
    if (!props.channelMap) {
      return []
    }
    const names = new Set<string>()
    for (const model of props.models) {
      for (const name of props.channelMap[model.model] ?? []) {
        names.add(name)
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [props.channelMap, props.models])

  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return props.models.filter((model) => {
      // 搜索同时匹配展示名与内部模型名：用户可能搜产品名，也可能是管理员在搜内部名。
      if (
        query &&
        !model.model.toLowerCase().includes(query) &&
        !(model.display_name || '').toLowerCase().includes(query)
      ) {
        return false
      }
      // 选中的能力筛选是「且」关系：模型必须同时具备所有勾选的输入能力。
      for (const kind of requiredInputs) {
        if (!model.inputs.includes(kind)) {
          return false
        }
      }
      // 渠道筛选：模型必须挂在该渠道下（映射缺失时视为不匹配，宁可少列不可错列）。
      if (
        channelFilter !== CHANNEL_ALL &&
        !(props.channelMap?.[model.model] ?? []).includes(channelFilter)
      ) {
        return false
      }
      return true
    })
  }, [props.models, props.channelMap, keyword, requiredInputs, channelFilter])

  return (
    <div className='flex flex-col gap-3'>
      {/* 搜索 */}
      <div className='relative'>
        <Search className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('Search models')}
          className='border-border/60 bg-background h-8 w-full rounded-md border pr-2 pl-8 text-xs'
        />
      </div>

      {/* 能力筛选 */}
      <div className='flex flex-wrap gap-1'>
        {FILTERABLE_INPUTS.map((item) => {
          const active = requiredInputs.includes(item.kind)
          return (
            <button
              key={item.kind}
              type='button'
              onClick={() => toggleInputFilter(item.kind)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:border-primary/50'
              )}
            >
              {t(item.label)}
            </button>
          )
        })}
      </div>

      {/* 渠道筛选：仅管理员可见（channelMap 只有管理员才传得进来）。
          渠道名是内部运营信息，普通用户的模型选择不该被它污染。
          触发器文本显式给出，不走 SelectValue 自动解析——选项列表是异步数据，
          首渲染时还没有 SelectItem 可供反查，自动解析会把哨兵值原文亮出来。 */}
      {channelOptions.length > 0 && (
        <div className='flex items-center gap-1'>
          <Select
            value={channelFilter}
            onValueChange={(value) => value && setChannelFilter(value)}
          >
            <SelectTrigger className='h-7 w-full text-xs'>
              <SelectValue placeholder={t('Filter by channel')}>
                {channelFilter === CHANNEL_ALL
                  ? t('All channels')
                  : channelFilter}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CHANNEL_ALL}>{t('All channels')}</SelectItem>
              {channelOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channelFilter !== CHANNEL_ALL && (
            <Button
              type='button'
              size='icon'
              variant='ghost'
              className='text-muted-foreground h-7 w-7 shrink-0'
              aria-label={t('All channels')}
              onClick={() => setChannelFilter(CHANNEL_ALL)}
            >
              <X className='h-3.5 w-3.5' />
            </Button>
          )}
        </div>
      )}

      {/* 列表 */}
      {renderList()}

      {/* 能力筛选（底部不再重复） */}
    </div>
  )

  function renderList() {
    if (props.models.length === 0) {
      return (
        <p className='text-muted-foreground text-sm'>
          {t('No video models are available for your account.')}
        </p>
      )
    }
    if (visible.length === 0) {
      return (
        <p className='text-muted-foreground text-sm'>
          {t('No models match your current filters.')}
        </p>
      )
    }
    return (
      <div className='flex flex-col gap-2'>
        {visible.map((model) => {
          const eligibility = evaluateModel(model, props.items)
          const isSelected = props.selected === model.model
          return (
            <button
              key={model.model}
              type='button'
              disabled={!eligibility.enabled}
              onClick={() => props.onSelect(model.model)}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors',
                eligibility.enabled
                  ? 'hover:border-primary/60 cursor-pointer'
                  : 'bg-muted/40 cursor-not-allowed opacity-60',
                isSelected && 'border-primary ring-primary/20 ring-2'
              )}
            >
              {/* 展示名优先：运营配了产品名就用产品名，内部模型名降级为小字技术信息。 */}
              <span className='flex flex-col gap-0.5'>
                <span className='truncate text-sm font-medium'>
                  {model.display_name || model.model}
                </span>
                {model.display_name && (
                  <span className='text-muted-foreground truncate font-mono text-[10px]'>
                    {model.model}
                  </span>
                )}
              </span>
              <span className='flex flex-wrap gap-1'>
                {INPUT_LABELS.filter((item) =>
                  model.inputs.includes(item.kind)
                ).map((item) => (
                  <Badge
                    key={item.kind}
                    variant='secondary'
                    className='text-[10px] font-normal'
                  >
                    {t(item.label)}
                  </Badge>
                ))}
                {model.returns_last_frame && (
                  <Badge
                    variant='outline'
                    className='text-[10px] font-normal'
                  >
                    {t('Returns last frame')}
                  </Badge>
                )}
                {/* 渠道筛选激活时标出该模型命中的渠道：管理员调试时能对上「我在筛哪条」。 */}
                {channelFilter !== CHANNEL_ALL &&
                  (props.channelMap?.[model.model] ?? [])
                    .filter((name) => name === channelFilter)
                    .map((name) => (
                      <Badge
                        key={name}
                        variant='outline'
                        className='text-muted-foreground text-[10px] font-normal'
                      >
                        {name}
                      </Badge>
                    ))}
              </span>
              {!eligibility.enabled && eligibility.reason && (
                <span className='text-destructive text-xs'>
                  {t(eligibility.reason.key, eligibility.reason.params)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }
}

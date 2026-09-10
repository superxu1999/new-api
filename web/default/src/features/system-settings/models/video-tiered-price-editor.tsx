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
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldGroup } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { useUpdateOption } from '../hooks/use-update-option'

const TIERED_PRICE_KEY = 'video_pricing_setting.tiered_price_by_model'
const MULTIPLIER_KEY = 'video_pricing_setting.model_multiplier_by_model'

// 默认分档单价（元/百万 token），按归一化模型名。
// 与后端 relay/channel/task/taskcommon 的 seedanceDefaultPriceTable 保持一致。
const DEFAULT_PRICES: Record<string, Record<string, number>> = {
  'doubao-seedance-2-0-260128': {
    no_720p: 46,
    with_720p: 28,
    no_1080p: 51,
    with_1080p: 31,
    no_4k: 26,
    with_4k: 16,
  },
  'doubao-seedance-2-5-260628': {
    no_720p: 70,
    with_720p: 42,
    no_1080p: 77,
    with_1080p: 46,
  },
  'doubao-seedance-2-0-fast-260128': {
    no_720p: 37,
    with_720p: 22,
  },
  'doubao-seedance-2-0-mini-260615': {
    no_720p: 23,
    with_720p: 14,
  },
}

const FALLBACK_MODEL = 'doubao-seedance-2-0-260128'

/** 与后端 normalizeSeedanceModel 保持一致的模型名归一化。 */
function normalizeSeedanceModel(model: string): string {
  const m = model.toLowerCase().trim()
  if (
    m.includes('seedance-2-5') ||
    m.includes('seedance2.5') ||
    m.endsWith('-25') ||
    m.includes('25-260628') ||
    m.includes('v25')
  ) {
    return 'doubao-seedance-2-5-260628'
  }
  if (m.includes('fast')) return 'doubao-seedance-2-0-fast-260128'
  if (m.includes('mini')) return 'doubao-seedance-2-0-mini-260615'
  return FALLBACK_MODEL
}

const RESOLUTIONS = ['480p/720p', '1080p', '4k'] as const
const NO_VIDEO_KEYS = ['no_720p', 'no_1080p', 'no_4k'] as const
const WITH_VIDEO_KEYS = ['with_720p', 'with_1080p', 'with_4k'] as const

type Props = {
  model: string
}

/**
 * 视频模型定价编辑器：分档单价（元/百万 token）+ 计费倍率。
 * 分档单价按「输入不含视频 / 输入包含视频」两组、各按分辨率填写；
 * 计费倍率用于按模型整体加价或打折（1.0 = 原价）。
 */
export function VideoTieredPriceEditor({ model }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  // 默认值按型号（2.0/2.5/fast/mini）推断；配置按【完整模型名】独立存取，
  // 与 ModelRatio 的粒度一致——每个模型互不影响。
  const defaults = DEFAULT_PRICES[normalizeSeedanceModel(model)] ?? DEFAULT_PRICES[FALLBACK_MODEL]
  const [prices, setPrices] = useState<Record<string, number>>({ ...defaults })
  const [multiplier, setMultiplier] = useState(1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPrices({ ...defaults })
    setMultiplier(1)
    api
      .get('/api/option/')
      .then((res) => {
        if (cancelled) return
        const items = (res.data || []) as Array<{ key?: string; value?: string }>
        const priceRaw = items.find((it) => it.key === TIERED_PRICE_KEY)?.value ?? ''
        const multRaw = items.find((it) => it.key === MULTIPLIER_KEY)?.value ?? ''
        const saved = parsePriceMap(priceRaw)[model]
        setPrices(saved ? { ...defaults, ...saved } : { ...defaults })
        const savedMult = parseNumberMap(multRaw)[model]
        setMultiplier(typeof savedMult === 'number' && savedMult > 0 ? savedMult : 1)
      })
      .catch(() => {
        /* 保持默认值 */
      })
    return () => {
      cancelled = true
    }
  }, [model, defaults])

  const save = async () => {
    setSaving(true)
    try {
      const res = await api.get('/api/option/')
      const items = (res.data || []) as Array<{ key?: string; value?: string }>
      const priceRaw = items.find((it) => it.key === TIERED_PRICE_KEY)?.value ?? ''
      const multRaw = items.find((it) => it.key === MULTIPLIER_KEY)?.value ?? ''

      // 合并其它模型配置，仅覆盖当前模型，避免互相清除。
      const nextPrices = { ...parsePriceMap(priceRaw), [model]: sanitizePrices(prices) }
      const nextMult = { ...parseNumberMap(multRaw), [model]: multiplier > 0 ? multiplier : 1 }

      await updateOption.mutateAsync({ key: TIERED_PRICE_KEY, value: JSON.stringify(nextPrices) })
      await updateOption.mutateAsync({ key: MULTIPLIER_KEY, value: JSON.stringify(nextMult) })
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const renderGroup = (title: string, keys: readonly string[]) => (
    <div className='space-y-2'>
      <Label className='text-xs font-semibold'>{title}</Label>
      <div className='grid gap-3 sm:grid-cols-3'>
        {keys.map((key, i) => (
          <div key={key} className='space-y-1'>
            <span className='text-muted-foreground text-xs'>{RESOLUTIONS[i]}</span>
            <Input
              type='number'
              step={1}
              min={0}
              value={prices[key] ?? ''}
              onChange={(e) =>
                setPrices((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))
              }
            />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <FieldGroup>
      <div className='space-y-4'>
        <div className='space-y-1'>
          <p className='text-sm font-medium'>{t('Video tiered price (¥/M tokens)')}</p>
          <p className='text-muted-foreground text-xs'>
            {t('Set the price per resolution. Can be adjusted per model.')}
          </p>
        </div>

        {renderGroup(t('Input without video'), NO_VIDEO_KEYS)}
        {renderGroup(t('Input with video'), WITH_VIDEO_KEYS)}

        <div className='space-y-2 border-t pt-3'>
          <Label className='text-xs font-semibold'>{t('Billing multiplier')}</Label>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Applies to this model only. 1.0 = original price, 1.5 = +50%, 0.8 = 20% off.'
            )}
          </p>
          <div className='grid gap-3 sm:grid-cols-3'>
            <Input
              type='number'
              step={0.01}
              min={0}
              value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <Button type='button' variant='outline' size='sm' onClick={save} disabled={saving}>
          {saving ? t('Saving...') : t('Save video pricing')}
        </Button>
      </div>
    </FieldGroup>
  )
}

/** 解析「模型 -> 档位单价表」的配置。 */
function parsePriceMap(raw: string): Record<string, Record<string, number>> {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, Record<string, number>>
    const out: Record<string, Record<string, number>> = {}
    for (const [m, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') out[m] = v
    }
    return out
  } catch {
    return {}
  }
}

/** 解析「模型 -> 数值」的配置（如计费倍率）。 */
function parseNumberMap(raw: string): Record<string, number> {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, number | string>
    const out: Record<string, number> = {}
    for (const [m, v] of Object.entries(obj)) {
      const num = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(num)) out[m] = num
    }
    return out
  } catch {
    return {}
  }
}

function sanitizePrices(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

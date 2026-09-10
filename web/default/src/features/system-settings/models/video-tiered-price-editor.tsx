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
import { api } from '@/lib/api'
import { useUpdateOption } from '../hooks/use-update-option'

const TIERED_PRICE_KEY = 'video_pricing_setting.tiered_price_by_model'

// 官方默认分档单价（元/百万 token），按归一化模型名。
// 与后端 relay/channel/task/taskcommon 的 seedanceDefaultPriceTable 保持一致。
const OFFICIAL_DEFAULTS: Record<string, Record<string, number>> = {
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
    m.includes('25-260628')
  ) {
    return 'doubao-seedance-2-5-260628'
  }
  if (m.includes('fast')) return 'doubao-seedance-2-0-fast-260128'
  if (m.includes('mini')) return 'doubao-seedance-2-0-mini-260615'
  return FALLBACK_MODEL
}

type TierField = {
  key: string
  resolution: string
  withVideo: boolean
}

// 逐档输入框：分辨率 × 输入是否包含视频。
const TIER_FIELDS: TierField[] = [
  { key: 'no_720p', resolution: '480p/720p', withVideo: false },
  { key: 'with_720p', resolution: '480p/720p', withVideo: true },
  { key: 'no_1080p', resolution: '1080p', withVideo: false },
  { key: 'with_1080p', resolution: '1080p', withVideo: true },
  { key: 'no_4k', resolution: '4k', withVideo: false },
  { key: 'with_4k', resolution: '4k', withVideo: true },
]

type Props = {
  model: string
}

/**
 * 视频模型分档单价编辑器（元/百万 token，官方 token 计费）。
 * 管理员逐档填写 480p/720p、1080p、4k × 输入不含/包含视频；默认值为官方价，可修改后保存。
 * 保存到 video_pricing_setting.tiered_price_by_model（按归一化模型名）。
 */
export function VideoTieredPriceEditor({ model }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const normalized = normalizeSeedanceModel(model)
  const official = OFFICIAL_DEFAULTS[normalized] ?? OFFICIAL_DEFAULTS[FALLBACK_MODEL]
  const [values, setValues] = useState<Record<string, number>>({ ...official })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setValues({ ...official })
    api
      .get('/api/option/')
      .then((res) => {
        if (cancelled) return
        const items = (res.data || []) as Array<{ key?: string; value?: string }>
        const raw = items.find((it) => it.key === TIERED_PRICE_KEY)?.value ?? ''
        const saved = parseTieredPrice(raw)[normalized]
        setValues(saved ? { ...official, ...saved } : { ...official })
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [normalized, official])

  const save = async () => {
    setSaving(true)
    try {
      // 合并当前 DB 中其它模型的配置，只覆盖本模型，避免互相清除。
      const res = await api.get('/api/option/')
      const items = (res.data || []) as Array<{ key?: string; value?: string }>
      const raw = items.find((it) => it.key === TIERED_PRICE_KEY)?.value ?? ''
      const next = { ...parseTieredPrice(raw), [normalized]: sanitize(values) }
      await updateOption.mutateAsync({ key: TIERED_PRICE_KEY, value: JSON.stringify(next) })
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldGroup>
      <div className='space-y-3'>
        <p className='text-sm font-medium'>{t('Video tiered price (¥/M tokens)')}</p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Official per-resolution price. Defaults to official pricing; adjust per model if needed.'
          )}
        </p>

        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {TIER_FIELDS.map((field) => (
            <div key={field.key} className='space-y-1'>
              <span className='text-muted-foreground text-xs'>
                {field.resolution}
                {field.withVideo ? ` · ${t('With video')}` : ` · ${t('No video')}`}
              </span>
              <Input
                type='number'
                step={1}
                min={0}
                value={values[field.key] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
          ))}
        </div>

        <Button type='button' variant='outline' size='sm' onClick={save} disabled={saving}>
          {saving ? t('Saving...') : t('Save video tiered price')}
        </Button>
        {loaded && <span className='sr-only'>{t('Loaded')}</span>}
      </div>
    </FieldGroup>
  )
}

function parseTieredPrice(raw: string): Record<string, Record<string, number>> {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, Record<string, number>>
    const out: Record<string, Record<string, number>> = {}
    for (const [m, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') out[m] = { ...v }
    }
    return out
  } catch {
    return {}
  }
}

function sanitize(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

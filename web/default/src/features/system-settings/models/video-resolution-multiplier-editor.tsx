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

const RES_KEYS = ['480p', '720p', '1080p', '4k'] as const
const BUILTIN_FALLBACK: Record<string, number> = {
  '480p': 1,
  '720p': 1,
  '1080p': 1.25,
  '4k': 0.32,
}

const GLOBAL_KEY = 'video_pricing_setting.resolution_ratio'
const BY_MODEL_KEY = 'video_pricing_setting.resolution_ratio_by_model'

type Props = {
  model: string
}

/**
 * 视频模型的分辨率倍率编辑器（用于模型定价编辑面板内）。
 * 提供两块：
 *  1) 全局默认值（video_pricing_setting.resolution_ratio）：对所有模型生效，
 *     模型未单独覆盖时使用。缺省回退到 BUILTIN_FALLBACK。
 *  2) 按模型覆盖（video_pricing_setting.resolution_ratio_by_model）：仅对当前模型覆盖全局。
 */
export function VideoResolutionMultiplierEditor({ model }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [globalMap, setGlobalMap] = useState<Record<string, number>>({ ...BUILTIN_FALLBACK })
  const [byModelMap, setByModelMap] = useState<Record<string, Record<string, number>>>({})
  const [loaded, setLoaded] = useState(false)
  const [globalValues, setGlobalValues] = useState<Record<string, number>>({ ...BUILTIN_FALLBACK })
  const [modelValues, setModelValues] = useState<Record<string, number>>({ ...BUILTIN_FALLBACK })
  const [savingGlobal, setSavingGlobal] = useState(false)
  const [savingModel, setSavingModel] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get('/api/option/')
      .then((res) => {
        if (cancelled) return
        const items = (res.data || []) as Array<{ key?: string; value?: string }>
        const globalRaw = items.find((it) => it.key === GLOBAL_KEY)?.value ?? ''
        const byModelRaw = items.find((it) => it.key === BY_MODEL_KEY)?.value ?? ''
        const parsedGlobal = parseGlobal(globalRaw)
        setGlobalMap(parsedGlobal)
        setGlobalValues(parsedGlobal)
        setByModelMap(parseByModel(byModelRaw))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    setModelValues(byModelMap[model] ? { ...byModelMap[model] } : { ...globalMap })
  }, [byModelMap, model, loaded, globalMap])

  const updateGlobalValue = (key: string, value: number) => {
    setGlobalValues((prev) => ({ ...prev, [key]: value }))
  }

  const updateModelValue = (key: string, value: number) => {
    setModelValues((prev) => ({ ...prev, [key]: value }))
  }

  const saveGlobal = async () => {
    const next = sanitizeMap(globalValues)
    setSavingGlobal(true)
    try {
      await updateOption.mutateAsync({ key: GLOBAL_KEY, value: JSON.stringify(next) })
      setGlobalMap(next)
      // 未覆盖的模型跟随新的全局默认
      setModelValues((prev) => ({ ...prev, ...next }))
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSavingGlobal(false)
    }
  }

  const saveModel = async () => {
    const next = {
      ...byModelMap,
      [model]: sanitizeMap(modelValues),
    }
    setSavingModel(true)
    try {
      await updateOption.mutateAsync({ key: BY_MODEL_KEY, value: JSON.stringify(next) })
      setByModelMap(next)
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSavingModel(false)
    }
  }

  return (
    <FieldGroup>
      <div className='space-y-4'>
        {/* 全局默认值 */}
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Video resolution pricing (global default)')}</p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Default per-resolution multipliers for all video models. Models without an override use these.'
            )}
          </p>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            {RES_KEYS.map((k) => (
              <div key={k} className='space-y-1'>
                <span className='text-muted-foreground text-xs'>{k}</span>
                <Input
                  type='number'
                  step={0.01}
                  min={0}
                  value={globalValues[k] ?? BUILTIN_FALLBACK[k]}
                  onChange={(e) => updateGlobalValue(k, Number(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={saveGlobal}
            disabled={savingGlobal}
          >
            {savingGlobal ? t('Saving...') : t('Save global resolution pricing')}
          </Button>
        </div>

        <div className='border-t pt-4'>
          {/* 按模型覆盖 */}
          <div className='space-y-2'>
            <p className='text-sm font-medium'>
              {t('Video resolution pricing ({{model}})', { model })}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Applies only to this model. Leave a field blank to use the global default.'
              )}
            </p>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {RES_KEYS.map((k) => (
                <div key={k} className='space-y-1'>
                  <span className='text-muted-foreground text-xs'>{k}</span>
                  <Input
                    type='number'
                    step={0.01}
                    min={0}
                    value={modelValues[k] ?? globalMap[k] ?? BUILTIN_FALLBACK[k]}
                    onChange={(e) => updateModelValue(k, Number(e.target.value) || 0)}
                  />
                </div>
              ))}
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={saveModel}
              disabled={savingModel}
            >
              {savingModel ? t('Saving...') : t('Save resolution pricing')}
            </Button>
          </div>
        </div>
      </div>
    </FieldGroup>
  )
}

function sanitizeMap(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const actual = typeof v === 'number' && Number.isFinite(v) ? v : 1
    out[k] = actual <= 0 ? 1 : actual
  }
  return out
}

function parseGlobal(raw: string): Record<string, number> {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, number>
    const out: Record<string, number> = {}
    for (const k of RES_KEYS) {
      const v = obj[k]
      out[k] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : BUILTIN_FALLBACK[k]
    }
    return out
  } catch {
    return { ...BUILTIN_FALLBACK }
  }
}

function parseByModel(raw: string): Record<string, Record<string, number>> {
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

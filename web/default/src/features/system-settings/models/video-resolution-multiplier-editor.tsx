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
const GLOBAL_DEFAULT: Record<string, number> = {
  '480p': 1,
  '720p': 1,
  '1080p': 1.25,
  '4k': 0.32,
}

type Props = {
  model: string
}

/**
 * 视频模型的分辨率倍率编辑器（用于模型定价编辑面板内）。
 * 无值则显示全局缺省（GLOBAL_DEFAULT），保存到 video_pricing_setting.resolution_ratio_by_model。
 */
export function VideoResolutionMultiplierEditor({ model }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [map, setMap] = useState<Record<string, Record<string, number>>>({})
  const [loaded, setLoaded] = useState(false)
  const [values, setValues] = useState<Record<string, number>>({ ...GLOBAL_DEFAULT })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get('/api/option/')
      .then((res) => {
        if (cancelled) return
        const item = (res.data || []).find(
          (it: { key?: string }) => it.key === 'video_pricing_setting.resolution_ratio_by_model'
        )
        setMap(parseByModel(item?.value ?? ''))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    setValues(map[model] ? { ...map[model] } : { ...GLOBAL_DEFAULT })
  }, [map, model, loaded])

  const save = async () => {
    const next = {
      ...map,
      [model]: Object.fromEntries(RES_KEYS.map((k) => [k, values[k] ?? 1])),
    }
    setSaving(true)
    try {
      await updateOption.mutateAsync({
        key: 'video_pricing_setting.resolution_ratio_by_model',
        value: JSON.stringify(next),
      })
      setMap(next)
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FieldGroup>
      <div className='space-y-2'>
        <p className='text-sm font-medium'>{t('Video resolution pricing (multipliers)')}</p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Applied on top of duration for video billing. Unset values use the global default shown.'
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
                value={values[k] ?? 1}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [k]: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
          ))}
        </div>
        <Button type='button' variant='outline' size='sm' onClick={save} disabled={saving}>
          {saving ? t('Saving...') : t('Save resolution pricing')}
        </Button>
      </div>
    </FieldGroup>
  )
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

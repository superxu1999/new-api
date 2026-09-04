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
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const RES_KEYS = ['480p', '720p', '1080p', '4k'] as const

type ModelResolution = Record<string, number>

type VideoResolutionSectionProps = {
  byModelJSON: string
  globalJSON: string
}

function parseMap(raw: string): Record<string, ModelResolution> {
  try {
    const obj = JSON.parse(raw || '{}') as Record<string, ModelResolution>
    const out: Record<string, ModelResolution> = {}
    for (const [m, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') out[m] = { ...v }
    }
    return out
  } catch {
    return {}
  }
}

function parseRatios(raw: string): ModelResolution {
  try {
    const obj = JSON.parse(raw || '{}') as ModelResolution
    const out: ModelResolution = {}
    for (const k of RES_KEYS) {
      const v = obj[k]
      out[k] = typeof v === 'number' ? v : 1
    }
    return out
  } catch {
    return { '480p': 1, '720p': 1, '1080p': 1.25, '4k': 0.32 }
  }
}

export function VideoResolutionSection({
  byModelJSON,
  globalJSON,
}: VideoResolutionSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const initial = useMemo(() => parseMap(byModelJSON), [byModelJSON])
  const globalDefault = useMemo(() => parseRatios(globalJSON), [globalJSON])
  const [map, setMap] = useState<Record<string, ModelResolution>>(initial)
  const [model, setModel] = useState<string>('')
  const [values, setValues] = useState<ModelResolution>({ ...globalDefault })
  const [saving, setSaving] = useState(false)

  const selectModel = (m: string) => {
    setModel(m)
    setValues(map[m] ? { ...map[m] } : { ...globalDefault })
  }

  const onSave = async () => {
    if (!model.trim()) {
      toast.error(t('Enter a model name first'))
      return
    }
    const next: Record<string, ModelResolution> = {
      ...map,
      [model.trim()]: Object.fromEntries(RES_KEYS.map((k) => [k, values[k] ?? 1])),
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
    <SettingsSection title={t('Video resolution pricing (per model)')}>
      <div className='space-y-4'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Per-resolution multiplier applied to video billing on top of duration, overridable per model. Leave a model unset to use its global default.'
          )}
        </p>
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-64 flex-1 space-y-1.5'>
            <Label className='text-xs'>{t('Model')}</Label>
            <Input
              placeholder={t('e.g. seedance2.0-cyai-260128')}
              value={model}
              onChange={(e) => selectModel(e.target.value)}
            />
          </div>
        </div>
        {model && (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {RES_KEYS.map((k) => (
              <div key={k} className='space-y-1.5'>
                <Label className='text-xs'>{k}</Label>
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
        )}
        {model && (
          <Button onClick={onSave} disabled={saving}>
            {saving ? t('Saving...') : t('Save')}
          </Button>
        )}
      </div>
    </SettingsSection>
  )
}


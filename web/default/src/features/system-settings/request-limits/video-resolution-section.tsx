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

type VideoResolutionSectionProps = {
  defaultValue: string
}

function parseRatios(raw: string): Record<string, number> {
  try {
    const obj = JSON.parse(raw || '{}')
    const out: Record<string, number> = {}
    for (const k of RES_KEYS) {
      const v = (obj as Record<string, number>)[k]
      out[k] = typeof v === 'number' ? v : 1
    }
    return out
  } catch {
    return { '480p': 1, '720p': 1, '1080p': 1.25, '4k': 0.32 }
  }
}

export function VideoResolutionSection({
  defaultValue,
}: VideoResolutionSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const initial = useMemo(() => parseRatios(defaultValue), [defaultValue])
  const [values, setValues] = useState<Record<string, number>>(initial)
  const [saving, setSaving] = useState(false)

  const onSave = async () => {
    setSaving(true)
    try {
      const payload = Object.fromEntries(
        RES_KEYS.map((k) => [k, values[k] ?? 1])
      )
      await updateOption.mutateAsync({
        key: 'video_pricing_setting.resolution_ratio',
        value: JSON.stringify(payload),
      })
      toast.success(t('Saved'))
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection title={t('Video resolution pricing')}>
      <div className='space-y-4'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Per-resolution multiplier applied to video billing on top of duration. Aligns customer price with upstream cost (relative to 720p).'
          )}
        </p>
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
        <Button onClick={onSave} disabled={saving}>
          {saving ? t('Saving...') : t('Save')}
        </Button>
      </div>
    </SettingsSection>
  )
}

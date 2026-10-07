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
import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

import { useUpdateOption } from '../hooks/use-update-option'
import { SettingsSection } from '../components/settings-section'
import { SettingsPageFormActions } from '../components/settings-page-context'

const DISPLAY_NAMES_KEY = 'model_display_name_setting.names'

type MappingRow = { id: string; model: string; displayName: string }

/**
 * 模型显示名编辑器：C 端界面（如创作台）优先展示这里配置的产品名，
 * 内部模型名（可能带渠道后缀，如 seedance2.0-cyai-25-260628）退为技术信息。
 * 提交、计费、日志仍使用真实模型名，因此这里只是「换个说法」，不影响任何链路。
 */
export function ModelDisplayNamesEditor() {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [rows, setRows] = useState<MappingRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .get('/api/option/')
      .then((res) => {
        if (cancelled) return
        const items = (res.data?.data ?? []) as Array<{
          key: string
          value: string
        }>
        const raw = items.find((it) => it.key === DISPLAY_NAMES_KEY)?.value ?? '{}'
        let mapping: Record<string, string> = {}
        try {
          mapping = JSON.parse(raw) as Record<string, string>
        } catch {
          mapping = {}
        }
        setRows(
          Object.entries(mapping).map(([model, displayName]) => ({
            id: model,
            model,
            displayName,
          }))
        )
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateRow = useCallback((index: number, patch: Partial<MappingRow>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  }, [])

  const save = async () => {
    const mapping: Record<string, string> = {}
    for (const row of rows) {
      const model = row.model.trim()
      const displayName = row.displayName.trim()
      // 空行与「只有一边」的行直接忽略：半截配置对 C 端毫无意义。
      if (model && displayName) {
        mapping[model] = displayName
      }
    }
    await updateOption.mutateAsync({
      key: DISPLAY_NAMES_KEY,
      value: JSON.stringify(mapping),
    })
    toast.success(t('Saved successfully'))
  }

  return (
    <SettingsSection title={t('Model display names')}>
      <div className='flex flex-col gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'The name C-end users see for each model. Internal names such as channel-suffixed variants are hidden; leave empty to keep the model name unchanged.'
          )}
        </p>
        {loaded && rows.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'No display names configured yet. Models will show their internal names.'
            )}
          </p>
        )}

        {rows.map((row, index) => (
          <div key={row.id} className='flex items-center gap-2'>
            <Input
              value={row.model}
              placeholder={t('Internal model name')}
              onChange={(e) => updateRow(index, { model: e.target.value })}
              className='font-mono'
            />
            <Input
              value={row.displayName}
              placeholder={t('Display name shown to users')}
              onChange={(e) => updateRow(index, { displayName: e.target.value })}
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t('Remove')}
              onClick={() =>
                setRows((prev) => prev.filter((_, i) => i !== index))
              }
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        ))}

        <div className='flex items-center justify-between gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() =>
              setRows((prev) => [
                ...prev,
                {
                  id: `new-${Date.now()}-${prev.length}`,
                  model: '',
                  displayName: '',
                },
              ])
            }
          >
            <Plus className='mr-1 h-3.5 w-3.5' />
            {t('Add a mapping')}
          </Button>
          <SettingsPageFormActions
            onSave={() => void save()}
            onReset={() => setRows([])}
            isSaving={updateOption.isPending}
            resetLabel='Reset to default'
            saveLabel='Save display names'
          />
        </div>
      </div>
    </SettingsSection>
  )
}
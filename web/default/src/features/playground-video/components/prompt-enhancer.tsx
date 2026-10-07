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
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { getUserModels } from '@/features/playground/api'
import { isVideoModel } from '@/features/playground/hooks/use-playground-options'

import { enhancePromptViaChat } from '../lib/api'

/** 优化模型选择记在本地：下次打开还是上次的模型，不用每次重挑。 */
const ENHANCER_MODEL_KEY = 'playground_video_enhancer_model'

const STYLE_OPTIONS = [
  { value: 'enrich', label: 'Enrich' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'concise', label: 'Concise' },
] as const

interface PromptEnhancerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt: string
  onApply: (prompt: string) => void
}

/**
 * AI 提示词优化：把当前提示词交给站内聊天模型改写，用户对比后决定是否采纳。
 *
 * 这是一次正常计费的聊天调用（会话鉴权走 /pg/chat/completions），
 * 所以模型由用户自选、界面上明确说明会扣费——辅助功能也要诚实。
 */
export function PromptEnhancer(props: PromptEnhancerProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState('')
  const [style, setStyle] = useState<string>('enrich')
  const [source, setSource] = useState('')
  const [result, setResult] = useState('')
  const [generating, setGenerating] = useState(false)

  // 打开时用编辑器里的当前提示词初始化，之后在弹窗里改不影响编辑器（除非点采纳）。
  useEffect(() => {
    if (props.open) {
      setSource(props.prompt)
      setResult('')
    }
  }, [props.open, props.prompt])

  const { data: models = [] } = useQuery({
    queryKey: ['playground-video-enhancer-models'],
    queryFn: () => getUserModels(''),
    enabled: props.open,
  })
  // 只留聊天模型：视频/任务模型没法当改写器用。
  const chatModels = models
    .map((item) => item.value)
    .filter((name) => !isVideoModel(name))

  // 首次打开时定默认模型：记住的 > 列表第一个。
  useEffect(() => {
    if (chatModels.length === 0) {
      return
    }
    setModel((prev) => {
      if (prev && chatModels.includes(prev)) {
        return prev
      }
      try {
        const remembered = window.localStorage.getItem(ENHANCER_MODEL_KEY)
        if (remembered && chatModels.includes(remembered)) {
          return remembered
        }
      } catch {
        // localStorage 不可用就退回默认。
      }
      return chatModels[0]
    })
  }, [chatModels])

  const generate = async () => {
    if (!model || !source.trim() || generating) {
      return
    }
    setGenerating(true)
    setResult('')
    try {
      window.localStorage.setItem(ENHANCER_MODEL_KEY, model)
    } catch {
      // 记不住就记不住，不影响功能。
    }
    try {
      const enhanced = await enhancePromptViaChat({
        model,
        prompt: source.trim(),
        style,
      })
      if (!enhanced) {
        toast.error(t('Enhancement failed'))
        return
      }
      setResult(enhanced)
    } catch {
      toast.error(t('Enhancement failed'))
    } finally {
      setGenerating(false)
    }
  }

  const apply = () => {
    if (!result.trim()) {
      return
    }
    props.onApply(result.trim())
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Enhance prompt')}
      description={t(
        'Uses a chat model to rewrite your video prompt. Billed like a normal chat request.'
      )}
      contentClassName='sm:max-w-xl'
    >
      <div className='flex flex-col gap-4'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <Label className='text-xs'>{t('Helper model')}</Label>
            <Select
              value={model}
              onValueChange={(value) => value && setModel(value)}
            >
              <SelectTrigger className='w-full'>
                {/* 模型名本身不翻译，但显式给出：选项是异步拉取的，
                    SelectValue 反查不到时会把哨兵值/空值亮出来。 */}
                <SelectValue placeholder={t('Helper model')}>
                  {model || t('Helper model')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {chatModels.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex flex-col gap-2'>
            <Label className='text-xs'>{t('Style')}</Label>
            <Select value={style} onValueChange={(value) => value && setStyle(value)}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <Label className='text-xs'>{t('Prompt')}</Label>
          <Textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={4}
            placeholder={t('Describe the video you want to generate')}
          />
        </div>

        <div className='flex items-center gap-2'>
          <Button
            type='button'
            size='sm'
            disabled={generating || !model || !source.trim()}
            onClick={() => void generate()}
          >
            {generating ? (
              t('Generating...')
            ) : (
              <>
                <Sparkles className='mr-1 h-3.5 w-3.5' />
                {result ? t('Regenerate') : t('Generate')}
              </>
            )}
          </Button>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!result.trim()}
            onClick={apply}
          >
            {t('Apply')}
          </Button>
        </div>

        {result && (
          <div className='flex flex-col gap-2'>
            <Label className='text-xs'>{t('Enhanced prompt')}</Label>
            <div className='bg-muted/50 max-h-64 overflow-y-auto rounded-lg border p-3 text-sm whitespace-pre-wrap'>
              {result}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

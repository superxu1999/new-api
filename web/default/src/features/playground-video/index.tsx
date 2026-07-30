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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, getUserModels } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface VideoTask {
  taskId: string
  model: string
  prompt: string
  status: string
  progress?: string
  failReason?: string
}

const POLL_INTERVAL = 5000
const TERMINAL_STATUS = new Set(['SUCCESS', 'FAILURE'])

function statusVariant(status: string) {
  if (status === 'SUCCESS') return 'default' as const
  if (status === 'FAILURE') return 'destructive' as const
  return 'secondary' as const
}

export function PlaygroundVideo() {
  const { t } = useTranslation()
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [tasks, setTasks] = useState<VideoTask[]>([])
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const { data: models = [] } = useQuery({
    queryKey: ['playground-video-models'],
    queryFn: async () => {
      const res = await getUserModels()
      return res.success && Array.isArray(res.data) ? res.data : []
    },
  })

  // Poll pending tasks
  useEffect(() => {
    const timer = setInterval(async () => {
      const pending = tasksRef.current.filter((t) => !TERMINAL_STATUS.has(t.status))
      if (pending.length === 0) return
      const updates = await Promise.all(
        pending.map(async (task) => {
          try {
            const res = await api.get(`/pg/video/generations/${task.taskId}`, {
              skipErrorHandler: true,
            })
            const data = res.data?.data
            if (!data) return task
            return {
              ...task,
              status: data.status || task.status,
              progress: data.progress,
              failReason: data.fail_reason,
            }
          } catch {
            return task
          }
        })
      )
      const byId = new Map(updates.map((u) => [u.taskId, u]))
      setTasks((prev) => prev.map((t) => byId.get(t.taskId) ?? t))
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [])

  const handleSubmit = async () => {
    if (!model) {
      toast.error(t('Please select a model'))
      return
    }
    if (!prompt.trim()) {
      toast.error(t('Please enter a prompt'))
      return
    }
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { model, prompt: prompt.trim() }
      const seconds = Number(duration)
      if (duration && Number.isFinite(seconds) && seconds > 0) {
        body.duration = seconds
      }
      const res = await api.post('/pg/video/generations', body)
      const taskId = res.data?.task_id ?? res.data?.data?.task_id
      if (!taskId) {
        toast.error(t('Failed to submit video task'))
        return
      }
      setTasks((prev) => [
        { taskId, model, prompt: prompt.trim(), status: res.data?.status || 'SUBMITTED' },
        ...prev,
      ])
      toast.success(t('Video task submitted'))
    } catch {
      // error toast handled by api interceptor
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 p-4'>
      <div className='flex flex-col gap-4 rounded-lg border p-4'>
        <div className='flex flex-col gap-2'>
          <Label>{t('Model')}</Label>
          <Select value={model} onValueChange={(v) => setModel(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder={t('Select a video model')} />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-2'>
          <Label>{t('Prompt')}</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('Describe the video you want to generate')}
            rows={3}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>{t('Duration (seconds, optional)')}</Label>
          <Input
            type='number'
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder='5'
          />
        </div>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? t('Submitting...') : t('Generate Video')}
        </Button>
      </div>

      <div className='flex flex-col gap-3'>
        {tasks.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('No video tasks yet')}</p>
        )}
        {tasks.map((task) => (
          <div key={task.taskId} className='flex flex-col gap-2 rounded-lg border p-4'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium'>{task.model}</span>
              <Badge variant={statusVariant(task.status)}>
                {task.status}
                {task.progress && !TERMINAL_STATUS.has(task.status) ? ` ${task.progress}` : ''}
              </Badge>
            </div>
            <p className='text-muted-foreground line-clamp-2 text-sm'>{task.prompt}</p>
            {task.failReason && task.status === 'FAILURE' && (
              <p className='text-destructive text-sm'>{task.failReason}</p>
            )}
            {task.status === 'SUCCESS' && (
              <video
                controls
                className='w-full rounded-md'
                src={`/v1/videos/${task.taskId}/content`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

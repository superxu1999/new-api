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
import { useTranslation } from 'react-i18next'

import { getTaskStats } from '../api'
import type { TaskStats, TaskStatsResponse } from '../types'

interface TaskStatsBarProps {
  isAdmin: boolean
  startTimestamp?: number
  endTimestamp?: number
  taskId?: string
  channelId?: string
}

const STATUS_LABEL: Array<{ key: string; label: string; barClass: string }> = [
  { key: 'NOT_START', label: 'Not Started', barClass: 'bg-slate-400' },
  { key: 'QUEUED', label: 'Queued', barClass: 'bg-amber-500' },
  { key: 'IN_PROGRESS', label: 'In Progress', barClass: 'bg-sky-500' },
  { key: 'FAILURE', label: 'Failed', barClass: 'bg-rose-500' },
]

function StatChip(props: {
  label: string
  value: number | string
  barClass?: string
}) {
  return (
    <div className='border-border/60 bg-muted/30 inline-flex items-center gap-2 rounded-md border px-3 py-1.5'>
      {props.barClass && (
        <span className={`h-3 w-0.5 rounded-full ${props.barClass}`} />
      )}
      <span className='text-muted-foreground text-xs'>{props.label}</span>
      <span className='text-foreground text-xs font-semibold tabular-nums'>
        {props.value}
      </span>
    </div>
  )
}

export function TaskStatsBar({
  isAdmin,
  startTimestamp,
  endTimestamp,
  taskId,
  channelId,
}: TaskStatsBarProps) {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: [
      'task-stats',
      isAdmin,
      startTimestamp,
      endTimestamp,
      taskId,
      channelId,
    ],
    queryFn: async () => {
      const res = (await getTaskStats(
        {
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp,
          task_id: taskId,
          channel_id: channelId,
        },
        isAdmin
      )) as TaskStatsResponse
      return res.data
    },
    staleTime: 30_000,
  })

  const stats: TaskStats | undefined = data
  const avg = stats?.avg_duration_seconds ?? 0

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {STATUS_LABEL.map((item) => (
        <StatChip
          key={item.key}
          label={t(item.label)}
          value={stats?.items?.[item.key] ?? 0}
          barClass={item.barClass}
        />
      ))}
      <StatChip
        label={t('Average duration')}
        value={avg > 0 ? `${avg.toFixed(1)}s` : '-'}
        barClass='bg-emerald-500'
      />
    </div>
  )
}

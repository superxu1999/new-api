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
import { CheckCircle2, CircleDashed, CircleX, Film, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { assetPreviewUrl } from '../lib/asset'
import { chainProgress, type ChainSegment, type VideoChain } from '../lib/chain'

interface ChainProgressProps {
  chain: VideoChain
  running: boolean
  onStop: () => void
  onResume: () => void
  onDismiss: () => void
}

const segmentIcons = {
  pending: CircleDashed,
  running: Loader2,
  success: CheckCircle2,
  failed: CircleX,
} as const

/**
 * 连拍进度条：把「现在跑到第几段、每段什么结果、为什么停下」摆在一处。
 *
 * 连拍是要花钱的自动流程，最忌讳的就是它自己悄悄跑或者悄悄停 —— 所以状态常驻
 * 在编辑器上方，停止/续跑都必须是用户显式点的按钮，不自动续跑。
 */
export function ChainProgress(props: ChainProgressProps) {
  const { t } = useTranslation()
  const progress = chainProgress(props.chain)
  const active = props.chain.segments.find(
    (segment) => segment.status === 'running' || segment.status === 'pending'
  )
  const current = active ? active.index : progress.total

  return (
    <div className='flex flex-col gap-3 rounded-xl border p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Film className='h-4 w-4' />
        <span className='text-sm font-medium'>{t('Continuous chain')}</span>
        <span className='text-muted-foreground text-xs'>
          {t('Segment {{index}} of {{total}}', {
            index: current,
            total: progress.total,
          })}
        </span>
        <Badge variant={statusVariant(props.chain.status)}>
          {statusText(props.chain.status, t)}
        </Badge>
        <div className='ml-auto flex items-center gap-2'>
          {props.running && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={props.onStop}
            >
              {t('Stop chain')}
            </Button>
          )}
          {props.chain.status === 'paused' && (
            <Button type='button' size='sm' onClick={props.onResume}>
              {t('Resume chain')}
            </Button>
          )}
          {!props.running && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={props.onDismiss}
            >
              {t('Dismiss chain')}
            </Button>
          )}
        </div>
      </div>

      <div className='flex flex-wrap gap-2'>
        {props.chain.segments.map((segment) => (
          <SegmentChip key={segment.index} segment={segment} />
        ))}
      </div>

      {props.chain.reason && (
        <p className='text-destructive text-xs'>
          {t(props.chain.reason.key, props.chain.reason.params)}
        </p>
      )}

      {props.chain.firstFrame && (
        <div className='flex items-center gap-2'>
          <img
            src={assetPreviewUrl(props.chain.firstFrame.asset)}
            alt={t('Last frame')}
            className='h-12 w-20 rounded border object-cover'
          />
          <span className='text-muted-foreground text-xs'>
            {t('Last frame carried into the next segment')}
          </span>
        </div>
      )}
    </div>
  )
}

function SegmentChip(props: { segment: ChainSegment }) {
  const { t } = useTranslation()
  const Icon = segmentIcons[props.segment.status]
  const failed = props.segment.status === 'failed'
  return (
    <span
      title={props.segment.failReason || props.segment.prompt}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
        failed && 'border-destructive text-destructive'
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          props.segment.status === 'running' && 'animate-spin'
        )}
      />
      {t('Segment {{index}}', { index: props.segment.index })}
    </span>
  )
}

function statusVariant(status: VideoChain['status']) {
  if (status === 'done') return 'default' as const
  if (status === 'failed') return 'destructive' as const
  return 'secondary' as const
}

function statusText(
  status: VideoChain['status'],
  t: (key: string) => string
): string {
  if (status === 'running') return t('Chain running')
  if (status === 'paused') return t('Chain paused')
  if (status === 'done') return t('Chain finished')
  if (status === 'failed') return t('Chain failed')
  return t('Chain stopped')
}

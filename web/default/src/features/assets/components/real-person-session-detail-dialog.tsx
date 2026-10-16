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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { formatTimestampToDate } from '@/lib/format'

import {
  deleteRealPersonSession,
  extractAssetError,
  listAssetGroups,
  updateAssetGroup,
} from '../api'
import type { RealPersonSessionRow } from '../types'
import { RealPersonStatusBadge } from './real-person-status-badge'

interface SessionDetailDialogProps {
  /** 被查看的会话；null 表示关闭。 */
  session: RealPersonSessionRow | null
  onOpenChange: (open: boolean) => void
  /** 记录被删除后通知父组件刷新列表。 */
  onDeleted: () => void
}

/**
 * 认证会话详情。
 *
 * 之前「详情」只是把这条记录设成「当前查看的会话」，界面上最多多一行「绑定的组 #7」，
 * 回答不了「谁做的、什么时候做的、产出了什么、还能不能用」。这里把会话档案一次摆清：
 * 状态与时间、渠道归属、短码与链接（可复制）、绑定素材组（可改名）、以及清理入口。
 */
export function RealPersonSessionDetailDialog(props: SessionDetailDialogProps) {
  const { t } = useTranslation()
  const session = props.session
  const open = session !== null

  const deleteMutation = useMutation({
    mutationFn: () => deleteRealPersonSession(session?.session_id ?? 0),
    onSuccess: () => {
      toast.success(t('Deleted'))
      props.onOpenChange(false)
      props.onDeleted()
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {t('Verification details')}
            {session && <RealPersonStatusBadge status={session.status} />}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Liveness verification must be completed by the person in front of the camera. A record cannot be edited after it is created, but you can delete it or rename the bound material group.'
            )}
          </DialogDescription>
        </DialogHeader>

        {session && (
          <div className='flex flex-col gap-5'>
            {/* 档案：两列定义列表，成对信息对齐着看 */}
            <section className='flex flex-col gap-2'>
              <SectionTitle>{t('Session')}</SectionTitle>
              <dl className='grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2'>
                <Field label={t('ID')} value={`#${session.session_id}`} mono />
                <Field
                  label={t('Channel')}
                  value={`#${session.channel_id}`}
                  mono
                />
                <Field
                  label={t('Created At')}
                  value={formatTimestampToDate(session.created_at)}
                />
                <Field
                  label={t('Expires At')}
                  value={
                    session.expires_at > 0
                      ? formatTimestampToDate(session.expires_at)
                      : t('Not set')
                  }
                />
              </dl>
            </section>

            {/* 链接：长链接必须可复制，且不能撑破弹窗 */}
            <section className='flex flex-col gap-2'>
              <SectionTitle>{t('Verification link')}</SectionTitle>
              {session.h5_link !== '' ? (
                <div className='flex items-center gap-2'>
                  <a
                    className='text-primary min-w-0 flex-1 truncate text-xs underline'
                    href={session.h5_link}
                    target='_blank'
                    rel='noreferrer'
                    title={session.h5_link}
                  >
                    {session.h5_link}
                  </a>
                  <CopyButton value={session.h5_link} size='sm' variant='outline' />
                </div>
              ) : (
                <p className='text-muted-foreground text-xs'>
                  {t('No link was returned for this session.')}
                </p>
              )}
              {session.short_link !== '' && (
                <p className='text-muted-foreground flex items-center gap-2 text-xs'>
                  {t('Short link code')}
                  <span className='text-foreground font-mono'>
                    {session.short_link}
                  </span>
                  <CopyButton
                    value={session.short_link}
                    size='sm'
                    variant='ghost'
                  />
                </p>
              )}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The link expires quickly. If it no longer opens, start a new verification instead of reusing it.'
                )}
              </p>
            </section>

            {/* 绑定组：认证通过后才有；可改名便于区分「是谁的真人素材」 */}
            <section className='flex flex-col gap-2'>
              <SectionTitle>{t('Bound material group')}</SectionTitle>
              <BoundGroupEditor groupId={session.group_id} status={session.status} />
            </section>
          </div>
        )}

        <DialogFooter>
          <Button
            variant='destructive'
            disabled={!session || deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className='mr-1 h-4 w-4' />
            {t('Delete record')}
          </Button>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 小节标题：把弹窗切成三块，避免所有信息挤成一坨。 */
function SectionTitle(props: { children: React.ReactNode }) {
  return (
    <h3 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
      {props.children}
    </h3>
  )
}

/** 档案字段：左标签右取值，成对信息对齐着看。 */
function Field(props: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <dt className='text-muted-foreground shrink-0 text-xs'>{props.label}</dt>
      <dd
        className={
          props.mono
            ? 'min-w-0 truncate font-mono text-sm'
            : 'min-w-0 truncate text-sm'
        }
      >
        {props.value}
      </dd>
    </div>
  )
}

/**
 * 绑定素材组：展示组 ID 与类型，组名可改（改的是组，不是这条会话记录）。
 *
 * 组名是异步取的，所以先放进 state 再回填 —— 直接把查询结果绑到输入框的 value 上，
 * 会在查询返回时覆盖用户正在输入的内容。
 */
function BoundGroupEditor(props: { groupId: number; status: string }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')

  const groupsQuery = useQuery({
    queryKey: ['asset-groups', props.groupId],
    queryFn: () => listAssetGroups(),
    enabled: props.groupId > 0,
    retry: false,
  })
  const group = groupsQuery.data?.find((item) => item.id === props.groupId)

  useEffect(() => {
    if (group) {
      setName(group.name)
    }
  }, [group])

  // 切换到另一条会话时清掉上一条留下的草稿，避免误以为已改过。
  useEffect(() => {
    setDraft('')
  }, [props.groupId])

  const renameMutation = useMutation({
    mutationFn: (value: string) =>
      updateAssetGroup(props.groupId, { name: value }),
    onSuccess: () => {
      toast.success(t('Saved successfully'))
      setDraft('')
      groupsQuery.refetch()
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  if (props.groupId <= 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {props.status === 'verified'
          ? t('This session has no bound group yet. Re-check the result.')
          : t('No group is bound until the verification is completed on the phone.')}
      </p>
    )
  }

  const dirty = draft !== '' && draft !== name

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground text-xs'>
          {t('Group')}
        </span>
        <span className='font-mono text-sm'>#{props.groupId}</span>
        {group && (
          <Badge variant='secondary' className='text-[10px]'>
            {group.group_type}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <Input
          value={draft || name}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('Group name')}
          className='h-8 flex-1 text-sm'
        />
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8 shrink-0'
          aria-label={t('Rename group')}
          disabled={!dirty || renameMutation.isPending}
          onClick={() => renameMutation.mutate(draft.trim())}
        >
          <Pencil className='h-4 w-4' />
        </Button>
      </div>
    </div>
  )
}
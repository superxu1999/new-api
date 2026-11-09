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
import { Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatLogQuota, formatTimestampRelative } from '@/lib/format'

import { getAgentLogs, getAgentStats, getAgentUsers } from './api'

const PAGE_SIZE = 20
const MONTH_SECONDS = 30 * 24 * 60 * 60

/**
 * 「我的下级」：代理视角的只读工作台。
 *
 * 只能看到直接下级（后端按 inviter_id 一层推导），没有任何写操作 —— 不能改额度、
 * 不能禁用账号、看不到密钥。代理本身不是管理员，拿不到任何后台入口。
 */
export function AgentWorkspace() {
  const { t } = useTranslation()
  const [keywordDraft, setKeywordDraft] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [logUserId, setLogUserId] = useState<number | undefined>(undefined)
  const [logPage, setLogPage] = useState(1)

  const usersQuery = useQuery({
    queryKey: ['agent-subordinates', keyword, page],
    queryFn: () => getAgentUsers({ page, pageSize: PAGE_SIZE, keyword }),
  })
  const statsQuery = useQuery({
    queryKey: ['agent-stats'],
    queryFn: () =>
      getAgentStats({
        startTimestamp: Math.floor(Date.now() / 1000) - MONTH_SECONDS,
      }),
  })
  const logsQuery = useQuery({
    queryKey: ['agent-logs', logUserId, logPage],
    queryFn: () => getAgentLogs({ page: logPage, pageSize: PAGE_SIZE, userId: logUserId }),
  })

  const summary = usersQuery.data?.summary
  const users = usersQuery.data?.page.items ?? []
  const totalUsers = usersQuery.data?.page.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))
  const logs = logsQuery.data?.items ?? []
  const totalLogs = logsQuery.data?.total ?? 0
  const logPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE))

  const applyKeyword = () => {
    setKeyword(keywordDraft.trim())
    setPage(1)
  }

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto p-4'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-base font-medium'>{t('My subordinates')}</h2>
        <p className='text-muted-foreground text-xs'>
          {t('Read-only view of the users assigned to you.')}
        </p>
      </div>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <SummaryTile
          label={t('Subordinates')}
          value={String(summary?.user_count ?? 0)}
        />
        <SummaryTile
          label={t('Their balance')}
          value={formatLogQuota(summary?.total_quota ?? 0)}
        />
        <SummaryTile
          label={t('Their total usage')}
          value={formatLogQuota(summary?.total_used_quota ?? 0)}
        />
        <SummaryTile
          label={t('Requests this month')}
          value={String(statsQuery.data?.total_count ?? 0)}
        />
      </div>

      <section className='flex flex-col gap-3 rounded-xl border p-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>{t('Subordinate users')}</h3>
          <div className='flex items-center gap-2'>
            <Input
              className='h-8 w-52'
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyKeyword()
                }
              }}
              placeholder={t('Search username or ID')}
            />
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={applyKeyword}
            >
              <Search className='mr-1 h-3.5 w-3.5' />
              {t('Search')}
            </Button>
          </div>
        </div>

        {usersQuery.isLoading && (
          <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
        )}
        {!usersQuery.isLoading && users.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No subordinates yet')}
          </p>
        )}
        {!usersQuery.isLoading && users.length > 0 && (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-muted-foreground text-left text-xs'>
                <tr>
                  <th className='py-2 pr-3 font-normal'>{t('Username')}</th>
                  <th className='py-2 pr-3 font-normal'>{t('Group')}</th>
                  <th className='py-2 pr-3 font-normal'>{t('Status')}</th>
                  <th className='py-2 pr-3 text-right font-normal'>
                    {t('Balance')}
                  </th>
                  <th className='py-2 pr-3 text-right font-normal'>
                    {t('Used quota')}
                  </th>
                  <th className='py-2 pr-3 text-right font-normal'>
                    {t('Requests')}
                  </th>
                  <th className='py-2 text-right font-normal'>
                    {t('Joined')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className='border-t'>
                    <td className='py-2 pr-3'>
                      {user.display_name || user.username}
                      <span className='text-muted-foreground ml-1 text-xs'>
                        #{user.id}
                      </span>
                    </td>
                    <td className='py-2 pr-3'>{user.group || '-'}</td>
                    <td className='py-2 pr-3'>
                      {user.status === 1 ? t('Enabled') : t('Disabled')}
                    </td>
                    <td className='py-2 pr-3 text-right'>
                      {formatLogQuota(user.quota ?? 0)}
                    </td>
                    <td className='py-2 pr-3 text-right'>
                      {formatLogQuota(user.used_quota ?? 0)}
                    </td>
                    <td className='py-2 pr-3 text-right'>
                      {user.request_count ?? 0}
                    </td>
                    <td className='py-2 text-right'>
                      {user.created_at
                        ? formatTimestampRelative(user.created_at)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className='flex items-center justify-end gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{page}} of {{total}}', {
                page,
                total: totalPages,
              })}
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              {t('Previous page')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              {t('Next page')}
            </Button>
          </div>
        )}
      </section>

      <section className='flex flex-col gap-3 rounded-xl border p-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>{t('Subordinate usage logs')}</h3>
          <select
            className='border-input bg-background h-8 rounded-md border px-2 text-sm'
            value={logUserId ?? ''}
            onChange={(event) => {
              const value = event.target.value
              setLogUserId(value === '' ? undefined : Number(value))
              setLogPage(1)
            }}
          >
            <option value=''>{t('All subordinates')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name || user.username}
              </option>
            ))}
          </select>
        </div>

        {logsQuery.isLoading && (
          <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
        )}
        {!logsQuery.isLoading && logs.length === 0 && (
          <p className='text-muted-foreground text-sm'>{t('No logs yet')}</p>
        )}
        {!logsQuery.isLoading && logs.length > 0 && (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-muted-foreground text-left text-xs'>
                <tr>
                  <th className='py-2 pr-3 font-normal'>{t('Time')}</th>
                  <th className='py-2 pr-3 font-normal'>{t('Username')}</th>
                  <th className='py-2 pr-3 font-normal'>{t('Model')}</th>
                  <th className='py-2 pr-3 text-right font-normal'>
                    {t('Tokens')}
                  </th>
                  <th className='py-2 text-right font-normal'>{t('Cost')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className='border-t'>
                    <td className='py-2 pr-3 whitespace-nowrap'>
                      {formatTimestampRelative(log.created_at)}
                    </td>
                    <td className='py-2 pr-3'>{log.username || '-'}</td>
                    <td className='py-2 pr-3'>{log.model_name || '-'}</td>
                    <td className='py-2 pr-3 text-right'>
                      {(log.prompt_tokens ?? 0) + (log.completion_tokens ?? 0)}
                    </td>
                    <td className='py-2 text-right'>
                      {formatLogQuota(log.quota ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {logPages > 1 && (
          <div className='flex items-center justify-end gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Page {{page}} of {{total}}', {
                page: logPage,
                total: logPages,
              })}
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={logPage <= 1}
              onClick={() => setLogPage((prev) => Math.max(1, prev - 1))}
            >
              {t('Previous page')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={logPage >= logPages}
              onClick={() => setLogPage((prev) => Math.min(logPages, prev + 1))}
            >
              {t('Next page')}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryTile(props: { label: string; value: string }) {
  return (
    <div className='rounded-xl border p-4'>
      <p className='text-muted-foreground text-xs'>{props.label}</p>
      <p className='mt-1 text-lg font-medium'>{props.value}</p>
    </div>
  )
}

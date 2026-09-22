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
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatTimestampToDate } from '@/lib/format'

import {
  createRealPersonSession,
  extractAssetError,
  getRealPersonSession,
  listRealPersonSessions,
} from '../api'

/**
 * 真人认证面板。
 *
 * 活体认证必须由真人本人在手机上完成（上游明确不可绕过），所以这里只负责：
 * 拉起认证会话 → 展示 H5 链接与二维码 → 轮询认证结果 → 显示绑定的真人素材组。
 * 认证链接有效期短，随时可以重新生成。
 */
export function RealPersonPanel() {
  const { t } = useTranslation()
  const [sessionId, setSessionId] = useState<number>(0)
  const [h5Link, setH5Link] = useState('')
  const [shortLink, setShortLink] = useState('')

  const createMutation = useMutation({
    mutationFn: createRealPersonSession,
    onSuccess: (data) => {
      setSessionId(data.session_id)
      setH5Link(data.h5_link)
      // 二维码编码短链：上游链接很长，直接编码会让二维码过密、低端手机扫不出来。
      setShortLink(data.short_link || data.h5_link)
      toast.success(t('Verification link generated'))
    },
    onError: (error) => toast.error(extractAssetError(error).message),
  })

  const sessionQuery = useQuery({
    queryKey: ['real-person-session', sessionId],
    queryFn: () => getRealPersonSession(sessionId),
    enabled: sessionId > 0,
    retry: false,
    // 认证在手机上完成，页面轮询结果；已通过后停止轮询。
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && data.status === 'verified') return false
      return 5000
    },
  })

  const session = sessionQuery.data
  const verified = session?.status === 'verified'

  // 认证历史：完成后刷新一次，方便对账与继续查看已绑定的真人素材组。
  const historyQuery = useQuery({
    queryKey: ['real-person-sessions', session?.status],
    queryFn: listRealPersonSessions,
    retry: false,
  })
  const history = historyQuery.data ?? []

  return (
    <div className='space-y-4'>
      <Alert>
        <AlertTitle>{t('Real-person verification')}</AlertTitle>
        <AlertDescription>
          {t(
            'Real-person materials must go through liveness verification before they can be used for generation. The person in front of the camera completes it on a phone, and the link expires quickly.'
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className='space-y-4 pt-6'>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {t('Start verification')}
          </Button>

          {h5Link !== '' && (
            <div className='space-y-3'>
              <div className='flex justify-center rounded-lg border bg-white p-4'>
                <QRCodeSVG
                  value={shortLink}
                  size={260}
                  level='L'
                  marginSize={2}
                />
              </div>
              <p className='text-muted-foreground text-center text-xs'>
                {t('Scan the QR code with a phone, or open this link:')}
              </p>
              <div className='flex items-center justify-center gap-2'>
                <a
                  className='text-primary max-w-[420px] truncate text-xs underline'
                  href={shortLink}
                  target='_blank'
                  rel='noreferrer'
                >
                  {shortLink}
                </a>
                <CopyButton value={shortLink} size='sm' variant='outline' />
              </div>
              <p className='text-muted-foreground text-center text-xs'>
                {t(
                  'If the link has expired, generate a new one. Verification cannot be skipped.'
                )}
              </p>
            </div>
          )}

          {sessionId > 0 && (
            <div className='flex items-center justify-center gap-2 text-sm'>
              {!verified && <Spinner />}
              <span>{t('Verification status')}:</span>
              {verified ? (
                <Badge>{t('Verified')}</Badge>
              ) : (
                <Badge variant='secondary'>{t('Waiting for completion')}</Badge>
              )}
            </div>
          )}

          {verified && session && (
            <p className='text-center text-sm'>
              {t('Bound real-person group')}: #{session.group_id}
            </p>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className='space-y-3 pt-6'>
            <h3 className='text-sm font-medium'>
              {t('Verification history')}
            </h3>
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ID')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead>{t('Asset group')}</TableHead>
                    <TableHead>{t('Created At')}</TableHead>
                    <TableHead className='text-right'>
                      {t('Actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className='font-mono text-xs'>
                        #{item.id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.status === 'verified' ? 'default' : 'secondary'
                          }
                        >
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.group_id > 0 ? `#${item.group_id}` : '—'}
                      </TableCell>
                      <TableCell>
                        {formatTimestampToDate(item.created_at)}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => {
                            setSessionId(item.id)
                            setH5Link('')
                            setShortLink('')
                          }}
                        >
                          {t('Details')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

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
import { Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { formatLocalCurrencyAmount } from '@/lib/currency'

import { getUserBillingHistory, isApiSuccess } from '../../api'
import type { WechatPaymentResponse } from '../../types'

interface WechatPayDialogProps {
  order: WechatPaymentResponse | null
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}

/** 轮询间隔（毫秒）。微信回调通常在数秒内到达。 */
const POLL_INTERVAL_MS = 3000

/** 超过该时长仍未到账就停止轮询并提示用户手动刷新。 */
const POLL_TIMEOUT_MS = 15 * 60 * 1000

export function WechatPayDialog(props: WechatPayDialogProps) {
  const { t } = useTranslation()
  const [paid, setPaid] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [checking, setChecking] = useState(false)
  const paidRef = useRef(false)

  const tradeNo = props.order?.trade_no ?? null

  // onPaid 由父组件每次渲染重建；用 ref 持有最新引用，避免轮询 effect 被反复重建。
  const onPaidRef = useRef(props.onPaid)
  useEffect(() => {
    onPaidRef.current = props.onPaid
  }, [props.onPaid])

  const checkOrder = useCallback(async () => {
    if (!tradeNo) {
      return false
    }
    const response = await getUserBillingHistory(1, 20, tradeNo)
    if (!isApiSuccess(response)) {
      return false
    }
    const matched = (response.data?.items ?? []).find(
      (item) => item.trade_no === tradeNo && item.status === 'success'
    )
    return !!matched
  }, [tradeNo])

  // 关闭或切换订单时重置本地状态
  useEffect(() => {
    setPaid(false)
    setTimedOut(false)
    paidRef.current = false
  }, [tradeNo])

  useEffect(() => {
    if (!tradeNo || paid) {
      return
    }

    let cancelled = false
    const startedAt = Date.now()

    const timer = window.setInterval(async () => {
      if (cancelled || paidRef.current) {
        return
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(timer)
        setTimedOut(true)
        return
      }
      try {
        const settled = await checkOrder()
        if (settled && !cancelled && !paidRef.current) {
          paidRef.current = true
          window.clearInterval(timer)
          setPaid(true)
          toast.success(t('Payment successful'))
          onPaidRef.current()
        }
      } catch {
        // 单次轮询失败不打断流程，下一轮继续
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [tradeNo, paid, checkOrder, t])

  const handleManualRefresh = async () => {
    setChecking(true)
    try {
      const settled = await checkOrder()
      if (settled) {
        paidRef.current = true
        setPaid(true)
        toast.success(t('Payment successful'))
        props.onPaid()
        return
      }
      toast.info(t('Payment not received yet'))
    } catch {
      toast.error(t('Failed to load billing history'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Dialog
      open={!!props.order}
      onOpenChange={(open) => {
        if (!open) {
          props.onOpenChange(false)
        }
      }}
      title={paid ? t('Payment successful') : t('Scan to pay with WeChat')}
      description={
        paid
          ? t('Your balance has been credited.')
          : t('Open WeChat and scan the QR code to complete the payment.')
      }
      contentClassName='sm:max-w-[420px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {paid ? (
        <div className='flex flex-col items-center gap-3 py-4'>
          <CheckCircle2 className='h-12 w-12 text-green-600' />
          <p className='text-sm font-medium'>{t('Payment successful')}</p>
        </div>
      ) : (
        <>
          <div className='flex flex-col items-center gap-3'>
            <div className='rounded-lg border bg-white p-3'>
              <QRCodeSVG value={props.order?.code_url ?? ''} size={200} />
            </div>
            <div className='text-center'>
              <div className='text-muted-foreground text-xs'>
                {t('Amount to pay:')}
              </div>
              <div className='text-lg font-semibold'>
                {formatLocalCurrencyAmount(
                  Number(props.order?.money ?? 0),
                  { digitsLarge: 2, digitsSmall: 2 }
                )}
              </div>
            </div>
          </div>

          {timedOut ? (
            <div className='text-muted-foreground flex flex-col items-center gap-2 text-center text-xs'>
              <p>{t('Still waiting for the payment result.')}</p>
              <Button
                size='sm'
                variant='outline'
                onClick={handleManualRefresh}
                disabled={checking}
              >
                {checking ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <RefreshCw className='h-4 w-4' />
                )}
                {t('Check payment status')}
              </Button>
            </div>
          ) : (
            <div className='text-muted-foreground flex items-center justify-center gap-2 text-center text-xs'>
              <Loader2 className='h-3 w-3 animate-spin' />
              {t('Waiting for payment...')}
            </div>
          )}

          {props.order?.trade_no && (
            <div className='text-muted-foreground text-center font-mono text-[11px] break-all'>
              {props.order.trade_no}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

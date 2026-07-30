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
import { motion, AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

export function CustomerServiceWidget() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { status } = useStatus()

  const qrUrl =
    status?.wechat_qrcode ||
    status?.wechat_qr_code ||
    status?.wechat_qrcode_image_url ||
    status?.wechat_qr_code_image_url ||
    status?.wechat_account_qrcode_image_url ||
    status?.WeChatAccountQRCodeImageURL ||
    ''

  if (!qrUrl) return null

  return (
    <>
      {/* Floating button */}
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'fixed right-5 bottom-5 z-50 flex size-12 items-center justify-center rounded-full shadow-lg transition-all duration-200',
          'bg-primary text-primary-foreground hover:bg-primary/90',
          'hover:scale-110 active:scale-95'
        )}
        aria-label={t('Toggle customer service')}
      >
        {open ? (
          // Close (X) icon
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='22'
            height='22'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
          >
            <line x1='18' y1='6' x2='6' y2='18' />
            <line x1='6' y1='6' x2='18' y2='18' />
          </svg>
        ) : (
          // Message bubble icon
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='22'
            height='22'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden='true'
          >
            <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
          </svg>
        )}
      </button>

      {/* QR card */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className='fixed right-5 bottom-20 z-50'
          >
            <div
              className={cn(
                'bg-popover text-popover-foreground flex w-56 flex-col items-center gap-3 rounded-xl p-5 shadow-xl ring-1',
                'ring-foreground/10'
              )}
            >
              <p className='text-sm font-medium'>{t('Customer Service')}</p>

              <div className='overflow-hidden rounded-lg border border-border/40'>
                <img
                  src={qrUrl}
                  alt={t('WeChat QR Code')}
                  className='block size-40 object-contain'
                />
              </div>

              <p className='text-muted-foreground text-center text-xs leading-relaxed'>
                {t('Scan QR code to add WeChat')}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

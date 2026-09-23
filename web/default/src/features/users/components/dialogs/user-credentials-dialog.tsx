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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

type UserCredentialsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  username: string
  password: string
}

/** 新建用户成功后展示本次生成的账号密码，方便一次性复制转交。 */
export function UserCredentialsDialog({
  open,
  onOpenChange,
  username,
  password,
}: UserCredentialsDialogProps) {
  const { t } = useTranslation()
  const credentialsText = `${t('Username')}: ${username}\n${t('Password')}: ${password}`

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('User created successfully')}
      description={t('Copy the credentials below and hand them to the user.')}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <CopyButton value={credentialsText} variant='outline' size='sm'>
            {t('Copy All')}
          </CopyButton>
          <Button type='button' onClick={() => onOpenChange(false)}>
            {t('Done')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <CredentialRow label={t('Username')} value={username} />
        <CredentialRow label={t('Password')} value={password} />
      </div>
    </Dialog>
  )
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation()

  return (
    <div className='flex flex-col gap-1'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <div className='bg-muted flex items-center gap-2 rounded-md border px-3 py-2'>
        <code className='min-w-0 flex-1 font-mono text-sm break-all'>
          {value}
        </code>
        <CopyButton
          value={value}
          tooltip={t('Copy to clipboard')}
          successTooltip={t('Copied!')}
        />
      </div>
    </div>
  )
}

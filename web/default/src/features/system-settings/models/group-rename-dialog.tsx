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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

interface GroupRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前定价分组表里的分组名，用作「旧名称」下拉。 */
  groupNames: string[]
  /** 改名成功后回调（服务端已改完数据库与配置，调用方应重新加载设置）。 */
  onRenamed: () => void
}

interface RenameResult {
  users?: number
  tokens?: number
  channels?: number
}

/**
 * 分组改名。
 *
 * 分组在系统里只是字符串，散落在定价倍率、充值倍率、用户可选分组、特殊可用分组规则，
 * 以及用户 / 令牌 / 渠道（还有由渠道派生的能力表）里。只改定价表会让已有用户留在旧
 * 分组、新分组又没有渠道服务，所以这里走服务端的一次性同步改名，而不是在前端就地改字。
 */
export function GroupRenameDialog(props: GroupRenameDialogProps) {
  const { t } = useTranslation()
  const [oldName, setOldName] = useState('')
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const trimmedNew = newName.trim()
  const canSubmit =
    oldName !== '' && trimmedNew !== '' && trimmedNew !== oldName && !renaming

  const handleSubmit = async () => {
    if (!canSubmit) {
      return
    }
    setRenaming(true)
    try {
      const res = await api.post('/api/option/group/rename', {
        old_name: oldName,
        new_name: trimmedNew,
      })
      const data = (res.data?.data ?? {}) as RenameResult
      toast.success(
        t(
          'Group renamed. Updated {{users}} users, {{tokens}} tokens and {{channels}} channels.',
          {
            users: data.users ?? 0,
            tokens: data.tokens ?? 0,
            channels: data.channels ?? 0,
          }
        )
      )
      props.onOpenChange(false)
      setOldName('')
      setNewName('')
      props.onRenamed()
    } catch {
      // 具体原因（分组不存在 / 目标名已存在）由接口层提示。
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Rename group')}
      description={t(
        'Renaming a group updates its ratio, top-up ratio, user-selectable list, special usable-group rules, and every user, token and channel that uses it. Save your pending edits first.'
      )}
      footer={
        <Button
          type='button'
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {renaming ? t('Renaming...') : t('Rename')}
        </Button>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1.5'>
          <Label className='text-xs'>{t('Current group name')}</Label>
          <select
            className='border-input bg-background h-9 rounded-md border px-2 text-sm'
            value={oldName}
            onChange={(event) => setOldName(event.target.value)}
          >
            <option value=''>{t('Select a group')}</option>
            {props.groupNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label className='text-xs'>{t('New group name')}</Label>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t('Enter a new group name')}
          />
        </div>
      </div>
    </Dialog>
  )
}

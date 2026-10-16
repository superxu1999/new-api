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

import { Badge } from '@/components/ui/badge'

import { realPersonStatusVariant } from '../lib/real-person-status'

/** 认证状态徽章：后端未覆盖的状态原样展示。 */
export function RealPersonStatusBadge(props: { status: string }) {
  const { t } = useTranslation()
  let label = props.status
  if (props.status === 'pending') label = t('Waiting for completion')
  if (props.status === 'verified') label = t('Verified')
  if (props.status === 'cancelled') label = t('Cancelled')
  return <Badge variant={realPersonStatusVariant(props.status)}>{label}</Badge>
}
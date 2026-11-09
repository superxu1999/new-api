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
import { createFileRoute } from '@tanstack/react-router'

import { AgentWorkspace } from '@/features/agent'

// 代理的只读工作台：只能看到直接下级（inviter_id 指向自己）的用户与用量，
// 没有管理入口。侧边栏按 requiredRole 只对代理及以上显示。
export const Route = createFileRoute('/_authenticated/agent/')({
  component: AgentWorkspace,
})

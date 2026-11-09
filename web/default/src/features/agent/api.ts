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
import { api } from '@/lib/api'

/** 代理名下直接下级的汇总（后端按 inviter_id 一层统计）。 */
export interface SubordinateSummary {
  user_count: number
  total_quota: number
  total_used_quota: number
  total_requests: number
}

/** 下级用户：后端已剔除密码与访问令牌，只返回业务字段。 */
export interface AgentSubordinate {
  id: number
  username: string
  display_name?: string
  group?: string
  status: number
  quota: number
  used_quota: number
  request_count?: number
  created_at?: number
  last_login_at?: number
}

export interface AgentPage<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

export interface AgentLog {
  id: number
  created_at: number
  username?: string
  model_name?: string
  token_name?: string
  quota?: number
  prompt_tokens?: number
  completion_tokens?: number
  content?: string
}

export interface AgentStatRow {
  user_id: number
  username: string
  display_name: string
  quota: number
  count: number
}

export interface AgentStats {
  items: AgentStatRow[]
  total_quota: number
  total_count: number
  subordinate_count: number
}

const EMPTY_SUMMARY: SubordinateSummary = {
  user_count: 0,
  total_quota: 0,
  total_used_quota: 0,
  total_requests: 0,
}

/**
 * 我的下级列表。
 *
 * 范围由后端按「inviter_id 指向当前登录账号」推导，前端不传任何用户范围参数，
 * 也就没有可以把范围改大的入口。
 */
export async function getAgentUsers(params: {
  page?: number
  pageSize?: number
  keyword?: string
}): Promise<{ page: AgentPage<AgentSubordinate>; summary: SubordinateSummary }> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const query = new URLSearchParams({
    p: String(page),
    page_size: String(pageSize),
  })
  if (params.keyword) {
    query.set('keyword', params.keyword)
  }
  const res = await api.get(`/api/agent/users?${query.toString()}`)
  const data = res.data?.data ?? {}
  return {
    page: {
      page: Number(data.page ?? page),
      page_size: Number(data.page_size ?? pageSize),
      total: Number(data.total ?? 0),
      items: (data.items ?? []) as AgentSubordinate[],
    },
    summary: (data.summary ?? EMPTY_SUMMARY) as SubordinateSummary,
  }
}

/** 按时间范围统计每个下级的消费额度与请求次数。 */
export async function getAgentStats(params: {
  startTimestamp?: number
  endTimestamp?: number
}): Promise<AgentStats> {
  const query = new URLSearchParams()
  if (params.startTimestamp) {
    query.set('start_timestamp', String(params.startTimestamp))
  }
  if (params.endTimestamp) {
    query.set('end_timestamp', String(params.endTimestamp))
  }
  const res = await api.get(`/api/agent/stats?${query.toString()}`)
  const data = res.data?.data ?? {}
  return {
    items: (data.items ?? []) as AgentStatRow[],
    total_quota: Number(data.total_quota ?? 0),
    total_count: Number(data.total_count ?? 0),
    subordinate_count: Number(data.subordinate_count ?? 0),
  }
}

/** 下级的使用日志，筛选能力与用户自查日志一致。 */
export async function getAgentLogs(params: {
  page?: number
  pageSize?: number
  userId?: number
  startTimestamp?: number
  endTimestamp?: number
}): Promise<AgentPage<AgentLog>> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const query = new URLSearchParams({
    p: String(page),
    page_size: String(pageSize),
  })
  if (params.userId) {
    query.set('user_id', String(params.userId))
  }
  if (params.startTimestamp) {
    query.set('start_timestamp', String(params.startTimestamp))
  }
  if (params.endTimestamp) {
    query.set('end_timestamp', String(params.endTimestamp))
  }
  const res = await api.get(`/api/agent/logs?${query.toString()}`)
  const data = res.data?.data ?? {}
  return {
    page: Number(data.page ?? page),
    page_size: Number(data.page_size ?? pageSize),
    total: Number(data.total ?? 0),
    items: (data.items ?? []) as AgentLog[],
  }
}

/**
 * 管理员把一批用户挂到某个代理名下；agentId 传 0 表示解除归属。
 *
 * 只允许把普通用户挂到代理名下：代理不能被挂到另一个代理下（那会变成两层），
 * 后端会拒绝这种请求。
 */
export async function assignSubordinates(payload: {
  agentId: number
  userIds: number[]
}): Promise<void> {
  await api.post('/api/agent/assign', {
    agent_id: payload.agentId,
    user_ids: payload.userIds,
  })
}

/** 下拉用：列出所有代理账号（角色值为 2）。 */
export async function listAgents(keyword = ''): Promise<AgentSubordinate[]> {
  const query = new URLSearchParams({
    keyword,
    p: '1',
    page_size: '100',
    role: '2',
  })
  const res = await api.get(`/api/user/search?${query.toString()}`)
  return (res.data?.data?.items ?? []) as AgentSubordinate[]
}

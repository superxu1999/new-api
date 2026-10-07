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
import {
  createAssetGroup,
  listAssetGroups,
  listAssets,
  uploadAsset,
} from '@/features/assets/api'
import type { Asset, AssetGroup } from '@/features/assets/types'
import { sendChatCompletion } from '@/features/playground/api'
import type { TaskLog } from '@/features/usage-logs/types'
import { api } from '@/lib/api'

/** 后端下发的输入形态，与 relay/channel/video_capability.go 的 VideoInputKind 一一对应。 */
export type VideoInputKind =
  | 'text'
  | 'image'
  | 'reference_image'
  | 'first_last_frame'
  | 'reference_video'
  | 'reference_audio'

/** 输出时长范围（秒）。 */
export interface VideoDurationRange {
  min: number
  max: number
  /** 是否支持 -1（交给模型自动选择时长）。 */
  allow_auto: boolean
}

/** 单个模型的视频生成能力。 */
export interface VideoModelCapability {
  model: string
  /**
   * 运营配置的对外显示名（产品名），C 端界面优先展示它；
   * 为空串表示未配置，界面回退到 model（可能带渠道后缀的内部名）。
   */
  display_name?: string
  inputs: VideoInputKind[]
  max_images: number
  max_videos: number
  max_audios: number
  returns_last_frame: boolean
  /** 可选的输出分辨率；为空表示不作前置限制。 */
  resolutions: string[]
  /** 可选的宽高比；为空表示不作前置限制。 */
  ratios: string[]
  duration: VideoDurationRange
  supports_audio: boolean
  supports_watermark: boolean
  supports_seed: boolean
  /** declared = 适配器声明；upstream = 上游实时返回 */
  source: string
}

/**
 * 取「当前用户可用的视频模型 + 每个模型能吃哪些素材」。
 *
 * 这份数据是前端置灰与后端选路共用的同一份声明，前端不另写一套判定规则，
 * 避免出现「界面显示可用、提交后被拒」。
 */
export async function getVideoCapabilities(): Promise<VideoModelCapability[]> {
  const res = await api.get('/v1/video/capabilities')
  const models = res.data?.data?.models
  return Array.isArray(models) ? (models as VideoModelCapability[]) : []
}

/** 素材库列表（仅返回已登记素材，供托盘挑选）。 */
export async function listLibraryAssets(keyword?: string): Promise<Asset[]> {
  const result = await listAssets({ keyword, pageSize: 100 })
  return result.items
}

/**
 * 取上传入库要用的素材组：复用账号下已有的 AIGC 组，一个都没有时建一个默认组。
 *
 * 把「找组建组」从逐文件上传里提出来：多选上传时整个批次共享同一个组，
 * 避免「第一个文件触发建组、第二个文件又建一个默认组」的并发重复。
 */
export async function resolveDefaultAssetGroup(
  groups: AssetGroup[]
): Promise<AssetGroup> {
  const existing = groups.find((item) => item.group_type === 'AIGC')
  if (existing) {
    return existing
  }
  return createAssetGroup({ name: '默认素材组' })
}

/**
 * 上传本地文件并入库。
 *
 * 素材在上游必须挂在某个素材组下，而「上传即入库」不该逼用户先去建组，因此这里
 * 自动复用账号下已有的 AIGC 组；一个都没有时先建一个默认组。
 * group 由调用方通过 resolveDefaultAssetGroup 一次性解析，整批文件共用。
 */
export async function uploadAndPersistAsset(
  file: File,
  group: AssetGroup
): Promise<Asset> {
  return uploadAsset({
    file,
    name: file.name,
    groupId: group.id,
  })
}

/** 账号下可用的素材组（上传入库时需要）。 */
export async function fetchAssetGroups(): Promise<AssetGroup[]> {
  return listAssetGroups()
}

/** 预估价结果。approximate=true 时界面应显示 ≈，最终以任务结算为准。 */
export interface VideoEstimateResult {
  model: string
  /** 后端折算后的实际计费秒数（前端传 0 时按上游默认值回填）。 */
  seconds: number
  resolution: string
  group_ratio: number
  mode: 'model_price' | 'video_token' | 'model_ratio'
  approximate: boolean
  quota: number
  token?: number
  tier_price?: number
  multiplier?: number
  model_ratio?: number
}

/**
 * 预估一次视频任务的额度消耗。
 *
 * 公式在后端（与真实计费共用同一组 helper），前端只负责展示 —— 定价逻辑绝不在前端复刻，
 * 否则界面上的数字迟早与账单不一致。
 */
export async function estimateVideoQuota(payload: {
  model: string
  /** 0 表示未指定时长，由后端按上游默认值折算。 */
  seconds: number
  resolution?: string
  hasReferenceVideo?: boolean
}): Promise<VideoEstimateResult> {
  const res = await api.post('/v1/video/estimate', {
    model: payload.model,
    seconds: payload.seconds,
    resolution: payload.resolution ?? '',
    has_reference_video: payload.hasReferenceVideo ?? false,
  })
  return res.data?.data as VideoEstimateResult
}

/**
 * 取消一个进行中的视频任务。
 *
 * 走 /v1/videos/:id/cancel：成功后任务转 FAILURE 并按规则退款；渠道不支持取消、
 * 任务已结束、或上游拒绝时后端返回带 code 的错误体（cancel_not_supported /
 * task_already_finished / cancel_rejected_by_upstream），由接口层统一提示。
 */
export async function cancelVideoTask(taskId: string): Promise<void> {
  await api.post(`/v1/videos/${taskId}/cancel`)
}

/** 提示词优化的样式指令：拼进 system 提示，告诉模型往哪个方向改写。 */
const ENHANCE_STYLE_INSTRUCTIONS: Record<string, string> = {
  enrich:
    'Enrich it with concrete visual details: subject appearance, action, setting, lighting, color palette, camera angle, and overall mood.',
  cinematic:
    'Focus on camera language: shot type, camera movement (dolly, pan, orbit, crane...), lens feel, depth of field, and how the scene unfolds over time.',
  concise:
    'Trim it to the essentials: remove redundancy and filler, keep it under 60 words while retaining the core subject, action, and look.',
}

/**
 * 用站内聊天模型优化视频提示词。
 *
 * 走 /pg/chat/completions（会话鉴权 + 分发计费），非流式、低 max_tokens：
 * 这是一次几毛钱级别的辅助调用，用户选哪个模型就用哪个，按站点价格正常计费。
 * 模型输出语言跟随输入语言，由 system 提示约束。
 */
export async function enhancePromptViaChat(input: {
  model: string
  prompt: string
  style: string
}): Promise<string> {
  const instruction =
    ENHANCE_STYLE_INSTRUCTIONS[input.style] ?? ENHANCE_STYLE_INSTRUCTIONS.enrich
  const system = [
    'You are a prompt engineer for AI video generation models.',
    'Improve the user\'s video prompt so it is clearer and more vivid for a text-to-video or image-to-video model.',
    instruction,
    'Preserve the language of the user\'s prompt: if it is written in Chinese, answer in Chinese; if in English, answer in English.',
    'Output ONLY the improved prompt as plain text. No explanations, no quotes, no markdown, no preamble. Keep it under 120 words.',
  ].join(' ')
  const res = await sendChatCompletion({
    model: input.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input.prompt },
    ],
    stream: false,
    max_tokens: 500,
  })
  return res.choices?.[0]?.message?.content?.trim() ?? ''
}

/** 管理员渠道筛选的取数页大小：接口上限 100，循环拉到 total 为止。 */
const ADMIN_CHANNEL_PAGE_SIZE = 100

/**
 * 管理员专用：拉取启用渠道并构建「模型 → 渠道名列表」映射，供创作台模型栏的渠道筛选。
 *
 * 数据走 /api/channel/（authz.ChannelRead 权限保护）：普通用户请求会 403，
 * 调用方应只在管理员角色下启用，这里 403 时静默返回 null（界面随之不渲染筛选）。
 * 渠道 key 字段被后端 Omit，不会经此泄露密钥。
 */
export async function fetchModelChannelMap(): Promise<
  Record<string, string[]> | null
> {
  try {
    const map: Record<string, string[]> = {}
    let page = 1
    for (;;) {
      const res = await api.get('/api/channel/', {
        params: { p: page, page_size: ADMIN_CHANNEL_PAGE_SIZE, status: 1 },
        skipErrorHandler: true,
      })
      const items = res.data?.data?.items as
        | Array<{ name?: string; models?: string }>
        | undefined
      if (!Array.isArray(items) || items.length === 0) {
        break
      }
      for (const channel of items) {
        if (!channel.name || !channel.models) {
          continue
        }
        for (const raw of channel.models.split(',')) {
          const modelName = raw.trim()
          if (!modelName) {
            continue
          }
          const list = map[modelName]
          if (list) {
            if (!list.includes(channel.name)) {
              list.push(channel.name)
            }
          } else {
            map[modelName] = [channel.name]
          }
        }
      }
      const total = Number(res.data?.data?.total ?? 0)
      if (total <= 0 || page * ADMIN_CHANNEL_PAGE_SIZE >= total) {
        break
      }
      page += 1
    }
    return map
  } catch {
    // 无权限（普通用户/权限不足）或接口异常：返回 null，渠道筛选整体不渲染。
    return null
  }
}

/** 任务列表里展示的最近任务条数。 */
const RECENT_TASK_PAGE_SIZE = 30

/**
 * 拉取当前用户最近的视频任务，让创作台任务列表在刷新后仍能恢复。
 *
 * 直接读 /api/task/self（与任务日志页同源），只保留视频平台且按提交时间倒序；
 * 提交中的任务交给轮询补状态，这里只负责「把已经存在的任务找回来」。
 */
export async function listRecentVideoTasks(): Promise<TaskLog[]> {
  const res = await api.get(
    `/api/task/self?p=1&page_size=${RECENT_TASK_PAGE_SIZE}`
  )
  const items = res.data?.data?.items
  if (!Array.isArray(items)) {
    return []
  }
  return (items as TaskLog[])
    .filter((item) => isVideoTaskLog(item))
    .sort((a, b) => (b.submit_time || 0) - (a.submit_time || 0))
}

/** 判断一条任务日志是不是视频生成任务（创作台只关心这类）。 */
function isVideoTaskLog(item: TaskLog): boolean {
  if (typeof item.result_url === 'string' && item.result_url.includes('video')) {
    return true
  }
  // 任务平台字段对视频任务多为渠道平台名（seedance/kling/…），无法一一枚举；
  // 用「有视频快照字段或结果是 mp4」这类特征兜底，过滤掉 Suno 等音频任务。
  const dataText = typeof item.data === 'string' ? item.data : ''
  return (
    item.duration !== undefined ||
    item.has_input_video === true ||
    /\.mp4(\?|$)/i.test(item.result_url || '') ||
    /"video"/.test(dataText)
  )
}

/**
 * 把任务成片回流为素材：拉取成片 → 走直传入库（本站暂存）。
 *
 * 成片在上游的 URL 通常有时效，直接登记来源地址会在过期后失效；因此先经本站代理
 * （/v1/videos/:id/content）取回文件本体，再以 multipart 直传入库——这样素材实体
 * 落在本站暂存，可长期复用，与「上传即入库」是同一条通路。
 */
export async function saveTaskOutputAsAsset(
  task: TaskLog,
  groups: AssetGroup[]
): Promise<Asset> {
  const contentUrl = `/v1/videos/${task.task_id}/content`
  const response = await fetch(contentUrl, { credentials: 'include' })
  if (!response.ok) {
    throw new Error(`failed to fetch task output: ${response.status}`)
  }
  const blob = await response.blob()
  const fileName = `${task.task_id}.mp4`
  const file = new File([blob], fileName, {
    type: blob.type || 'video/mp4',
  })
  const group = await resolveDefaultAssetGroup(groups)
  return uploadAsset({
    file,
    name: task.properties ? taskNameFromProps(task) : fileName,
    groupId: group.id,
  })
}

/** 素材名优先用提示词前若干字，便于在素材库里辨认这条成片。 */
function taskNameFromProps(task: TaskLog): string {
  const fallback = `${task.task_id}.mp4`
  if (!task.properties) {
    return fallback
  }
  try {
    const props = JSON.parse(task.properties) as { prompt?: string }
    const prompt = (props.prompt || '').trim()
    if (!prompt) {
      return fallback
    }
    return prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt
  } catch {
    return fallback
  }
}

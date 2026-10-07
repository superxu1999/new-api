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
import { Film, Gauge, LayoutGrid, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createAsset } from '@/features/assets/api'
import type { Asset } from '@/features/assets/types'
import { ROLE } from '@/lib/roles'
import { TaskDetailDialog } from '@/features/usage-logs/components/dialogs/task-detail-dialog'
import type { TaskLog } from '@/features/usage-logs/types'
import { api } from '@/lib/api'
import { formatLogQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AssetTray } from './components/asset-tray'
import { CapabilityPanelDialog } from './components/capability-panel-dialog'
import { ChainDialog } from './components/chain-dialog'
import { ChainProgress } from './components/chain-progress'
import { ModelList } from './components/model-list'
import { ParameterBar } from './components/parameter-bar'
import { PromptEnhancer } from './components/prompt-enhancer'
import { StoryboardDialog } from './components/storyboard-dialog'
import { TaskCard } from './components/task-card'
import { useVideoChain } from './hooks/use-video-chain'
import {
  cancelVideoTask,
  estimateVideoQuota,
  fetchAssetGroups,
  fetchModelChannelMap,
  getVideoCapabilities,
  listRecentVideoTasks,
  resolveDefaultAssetGroup,
  saveTaskOutputAsAsset,
} from './lib/api'
import {
  buildAssetContent,
  evaluateModel,
  type AssetRole,
  type TrayItem,
} from './lib/capability'
import { loadDraft, saveDraft, type StudioDraft } from './lib/draft'
import { extractLastFrameUrl, taskModelName, taskPromptPreview } from './lib/task'
import {
  buildVideoRequestBody,
  EMPTY_VIDEO_PARAMS,
  normalizeParamsForModel,
  type VideoParams,
} from './lib/params'

const TERMINAL_STATUS = new Set(['SUCCESS', 'FAILURE'])

/** 任务列表的状态筛选（C 端按「作品 / 进行中 / 失败」看，而不是按技术维度）。 */
type TaskFilterKey = 'all' | 'running' | 'success' | 'failed'

const TASK_FILTERS: Array<{ key: TaskFilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'In progress' },
  { key: 'success', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

/** 轮询间隔：刚提交的阶段密一点，跑久了放慢，避免对服务端持续打点。 */
const POLL_ACTIVE_MS = 4000
const POLL_SLOW_MS = 10000
/** 提交超过这个秒数的任务视为「跑久了」，轮询放慢到慢档。 */
const FRESH_TASK_SECONDS = 120

/** 提交时的参数快照：失败任务「重试」靠它还原请求，不用用户重填。 */
interface SubmitDraft {
  model: string
  prompt: string
  params: VideoParams
  items: TrayItem[]
}

/** 允许「分镜」只覆盖提示词，其余沿用当前编辑器状态。 */
type PartialSubmitDraft = Partial<SubmitDraft> & { prompt: string }

/** 创作台内部的任务对象：TaskLog 之外带上可选的提交快照（仅本会话提交的有）。 */
type StudioTask = TaskLog & { draft?: SubmitDraft }

/** 用回包里的字段更新任务，未返回的字段保留本地值。 */
function mergeTask(prev: StudioTask, next: Partial<StudioTask>): StudioTask {
  return { ...prev, ...next }
}

/**
 * 创作台：素材驱动、模型自选、能力前置。
 *
 * 布局分三栏：素材（可引入/上传）→ 提示词与参数 → 模型（全量列出、不可用置灰并说明原因）。
 * 判定模型是否可用的规则来自后端下发的能力声明，前端只做集合判断，因此
 * 「界面显示可点」与「后端能接住」是同一套标准（后端选路与提交前校验也用同一份声明）。
 *
 * 任务列表读 /api/task/self，刷新页面后进行中与已完成的任务仍在；
 * 成片可一键回流为素材，直接作为下一次生成的输入。
 */
export function PlaygroundVideo() {
  const { t } = useTranslation()
  // 草稿只在首渲染读一次：之后以组件状态为准，避免覆盖用户正在编辑的内容。
  const initialDraft = useRef<StudioDraft | null>(null)
  if (initialDraft.current === null) {
    initialDraft.current = loadDraft() ?? {
      model: '',
      prompt: '',
      params: EMPTY_VIDEO_PARAMS,
      items: [],
    }
  }
  const draft = initialDraft.current
  const [model, setModel] = useState(draft.model)
  const [prompt, setPrompt] = useState(draft.prompt)
  const [params, setParams] = useState<VideoParams>(draft.params)
  const [items, setItems] = useState<TrayItem[]>(draft.items)
  const [submitting, setSubmitting] = useState(false)
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const [savingTaskId, setSavingTaskId] = useState<string>('')
  const [cancelingTaskId, setCancelingTaskId] = useState<string>('')
  const [continuingTaskId, setContinuingTaskId] = useState<string>('')
  const [detailTask, setDetailTask] = useState<TaskLog | null>(null)
  const [capabilityOpen, setCapabilityOpen] = useState(false)
  const [storyboardOpen, setStoryboardOpen] = useState(false)
  const [chainOpen, setChainOpen] = useState(false)
  const [enhancerOpen, setEnhancerOpen] = useState(false)
  const [taskFilter, setTaskFilter] = useState<TaskFilterKey>('all')
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const { data: capabilities = [], isLoading: loadingModels } = useQuery({
    queryKey: ['playground-video-capabilities'],
    queryFn: getVideoCapabilities,
  })

  // 渠道筛选只对管理员开放：数据来自 /api/channel/（ChannelRead 权限），
  // 普通用户既看不到筛选，接口也不会给他们返回渠道数据。
  const currentUser = useAuthStore((s) => s.auth.user)
  const isAdmin = (currentUser?.role ?? 0) >= ROLE.ADMIN
  const { data: adminChannelMap } = useQuery({
    queryKey: ['playground-video-admin-channel-map'],
    queryFn: fetchModelChannelMap,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // 草稿自动保存：编辑过程中节流写入，刷新/切页回来内容还在。
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft({ model, prompt, params, items })
    }, 400)
    return () => clearTimeout(timer)
  }, [model, prompt, params, items])

  // 初次进入时把账号下已有的视频任务找回来，刷新不丢。
  const { data: recentTasks, isLoading: loadingTasks } = useQuery({
    queryKey: ['playground-video-recent-tasks'],
    queryFn: listRecentVideoTasks,
    refetchOnWindowFocus: false,
  })
  const recentLoadedRef = useRef(false)
  useEffect(() => {
    if (!recentTasks || recentLoadedRef.current) return
    recentLoadedRef.current = true
    setTasks((prev) => {
      const localById = new Map(prev.map((task) => [task.task_id, task]))
      // 历史列表以本地已提交的为准（避免被回包覆盖进度）。
      const merged = recentTasks.map((task) => localById.get(task.task_id) ?? task)
      // 本地有但历史列表还没有的（刚提交未落库）补到最前。
      const knownIds = new Set(merged.map((task) => task.task_id))
      const extra = prev.filter((task) => !knownIds.has(task.task_id))
      return [...extra, ...merged]
    })
  }, [recentTasks])

  const selectedCapability = useMemo(
    () => capabilities.find((item) => item.model === model),
    [capabilities, model]
  )

  // 素材变化后，已选模型可能不再可用：这里同步清掉失效的选择，避免提交时才报错。
  const selectedEligibility = useMemo(() => {
    return selectedCapability
      ? evaluateModel(selectedCapability, items)
      : undefined
  }, [selectedCapability, items])

  useEffect(() => {
    if (model && selectedEligibility && !selectedEligibility.enabled) {
      setModel('')
    }
  }, [model, selectedEligibility])

  // 换模型后把上一个模型不支持的参数排掉（分辨率/时长/比例的取值范围各家不同）。
  useEffect(() => {
    setParams((prev) => normalizeParamsForModel(prev, selectedCapability))
  }, [selectedCapability])

  // 轮询进行中的任务；全部终态后停止，新提交/恢复的任务会重新触发。
  useEffect(() => {
    if (!tasks.some((task) => !TERMINAL_STATUS.has(task.status))) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      const pending = tasksRef.current.filter(
        (task) => !TERMINAL_STATUS.has(task.status)
      )
      if (cancelled || pending.length === 0) return
      const updates = await Promise.all(
        pending.map(async (task) => {
          try {
            const res = await api.get(`/pg/video/generations/${task.task_id}`, {
              skipErrorHandler: true,
            })
            const data = res.data?.data
            if (!data) return task
            return mergeTask(task, {
              status: data.status || task.status,
              progress: data.progress,
              fail_reason: data.fail_reason,
              result_url: data.result_url || task.result_url,
              // 尾帧要一起带回来：连拍靠它接下一段，丢了就只能等下一次列表刷新。
              last_frame_url: data.last_frame_url || task.last_frame_url,
            })
          } catch {
            return task
          }
        })
      )
      if (cancelled) return
      const byId = new Map(updates.map((update) => [update.task_id, update]))
      setTasks((prev) => prev.map((task) => byId.get(task.task_id) ?? task))

      const stillPending = updates.filter(
        (task) => !TERMINAL_STATUS.has(task.status)
      )
      if (stillPending.length === 0 || cancelled) return
      const nowSeconds = Date.now() / 1000
      const hasFresh = stillPending.some(
        (task) => nowSeconds - (task.submit_time || 0) < FRESH_TASK_SECONDS
      )
      timer = setTimeout(poll, hasFresh ? POLL_ACTIVE_MS : POLL_SLOW_MS)
    }

    timer = setTimeout(poll, POLL_ACTIVE_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [tasks])

  // 后台标签页的完成通知：视频生成动辄几分钟，用户多半已经切走。
  // 只对「本会话里见过它进行中」的任务通知——刚进页面就是终态的历史任务不值得打扰。
  const prevStatusRef = useRef(new Map<string, string>())
  useEffect(() => {
    for (const task of tasks) {
      const prev = prevStatusRef.current.get(task.task_id)
      prevStatusRef.current.set(task.task_id, task.status)
      const becameTerminal =
        prev !== undefined &&
        !TERMINAL_STATUS.has(prev) &&
        TERMINAL_STATUS.has(task.status)
      if (
        !becameTerminal ||
        !document.hidden ||
        typeof Notification === 'undefined' ||
        Notification.permission !== 'granted'
      ) {
        continue
      }
      const title =
        task.status === 'SUCCESS' ? t('Video ready') : t('Video task failed')
      try {
        new Notification(title, {
          body: taskPromptPreview(task),
          tag: task.task_id,
        })
      } catch {
        // 通知构造被浏览器策略拦下时不影响主流程。
      }
    }
  }, [tasks, t])

  // 标签页标题带进行中任务数：切到别的标签也能一眼看到还有几个在跑。
  const activeTaskCount = tasks.filter(
    (task) => !TERMINAL_STATUS.has(task.status)
  ).length

  // 状态筛选：进行中 = 未到终态；成功/失败 = 对应终态。作品视角的最小实现。
  const visibleTasks = useMemo(() => {
    if (taskFilter === 'all') {
      return tasks
    }
    return tasks.filter((task) => {
      if (taskFilter === 'running') return !TERMINAL_STATUS.has(task.status)
      return task.status === (taskFilter === 'success' ? 'SUCCESS' : 'FAILURE')
    })
  }, [tasks, taskFilter])

  const taskCountByStatus = (key: TaskFilterKey) => {
    if (key === 'all') {
      return tasks.length
    }
    if (key === 'running') {
      return tasks.filter((task) => !TERMINAL_STATUS.has(task.status)).length
    }
    const target = key === 'success' ? 'SUCCESS' : 'FAILURE'
    return tasks.filter((task) => task.status === target).length
  }

  // 模型真名 → 对外显示名：任务卡只给用户看产品名，真名留在详情里。
  const modelDisplayNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const item of capabilities) {
      if (item.display_name) {
        map[item.model] = item.display_name
      }
    }
    return map
  }, [capabilities])

  const baseTitleRef = useRef('')
  useEffect(() => {
    // 挂载时记住应用设置的标题，卸载或清零时还原。
    if (!baseTitleRef.current) {
      baseTitleRef.current = document.title
    }
    document.title =
      activeTaskCount > 0 ? `(${activeTaskCount}) ${baseTitleRef.current}` : baseTitleRef.current
    return () => {
      document.title = baseTitleRef.current
    }
  }, [activeTaskCount])

  /**
   * 提交一次生成，成功返回任务 ID，失败返回空串。
   *
   * draft 不传时用当前编辑器状态；重试/连拍时传入完整快照，因此调用方不必关心
   * 「此刻编辑器里是什么」。返回任务 ID 而不是布尔，是因为连拍要接着等这一段的终态。
   * quiet 用于连拍：连提交 6 段会刷 6 条成功提示，把真正要注意的错误盖掉。
   */
  const submitGeneration = async (
    draft?: PartialSubmitDraft,
    options?: { quiet?: boolean }
  ): Promise<string> => {
    const useModel = draft?.model ?? model
    const usePrompt = draft?.prompt ?? prompt
    const useParams = draft?.params ?? params
    const useItems = draft?.items ?? items
    if (!useModel) {
      toast.error(t('Please select a model'))
      return ''
    }
    if (!usePrompt.trim()) {
      toast.error(t('Please enter a prompt'))
      return ''
    }
    setSubmitting(true)
    try {
      const capabilityForModel = capabilities.find(
        (item) => item.model === useModel
      )
      const body = buildVideoRequestBody(
        useModel,
        usePrompt.trim(),
        useParams,
        capabilityForModel
      )
      if (useItems.length > 0) {
        // 站内素材引用：后端会换成上游素材 ID，并把任务锁到素材所属渠道。
        body.metadata = {
          ...(body.metadata as Record<string, unknown> | undefined),
          content: buildAssetContent(useItems),
        }
      }
      const res = await api.post('/pg/video/generations', body)
      const taskId = res.data?.task_id ?? res.data?.data?.task_id
      if (!taskId) {
        toast.error(t('Failed to submit video task'))
        return ''
      }
      const newTask: StudioTask = {
        id: 0,
        user_id: 0,
        platform: '',
        task_id: taskId,
        action: 'GENERATE',
        channel_id: 0,
        submit_time: Math.floor(Date.now() / 1000),
        status: res.data?.status || 'SUBMITTED',
        properties: JSON.stringify({
          prompt: usePrompt.trim(),
          // 记下模型名：任务卡要按它查显示名（本地记 model，旧任务用 origin_model_name）。
          model: useModel,
        }),
        draft: {
          model: useModel,
          prompt: usePrompt,
          params: useParams,
          items: useItems,
        },
      }
      setTasks((prev) => [newTask, ...prev])
      if (!options?.quiet) {
        toast.success(t('Video task submitted'))
      }
      return String(taskId)
    } catch {
      // error toast handled by api interceptor
      return ''
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = () => {
    // 通知权限在点击时同步申请：浏览器只认用户手势时机，提交成功后再申请会被拒。
    // 已授权/已拒绝时是无害空操作；默认拒绝打扰，不发通知也能正常用。
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    void submitGeneration()
  }

  /**
   * 分镜提交：多个镜头共用当前模型/参数/素材，逐个串行提交。
   * 串行是为了让预扣额度可见可控 —— 并发提交会在用户没有预期时同时扣掉 N 份钱，
   * 且额度不足时能立刻停下，已提交的镜头照常出片。
   */
  const handleStoryboardSubmit = async (
    shots: Array<{ prompt: string; duration?: string }>
  ): Promise<number> => {
    let submitted = 0
    for (const shot of shots) {
      // 每镜可单独指定时长；不指定就沿用参数区当前设置。
      const taskId = await submitGeneration({
        prompt: shot.prompt,
        params: shot.duration
          ? { ...params, duration: shot.duration }
          : params,
      })
      if (!taskId) {
        break
      }
      submitted += 1
    }
    if (submitted > 0) {
      toast.success(
        t('Submitted {{count}} shots', { count: submitted })
      )
    }
    return submitted
  }

  /** 失败任务重试：用提交时的快照原样再来一次，不打断用户当前编辑器内容。 */
  const handleRetry = (task: StudioTask) => {
    if (!task.draft) {
      toast.error(t('Cannot retry: original parameters are unavailable'))
      return
    }
    void submitGeneration(task.draft)
  }

  /** 取消进行中的任务：成功后本地标记 FAILURE（后端已置状态并退款）。 */
  const handleCancel = async (task: StudioTask) => {
    setCancelingTaskId(task.task_id)
    try {
      await cancelVideoTask(task.task_id)
      setTasks((prev) =>
        prev.map((item) =>
          item.task_id === task.task_id
            ? { ...item, status: 'FAILURE', fail_reason: t('Canceled by user') }
            : item
        )
      )
      toast.success(t('Task canceled'))
    } catch {
      // 渠道不支持取消 / 已结束 / 上游拒绝等原因由接口层提示。
    } finally {
      setCancelingTaskId('')
    }
  }

  // 成片回流为素材：落本站暂存，作为下一次生成的输入。
  const handleSaveAsAsset = async (task: TaskLog) => {
    setSavingTaskId(task.task_id)
    try {
      const groups = await fetchAssetGroups()
      await saveTaskOutputAsAsset(task, groups)
      toast.success(t('Saved to material library'))
    } catch {
      // 未开通上传能力 / 本站无公网地址等原因由接口层提示。
    } finally {
      setSavingTaskId('')
    }
  }

  const appendTrayAsset = (asset: Asset, role: AssetRole) => {
    setItems((prev) => [
      ...prev,
      { key: `${asset.id}-${Date.now()}`, asset, role },
    ])
  }

  /**
   * 继续创作：把成片作为参考视频放进托盘，用户接着写下一步的提示词。
   * 先经本站取回再入库（与「存为素材」同一条通路），所以不受上游 URL 时效影响。
   */
  const handleContinue = async (task: TaskLog) => {
    setContinuingTaskId(task.task_id)
    try {
      const groups = await fetchAssetGroups()
      const asset = await saveTaskOutputAsAsset(task, groups)
      appendTrayAsset(asset, 'reference_video')
      setPrompt('')
      toast.success(t('Clip added as a reference video'))
    } catch {
      // 同上，错误由接口层提示。
    } finally {
      setContinuingTaskId('')
    }
  }

  /**
   * 把某段成片的尾帧登记成素材，供下一段当首帧用。
   * 与「取尾帧续拍」是同一条通路：尾帧 URL 在上游有时效，登记后由本站托管。
   */
  const registerLastFrameAsset = async (input: {
    taskId: string
    url: string
  }): Promise<TrayItem> => {
    const group = await resolveDefaultAssetGroup(await fetchAssetGroups())
    const asset = await createAsset({
      group_id: group.id,
      name: `${input.taskId}-last-frame`,
      url: input.url,
      asset_type: 'Image',
    })
    return { key: `${asset.id}-chain-${input.taskId}`, asset, role: 'first_frame' }
  }

  /**
   * 取尾帧续拍：把上一段的尾帧当作下一段的首帧（Seedance 系的标准续拍手法）。
   * 上游没返回过尾帧时明确告知，而不是悄悄退化成「用整段视频当参考」。
   */
  const handleContinueFromLastFrame = async (task: TaskLog) => {
    const url = extractLastFrameUrl(task)
    if (!url) {
      toast.info(t('This clip has no last frame; use "Continue creating" instead'))
      return
    }
    setContinuingTaskId(task.task_id)
    try {
      const item = await registerLastFrameAsset({ taskId: task.task_id, url })
      appendTrayAsset(item.asset, 'first_frame')
      setPrompt('')
      toast.success(t('Last frame added as the first frame'))
    } catch {
      // 上游素材登记失败等原因由接口层提示。
    } finally {
      setContinuingTaskId('')
    }
  }

  /**
   * 连拍驱动器：按段推进，每段出片后取尾帧接下一段。这里只负责把「怎么提交」和
   * 「尾帧怎么变成素材」交给它，推进/中断/续跑的逻辑都在 hooks/use-video-chain.ts。
   */
  const chainController = useVideoChain({
    tasks,
    submitSegment: ({ prompt: segmentPrompt, items: segmentItems, model: segmentModel, params: segmentParams }) =>
      submitGeneration(
        {
          model: segmentModel,
          params: segmentParams,
          prompt: segmentPrompt,
          items: segmentItems,
        },
        { quiet: true }
      ),
    registerLastFrame: registerLastFrameAsset,
  })

  const canSubmit = Boolean(model) && prompt.trim().length > 0 && !submitting

  // 预估价：模型/时长/分辨率/是否含参考视频任一变化就重算（react-query 自带 key 去重）。
  // 时长未指定时传 0，由后端按上游默认值折算并把实际秒数回传。
  const estimateSeconds = (() => {
    const parsed = Number(params.duration)
    if (params.duration === '' || !Number.isFinite(parsed) || parsed <= 0) {
      return 0
    }
    return parsed
  })()
  const hasReferenceVideo = items.some(
    (item) => item.role === 'reference_video'
  )
  const { data: estimate } = useQuery({
    queryKey: [
      'playground-video-estimate',
      model,
      estimateSeconds,
      params.resolution,
      hasReferenceVideo,
    ],
    queryFn: () =>
      estimateVideoQuota({
        model,
        seconds: estimateSeconds,
        resolution: params.resolution,
        hasReferenceVideo,
      }),
    enabled: Boolean(model),
    retry: false,
    // 价格随参数实时变，缓存住旧值反而误导。
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  // 生成按钮为什么不能点，必须写出来 —— 灰按钮不给理由是最劝退的交互。
  let disabledReason = ''
  if (submitting) {
    disabledReason = t('Submitting...')
  } else if (!model) {
    disabledReason = t('Pick a model to continue')
  } else if (prompt.trim().length === 0) {
    disabledReason = t('Enter a prompt to generate')
  }

  // 连拍比普通生成多一个前置条件：这个模型得会把尾帧交回来，否则第二段就没法接。
  let chainDisabledReason = ''
  if (chainController.running) {
    chainDisabledReason = t('Chain running')
  } else if (!model) {
    chainDisabledReason = t('Pick a model to continue')
  } else if (!selectedCapability?.returns_last_frame) {
    chainDisabledReason = t(
      'This model does not return a last frame, so segments cannot be chained'
    )
  } else if (prompt.trim().length === 0) {
    chainDisabledReason = t('Enter a prompt to generate')
  }

  return (
    // Main 是 flex-1 + overflow-hidden 的容器：页面自己必须是滚动容器，否则内容超出视口
    // 会被父级直接裁掉，表现就是「创作台滑不动」。
    // 宽度不加 max-w：创作台是三栏工作台，窄屏外的留白是浪费（Main 默认就是 fluid）。
    <div className='flex min-h-0 w-full flex-1 flex-col gap-6 overflow-y-auto p-4'>
      {/* 顶部工具条：用户最先要确认的就是「我能用什么、还剩多少」。 */}
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-base font-medium'>{t('Studio')}</h2>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={Boolean(chainDisabledReason)}
            title={chainDisabledReason || undefined}
            onClick={() => setChainOpen(true)}
          >
            <Film className='mr-1 h-3.5 w-3.5' />
            {t('Continuous chain')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={!canSubmit}
            onClick={() => setStoryboardOpen(true)}
          >
            <LayoutGrid className='mr-1 h-3.5 w-3.5' />
            {t('Storyboard')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setCapabilityOpen(true)}
          >
            <Gauge className='mr-1 h-3.5 w-3.5' />
            {t('My capabilities')}
          </Button>
        </div>
      </div>

      {/* 连拍是要花钱的自动流程：跑到哪了、为什么停下，必须常驻在编辑器上方。 */}
      {chainController.chain && (
        <ChainProgress
          chain={chainController.chain}
          running={chainController.running}
          onStop={chainController.stop}
          onResume={chainController.resume}
          onDismiss={chainController.dismiss}
        />
      )}

      <div className='grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]'>
        {/* 素材 */}
        <section className='order-2 rounded-xl border p-4 lg:order-1'>
          <AssetTray items={items} onChange={setItems} />
        </section>

        {/* 提示词与提交 */}
        <section className='order-1 flex flex-col gap-4 rounded-xl border p-4 lg:order-2'>
          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <Label>{t('Prompt')}</Label>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='text-muted-foreground h-7 px-2 text-xs'
                onClick={() => setEnhancerOpen(true)}
              >
                <Wand2 className='mr-1 h-3.5 w-3.5' />
                {t('Enhance prompt')}
              </Button>
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t('Describe the video you want to generate')}
              rows={5}
            />
          </div>
          <ParameterBar
            capability={selectedCapability}
            value={params}
            onChange={setParams}
            disabled={submitting}
          />
          <div className='flex flex-wrap items-center gap-3'>
            <Button onClick={handleSubmit} disabled={!canSubmit} className='w-fit'>
              {submitting ? t('Submitting...') : t('Generate Video')}
            </Button>
            {estimate ? (
              <span className='text-muted-foreground text-xs'>
                {t('Estimated cost')}: {estimate.approximate ? '≈ ' : ''}
                {formatLogQuota(estimate.quota)}
                {' · '}
                {params.duration === '' || params.duration === '-1'
                  ? t('estimated at {{seconds}}s by upstream default', {
                      seconds: estimate.seconds,
                    })
                  : `${estimate.seconds}s`}
                {estimate.approximate && (
                  <> {t('(final amount follows the settled task)')}</>
                )}
              </span>
            ) : (
              disabledReason && (
                <span className='text-muted-foreground text-xs'>
                  {disabledReason}
                </span>
              )
            )}
          </div>
        </section>

        {/* 模型 */}
        <section className='order-3 flex flex-col gap-3 rounded-xl border p-4'>
          <div className='flex items-center justify-between'>
            <h3 className='text-sm font-medium'>{t('Model')}</h3>
            {items.length > 0 && (
              <span className='text-muted-foreground text-xs'>
                {t('Filtered by materials')}
              </span>
            )}
          </div>
          {loadingModels ? (
            <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
          ) : (
            <div className='max-h-[420px] overflow-y-auto pr-1'>
              <ModelList
                models={capabilities}
                selected={model}
                onSelect={setModel}
                items={items}
                channelMap={adminChannelMap ?? null}
              />
            </div>
          )}
        </section>
      </div>

      <section className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-medium'>{t('Tasks')}</h3>
          {/* C 端第一诉求是「我有哪些作品」和「有没有失败的要看」，
              所以筛选按状态而不是按模型/时间——这是作品视角的入口。 */}
          <div className='flex flex-wrap gap-1'>
            {TASK_FILTERS.map((item) => {
              const count = taskCountByStatus(item.key)
              if (item.key !== 'all' && count === 0) {
                return null
              }
              const active = taskFilter === item.key
              return (
                <button
                  key={item.key}
                  type='button'
                  onClick={() => setTaskFilter(item.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'text-muted-foreground border-border/60 hover:border-primary/50'
                  )}
                >
                  {t(item.label)}
                  {count > 0 && ` ${count}`}
                </button>
              )
            })}
          </div>
        </div>
        {/* 页宽放开后任务卡按列铺开：宽屏一行 2~3 张，成片预览不会被拉成全屏高。 */}
        <div
          className={
            visibleTasks.length > 0
              ? 'grid gap-4 xl:grid-cols-2 2xl:grid-cols-3'
              : undefined
          }
        >
          {renderTaskList()}
        </div>
      </section>

      {/* 任务详情复用任务日志页的弹窗：请求参数、计费明细、上游响应都能对得上。 */}
      <TaskDetailDialog
        log={detailTask ?? ({} as TaskLog)}
        open={detailTask !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTask(null)
          }
        }}
      />

      <CapabilityPanelDialog
        open={capabilityOpen}
        onOpenChange={setCapabilityOpen}
        capabilities={capabilities}
      />

      <StoryboardDialog
        open={storyboardOpen}
        onOpenChange={setStoryboardOpen}
        onSubmit={handleStoryboardSubmit}
        unitQuota={estimate?.quota}
        unitApproximate={estimate?.approximate}
        disabled={!canSubmit}
      />

      <PromptEnhancer
        open={enhancerOpen}
        onOpenChange={setEnhancerOpen}
        prompt={prompt}
        onApply={setPrompt}
      />

      <ChainDialog
        open={chainOpen}
        onOpenChange={setChainOpen}
        prompt={prompt}
        supported={Boolean(selectedCapability?.returns_last_frame)}
        unitQuota={estimate?.quota}
        unitApproximate={estimate?.approximate}
        onSubmit={(prompts) => {
          setChainOpen(false)
          // 用当前编辑器状态做一次快照：之后用户改提示词/参数不会影响已启动的连拍。
          chainController.start({
            model,
            params,
            baseItems: items,
            prompts,
          })
        }}
      />
    </div>
  )

  function renderTaskList() {
    if (loadingTasks && tasks.length === 0) {
      return <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
    }
    if (visibleTasks.length === 0) {
      return (
        <p className='text-muted-foreground text-sm'>
          {tasks.length === 0 ? t('No video tasks yet') : t('No tasks yet')}
        </p>
      )
    }
    return visibleTasks.map((task) => (
      <TaskCard
        key={task.task_id}
        task={task}
        displayName={
          modelDisplayNames[taskModelName(task) || '']
        }
        onRetry={task.draft ? () => handleRetry(task) : undefined}
        onCancel={() => handleCancel(task)}
        onSaveAsAsset={() => handleSaveAsAsset(task)}
        onShowDetail={() => setDetailTask(task)}
        onContinue={() => handleContinue(task)}
        onContinueFromLastFrame={() => handleContinueFromLastFrame(task)}
        canceling={cancelingTaskId === task.task_id}
        saving={savingTaskId === task.task_id}
        continuing={continuingTaskId === task.task_id}
        retryDisabled={submitting}
      />
    ))
  }
}

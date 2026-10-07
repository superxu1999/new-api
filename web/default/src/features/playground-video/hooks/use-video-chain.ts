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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { TaskLog } from '@/features/usage-logs/types'

import type { TrayItem } from '../lib/capability'
import {
  clearChain,
  createChain,
  loadChain,
  patchSegment,
  saveChain,
  type ChainReason,
  type VideoChain,
} from '../lib/chain'
import type { VideoParams } from '../lib/params'
import { extractLastFrameUrl } from '../lib/task'

const TERMINAL_STATUS = new Set(['SUCCESS', 'FAILURE'])

/** 单段等待上界：长视频任务本身可能跑十几分钟，超过这个时间就当它不会再回来了。 */
const WAIT_TIMEOUT_MS = 30 * 60 * 1000

interface SubmitSegmentInput {
  prompt: string
  items: TrayItem[]
  /** 这一段用的模型与参数来自连拍启动时的快照，不受用户之后改编辑器的影响。 */
  model: string
  params: VideoParams
}

interface UseVideoChainOptions {
  /** 任务列表：链式推进靠它拿到每段的终态，不另开一套轮询。 */
  tasks: TaskLog[]
  /** 提交一段并返回任务 ID；提交失败返回空串。 */
  submitSegment: (input: SubmitSegmentInput) => Promise<string>
  /** 把一段成片的尾帧登记成「下一段首帧」素材。 */
  registerLastFrame: (input: { taskId: string; url: string }) => Promise<TrayItem>
}

interface StartChainInput {
  model: string
  params: VideoParams
  baseItems: TrayItem[]
  prompts: string[]
}

export interface VideoChainController {
  chain: VideoChain | null
  /** 正在推进中（提交或等待某一段出片）。 */
  running: boolean
  start: (input: StartChainInput) => void
  resume: () => void
  stop: () => void
  dismiss: () => void
}

/**
 * 连拍驱动器：按顺序把每一段交出去，等到出片，取尾帧，再喂给下一段。
 *
 * 为什么是客户端驱动而不是后端编排：每一段的输入依赖上一段的产物（尾帧），
 * 而后端任务表只按「一次提交一个任务」建模；把它做成服务端工作流会引入新的
 * 状态机与调度器，而用户对连拍的预期恰恰是「看得见每一段、随时能停」。
 *
 * 进度落在 localStorage：刷新或误关页面后能看到跑到哪了，也能接着跑，
 * 不会从头再扣一遍钱；但不会自动续跑 —— 无人看管时继续扣费不是用户想要的。
 */
export function useVideoChain(
  options: UseVideoChainOptions
): VideoChainController {
  const { t } = useTranslation()
  const [chain, setChain] = useState<VideoChain | null>(() => {
    const restored = loadChain()
    if (!restored) {
      return null
    }
    if (restored.status === 'running') {
      return {
        ...restored,
        status: 'paused',
        reason: { key: 'Chain paused: the page was closed' },
      }
    }
    return restored
  })
  const [running, setRunning] = useState(false)
  const runIdRef = useRef(0)
  const waitersRef = useRef(new Map<string, (task: TaskLog | null) => void>())
  const tasksRef = useRef(options.tasks)
  tasksRef.current = options.tasks

  useEffect(() => {
    if (chain) {
      saveChain(chain)
    }
  }, [chain])

  // 列表里到达终态的任务唤醒对应的等待者。终态更新只会从列表进来（唯一的轮询源），
  // 所以驱动器不自己发请求，也就不会和列表轮询重复打点。
  useEffect(() => {
    for (const task of options.tasks) {
      if (!TERMINAL_STATUS.has(task.status)) {
        continue
      }
      const resolve = waitersRef.current.get(task.task_id)
      if (resolve) {
        waitersRef.current.delete(task.task_id)
        resolve(task)
      }
    }
  }, [options.tasks])

  const updateChain = useCallback(
    (updater: (prev: VideoChain) => VideoChain) => {
      setChain((prev) => (prev ? updater(prev) : prev))
    },
    []
  )

  /**
   * 等一个任务到达终态。已经终态的任务立即返回；收到停止信号（用户点了停止或离开页面）
   * 时返回 null；等待超时返回一个合成的失败任务，避免界面永远卡在「进行中」。
   */
  const waitFor = (taskId: string): Promise<TaskLog | null> => {
    const known = tasksRef.current.find((task) => task.task_id === taskId)
    if (known && TERMINAL_STATUS.has(known.status)) {
      return Promise.resolve(known)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waitersRef.current.delete(taskId)
        resolve({
          id: 0,
          user_id: 0,
          platform: '',
          task_id: taskId,
          action: 'GENERATE',
          channel_id: 0,
          submit_time: 0,
          status: 'FAILURE',
          fail_reason: t('Timed out waiting for this segment'),
        })
      }, WAIT_TIMEOUT_MS)
      waitersRef.current.set(taskId, (task) => {
        clearTimeout(timer)
        resolve(task)
      })
    })
  }

  // 离开创作台时停止推进：已经交出去的那一段钱已经花了，让它照常跑完，但不再自动
  // 提交下一段 —— 用户看不到进度的时候继续扣费，是连拍最不该有的行为。
  // 持久化的状态仍是「进行中」，下次进来会被 loadChain 转成「已中断」，由用户决定是否续跑。
  useEffect(() => {
    const waiters = waitersRef.current
    return () => {
      runIdRef.current += 1
      for (const resolve of waiters.values()) {
        resolve(null)
      }
      waiters.clear()
    }
  }, [])

  const run = async (initial: VideoChain) => {
    const myRun = runIdRef.current + 1
    runIdRef.current = myRun
    const aborted = () => runIdRef.current !== myRun
    setRunning(true)
    updateChain((prev) => ({ ...prev, status: 'running', reason: undefined }))

    let firstFrame = initial.firstFrame
    // 中止原因用对象字段承载：闭包里赋值后还要在主流程里读，用局部变量会被
    // TS 的类型收窄判定成永远是 undefined。
    const outcome: { reason?: ChainReason } = {}

    const fail = (target: number, next: ChainReason, failReason?: string) => {
      outcome.reason = next
      updateChain((prev) => ({
        ...patchSegment(prev, target, { status: 'failed', failReason }),
        status: 'failed',
        reason: next,
      }))
    }

    for (const segment of initial.segments) {
      if (aborted()) {
        break
      }
      if (segment.status === 'success') {
        continue
      }

      // 中断前已经提交出去的段复用原任务，不重新提交（重新提交就是重复扣费）。
      let taskId = segment.status === 'running' ? segment.taskId : ''
      if (!taskId) {
        // 上一段的尾帧就是这一段的首帧：所以要把用户原来放的首帧换掉，而不是叠加
        // 成两张首帧（那在多数上游都是非法输入）。
        const items = firstFrame
          ? [
              ...initial.baseItems.filter((item) => item.role !== 'first_frame'),
              firstFrame,
            ]
          : initial.baseItems
        taskId = await options.submitSegment({
          prompt: segment.prompt,
          items,
          model: initial.model,
          params: initial.params,
        })
        if (aborted()) {
          break
        }
        if (!taskId) {
          fail(segment.index, { key: 'Failed to submit this segment' })
          break
        }
      }
      updateChain((prev) =>
        patchSegment(prev, segment.index, { status: 'running', taskId })
      )

      const task = await waitFor(taskId)
      if (aborted() || !task) {
        break
      }
      if (task.status !== 'SUCCESS') {
        fail(
          segment.index,
          {
            key: 'Segment {{index}} failed',
            params: { index: segment.index },
          },
          task.fail_reason
        )
        break
      }
      updateChain((prev) =>
        patchSegment(prev, segment.index, { status: 'success' })
      )

      const isLastSegment = segment.index >= initial.segments.length
      if (isLastSegment) {
        continue
      }
      // 尾帧是下一段的输入，也是「这段能不能接着拍」的唯一判据：拿不到就停，
      // 不能退回「整段视频当参考」蒙混过去（那是另一个语义，且同样要花钱）。
      const url = extractLastFrameUrl(task)
      if (!url) {
        outcome.reason = {
          key: 'This model did not return a last frame, so the chain stopped',
        }
        updateChain((prev) => ({
          ...prev,
          status: 'failed',
          reason: outcome.reason,
        }))
        break
      }
      try {
        const item = await options.registerLastFrame({ taskId, url })
        if (aborted()) {
          break
        }
        firstFrame = item
        updateChain((prev) => ({ ...prev, firstFrame: item }))
      } catch {
        outcome.reason = {
          key: 'Failed to register the last frame as a material',
        }
        updateChain((prev) => ({
          ...prev,
          status: 'failed',
          reason: outcome.reason,
        }))
        break
      }
    }

    setRunning(false)
    if (aborted()) {
      return
    }
    if (outcome.reason) {
      toast.error(t(outcome.reason.key, outcome.reason.params))
      return
    }
    updateChain((prev) => ({ ...prev, status: 'done' }))
    toast.success(t('Chain finished'))
  }

  const start = (input: StartChainInput) => {
    if (running) {
      return
    }
    const next = createChain(input)
    setChain(next)
    void run(next)
  }

  const resume = () => {
    const current = chain
    if (!current || running) {
      return
    }
    void run(current)
  }

  const stop = () => {
    if (!running) {
      return
    }
    runIdRef.current += 1
    for (const resolve of waitersRef.current.values()) {
      resolve(null)
    }
    waitersRef.current.clear()
    setRunning(false)
    updateChain((prev) => ({
      ...prev,
      status: 'canceled',
      reason: { key: 'Chain stopped' },
    }))
    toast.info(t('Chain stopped; the running segment keeps going'))
  }

  const dismiss = () => {
    if (running) {
      return
    }
    clearChain()
    setChain(null)
  }

  return { chain, running, start, resume, stop, dismiss }
}

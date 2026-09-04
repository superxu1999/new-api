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
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// 文档目录（与下方 Section id 对应；sub 为二级目录）
const TOC: { id: string; label: string; sub?: { id: string; label: string }[] }[] = [
  { id: 'sec-1', label: '1. 接入与认证' },
  { id: 'sec-2', label: '2. 快速开始' },
  { id: 'sec-3', label: '3. 查询可用模型' },
  { id: 'sec-4', label: '4. 对话' },
  {
    id: 'sec-5',
    label: '5. 视频生成（任务式）',
    sub: [
      { id: 'sec-5-1', label: '5.1 创建视频任务' },
      { id: 'sec-5-2', label: '5.2 图生视频' },
      { id: 'sec-5-3', label: '5.3 视频生视频 / Remix' },
      { id: 'sec-5-4', label: '5.4 查询任务状态' },
      { id: 'sec-5-5', label: '5.5 下载成片' },
    ],
  },
  { id: 'sec-6', label: '6. 图像生成' },
  { id: 'sec-7', label: '7. 向量 Embeddings' },
  { id: 'sec-8', label: '8. 音频' },
  { id: 'sec-9', label: '9. 其它兼容接口' },
  { id: 'sec-10', label: '10. 错误码' },
]

function Section(props: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={props.id} className='scroll-mt-20 space-y-3'>
      <h2 className='text-lg font-semibold'>{props.title}</h2>
      {props.children}
    </section>
  )
}

function Sub(props: { id?: string; title: string; children: ReactNode }) {
  return (
    <div id={props.id} className='scroll-mt-20 space-y-2'>
      <h3 className='text-sm font-semibold'>{props.title}</h3>
      {props.children}
    </div>
  )
}

function Code(props: { children: string }) {
  return (
    <pre className='bg-muted/60 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed'>
      <code>{props.children}</code>
    </pre>
  )
}

function T(props: { headers: string[]; rows: string[][] }) {
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full text-xs'>
        <thead className='bg-muted/60'>
          <tr>
            {props.headers.map((h) => (
              <th key={h} className='px-3 py-2 text-left font-medium'>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={i} className='border-t'>
              {row.map((cell, j) => (
                <td key={j} className='px-3 py-2 align-top'>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Docs() {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string>('')

  // 滚动监听：高亮当前所在章节
  useEffect(() => {
    const sectionIds = TOC.flatMap((item) => [
      item.id,
      ...(item.sub?.map((s) => s.id) ?? []),
    ])
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.25, 0.5] }
    )
    sectionIds.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className='mx-auto max-w-6xl px-4 py-8'>
      <div className='flex gap-10'>
        {/* 左侧粘性目录 */}
        <nav className='sticky top-20 hidden h-fit shrink-0 lg:block'>
          <p className='text-muted-foreground mb-3 px-3 text-xs font-medium tracking-wider uppercase'>
            {t('目录')}
          </p>
          <ul className='space-y-0.5 text-sm'>
            {TOC.map((item) => {
              const active =
                activeId === item.id ||
                item.sub?.some((s) => s.id === activeId)
              return (
                <li key={item.id}>
                  <button
                    type='button'
                    onClick={() => scrollTo(item.id)}
                    className={cn(
                      'hover:text-primary hover:bg-muted/60 w-full rounded-md px-3 py-1.5 text-left transition-colors',
                      active ? 'text-primary bg-muted/60 font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {item.label}
                  </button>
                  {item.sub && (
                    <ul className='border-border/60 ml-4 border-l pl-2'>
                      {item.sub.map((s) => (
                        <li key={s.id}>
                          <button
                            type='button'
                            onClick={() => scrollTo(s.id)}
                            className={cn(
                              'hover:text-primary hover:bg-muted/60 w-full rounded-md px-3 py-1 text-left text-xs transition-colors',
                              activeId === s.id
                                ? 'text-primary bg-muted/60 font-medium'
                                : 'text-muted-foreground'
                            )}
                          >
                            {s.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        {/* 内容区 */}
        <div className='min-w-0 flex-1 space-y-8'>
          <div className='space-y-2 border-b pb-6'>
            <h1 className='text-2xl font-bold'>{t('基加BASEADD API 接口文档')}</h1>
            <p className='text-muted-foreground text-xs'>
              Doc Version: 1.0.0 ｜ 适用平台：基加BASEADD 聚合型 AI 接口网关 ｜ 接口风格：OpenAI 兼容
            </p>
            <p className='text-muted-foreground text-sm'>
              {t('基加BASEADD 为聚合型 AI 接口网关，对 OpenAI 兼容接口提供统一转发，支持对话、图像、视频、向量、音频等多模态；不同能力对应不同模型，可用模型请通过查询模型接口获取。')}
            </p>
          </div>

          <Section id='sec-1' title={t('1. 接入与认证')}>
            <T
              headers={['项', '值']}
              rows={[
                ['Base URL', 'https://baseadd.vip'],
                ['认证方式', '请求头 Authorization: Bearer <API Key>'],
                ['API Key', '在基加BASEADD 控制台创建，绑定账号/分组/额度/模型'],
                ['Content-Type', 'application/json（音频上传为 multipart/form-data）'],
              ]}
            />
          </Section>

          <Section id='sec-2' title={t('2. 快速开始')}>
            <p className='text-xs'>{t('第 1 步：查询可用模型，取 model id。')}</p>
            <Code>{`curl https://baseadd.vip/v1/models \\
  -H "Authorization: Bearer sk-..."`}</Code>
            <p className='text-xs'>{t('第 2 步：用任意模型 id 发起一个视频任务。')}</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
          </Section>

          <Section id='sec-3' title={t('3. 查询可用模型')}>
            <p className='text-xs'>{t('模型与能力动态变化，请始终通过本接口查询，勿硬编码。')}</p>
            <Sub title={t('请求')}>
              <Code>{`GET /v1/models`}</Code>
              <Code>{`curl https://baseadd.vip/v1/models \\
  -H "Authorization: Bearer sk-..."`}</Code>
            </Sub>
            <Sub title={t('响应示例（真实）')}>
              <Code>{`HTTP/1.1 200 OK
{
  "data": [
    { "id": "seedance2.0-cyai-25-260628", "object": "model",
      "created": 1626777600, "owned_by": "cyai seedance",
      "supported_endpoint_types": ["openai"] },
    { "id": "seedance2.0-cyai-260128", "object": "model",
      "created": 1626777600, "owned_by": "cyai seedance",
      "supported_endpoint_types": ["openai"] }
  ],
  "object": "list",
  "success": true
}`}</Code>
            </Sub>
            <Sub title={t('响应字段')}>
              <T
                headers={['字段', '类型', '说明']}
                rows={[
                  ['data[].id', 'string', '模型 ID，调用时使用'],
                  ['data[].object', 'string', '固定 model'],
                  ['data[].supported_endpoint_types', 'string[]', '支持的端点类型'],
                  ['object', 'string', '固定 list'],
                  ['success', 'boolean', '请求是否成功'],
                ]}
              />
            </Sub>
          </Section>

          <Section id='sec-4' title={t('4. 对话')}>
            <p className='text-xs font-medium'>POST /v1/chat/completions</p>
            <Sub title={t('请求参数')}>
              <T
                headers={['字段', '类型', '必填', '说明']}
                rows={[
                  ['model', 'string', '是', '模型 ID，来自 /v1/models'],
                  ['messages', 'array', '是', '消息列表 [{role, content}, ...]'],
                  ['stream', 'boolean', '否', '是否流式返回'],
                  ['temperature', 'number', '否', '采样温度'],
                  ['max_tokens', 'integer', '否', '最大输出 token 数'],
                ]}
              />
            </Sub>
            <Sub title={t('请求示例')}>
              <Code>{`curl -X POST https://baseadd.vip/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Say hello in one sentence." }
    ],
    "stream": false
  }'`}</Code>
            </Sub>
            <Sub title={t('响应示例（OpenAI 格式）')}>
              <Code>{`HTTP/1.1 200 OK
{
  "choices": [
    { "message": { "role": "assistant", "content": "Hello! How can I help you today?" },
      "finish_reason": "stop", "index": 0 }
  ],
  "object": "chat.completion",
  "usage": { "prompt_tokens": 8, "completion_tokens": 12, "total_tokens": 20 },
  "model": "<model-id>"
}`}</Code>
            </Sub>
          </Section>

          <Section id='sec-5' title={t('5. 视频生成（任务式）')}>
            <p className='text-xs'>
              {t('视频生成是异步任务：创建返回 task_id → 轮询查询 → 成功后下载成片。')}
            </p>
            <Sub id='sec-5-1' title={t('5.1 创建视频任务（文本生视频）')}>
              <p className='text-xs font-medium'>POST /v1/videos</p>
              <T
                headers={['字段', '类型', '必填', '说明']}
                rows={[
                  ['model', 'string', '是', '视频模型 ID'],
                  ['prompt', 'string', '是', '画面描述（中文 ≤ 500 字、英文 ≤ 1000 词）'],
                  ['duration', 'integer', '否', '时长（秒），不支持 0 与 -1'],
                  ['metadata', 'object', '否', '扩展参数'],
                ]}
              />
              <T
                headers={['字段', '类型', '说明']}
                rows={[
                  ['metadata.resolution', 'string', '480p/720p/1080p/4k（不支持 2k）'],
                  ['metadata.ratio', 'string', '16:9/9:16/4:3/3:4/21:9/1:1'],
                  ['metadata.generate_audio', 'boolean', '是否生成音频'],
                  ['metadata.watermark', 'boolean', '是否带水印'],
                  ['metadata.seed', 'integer', '随机种子'],
                  ['metadata.image_url', 'string', '图生视频'],
                  ['metadata.video_url', 'string', '视频生视频'],
                ]}
              />
              <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
              <Code>{`HTTP/1.1 200 OK
{
  "id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "task_id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "object": "video",
  "model": "seedance2.0-cyai-mini-260615",
  "status": "queued",
  "progress": 0,
  "created_at": 1788491705
}`}</Code>
            </Sub>
            <Sub id='sec-5-2' title={t('5.2 图生视频')}>
              <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "让图片里的猫动起来",
    "metadata": { "resolution": "720p", "ratio": "16:9", "image_url": "https://example.com/cat.jpg" }
  }'`}</Code>
            </Sub>
            <Sub id='sec-5-3' title={t('5.3 视频生视频 / Remix')}>
              <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "调整为电影感",
    "metadata": { "resolution": "720p", "ratio": "16:9", "video_url": "https://example.com/input.mp4" }
  }'`}</Code>
            </Sub>
            <Sub id='sec-5-4' title={t('5.4 查询任务状态')}>
              <Code>{`GET /v1/videos/{task_id}`}</Code>
              <Code>{`curl https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM \\
  -H "Authorization: Bearer sk-..."`}</Code>
              <Code>{`HTTP/1.1 200 OK
{
  "id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "object": "video",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1788491705,
  "completed_at": 1788491754,
  "metadata": { "url": "https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content" }
}`}</Code>
              <p className='text-xs'>
                {t('状态流转：queued → in_progress → completed / failed。completed 后 metadata.url 即为成片地址。')}
              </p>
            </Sub>
            <Sub id='sec-5-5' title={t('5.5 下载成片')}>
              <Code>{`curl -L https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content \\
  -H "Authorization: Bearer sk-..." \\
  -o output.mp4`}</Code>
              <p className='text-xs'>{t('返回 video/mp4 二进制内容；任务未完成时返回错误 JSON。')}</p>
            </Sub>
          </Section>

          <Section id='sec-6' title={t('6. 图像生成')}>
            <p className='text-xs font-medium'>POST /v1/images/generations　·　POST /v1/images/edits</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "prompt": "a red sunset over the sea", "size": "1024x1024", "n": 1}'`}</Code>
          </Section>

          <Section id='sec-7' title={t('7. 向量 Embeddings')}>
            <p className='text-xs font-medium'>POST /v1/embeddings</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "input": "hello world"}'`}</Code>
          </Section>

          <Section id='sec-8' title={t('8. 音频')}>
            <p className='text-xs font-medium'>
              POST /v1/audio/transcriptions　·　POST /v1/audio/translations　·　POST /v1/audio/speech
            </p>
            <p className='text-xs'>{t('语音转写/翻译/合成（TTS），模型 ID 通过 /v1/models 查询。')}</p>
          </Section>

          <Section id='sec-9' title={t('9. 其它兼容接口')}>
            <T
              headers={['能力', '端点']}
              rows={[
                ['补全', 'POST /v1/completions'],
                ['Responses', 'POST /v1/responses，POST /v1/responses/compact'],
                ['Claude', 'POST /v1/messages'],
                ['Gemini', 'POST /v1beta/models/*path'],
                ['重排', 'POST /v1/rerank'],
                ['审核', 'POST /v1/moderations'],
                ['Midjourney', '/mj/submit/*，/mj/task/*，/mj/image/*'],
                ['Suno（音乐）', '/suno/submit/:action，/suno/fetch'],
                ['实时', '/v1/realtime（WebSocket）'],
              ]}
            />
          </Section>

          <Section id='sec-10' title={t('10. 错误码')}>
            <T
              headers={['code', 'HTTP', '说明', '处理建议']}
              rows={[
                ['model_not_found', '503', '模型不存在或无可用渠道', '查询 /v1/models 确认模型名'],
                ['insufficient_user_quota', '403', '余额不足', '充值或检查额度'],
                ['model_price_error', '400', '模型/参数不支持', '检查参数（如 2k/-1 时长）'],
                ['invalid_seconds', '400', '时长非法', '传固定秒数'],
                ['invalid_api_platform', '400', '调用了不支持的接口/模型类型', '改用对应能力接口'],
                ['task_not_exist', '400', '任务不存在', '核对 task_id'],
              ]}
            />
            <p className='text-xs'>
              {t('错误响应结构：{"error": {"message": "...", "code": "...", "type": "new_api_error"}}。')}
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}

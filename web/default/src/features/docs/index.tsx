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

const TOC: { id: string; label: string; sub?: { id: string; label: string }[] }[] = [
  { id: 'sec-1', label: '1. 接入与认证' },
  { id: 'sec-2', label: '2. 快速开始' },
  { id: 'sec-3', label: '3. 接口总览' },
  { id: 'sec-4', label: '4. 查询可用模型' },
  { id: 'sec-5', label: '5. 对话（Chat）' },
  {
    id: 'sec-6',
    label: '6. 视频生成（任务式）',
    sub: [
      { id: 'sec-6-1', label: '6.1 创建视频任务' },
      { id: 'sec-6-2', label: '6.2 图生视频' },
      { id: 'sec-6-3', label: '6.3 视频生视频 / Remix' },
      { id: 'sec-6-4', label: '6.4 查询任务状态' },
      { id: 'sec-6-5', label: '6.5 下载成片' },
    ],
  },
  { id: 'sec-7', label: '7. 图像生成' },
  { id: 'sec-8', label: '8. 向量（Embeddings）' },
  { id: 'sec-9', label: '9. 音频' },
  { id: 'sec-10', label: '10. 其它兼容接口' },
  { id: 'sec-11', label: '11. 错误码' },
]

function Section(props: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={props.id} className='scroll-mt-20 space-y-4'>
      <h2 className='text-xl font-semibold'>{props.title}</h2>
      {props.children}
    </section>
  )
}

function Sub(props: { id?: string; title: string; children: ReactNode }) {
  return (
    <div id={props.id} className='scroll-mt-20 space-y-2.5'>
      <h3 className='text-base font-semibold'>{props.title}</h3>
      {props.children}
    </div>
  )
}

function Code(props: { children: string }) {
  return (
    <pre className='bg-muted/60 overflow-x-auto rounded-lg border p-4 text-[13px] leading-6'>
      <code>{props.children}</code>
    </pre>
  )
}

function ET(props: { title: string }) {
  return <p className='text-[13px] font-medium'>{props.title}</p>
}

/** 方法徽章（GET 蓝 / POST 绿 / DELETE 红） */
function MethodChip(props: { method: 'GET' | 'POST' | 'DELETE' }) {
  const cls =
    props.method === 'GET'
      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
      : props.method === 'POST'
        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        : 'bg-red-500/15 text-red-600 dark:text-red-400'
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold', cls)}
    >
      {props.method}
    </span>
  )
}

/** 接口行：方法徽章 + 路径 */
function Endpoint(props: { method: 'GET' | 'POST' | 'DELETE'; path: string }) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <MethodChip method={props.method} />
      <code className='text-[13px] font-medium break-all'>{props.path}</code>
    </div>
  )
}

/** 提示框 */
function Callout(props: { title?: string; children: ReactNode }) {
  return (
    <div className='border-primary/25 bg-primary/5 rounded-lg border-l-2 border-l-primary px-3 py-2'>
      {props.title && <p className='text-primary text-[13px] font-semibold'>{props.title}</p>}
      <div className='text-[13px]'>{props.children}</div>
    </div>
  )
}

function T(props: { headers: string[]; rows: string[][] }) {
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full text-[13px]'>
        <thead className='bg-muted/60'>
          <tr>
            {props.headers.map((h) => (
              <th key={h} className='px-4 py-2.5 text-left font-medium'>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={i} className='hover:bg-muted/30 border-t'>
              {row.map((cell, j) => (
                <td key={j} className='px-4 py-2.5 align-top'>
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

  useEffect(() => {
    const ids = TOC.flatMap((item) => [
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
    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className='mx-auto max-w-6xl px-4 py-10'>
      <div className='flex gap-10'>
        <nav className='sticky top-20 hidden h-fit shrink-0 lg:block'>
          <p className='text-muted-foreground mb-3 px-3 text-[13px] font-medium tracking-wider uppercase'>
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
                              'hover:text-primary hover:bg-muted/60 w-full rounded-md px-3 py-1 text-left text-[13px] transition-colors',
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

        <div className='min-w-0 flex-1 space-y-10'>
          <div className='bg-card/60 space-y-5 rounded-2xl border p-8'>
            <div className='space-y-1'>
              <h1 className='text-2xl font-bold'>{t('基加BASEADD 接口指引')}</h1>
              <p className='text-muted-foreground text-sm'>
                {t('基加BASEADD 提供对话、视频、图像、向量、音频等 AI 能力的统一 API。所有接口遵循 OpenAI 兼容格式，接入简单、各能力独立。')}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              {[
                ['Base URL', 'https://ghyc.top'],
                ['认证', 'Authorization: Bearer <API Key>'],
                ['风格', 'OpenAI 兼容'],
                ['版本', 'v1.0.0'],
              ].map(([k, v]) => (
                <div key={k} className='bg-muted/50 rounded-lg border px-2.5 py-1.5'>
                  <p className='text-muted-foreground text-[10px] tracking-wide uppercase'>
                    {k}
                  </p>
                  <p className='font-mono text-[13px] font-medium'>{v}</p>
                </div>
              ))}
            </div>
          </div>

          <Section id='sec-1' title={t('1. 接入与认证')}>
            <T
              headers={['项', '值']}
              rows={[
                ['Base URL', 'https://ghyc.top'],
                ['认证方式', '请求头 Authorization: Bearer <API Key>'],
                ['API Key', '在基加BASEADD 控制台创建'],
                ['Content-Type', 'application/json（音频上传为 multipart/form-data）'],
              ]}
            />
            <p className='text-[13px]'>
              {t('所有接口都需要携带 API Key，否则返回 401。API Key 与账号额度、可用模型绑定。')}
            </p>
          </Section>

          <Section id='sec-2' title={t('2. 快速开始')}>
            <p className='text-[13px]'>
              {t('第 1 步：查询可用模型，获取 model id。')}
            </p>
            <ET title={t('请求示例')} />
            <Code>{`GET /v1/models
Authorization: Bearer sk-...`}</Code>
            <p className='text-[13px]'>
              {t('第 2 步：用获取的 model id 发起一次视频任务。')}
            </p>
            <ET title={t('请求示例')} />
            <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
          </Section>

          <Section id='sec-3' title={t('3. 接口总览')}>
            <T
              headers={['能力', '接口', '说明']}
              rows={[
                ['对话', 'POST /v1/chat/completions', '支持流式（stream）与非流式'],
                ['视频', 'POST /v1/videos（任务式）', '异步任务：创建→查询→下载；支持图/视频生视频'],
                ['图像', 'POST /v1/images/generations、POST /v1/images/edits', '文生图、图编辑'],
                ['向量', 'POST /v1/embeddings', '文本向量化'],
                ['音频', 'POST /v1/audio/transcriptions、/translations、/speech', '语音转写、翻译、合成'],
                ['模型', 'GET /v1/models', '查询当前可用模型'],
              ]}
            />
            <p className='text-[13px]'>
              {t('各能力接口相互独立，按需调用。同一能力内，传不同的模型 ID 即可使用不同的模型/规格。')}
            </p>
          </Section>

          <Section id='sec-4' title={t('4. 查询可用模型')}>
            <p className='text-[13px]'>{t('模型会随平台上架/下架变化，请以本接口返回为准。')}</p>
            <Endpoint method='GET' path='/v1/models' />
            <ET title={t('请求示例')} />
            <Code>{`curl https://ghyc.top/v1/models \\
  -H "Authorization: Bearer sk-..."`}</Code>
            <ET title={t('响应示例')} />
            <Code>{`HTTP/1.1 200 OK
{
  "data": [
    { "id": "seedance2.0-cyai-25-260628", "object": "model",
      "created": 1626777600, "owned_by": "cyai seedance",
      "supported_endpoint_types": ["openai"] }
  ],
  "object": "list",
  "success": true
}`}</Code>
            <ET title={t('响应字段')} />
            <T
              headers={['字段', '类型', '说明']}
              rows={[
                ['data[].id', 'string', '模型 ID，后续调用时传入'],
                ['data[].object', 'string', '固定为 model'],
                ['data[].supported_endpoint_types', 'string[]', '该模型支持的端点类型'],
                ['object', 'string', '固定为 list'],
                ['success', 'boolean', '请求是否成功'],
              ]}
            />
          </Section>

          <Section id='sec-5' title={t('5. 对话（Chat）')}>
            <Endpoint method='POST' path='/v1/chat/completions' />
            <p className='text-[13px]'>{t('支持流式返回（stream:true，SSE）与非流式返回。')}</p>
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '说明']}
              rows={[
                ['model', 'string', '是', '模型 ID，来自 /v1/models'],
                ['messages', 'array', '是', '消息列表：[{role, content}, ...]，role 为 system/user/assistant'],
                ['stream', 'boolean', '否', '是否流式返回，默认 false'],
                ['temperature', 'number', '否', '采样温度，一般 0-2'],
                ['max_tokens', 'integer', '否', '最大输出 token 数'],
                ['top_p', 'number', '否', '核采样参数'],
              ]}
            />
            <Sub title={t('5.1 非流式')}>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "用一句话介绍人工智能。" }
    ],
    "stream": false
  }'`}</Code>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "chatcmpl-xxxx",
  "object": "chat.completion",
  "created": 1788490000,
  "model": "<model-id>",
  "choices": [
    { "index": 0, "finish_reason": "stop",
      "message": { "role": "assistant", "content": "人工智能是使机器具备类似人类智能的技术。" } }
  ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 30, "total_tokens": 42 }
}`}</Code>
              <ET title={t('响应字段')} />
              <T
                headers={['字段', '说明']}
                rows={[
                  ['choices[0].message.content', '助手回复内容'],
                  ['choices[0].finish_reason', '结束原因（stop/length 等）'],
                  ['usage', 'token 消耗（计费依据）'],
                ]}
              />
            </Sub>
            <Sub title={t('5.2 流式（SSE）')}>
              <p className='text-[13px]'>{t('stream 传 true，返回 text/event-stream，逐段输出 data: {...}。')}</p>
              <ET title={t('请求示例')} />
              <Code>{`curl -N -X POST https://ghyc.top/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"你好"}],"stream":true}'`}</Code>
              <ET title={t('响应示例（SSE 片段）')} />
              <Code>{`data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"你好"},"index":0}]}

data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"，有什么可以帮你？"},"index":0}]}

data: [DONE]`}</Code>
            </Sub>
          </Section>

          <Section id='sec-6' title={t('6. 视频生成（任务式）')}>
            <Callout title={t('异步任务说明')}>
              {t('视频生成是异步任务：创建接口返回 task_id → 轮询查询接口 → 状态成功后通过下载接口获取成片。')}
            </Callout>
            <Sub id='sec-6-1' title={t('6.1 创建视频任务（文本生视频）')}>
              <Endpoint method='POST' path='/v1/videos' />
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '说明']}
                rows={[
                  ['model', 'string', '是', '视频模型 ID'],
                  ['prompt', 'string', '是', '画面描述（中文 ≤ 500 字、英文 ≤ 1000 词）'],
                  ['duration', 'integer', '否', '时长（秒），不支持 0 与 -1'],
                  ['metadata', 'object', '否', '扩展参数，见下表'],
                ]}
              />
              <ET title={t('metadata 字段')} />
              <T
                headers={['字段', '类型', '说明']}
                rows={[
                  ['resolution', 'string', '480p/720p/1080p/4k（不支持 2k）'],
                  ['ratio', 'string', '16:9/9:16/4:3/3:4/21:9/1:1'],
                  ['generate_audio', 'boolean', '是否生成音频，默认 true'],
                  ['watermark', 'boolean', '是否带水印'],
                  ['seed', 'integer', '随机种子'],
                  ['image_url', 'string', '图生视频：输入图片公网 URL'],
                  ['video_url', 'string', '视频生视频：输入视频公网 URL'],
                ]}
              />
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
              <ET title={t('响应示例')} />
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
              <ET title={t('响应字段')} />
              <T
                headers={['字段', '说明']}
                rows={[
                  ['task_id', '任务 ID，用于查询与下载'],
                  ['status', '任务状态（queued 表示已排队）'],
                  ['progress', '进度（0-100）'],
                ]}
              />
            </Sub>
            <Sub id='sec-6-2' title={t('6.2 图生视频')}>
              <p className='text-[13px]'>{t('在 metadata 传 image_url，基于图片生成视频。')}</p>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "让图片里的猫动起来",
    "metadata": { "resolution": "720p", "ratio": "16:9", "image_url": "https://example.com/cat.jpg" }
  }'`}</Code>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "task_id": "task_rzBa6A4nhqiM8u61oreSYxkcJilyCxMM",
  "object": "video",
  "model": "seedance2.0-cyai-mini-260615",
  "status": "queued"
}`}</Code>
            </Sub>
            <Sub id='sec-6-3' title={t('6.3 视频生视频 / Remix')}>
              <p className='text-[13px]'>{t('方式一：metadata 传 video_url。方式二：POST /v1/videos/{video_id}/remix。')}</p>
              <ET title={t('请求示例（video_url 方式）')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "调整为电影感",
    "metadata": { "resolution": "720p", "ratio": "16:9", "video_url": "https://example.com/input.mp4" }
  }'`}</Code>
              <ET title={t('请求示例（Remix 方式）')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos/video_xxx/remix \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "seedance2.0-cyai-mini-260615", "prompt": "调整为电影感"}'`}</Code>
            </Sub>
            <Sub id='sec-6-4' title={t('6.4 查询任务状态')}>
              <Endpoint method='GET' path='/v1/videos/{task_id}' />
              <ET title={t('请求示例')} />
              <Code>{`curl https://ghyc.top/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM \\
  -H "Authorization: Bearer sk-..."`}</Code>
              <ET title={t('响应示例（生成中）')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "object": "video",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1788491705,
  "completed_at": 1788491754,
  "metadata": { "url": "https://ghyc.top/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content" }
}`}</Code>
              <p className='text-[13px]'>
                {t('状态流转：queued → in_progress → completed / failed。completed 后 metadata.url 即为成片地址。')}
              </p>
              <ET title={t('状态说明')} />
              <T
                headers={['status', '说明']}
                rows={[
                  ['queued', '已提交，排队中'],
                  ['in_progress', '生成中（progress 显示进度）'],
                  ['completed', '已完成，可取成片'],
                  ['failed', '失败，可查看错误信息'],
                ]}
              />
            </Sub>
            <Sub id='sec-6-5' title={t('6.5 下载成片')}>
              <Endpoint method='GET' path='/v1/videos/{task_id}/content' />
              <ET title={t('请求示例')} />
              <Code>{`curl -L https://ghyc.top/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content \\
  -H "Authorization: Bearer sk-..." \\
  -o output.mp4`}</Code>
              <ET title={t('响应说明')} />
              <p className='text-[13px]'>{t('任务完成后返回 video/mp4 二进制内容；未完成时返回错误 JSON。')}</p>
            </Sub>
          </Section>

          <Section id='sec-7' title={t('7. 图像生成')}>
            <Endpoint method='POST' path='/v1/images/generations　·　POST /v1/images/edits' />
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '说明']}
              rows={[
                ['model', 'string', '是', '图像模型 ID'],
                ['prompt', 'string', '是', '画面描述'],
                ['size', 'string', '否', '尺寸，如 1024x1024'],
                ['n', 'integer', '否', '生成张数'],
                ['response_format', 'string', '否', 'url 或 b64_json'],
              ]}
            />
            <ET title={t('请求示例')} />
            <Code>{`curl -X POST https://ghyc.top/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","prompt":"a red sunset over the sea","size":"1024x1024","n":1}'`}</Code>
            <ET title={t('响应示例')} />
            <Code>{`HTTP/1.1 200 OK
{
  "created": 1788490000,
  "data": [
    { "url": "https://ghyc.top/files/xxxx.png",
      "revised_prompt": "a red sunset over the sea" }
  ]
}`}</Code>
          </Section>

          <Section id='sec-8' title={t('8. 向量（Embeddings）')}>
            <p className='text-[13px]'>
              {t('把文本转换为向量，用于语义搜索、知识库检索（RAG）、推荐、聚类等场景。')}
            </p>
            <Endpoint method='POST' path='/v1/embeddings' />
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '说明']}
              rows={[
                ['model', 'string', '是', '向量模型 ID'],
                ['input', 'string/array', '是', '待向量化文本，支持批量（数组）'],
              ]}
            />
            <ET title={t('请求示例')} />
            <Code>{`curl -X POST https://ghyc.top/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","input":"hello world"}'`}</Code>
            <ET title={t('响应示例')} />
            <Code>{`HTTP/1.1 200 OK
{
  "object": "list",
  "data": [
    { "index": 0, "embedding": [0.0123, -0.0456, 0.0789] }
  ],
  "model": "<model-id>",
  "usage": { "prompt_tokens": 2, "total_tokens": 2 }
}`}</Code>
            <ET title={t('响应字段')} />
            <T
              headers={['字段', '说明']}
              rows={[
                ['data[].embedding', '向量数组（维度因模型而异）'],
                ['usage.prompt_tokens', '输入 token 数（计费依据）'],
              ]}
            />
          </Section>

          <Section id='sec-9' title={t('9. 音频')}>
            <T
              headers={['能力', '接口', '说明']}
              rows={[
                ['语音转写', 'POST /v1/audio/transcriptions', '音频 → 文本（multipart/form-data）'],
                ['语音翻译', 'POST /v1/audio/translations', '外语音频 → 英文文本'],
                ['语音合成（TTS）', 'POST /v1/audio/speech', '文本 → 语音'],
              ]}
            />
            <ET title={t('请求示例（转写）')} />
            <Code>{`curl -X POST https://ghyc.top/v1/audio/transcriptions \\
  -H "Authorization: Bearer sk-..." \\
  -F "model=<model-id>" \\
  -F "file=@audio.mp3"`}</Code>
          </Section>

          <Section id='sec-10' title={t('10. 其它兼容接口')}>
            <p className='text-[13px]'>{t('以下接口为按需提供的兼容接口，模型上线后即可使用。')}</p>
            <Sub title={t('10.1 Response API')}>
              <p className='text-[13px]'>POST /v1/responses　·　POST /v1/responses/compact</p>
              <p className='text-[13px]'>{t('输出结构化响应，支持 reasoning、输出 schema（JSON）等）。')}</p>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","input":"who won the world cup in 2018?"}'`}</Code>
            </Sub>
            <Sub title={t('10.2 Claude 兼容（Anthropic）')}>
              <p className='text-[13px]'>POST /v1/messages</p>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}'`}</Code>
            </Sub>
            <Sub title={t('10.3 Gemini 兼容')}>
              <p className='text-[13px]'>POST /v1beta/models/*path　·　GET /v1beta/models</p>
            </Sub>
            <Sub title={t('10.4 重排（Rerank）')}>
              <p className='text-[13px]'>POST /v1/rerank</p>
              <p className='text-[13px]'>{t('对候选文档按与查询的相关度重排，常用于检索增强。')}</p>
            </Sub>
            <Sub title={t('10.5 内容审核（Moderations）')}>
              <p className='text-[13px]'>POST /v1/moderations</p>
            </Sub>
            <Sub title={t('10.6 扩展工具（按需开通）')}>
              <T
                headers={['能力', '接口']}
                rows={[
                  ['Midjourney 绘图', '/mj/submit/*，/mj/task/*，/mj/image/*'],
                  ['Suno 音乐', '/suno/submit/:action，/suno/fetch'],
                  ['实时语音', '/v1/realtime（WebSocket）'],
                ]}
              />
              <p className='text-[13px]'>{t('以上为专用工具接口，需平台开通对应能力后可用；具体请求格式可另行咨询。')}</p>
            </Sub>
          </Section>

          <Section id='sec-11' title={t('11. 错误码')}>
            <T
              headers={['code', 'HTTP', '说明', '处理建议']}
              rows={[
                ['model_not_found', '503', '模型不存在或无可用渠道', '查询 /v1/models 确认模型名'],
                ['insufficient_user_quota', '403', '余额不足', '充值或检查额度'],
                ['model_price_error', '400', '模型/参数不支持', '检查参数（如 2k/-1 时长）'],
                ['invalid_seconds', '400', '时长非法', '传固定秒数'],
                ['invalid_api_platform', '400', '调用了不支持的接口/模型类型', '改用对应能力接口'],
                ['task_not_exist', '400', '任务不存在', '核对 task_id'],
                ['invalid_response', '400', '缺少必填参数', '按参数表补全必填项'],
              ]}
            />
            <p className='text-[13px]'>
              {t('错误响应结构：{"error": {"message": "...", "code": "...", "type": "new_api_error"}}。')}
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}

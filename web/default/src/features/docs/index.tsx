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
import { useEffect, useState, type ReactNode } from 'react'
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
      { id: 'sec-6-1', label: '6.1 创建视频任务（文本生视频）' },
      { id: 'sec-6-2', label: '6.2 图生视频' },
      { id: 'sec-6-3', label: '6.3 视频生视频 / Remix' },
      { id: 'sec-6-4', label: '6.4 多模态参考' },
      { id: 'sec-6-5', label: '6.5 查询任务状态' },
      { id: 'sec-6-6', label: '6.6 取消任务' },
      { id: 'sec-6-7', label: '6.7 下载成片' },
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
    <div id={props.id} className='scroll-mt-20 space-y-3'>
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

/** 小节内的字段标题：与紧随其后的代码块或表格成组，故上方留出更大间距 */
function ET(props: { title: string }) {
  return (
    <p className='text-[13px] font-medium [&:not(:first-child)]:pt-2'>{props.title}</p>
  )
}

/** 正文段落 */
function P(props: { children: ReactNode }) {
  return <p className='text-[13px] leading-relaxed'>{props.children}</p>
}

/** 说明块：与提示框同一版式，仅用中性底色区分 */
function Note(props: { title?: string; children: ReactNode }) {
  return (
    <div className='bg-muted/40 space-y-1.5 rounded-lg border p-4'>
      {props.title && <p className='text-[13px] font-medium'>{props.title}</p>}
      <div className='text-[13px] leading-relaxed'>{props.children}</div>
    </div>
  )
}

/** 方法徽章的配色（GET 蓝 / POST 绿 / DELETE 红） */
const METHOD_CHIP_CLASS: Record<'GET' | 'POST' | 'DELETE', string> = {
  GET: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  POST: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  DELETE: 'bg-red-500/15 text-red-600 dark:text-red-400',
}

/** 方法徽章（GET 蓝 / POST 绿 / DELETE 红） */
function MethodChip(props: { method: 'GET' | 'POST' | 'DELETE' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
        METHOD_CHIP_CLASS[props.method]
      )}
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
    <div className='border-primary/25 bg-primary/5 border-l-primary space-y-1 rounded-lg border border-l-2 px-4 py-3'>
      {props.title && <p className='text-primary text-[13px] font-semibold'>{props.title}</p>}
      <div className='text-[13px] leading-relaxed'>{props.children}</div>
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
          {props.rows.map((row) => (
            <tr key={row.join('|')} className='hover:bg-muted/30 border-t'>
              {row.map((cell) => (
                <td key={cell} className='px-4 py-2.5 align-top'>
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

        <div className='min-w-0 flex-1 space-y-10 leading-relaxed'>
          <div className='bg-card/60 space-y-5 rounded-2xl border p-8'>
            <div className='space-y-1.5'>
              <h1 className='text-2xl font-bold'>{t('基加BASEADD 接口指引')}</h1>
              <p className='text-muted-foreground text-sm'>
                {t('基加BASEADD 将对话、视频、图像、向量、音频等 AI 能力统一为一套接口，全部遵循 OpenAI 兼容格式；各能力相互独立，可按需调用。')}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              {[
                ['Base URL', 'https://ghyc.top'],
                ['认证方式', 'Authorization: Bearer <API Key>'],
                ['接口风格', 'OpenAI 兼容'],
                ['接口版本', 'v1.0.0'],
              ].map(([k, v]) => (
                <div key={k} className='bg-muted/50 rounded-lg border px-3 py-2'>
                  <p className='text-muted-foreground text-[11px] tracking-wide uppercase'>
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
            <P>
              {t('所有接口均需携带 API Key，缺失或无效时返回 401。API Key 与账号额度、可用模型绑定。')}
            </P>
          </Section>

          <Section id='sec-2' title={t('2. 快速开始')}>
            <ET title={t('第 1 步：查询可用模型，取得 model ID')} />
            <Code>{`GET /v1/models
Authorization: Bearer sk-...`}</Code>
            <ET title={t('第 2 步：以该 model ID 创建一个视频任务')} />
            <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
          </Section>

          <Section id='sec-3' title={t('3. 接口总览')}>
            <T
              headers={['能力', '接口', '说明']}
              rows={[
                ['对话', 'POST /v1/chat/completions', '支持流式（stream）与非流式返回'],
                ['视频', 'POST /v1/videos（任务式）', '异步任务：创建 → 查询 → 下载；支持图生视频、视频生视频'],
                ['图像', 'POST /v1/images/generations、POST /v1/images/edits', '文本生图、图片编辑'],
                ['向量', 'POST /v1/embeddings', '文本向量化'],
                ['音频', 'POST /v1/audio/transcriptions、/translations、/speech', '语音转写、语音翻译、语音合成'],
                ['模型', 'GET /v1/models', '查询当前可用模型'],
              ]}
            />
            <P>
              {t('各能力接口相互独立，可按需调用；同一能力下更换 model，即可切换具体模型或规格。')}
            </P>
          </Section>

          <Section id='sec-4' title={t('4. 查询可用模型')}>
            <P>{t('模型会随平台上架或下架而变化，请以本接口返回为准。')}</P>
            <Endpoint method='GET' path='/v1/models' />
            <ET title={t('请求示例')} />
            <Code>{`curl https://ghyc.top/v1/models \\
  -H "Authorization: Bearer sk-..."`}</Code>
            <ET title={t('响应示例')} />
            <Code>{`HTTP/1.1 200 OK
{
  "data": [
    { "id": "<model-id>", "object": "model",
      "created": 1626777600, "owned_by": "<归属方>",
      "supported_endpoint_types": ["openai"] }
  ],
  "object": "list",
  "success": true
}`}</Code>
            <ET title={t('响应字段')} />
            <T
              headers={['字段', '类型', '说明']}
              rows={[
                ['data[].id', 'string', '模型 ID，调用时作为 model 传入'],
                ['data[].object', 'string', '固定为 model'],
                ['data[].created', 'integer', '条目创建时间戳（秒）'],
                ['data[].owned_by', 'string', '归属方（渠道名或渠道类型名）'],
                ['data[].supported_endpoint_types', 'string[]', '该模型支持的端点类型'],
                ['object', 'string', '固定为 list'],
                ['success', 'boolean', '请求是否成功'],
              ]}
            />
          </Section>

          <Section id='sec-5' title={t('5. 对话（Chat）')}>
            <Endpoint method='POST' path='/v1/chat/completions' />
            <P>{t('支持流式（stream=true，SSE）与非流式返回。')}</P>
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '默认值', '说明']}
              rows={[
                ['model', 'string', '是', '—', '模型 ID，取自 /v1/models'],
                ['messages', 'array', '是', '—', '消息列表，元素为 {role, content}；role 取 system / user / assistant'],
                ['stream', 'boolean', '否', 'false', '是否流式返回'],
                ['temperature', 'number', '否', '模型默认', '采样温度，取值 0–2，越低输出越确定'],
                ['max_tokens', 'integer', '否', '模型默认', '最大输出 token 数'],
                ['top_p', 'number', '否', '模型默认', '核采样阈值，取值 0–1'],
                ['top_k', 'integer', '否', '模型默认', '仅从前 k 个 token 中采样，是否支持以模型为准'],
                ['frequency_penalty', 'number', '否', '0', '重复惩罚，取值 -2 至 2'],
                ['presence_penalty', 'number', '否', '0', '话题新颖度惩罚，取值 -2 至 2'],
                ['seed', 'integer', '否', '随机', '随机种子，固定后可复现输出'],
                ['stop', 'string/array', '否', '—', '停止词，命中即结束生成'],
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
                headers={['字段', '类型', '说明']}
                rows={[
                  ['choices[0].message.content', 'string', '助手回复内容'],
                  ['choices[0].finish_reason', 'string', '结束原因，如 stop、length'],
                  ['usage', 'object', 'token 用量（计费依据）'],
                ]}
              />
            </Sub>
            <Sub title={t('5.2 流式（SSE）')}>
              <P>{t('stream 为 true 时返回 text/event-stream，按段输出 data: {...}。')}</P>
              <ET title={t('请求示例')} />
              <Code>{`curl -N -X POST https://ghyc.top/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","messages":[{"role":"user","content":"你好"}],"stream":true}'`}</Code>
              <ET title={t('响应示例（SSE 片段）')} />
              <Code>{`data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant","content":"你好"},"index":0}]}

data: {"id":"chatcmpl-xxxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"，有什么可以帮你？"},"index":0}]}

data: [DONE]`}</Code>
              <P>
                {t('响应末尾默认额外返回一个携带 usage 的分片；可通过 stream_options.include_usage=false 关闭。')}
              </P>
            </Sub>
          </Section>

          <Section id='sec-6' title={t('6. 视频生成（任务式）')}>
            <Callout title={t('异步任务说明')}>
              {t('视频生成为异步任务：创建接口返回 task_id，轮询查询接口获知状态，成功后通过下载接口获取成片。')}
            </Callout>
            <Note title={t('通用约定')}>
              <ul className='list-disc space-y-1 pl-5'>
                <li>{t('唯一必填参数为 model。prompt 可省略，此时以 content 中 type=text 元素的文本作为提示词；其余字段均为可选，省略时采用上游默认值。')}</li>
                <li>{t('duration：可选。Seedance 系模型须为 4–15 的整数（秒）；省略或指定 -1 时由模型自动选择（2.0 系列默认 5 秒，2.5 系列默认 10 秒），超出该范围返回 invalid_seconds。其它模型族以各自模型规格为准。')}</li>
                <li>{t('resolution：可选。省略或为空时按 720p 处理，常用取值 480p / 720p / 1080p / 4k；传入不受支持的值返回 invalid_resolution。')}</li>
                <li>{t('各字段的取值范围、默认值与参考输入上限均以所用模型的规格为准。')}</li>
              </ul>
            </Note>
            <Sub id='sec-6-1' title={t('6.1 创建视频任务（文本生视频）')}>
              <Endpoint method='POST' path='/v1/videos' />
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '视频模型 ID'],
                  ['prompt', 'string', '否（见说明）', '—', '画面描述（中文不超过 500 字，英文不超过 1000 词）；与 content 中 type=text 元素的文本合并为一条提示词，二者可只写其一'],
                  ['content', 'array', '否', '—', '多模态参考（参考图 / 参考视频 / 参考音频）的顶层写法，与 metadata.content 等价，详见 6.4'],
                  ['duration', 'integer', '否', '模型默认', '时长（秒）：4–15 的整数；省略或 -1 由模型自动选择'],
                  ['resolution / ratio / generate_audio / watermark / seed / frames / camera_fixed', 'string / number / boolean', '否', '—', '与 model 同级直接传入；与 metadata 中的同名字段等价，两处都写时以 metadata 为准'],
                  ['metadata', 'object', '否', '见下表', '扩展参数，见下表'],
                ]}
              />
              <ET title={t('metadata 字段')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['resolution', 'string', '否', '720p', '480p / 720p / 1080p / 4k'],
                  ['ratio', 'string', '否', '模型默认', '16:9 / 9:16 / 4:3 / 3:4 / 21:9 / 1:1'],
                  ['generate_audio', 'boolean', '否', 'true', '是否生成音频'],
                  ['watermark', 'boolean', '否', 'false', '是否带水印'],
                  ['seed', 'integer', '否', '随机', '随机种子，固定后可复现输出'],
                  ['frames', 'integer', '否', '模型默认', '总帧数，与 duration 二选一；是否支持以模型为准'],
                  ['camera_fixed', 'boolean', '否', '模型默认', '是否固定镜头，是否支持以模型为准'],
                  ['image_url', 'string', '否', '—', '图生视频的输入图片公网 URL，详见 6.2'],
                  ['video_url', 'string', '否', '—', '视频生视频的输入视频公网 URL，详见 6.3'],
                  ['content', 'array', '否', '—', '多模态参考数组，详见 6.4'],
                  ['return_last_frame', 'boolean', '否', 'false', '是否额外返回尾帧图。开启后查询结果的 metadata.last_frame_url 给出尾帧地址，可作为下一段视频的首帧参考'],
                ]}
              />
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0,
  "created_at": 1788598144
}`}</Code>
              <ET title={t('响应字段')} />
              <T
                headers={['字段', '类型', '说明']}
                rows={[
                  ['id', 'string', '任务 ID（与 task_id 一致）'],
                  ['task_id', 'string', '任务 ID，用于查询、取消与下载'],
                  ['object', 'string', '固定为 video'],
                  ['model', 'string', '本次请求使用的模型'],
                  ['status', 'string', '任务状态，创建成功时为 queued'],
                  ['progress', 'number', '进度（0–100）'],
                  ['created_at', 'integer', '任务创建时间戳（秒）'],
                ]}
              />
            </Sub>
            <Sub id='sec-6-2' title={t('6.2 图生视频')}>
              <P>{t('以 metadata.image_url 传入输入图片，基于该图片生成视频。')}</P>
              <P>
                {t('metadata.image_url 为简化写法，本站按「首帧图片」意图下发；如需严格的首帧或首尾帧语义，请改用 6.4 的 content 写法并显式声明 role（first_frame / last_frame）。')}
              </P>
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '视频模型 ID'],
                  ['prompt', 'string', '是', '—', '画面描述'],
                  ['metadata.image_url', 'string', '是', '—', '输入图片公网 URL'],
                  ['metadata.resolution', 'string', '否', '720p', '480p / 720p / 1080p / 4k'],
                  ['metadata.ratio', 'string', '否', '模型默认', '16:9 / 9:16 / 4:3 / 3:4 / 21:9 / 1:1'],
                ]}
              />
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "prompt": "让图片里的猫动起来",
    "metadata": { "resolution": "720p", "ratio": "16:9", "image_url": "https://example.com/cat.jpg" }
  }'`}</Code>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0,
  "created_at": 1788598144
}`}</Code>
            </Sub>
            <Sub id='sec-6-3' title={t('6.3 视频生视频 / Remix')}>
              <P>{t('方式一：以 metadata.video_url 传入参考视频，或在 content 中提供一条 role=reference_video 的 video_url 元素。方式二：调用 POST /v1/videos/{video_id}/remix，由原任务派生新任务。')}</P>
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '视频模型 ID'],
                  ['prompt', 'string', '是', '—', '画面描述或调整指令'],
                  ['metadata.video_url', 'string', '是（video_url 方式）', '—', '输入视频公网 URL'],
                  ['metadata.resolution', 'string', '否', '720p', '480p / 720p / 1080p / 4k'],
                  ['metadata.ratio', 'string', '否', '模型默认', '16:9 / 9:16 / 4:3 / 3:4 / 21:9 / 1:1'],
                ]}
              />
              <ET title={t('请求示例（video_url 方式）')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "prompt": "调整为电影感",
    "metadata": { "resolution": "720p", "ratio": "16:9", "video_url": "https://example.com/input.mp4" }
  }'`}</Code>
              <ET title={t('请求示例（Remix 方式）')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos/video_xxx/remix \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"prompt": "调整为电影感"}'`}</Code>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0,
  "created_at": 1788598144
}`}</Code>
              <P>
                {t('Remix 会创建新任务并返回新的 task_id，原视频不受影响。请求中请勿携带 model，系统沿用原任务的模型与渠道。注意：Remix 并非所有模型都支持；不支持时接口不会报错，但会退化为普通文生视频且不使用原视频，此类场景请改用 metadata.video_url 传入参考视频。')}
              </P>
            </Sub>
            <Sub id='sec-6-4' title={t('6.4 多模态参考')}>
              <Note title={t('多模态参考约定')}>
                <ul className='list-disc space-y-1 pl-5'>
                  <li>{t('单图或单视频可用扁平写法：metadata.image_url（图生视频）、metadata.video_url（视频生视频），详见 6.2、6.3；多图、多视频或多模态混搭请使用 content 数组。')}</li>
                  <li>{t('content 数组内的 type=text 元素可省略：省略时以顶层 prompt 作为提示词，两者均提供时合并为一条。')}</li>
                  <li>{t('参考音频（type=audio_url）不可单独输入，须至少配合 1 张参考图或 1 个参考视频；是否支持以模型为准。')}</li>
                  <li>{t('参考项数量上限由模型规格决定，如 Seedance 2.0 为 9 图 + 3 视频 + 3 音频，Seedance 2.5 为 30 图 + 10 视频 + 10 音频。')}</li>
                </ul>
              </Note>
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '视频模型 ID'],
                  ['prompt', 'string', '否（见说明）', '—', '画面描述；与 content 中 type=text 元素的文本合并为一条提示词，可只写其一'],
                  ['duration', 'integer', '否', '模型默认', '时长（秒）：4–15 的整数；省略或 -1 由模型自动选择'],
                  ['metadata.resolution', 'string', '否', '720p', '480p / 720p / 1080p / 4k'],
                  ['metadata.ratio', 'string', '否', '模型默认', '16:9 / 9:16 / 4:3 / 3:4 / 21:9 / 1:1'],
                  ['content', 'array', '是（二选一）', '—', '多模态参考数组（与 model、prompt 同级）；元素结构见下表'],
                  ['metadata.content', 'array', '是（二选一）', '—', '多模态参考数组（写在 metadata 内），与顶层 content 完全等价'],
                  ['metadata.image_url / metadata.video_url / metadata.audio_url', 'string', '否', '—', '单素材扁平写法（详见 6.2、6.3），会转换为 content 中对应的元素：参考视频与参考音频自动补 role，图片不带 role 时按首帧处理。转换后不再重复下发，与 content 同时存在时同一 URL 仅保留一次'],
                ]}
              />
              <ET title={t('metadata.content 数组元素')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['type', 'string', '是', '—', '元素类型：text / image_url / video_url / audio_url'],
                  ['text', 'string', 'type=text 时必填', '—', '文本提示词；与顶层 prompt 合并为一条（换行拼接，完全重复的只保留一次）'],
                  ['image_url.url', 'string', 'type=image_url 时必填', '—', '参考图公网 URL'],
                  ['video_url.url', 'string', 'type=video_url 时必填', '—', '参考视频公网 URL'],
                  ['audio_url.url', 'string', 'type=audio_url 时必填', '—', '参考音频公网 URL'],
                  ['role', 'string', '可选（见下）', '—', '素材用途；省略时按「写法与参考意图」推断'],
                ]}
              />
              <ET title={t('参考素材的用途（role）')} />
              <P>
                {t('role 用于声明参考素材的用途。显式声明的 role 原样透传，本站不做改写；省略时按下列「写法与参考意图」对应关系推断，其中两张及以上的图片由本站补齐为 reference_image。首帧与尾帧为上游规范定义的角色，如需严格的首帧或首尾帧语义，请显式声明 role（first_frame / last_frame），不要依赖省略时的推断。')}
              </P>
              <T
                headers={['素材类型', 'role 取值', '是否必须声明', '说明']}
                rows={[
                  ['image_url', 'reference_image（参考图）、first_frame（首帧）、last_frame（尾帧）', '单张可省略；多张必须声明', '省略时按「首帧图片」处理（最多 1 张）；两张及以上由本站补齐为 reference_image'],
                  ['video_url', 'reference_video', '必须声明', '参考视频；含真人影像的输入可能被上游内容审核拦截（InputVideoSensitiveContentDetected），任务创建失败且不扣费'],
                  ['audio_url', 'reference_audio', '必须声明', '不可单独输入，须至少配合 1 张参考图或 1 个参考视频；是否支持以模型为准'],
                ]}
              />
              <ET title={t('写法与参考意图的对应关系（省略 role 时按此推断）')} />
              <T
                headers={['写法', '推断出的意图', '说明']}
                rows={[
                  ['content 元素带 role', '原样使用', '显式声明优先，本站不覆盖'],
                  ['content 中省略 role 的图片', '一张=首帧；两张及以上=参考图', '首帧最多 1 张；两张及以上由本站补齐为 reference_image，如需固定语义请显式声明 role'],
                  ['input_reference / image', '首帧图片', 'OpenAI 风格的单图输入字段'],
                  ['images 数组', '一张=首帧；多张=参考图', '同一 URL 仅保留一次'],
                  ['metadata.image_url', '首帧图片', '等价于 content 中一条不带 role 的 image_url，详见 6.2'],
                  ['metadata.video_url', '参考视频', '自动补 role=reference_video，详见 6.3'],
                  ['metadata.audio_url', '参考音频', '自动补 role=reference_audio'],
                ]}
              />
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "duration": 5,
    "content": [
      { "type": "text", "text": "让参考图里的人物按参考视频的动作表演" },
      { "type": "image_url", "image_url": { "url": "https://example.com/char.jpg" }, "role": "reference_image" },
      { "type": "video_url", "video_url": { "url": "https://example.com/motion.mp4" }, "role": "reference_video" },
      { "type": "audio_url", "audio_url": { "url": "https://example.com/bgm.mp3" }, "role": "reference_audio" }
    ],
    "metadata": {
      "resolution": "720p",
      "ratio": "16:9"
    }
  }'`}</Code>
              <P>
                {t('上例将多模态参考数组置于顶层 content。该数组亦可置于 metadata.content，效果一致；两处均提供时合并为同一份素材清单，同一 URL 仅保留一次。')}
              </P>
              <ET title={t('响应示例')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0,
  "created_at": 1788598144
}`}</Code>
            </Sub>
            <Sub id='sec-6-5' title={t('6.5 查询任务状态')}>
              <Endpoint method='GET' path='/v1/videos/{task_id}' />
              <ET title={t('请求示例')} />
              <Code>{`curl https://ghyc.top/v1/videos/<task_id> \\
  -H "Authorization: Bearer sk-..."`}</Code>
              <ET title={t('响应示例（生成中）')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1788598144,
  "metadata": {
    "url": "<成片地址>"
  }
}`}</Code>
              <ET title={t('响应示例（已完成）')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "completed",
  "progress": 100,
  "created_at": 1788598144,
  "completed_at": 1788598270,
  "metadata": {
    "url": "<成片地址>"
  },
  "usage": {
    "completion_tokens": 198458,
    "total_tokens": 198458
  }
}`}</Code>
              <P>
                {t('状态流转：queued → in_progress → completed 或 failed。completed 后 metadata.url 即为成片下载地址。')}
              </P>
              <ET title={t('响应示例（失败）')} />
              <Code>{`HTTP/1.1 200 OK
{
  "id": "<task_id>",
  "task_id": "<task_id>",
  "object": "video",
  "model": "<model-id>",
  "status": "failed",
  "progress": 100,
  "created_at": 1788598144,
  "completed_at": 1788598270,
  "metadata": {
    "url": "<失败原因文本>",
    "fail_reason": "The request failed because the output video may be related to copyright restrictions. Request id: 021789..."
  }
}`}</Code>
              <ET title={t('响应字段')} />
              <T
                headers={['字段', '类型', '说明']}
                rows={[
                  ['id', 'string', '任务 ID（与 task_id 一致）'],
                  ['task_id', 'string', '任务 ID，用于查询、取消与下载'],
                  ['object', 'string', '固定为 video'],
                  ['model', 'string', '本次请求使用的模型'],
                  ['status', 'string', '任务状态：queued / in_progress / completed / failed'],
                  ['progress', 'number', '进度（0–100），completed 时为 100'],
                  ['created_at', 'integer', '任务创建时间戳（秒）'],
                  ['completed_at', 'integer', '任务完成时间戳（秒）；任务未结束时该字段不出现'],
                  ['metadata.url', 'string', '成片地址（completed 后有效），可直接下载，无需鉴权；如需统一走本站内容代理，见 6.7'],
                  ['metadata.last_frame_url', 'string', '尾帧图片地址；仅创建任务时携带 return_last_frame=true 才返回，可作为下一段视频的首帧参考'],
                  ['metadata.fail_reason', 'string', '失败原因；仅 failed 且上游给出原因时返回，例如上游内容审核 OutputVideoSensitiveContentDetected.PolicyViolation'],
                  ['usage', 'object', '实际用量；任务完成并结算后返回，未结算时该字段不出现'],
                  ['usage.completion_tokens', 'integer', '本次生成的 token 用量'],
                  ['usage.total_tokens', 'integer', '本次任务的 token 总用量，视频任务与 completion_tokens 相同'],
                ]}
              />
              <ET title={t('状态说明')} />
              <T
                headers={['status', '说明']}
                rows={[
                  ['queued', '已提交，排队中'],
                  ['in_progress', '生成中，progress 显示进度'],
                  ['completed', '已完成，可取成片'],
                  ['failed', '失败；原因见 metadata.fail_reason，如上游内容审核 OutputVideoSensitiveContentDetected.PolicyViolation。此类失败自动全额退款'],
                ]}
              />
            </Sub>
            <Sub id='sec-6-6' title={t('6.6 取消任务')}>
              <Endpoint method='POST' path='/v1/videos/{task_id}/cancel' />
              <P>{t('取消尚未结束的任务，等价写法为 DELETE /v1/videos/{task_id}（同样接受登录会话鉴权）。')}</P>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/videos/<task_id>/cancel \\
  -H "Authorization: Bearer sk-..."`}</Code>
              <ET title={t('说明')} />
              <P>
                {t('取消成功后任务置为 failed，metadata.fail_reason 为 canceled by user，预扣额度全额退还。任务已结束、渠道未实现取消、上游拒绝取消时返回对应错误（task_already_finished / cancel_not_supported / cancel_rejected_by_upstream），此时任务继续执行，本地状态与额度不变。能否取消取决于上游服务对该任务的支持情况；无法取消时，任务需自行执行至结束。')}
              </P>
            </Sub>
            <Sub id='sec-6-7' title={t('6.7 下载成片')}>
              <Endpoint method='GET' path='/v1/videos/{task_id}/content' />
              <ET title={t('请求示例')} />
              <Code>{`curl -L https://ghyc.top/v1/videos/<task_id>/content \\
  -H "Authorization: Bearer sk-..." \\
  -o output.mp4`}</Code>
              <ET title={t('响应说明')} />
              <P>
                {t('任务完成后返回 video/mp4 二进制内容，未完成时返回错误 JSON。该接口需携带鉴权（登录会话或 Bearer key）。6.5 返回的 metadata.url 已可直接下载，本节适用于希望统一走本站内容代理的调用方。')}
              </P>
            </Sub>
          </Section>

          <Section id='sec-7' title={t('7. 图像生成')}>
            <Endpoint method='POST' path='/v1/images/generations' />
            <Endpoint method='POST' path='/v1/images/edits' />
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '默认值', '说明']}
              rows={[
                ['model', 'string', '是', '—', '图像模型 ID'],
                ['prompt', 'string', '是', '—', '画面描述'],
                ['size', 'string', '否', '模型默认', '尺寸，如 1024x1024、512x512，以模型支持为准'],
                ['n', 'integer', '否', '1', '生成张数'],
                ['quality', 'string', '否', '模型默认', '画质：standard 或 hd，是否支持以模型为准'],
                ['style', 'string', '否', '模型默认', '风格，是否支持以模型为准'],
                ['response_format', 'string', '否', 'url', 'url 或 b64_json'],
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
    { "url": "https://<上游返回的图片地址>",
      "revised_prompt": "a red sunset over the sea" }
  ]
}`}</Code>
            <ET title={t('响应字段')} />
            <T
              headers={['字段', '类型', '说明']}
              rows={[
                ['created', 'integer', '创建时间戳（秒）'],
                ['data[].url', 'string', '生成图片的地址（response_format=url 时）；地址由上游返回，本站不提供静态图片服务'],
                ['data[].b64_json', 'string', '生成图片的 base64（response_format=b64_json 时）'],
                ['data[].revised_prompt', 'string', '模型改写后的提示词'],
              ]}
            />
          </Section>

          <Section id='sec-8' title={t('8. 向量（Embeddings）')}>
            <P>
              {t('将文本转换为向量，用于语义搜索、知识库检索（RAG）、推荐与聚类等场景。')}
            </P>
            <Endpoint method='POST' path='/v1/embeddings' />
            <ET title={t('请求参数')} />
            <T
              headers={['字段', '类型', '必填', '默认值', '说明']}
              rows={[
                ['model', 'string', '是', '—', '向量模型 ID'],
                ['input', 'string/array', '是', '—', '待向量化文本，支持数组批量传入'],
                ['encoding_format', 'string', '否', '上游默认（float）', '向量编码格式：float / base64'],
                ['dimensions', 'integer', '否', '模型默认', '输出向量维度，是否支持以模型为准'],
                ['user', 'string', '否', '—', '调用方标识，用于上游统计与风控'],
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
              headers={['字段', '类型', '说明']}
              rows={[
                ['data[].embedding', 'number[]', '向量数组，维度因模型而异'],
                ['usage.prompt_tokens', 'integer', '输入 token 数（计费依据）'],
              ]}
            />
          </Section>

          <Section id='sec-9' title={t('9. 音频')}>
            <T
              headers={['能力', '接口', '说明']}
              rows={[
                ['语音转写', 'POST /v1/audio/transcriptions', '音频转文本（multipart/form-data）'],
                ['语音翻译', 'POST /v1/audio/translations', '非英语音频转英文文本'],
                ['语音合成（TTS）', 'POST /v1/audio/speech', '文本转语音'],
              ]}
            />
            <ET title={t('请求参数（转写 / 翻译）')} />
            <T
              headers={['字段', '类型', '必填', '默认值', '说明']}
              rows={[
                ['file', 'file', '是', '—', '待转写或翻译的音频文件，以 multipart/form-data 上传'],
                ['model', 'string', '是', '—', '音频模型 ID'],
                ['language', 'string', '否', '自动识别', '音频语言，如 zh、en'],
                ['response_format', 'string', '否', '上游默认（json）', '输出格式：json / text / srt / verbose_json，以模型支持为准'],
                ['temperature', 'number', '否', '上游默认', '采样温度，透传给上游'],
              ]}
            />
            <ET title={t('请求参数（TTS 语音合成）')} />
            <T
              headers={['字段', '类型', '必填', '默认值', '说明']}
              rows={[
                ['model', 'string', '是', '—', 'TTS 模型 ID'],
                ['input', 'string', '是', '—', '待合成的文本'],
                ['voice', 'string', '否', '模型默认', '发音人，如 alloy、echo，以模型支持为准'],
                ['response_format', 'string', '否', '上游默认（mp3）', '输出格式：mp3 / wav / opus / flac / pcm，透传给上游'],
                ['speed', 'number', '否', '1.0', '语速倍率'],
              ]}
            />
            <ET title={t('请求示例（转写）')} />
            <Code>{`curl -X POST https://ghyc.top/v1/audio/transcriptions \\
  -H "Authorization: Bearer sk-..." \\
  -F "model=<model-id>" \\
  -F "file=@audio.mp3"`}</Code>
            <ET title={t('响应说明')} />
            <T
              headers={['能力', '响应']}
              rows={[
                ['转写 / 翻译', 'response_format=json 时返回 { "text": "..." }；verbose_json 返回带分段与时间戳的 JSON。响应体由上游原样返回，字段以模型为准'],
                ['TTS 语音合成', '返回音频二进制，格式由 response_format 决定'],
              ]}
            />
          </Section>

          <Section id='sec-10' title={t('10. 其它兼容接口')}>
            <P>{t('以下为按需提供的兼容接口，对应模型上线后即可使用。')}</P>
            <Sub title={t('10.1 Response API')}>
              <Endpoint method='POST' path='/v1/responses' />
              <Endpoint method='POST' path='/v1/responses/compact' />
              <P>{t('返回结构化响应，支持 reasoning 与 JSON 输出 schema。')}</P>
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '模型 ID'],
                  ['input', 'string/array', '是（compact 接口可省略）', '—', '输入文本或消息数组'],
                  ['instructions', 'string', '否', '—', '系统指令，compact 接口同样支持'],
                  ['previous_response_id', 'string', '否', '—', '压缩时引用的上一条响应，仅 compact 接口使用'],
                  ['max_output_tokens', 'integer', '否', '模型默认', '最大输出 token 数，仅 /v1/responses 支持'],
                  ['stream', 'boolean', '否', 'false', '是否流式返回，compact 接口不支持'],
                ]}
              />
              <P>
                {t('/v1/responses/compact 为压缩接口：仅校验 model，input 可省略，且不支持 max_output_tokens 与流式返回。')}
              </P>
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","input":"who won the world cup in 2018?"}'`}</Code>
            </Sub>
            <Sub title={t('10.2 Claude 兼容（Anthropic）')}>
              <Endpoint method='POST' path='/v1/messages' />
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '模型 ID'],
                  ['max_tokens', 'integer', '是', '—', '最大输出 token 数'],
                  ['messages', 'array', '是', '—', '消息列表，role 取 user / assistant'],
                  ['system', 'string', '否', '—', '系统提示'],
                  ['stream', 'boolean', '否', 'false', '是否流式返回'],
                ]}
              />
              <ET title={t('请求示例')} />
              <Code>{`curl -X POST https://ghyc.top/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model":"<model-id>","max_tokens":1024,"messages":[{"role":"user","content":"你好"}]}'`}</Code>
            </Sub>
            <Sub title={t('10.3 Gemini 兼容')}>
              <Endpoint method='POST' path='/v1beta/models/*path' />
              <Endpoint method='GET' path='/v1beta/models' />
            </Sub>
            <Sub title={t('10.4 重排（Rerank）')}>
              <Endpoint method='POST' path='/v1/rerank' />
              <P>{t('按与查询的相关度对候选文档重排，常用于检索增强。')}</P>
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '是', '—', '重排模型 ID'],
                  ['query', 'string', '是', '—', '查询文本'],
                  ['documents', 'string[]', '是', '—', '候选文档列表'],
                  ['top_n', 'integer', '否', '返回全部', '返回前 N 个结果'],
                ]}
              />
            </Sub>
            <Sub title={t('10.5 内容审核（Moderations）')}>
              <Endpoint method='POST' path='/v1/moderations' />
              <ET title={t('请求参数')} />
              <T
                headers={['字段', '类型', '必填', '默认值', '说明']}
                rows={[
                  ['model', 'string', '否', 'text-moderation-latest', '审核模型 ID，省略时使用默认审核模型'],
                  ['input', 'string/array', '是', '—', '待审核文本，支持数组批量传入'],
                ]}
              />
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
              <P>{t('以上为专用工具接口，需平台开通对应能力后方可使用；具体请求格式请另行咨询。')}</P>
            </Sub>
          </Section>

          <Section id='sec-11' title={t('11. 错误码')}>
            <T
              headers={['code', 'HTTP', '说明', '处理建议']}
              rows={[
                ['model_not_found', '503', '模型不存在或无可用渠道', '查询 /v1/models 确认模型名'],
                ['insufficient_user_quota', '403', '余额不足', '充值或检查额度'],
                ['model_price_error', '400', '模型或参数不受支持', '核对参数与模型能力'],
                ['invalid_seconds', '400', '时长非法（Seedance 系须为 4–15 的整数或 -1）', '按模型规格调整时长'],
                ['invalid_resolution', '400', '分辨率档位不受支持', '改用 720p、1080p 等受支持档位'],
                ['invalid_request', '400', '缺少必填参数（如 prompt、model）', '按参数表补全必填项'],
                ['invalid_api_platform', '400', '调用了不受支持的接口或模型类型', '改用对应能力接口'],
                ['task_not_exist', '400', '任务不存在', '核对 task_id'],
                ['task_already_finished', '400', '任务已结束，不可取消', '等待任务自行结束，或重新创建任务'],
                ['cancel_not_supported', '400', '该模型未实现取消', '等待任务自行结束'],
                ['cancel_rejected_by_upstream', '400', '上游拒绝取消', '等待任务自行结束；持续出现请反馈给平台'],
                ['invalid_response', '500', '上游返回体异常，如无法解析 task_id', '重试；持续出现请把 task_id 反馈给平台'],
              ]}
            />
            <P>
              {t('错误响应结构：对话等接口为 {"error": {"message": "...", "code": "...", "type": "new_api_error"}}，鉴权类错误的 code 可能为空；任务类接口（/v1/videos、/v1/video/generations）为扁平结构 {"code": "...", "message": "...", "data": null}。任务失败的详细原因见 6.5 的 metadata.fail_reason。')}
            </P>
          </Section>
        </div>
      </div>
    </div>
  )
}

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
import type { ReactNode } from 'react'

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className='space-y-3'>
      <h2 className='text-lg font-semibold'>{props.title}</h2>
      {props.children}
    </section>
  )
}

function CodeBlock(props: { children: string }) {
  return (
    <pre className='bg-muted/60 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed'>
      <code>{props.children}</code>
    </pre>
  )
}

function DocTable(props: { headers: string[]; rows: string[][] }) {
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

  return (
    <div className='mx-auto max-w-4xl px-4 py-8'>
      <div className='mb-6 space-y-2'>
        <h1 className='text-2xl font-bold'>{t('平台 API 对接文档')}</h1>
        <p className='text-muted-foreground text-sm'>
          {t('本平台为聚合型 AI 接口网关，对外提供 OpenAI 兼容接口。支持对话、图像、视频、向量、音频等多种模态，各模态对应不同的模型，可用模型请通过查询模型接口获取。')}
        </p>
      </div>

      <div className='space-y-8'>
        <Section title={t('1. 接入信息')}>
          <DocTable
            headers={['项', '值']}
            rows={[
              ['Base URL', 'https://baseadd.vip'],
              ['认证方式', 'HTTP Header Authorization: Bearer <API Key>'],
              ['API Key', '由平台分配'],
              ['Content-Type', 'application/json'],
            ]}
          />
        </Section>

        <Section title={t('2. 鉴权')}>
          <p className='text-xs'>
            {t('所有请求需在请求头携带 API Key：')}
          </p>
          <CodeBlock>{`Authorization: Bearer sk-...`}</CodeBlock>
          <p className='text-xs'>
            {t('API Key 在平台控制台/密钥管理页创建。Key 与调用账号、分组、额度、可用模型强绑定。')}
          </p>
        </Section>

        <Section title={t('3. 查询可用模型')}>
          <p className='text-xs'>
            {t('模型与可用能力动态变化，请始终通过以下接口查询，不要硬编码模型清单。')}
          </p>
          <CodeBlock>{`GET /v1/models`}</CodeBlock>
          <CodeBlock>{`curl "https://baseadd.vip/v1/models" \\
  -H "Authorization: Bearer sk-..."`}</CodeBlock>
          <CodeBlock>{`{
  "data": [
    { "id": "model-id", "object": "model",
      "created": 1626777600, "owned_by": "provider",
      "supported_endpoint_types": ["openai"] }
  ],
  "object": "list"
}`}</CodeBlock>
        </Section>

        <Section title={t('4. 对话')}>
          <p className='text-xs font-medium'>POST /v1/chat/completions</p>
          <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Say hello in one sentence." }
    ],
    "stream": false
  }'`}</CodeBlock>
          <p className='text-xs'>
            {t('响应为 OpenAI Chat Completions 格式，含 choices、usage 等字段。模型 ID 请通过 /v1/models 查询。')}
          </p>
        </Section>

        <Section title={t('5. 视频生成（任务式）')}>
          <p className='text-xs'>
            {t('视频生成是异步任务：提交任务返回 task_id，轮询状态，成功后下载成片。支持文本/图/视频生视频。')}
          </p>
          <p className='text-xs font-medium'>POST /v1/videos</p>
          <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/videos" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "<model-id>",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9", "generate_audio": true }
  }'`}</CodeBlock>
          <CodeBlock>{`{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0
}`}</CodeBlock>
          <p className='text-xs'>
            {t('视频输入能力：metadata.image_url（图生视频）、metadata.video_url（视频生视频）、POST /v1/videos/{id}/remix（视频 Remix）。也提供兼容接口 POST /v1/video/generations。')}
          </p>
          <p className='text-xs font-medium'>GET /v1/videos/&#123;task_id&#125;　·　GET /v1/videos/&#123;task_id&#125;/content</p>
          <CodeBlock>{`curl "https://baseadd.vip/v1/videos/task_xxx" -H "Authorization: Bearer sk-..."
curl -L "https://baseadd.vip/v1/videos/task_xxx/content" -H "Authorization: Bearer sk-..." -o output.mp4`}</CodeBlock>
        </Section>

        <Section title={t('6. 图像生成')}>
          <p className='text-xs font-medium'>POST /v1/images/generations　·　POST /v1/images/edits</p>
          <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/images/generations" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "prompt": "a red sunset over the sea", "size": "1024x1024"}'`}</CodeBlock>
        </Section>

        <Section title={t('7. 向量 Embeddings')}>
          <p className='text-xs font-medium'>POST /v1/embeddings</p>
          <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/embeddings" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "input": "hello"}'`}</CodeBlock>
        </Section>

        <Section title={t('8. 音频')}>
          <p className='text-xs font-medium'>
            POST /v1/audio/transcriptions　·　POST /v1/audio/translations　·　POST /v1/audio/speech
          </p>
          <p className='text-xs'>
            {t('语音转写/翻译/语音合成，模型 ID 请通过 /v1/models 查询。')}
          </p>
        </Section>

        <Section title={t('9. 其它兼容接口')}>
          <DocTable
            headers={['能力', '端点']}
            rows={[
              ['补全', 'POST /v1/completions'],
              ['Responses', 'POST /v1/responses，POST /v1/responses/compact'],
              ['Claude', 'POST /v1/messages'],
              ['Gemini', 'POST /v1beta/models/*path'],
              ['重排', 'POST /v1/rerank'],
              ['审核', 'POST /v1/moderations'],
              ['Midjourney', '/mj/submit/*，/mj/task/*，/mj/image/*'],
              ['Suno(音乐)', '/suno/submit/:action，/suno/fetch'],
              ['实时', '/v1/realtime (WebSocket)'],
            ]}
          />
        </Section>

        <Section title={t('10. 通用约定与错误码')}>
          <p className='text-xs font-medium'>{t('通用约定')}</p>
          <ul className='list-disc space-y-1 pl-5 text-xs'>
            <li>{t('模型 ID 通过 GET /v1/models 查询，随平台上架/下架动态变化。')}</li>
            <li>{t('各接口请求/响应遵循 OpenAI 兼容格式，具体字段以模型为准。')}</li>
            <li>{t('任务式接口（视频等）：创建返回 task_id，轮询状态，成功后下载成片。')}</li>
          </ul>
          <p className='text-xs font-medium'>{t('常见错误码')}</p>
          <DocTable
            headers={['code', '说明']}
            rows={[
              ['model_not_found', '模型不存在或无可用渠道'],
              ['insufficient_user_quota', '余额不足'],
              ['model_price_error', '模型/参数不支持'],
              ['invalid_seconds', '时长非法'],
              ['invalid_api_platform', '调用了不支持的接口/模型类型'],
              ['task_not_exist', '任务不存在'],
            ]}
          />
        </Section>
      </div>
    </div>
  )
}

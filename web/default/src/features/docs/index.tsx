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

function Sub(props: { title: string; children: ReactNode }) {
  return (
    <div className='space-y-2'>
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

  return (
    <div className='mx-auto max-w-4xl px-4 py-8'>
      <div className='mb-8 space-y-2 border-b pb-6'>
        <h1 className='text-2xl font-bold'>{t('平台 API 接口文档')}</h1>
        <p className='text-muted-foreground text-xs'>
          Doc Version: 1.0.0 ｜ 适用平台：聚合型 AI 接口网关 ｜ 接口风格：OpenAI 兼容
        </p>
        <p className='text-muted-foreground text-sm'>
          {t('本平台为聚合型 AI 接口网关，对 OpenAI 兼容接口提供统一转发。支持对话、图像、视频、向量、音频等多模态；不同能力对应不同模型，可用模型请通过查询模型接口获取。')}
        </p>
      </div>

      <div className='space-y-10'>
        <Section title={t('目录')}>
          <T
            headers={['章节', '内容']}
            rows={[
              ['1. 接入与认证', 'Base URL、API Key、请求头'],
              ['2. 快速开始', '最小可运行示例'],
              ['3. 查询可用模型', 'GET /v1/models'],
              ['4. 对话', 'POST /v1/chat/completions'],
              ['5. 视频生成', '创建/查询/下载/图生/视频生/Remix（任务式）'],
              ['6. 图像生成', 'POST /v1/images/generations / edits'],
              ['7. 向量 Embeddings', 'POST /v1/embeddings'],
              ['8. 音频', '转写/翻译/语音合成'],
              ['9. 其它兼容接口', 'Responses/Claude/Gemini/Rerank/审核/MJ/Suno/实时'],
              ['10. 错误码', '错误码与处理建议'],
            ]}
          />
        </Section>

        <Section title={t('1. 接入与认证')}>
          <T
            headers={['项', '值']}
            rows={[
              ['Base URL', 'https://baseadd.vip'],
              ['认证方式', '请求头 Authorization: Bearer <API Key>'],
              ['API Key', '在平台控制台创建，绑定账号/分组/额度/模型'],
              ['Content-Type', 'application/json（音频上传为 multipart/form-data）'],
              ['超时建议', '流式接口无固定超时；任务式接口建议轮询'],
            ]}
          />
        </Section>

        <Section title={t('2. 快速开始')}>
          <p className='text-xs'>
            {t('第 1 步：查询可用模型，取 model id。')}
          </p>
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

        <Section title={t('3. 查询可用模型')}>
          <p className='text-xs'>
            {t('模型与能力动态变化，请始终通过本接口查询，勿硬编码。')}
          </p>
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
                ['data[].supported_endpoint_types', 'string[]', '该模型支持的端点类型（如 openai）'],
                ['object', 'string', '固定 list'],
                ['success', 'boolean', '请求是否成功'],
              ]}
            />
          </Sub>
        </Section>

        <Section title={t('4. 对话')}>
          <p className='text-xs font-medium'>POST /v1/chat/completions</p>
          <Sub title={t('请求参数')}>
            <T
              headers={['字段', '类型', '必填', '说明']}
              rows={[
                ['model', 'string', '是', '模型 ID，来自 /v1/models'],
                ['messages', 'array', '是', '消息列表 [{role, content}, ...]'],
                ['stream', 'boolean', '否', '是否流式返回，默认 false'],
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

        <Section title={t('5. 视频生成（任务式）')}>
          <p className='text-xs'>
            {t('视频生成是异步任务：调用创建接口返回 task_id → 轮询查询接口 → 状态成功后通过内容接口下载成片。')}
          </p>
          <Sub title={t('5.1 创建视频任务（文本生视频）')}>
            <p className='text-xs font-medium'>POST /v1/videos</p>
            <T
              headers={['字段', '类型', '必填', '说明']}
              rows={[
                ['model', 'string', '是', '视频模型 ID'],
                ['prompt', 'string', '是', '画面描述（中文 ≤ 500 字、英文 ≤ 1000 词）'],
                ['duration', 'integer', '否', '时长（秒），不支持 0 与 -1'],
                ['metadata', 'object', '否', '扩展参数，见下表'],
              ]}
            />
            <p className='text-xs font-medium'>{t('metadata 字段')}</p>
            <T
              headers={['字段', '类型', '说明']}
              rows={[
                ['resolution', 'string', '480p/720p/1080p/4k（不支持 2k）'],
                ['ratio', 'string', '16:9/9:16/4:3/3:4/21:9/1:1'],
                ['generate_audio', 'boolean', '是否生成音频，默认 true'],
                ['watermark', 'boolean', '是否带水印'],
                ['seed', 'integer', '随机种子'],
                ['image_url', 'string', '输入图片 URL（图生视频）'],
                ['video_url', 'string', '输入视频 URL（视频生视频）'],
              ]}
            />
            <p className='text-xs font-medium'>{t('请求示例')}</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'`}</Code>
            <p className='text-xs font-medium'>{t('响应示例（真实）')}</p>
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

          <Sub title={t('5.2 图生视频')}>
            <p className='text-xs'>{t('metadata 传 image_url。')}</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "让图片里的猫动起来",
    "metadata": { "resolution": "720p", "ratio": "16:9", "image_url": "https://example.com/cat.jpg" }
  }'`}</Code>
            <p className='text-xs font-medium'>{t('响应示例（真实）')}</p>
            <Code>{`HTTP/1.1 200 OK
{
  "id": "task_rzBa6A4nhqiM8u61oreSYxkcJilyCxMM",
  "task_id": "task_rzBa6A4nhqiM8u61oreSYxkcJilyCxMM",
  "object": "video",
  "model": "seedance2.0-cyai-mini-260615",
  "status": "queued",
  "progress": 0,
  "created_at": 1788491789
}`}</Code>
          </Sub>

          <Sub title={t('5.3 视频生视频 / Remix')}>
            <p className='text-xs'>{t('方式一：metadata 传 video_url。方式二：POST /v1/videos/{video_id}/remix。')}</p>
            <Code>{`curl -X POST https://baseadd.vip/v1/videos \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-mini-260615",
    "prompt": "调整为电影感",
    "metadata": { "resolution": "720p", "ratio": "16:9", "video_url": "https://example.com/input.mp4" }
  }'`}</Code>
          </Sub>

          <Sub title={t('5.4 查询任务状态')}>
            <p className='text-xs font-medium'>GET /v1/videos/&#123;task_id&#125;</p>
            <Code>{`curl https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM \\
  -H "Authorization: Bearer sk-..."`}</Code>
            <p className='text-xs font-medium'>{t('响应示例（真实：生成中）')}</p>
            <Code>{`HTTP/1.1 200 OK
{
  "id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "task_id": "task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM",
  "object": "video",
  "model": "seedance2.0-cyai-mini-260615",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1788491705,
  "completed_at": 1788491754,
  "metadata": { "url": "https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content" }
}`}</Code>
            <p className='text-xs'>
              {t('状态流转：queued → in_progress → completed / failed。completed 后 metadata.url 即为成片地址；也可用 GET /v1/videos/{task_id}/content 下载。兼容接口 GET /v1/video/generations/{task_id} 返回 new-api TaskResponse 格式（code/data.status/progress）。')}
            </p>
          </Sub>

          <Sub title={t('5.5 下载成片')}>
            <p className='text-xs font-medium'>GET /v1/videos/&#123;task_id&#125;/content</p>
            <Code>{`curl -L https://baseadd.vip/v1/videos/task_DcQojxDoxtbGsJ0BL4UIV3KhiziDttIM/content \\
  -H "Authorization: Bearer sk-..." \\
  -o output.mp4`}</Code>
            <p className='text-xs'>{t('返回 video/mp4 二进制内容；任务未完成时返回错误 JSON。')}</p>
          </Sub>
        </Section>

        <Section title={t('6. 图像生成')}>
          <p className='text-xs font-medium'>POST /v1/images/generations　·　POST /v1/images/edits</p>
          <p className='text-xs'>{t('OpenAI Images 兼容格式。模型 ID 通过 /v1/models 查询（图像模型上线后可用）。')}</p>
          <Code>{`curl -X POST https://baseadd.vip/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "prompt": "a red sunset over the sea", "size": "1024x1024", "n": 1}'`}</Code>
        </Section>

        <Section title={t('7. 向量 Embeddings')}>
          <p className='text-xs font-medium'>POST /v1/embeddings</p>
          <Code>{`curl -X POST https://baseadd.vip/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{"model": "<model-id>", "input": "hello world"}'`}</Code>
        </Section>

        <Section title={t('8. 音频')}>
          <p className='text-xs font-medium'>
            POST /v1/audio/transcriptions　·　POST /v1/audio/translations　·　POST /v1/audio/speech
          </p>
          <p className='text-xs'>{t('语音转写/翻译/合成（TTS），模型 ID 通过 /v1/models 查询（音频模型上线后可用）。')}</p>
        </Section>

        <Section title={t('9. 其它兼容接口')}>
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

        <Section title={t('10. 错误码')}>
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
  )
}

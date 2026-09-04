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

function SubSection(props: { title: string; children: ReactNode }) {
  return (
    <div className='space-y-2'>
      <h3 className='text-sm font-semibold'>{props.title}</h3>
      {props.children}
    </div>
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
        <h1 className='text-2xl font-bold'>{t('Seedance 视频生成 API 对接文档')}</h1>
        <p className='text-muted-foreground text-sm'>
          {t('本文档说明如何通过本平台调用 Seedance 系列模型生成视频，涵盖文本生视频、图生视频、视频生视频、视频 Remix、任务查询与成片下载。')}
        </p>
      </div>

      <div className='space-y-8'>
        <Section title={t('1. 接入信息')}>
          <DocTable
            headers={['项', '值']}
            rows={[
              ['Base URL', 'https://baseadd.vip'],
              ['认证方式', 'Authorization: Bearer <API Key>'],
              ['API Key', 'sk-...（由平台分配）'],
              ['Content-Type', 'application/json'],
            ]}
          />
        </Section>

        <Section title={t('2. 可用模型')}>
          <DocTable
            headers={['模型 ID', '说明']}
            rows={[
              ['seedance2.0-cyai-25-260628', '高版本'],
              ['seedance2.0-cyai-260128', '标准版'],
              ['seedance2.0-cyai-fast-260128', '快速版'],
              ['seedance2.0-cyai-mini-260615', '轻量版'],
            ]}
          />
          <SubSection title={t('查询可用模型')}>
            <CodeBlock>{`GET /v1/models`}</CodeBlock>
            <CodeBlock>{`curl "https://baseadd.vip/v1/models" \\
  -H "Authorization: Bearer sk-..."`}</CodeBlock>
            <CodeBlock>{`{
  "data": [
    { "id": "seedance2.0-cyai-25-260628", "object": "model",
      "created": 1626777600, "owned_by": "cyai seedance",
      "supported_endpoint_types": ["openai"] }
  ],
  "object": "list"
}`}</CodeBlock>
          </SubSection>
        </Section>

        <Section title={t('3. 视频生成任务')}>
          <SubSection title={t('3.1 创建视频任务')}>
            <p className='text-xs font-medium'>POST /v1/videos</p>
            <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/videos" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "一只猫在草地上奔跑，电影感，镜头缓慢推进",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9", "generate_audio": true }
  }'`}</CodeBlock>
            <CodeBlock>{`{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "seedance2.0-cyai-25-260628",
  "status": "queued",
  "progress": 0
}`}</CodeBlock>
            <p className='text-xs'>
              {t('也可使用兼容接口 POST /v1/video/generations，请求参数一致。')}
            </p>
          </SubSection>

          <SubSection title={t('3.2 图生视频')}>
            <p className='text-xs'>
              {t('在 metadata 传入 image_url（或 content 数组含 image_url），即可基于图片生成视频。')}
            </p>
            <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/videos" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "让图片里的人物自然挥手",
    "metadata": {
      "resolution": "720p",
      "ratio": "16:9",
      "image_url": "https://example.com/input.jpg"
    }
  }'`}</CodeBlock>
          </SubSection>

          <SubSection title={t('3.3 视频生视频')}>
            <p className='text-xs'>
              {t('在 metadata 传入 video_url，即可基于已有视频生成新视频。')}
            </p>
            <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/videos" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "调整为电影感，延长 5 秒",
    "metadata": {
      "resolution": "720p",
      "ratio": "16:9",
      "video_url": "https://example.com/input.mp4"
    }
  }'`}</CodeBlock>
          </SubSection>

          <SubSection title={t('3.4 视频 Remix')}>
            <p className='text-xs'>
              {t('基于已有视频创建 Remix 任务，通过路径传入视频 id。')}
            </p>
            <CodeBlock>{`curl -X POST "https://baseadd.vip/v1/videos/video_xxx/remix" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-..." \\
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "调整为电影感"
  }'`}</CodeBlock>
          </SubSection>
        </Section>

        <Section title={t('4. 查询任务状态')}>
          <p className='text-xs font-medium'>GET /v1/videos/&#123;task_id&#125;</p>
          <CodeBlock>{`curl "https://baseadd.vip/v1/videos/task_xxx" \\
  -H "Authorization: Bearer sk-..."`}</CodeBlock>
          <p className='text-xs'>
            {t('状态流转：QUEUED → IN_PROGRESS → SUCCESS / FAILURE。SUCCESS 后可从 result_url 获取成片。')}
          </p>
        </Section>

        <Section title={t('5. 下载成片')}>
          <p className='text-xs font-medium'>GET /v1/videos/&#123;task_id&#125;/content</p>
          <CodeBlock>{`curl -L "https://baseadd.vip/v1/videos/task_xxx/content" \\
  -H "Authorization: Bearer sk-..." \\
  -o output.mp4`}</CodeBlock>
        </Section>

        <Section title={t('6. 请求参数说明')}>
          <DocTable
            headers={['字段', '类型', '必填', '说明']}
            rows={[
              ['model', 'string', '是', '模型 ID'],
              ['prompt', 'string', '是', '画面描述（中文 ≤ 500 字、英文 ≤ 1000 词）'],
              ['duration', 'integer', '否', '时长（秒），不支持 0 与 -1（自动）'],
              ['metadata', 'object', '否', '扩展参数，见下表'],
            ]}
          />
          <p className='text-xs font-medium'>{t('metadata 扩展参数')}</p>
          <DocTable
            headers={['字段', '类型', '说明']}
            rows={[
              ['resolution', 'string', '480p/720p/1080p/4k（不支持 2k）'],
              ['ratio', 'string', '16:9/9:16/4:3/3:4/21:9/1:1'],
              ['generate_audio', 'boolean', '是否生成音频，默认 true'],
              ['watermark', 'boolean', '是否带水印，默认 false'],
              ['seed', 'integer', '随机种子，留空为随机'],
              ['image_url', 'string', '输入图片 URL（图生视频）'],
              ['video_url', 'string', '输入视频 URL（视频生视频）'],
            ]}
          />
        </Section>

        <Section title={t('7. 常见错误码')}>
          <DocTable
            headers={['code', '说明']}
            rows={[
              ['model_price_error', '模型/参数不支持（如 2k、用 chat 调视频模型）'],
              ['invalid_seconds', '时长非法（-1、超范围）'],
              ['insufficient_user_quota', '余额不足'],
              ['model_not_found', '模型不存在或无可用渠道'],
              ['invalid_api_platform', '调用了不支持的接口/模型类型'],
              ['task_not_exist', '任务不存在（如 Remix 传入的视频 id 无效）'],
            ]}
          />
        </Section>

        <Section title={t('8. 注意事项')}>
          <ul className='list-disc space-y-1 pl-5 text-xs'>
            <li>{t('只能用视频接口，不能用 /v1/chat/completions 做对话。')}</li>
            <li>{t('时长传固定秒数（4–15），不要传 -1（自动）。')}</li>
            <li>{t('清晰度不要传 2k，用 480p/720p/1080p/4k。')}</li>
            <li>{t('视频是异步任务：创建 → 轮询 → 下载成片，建议每 3–5 秒轮询一次。')}</li>
            <li>{t('图生视频/视频生视频需传入公网可访问的图片/视频 URL。')}</li>
            <li>{t('视频按时长、清晰度预扣费，余额不足会 insufficient_user_quota。')}</li>
          </ul>
        </Section>
      </div>
    </div>
  )
}

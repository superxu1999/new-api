# 平台 API 对接文档

> 本平台为聚合型 AI 接口网关，对外提供 OpenAI 兼容接口。支持对话、图像、视频、向量、音频等多种模态，各模态对应不同模型，可用模型请通过查询模型接口获取。

## 1. 接入信息

| 项 | 值 |
| --- | --- |
| **Base URL** | `https://baseadd.vip` |
| **认证方式** | HTTP Header `Authorization: Bearer <API Key>` |
| **API Key** | 由平台分配 |
| **Content-Type** | `application/json` |

## 2. 鉴权

所有请求需在请求头携带 API Key：

```
Authorization: Bearer sk-...
```

API Key 在平台控制台/密钥管理页创建，与调用账号、分组、额度、可用模型强绑定。

## 3. 查询可用模型

模型与可用能力动态变化，请始终通过以下接口查询，不要硬编码模型清单。

```
GET /v1/models
```

```bash
curl "https://baseadd.vip/v1/models" \
  -H "Authorization: Bearer sk-..."
```

```json
{
  "data": [
    {
      "id": "model-id",
      "object": "model",
      "created": 1626777600,
      "owned_by": "provider",
      "supported_endpoint_types": ["openai"]
    }
  ],
  "object": "list"
}
```

## 4. 对话

```
POST /v1/chat/completions
```

```bash
curl -X POST "https://baseadd.vip/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "<model-id>",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Say hello in one sentence." }
    ],
    "stream": false
  }'
```

响应为 OpenAI Chat Completions 格式，含 `choices`、`usage` 等字段。模型 ID 请通过 `/v1/models` 查询。

## 5. 视频生成（任务式）

视频生成是异步任务：提交任务返回 `task_id`，轮询状态，成功后下载成片。支持文本/图/视频生视频。

```
POST /v1/videos
```

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "<model-id>",
    "prompt": "一只猫在草地上奔跑",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9", "generate_audio": true }
  }'
```

```json
{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "<model-id>",
  "status": "queued",
  "progress": 0
}
```

视频输入能力：`metadata.image_url`（图生视频）、`metadata.video_url`（视频生视频）、`POST /v1/videos/{id}/remix`（视频 Remix）。也提供兼容接口 `POST /v1/video/generations`。

```
GET /v1/videos/{task_id}        查询任务状态
GET /v1/videos/{task_id}/content 下载成片
```

```bash
curl "https://baseadd.vip/v1/videos/task_xxx" -H "Authorization: Bearer sk-..."
curl -L "https://baseadd.vip/v1/videos/task_xxx/content" -H "Authorization: Bearer sk-..." -o output.mp4
```

## 6. 图像生成

```
POST /v1/images/generations
POST /v1/images/edits
```

```bash
curl -X POST "https://baseadd.vip/v1/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{"model": "<model-id>", "prompt": "a red sunset over the sea", "size": "1024x1024"}'
```

## 7. 向量 Embeddings

```
POST /v1/embeddings
```

```bash
curl -X POST "https://baseadd.vip/v1/embeddings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{"model": "<model-id>", "input": "hello"}'
```

## 8. 音频

```
POST /v1/audio/transcriptions  语音转写
POST /v1/audio/translations    语音翻译
POST /v1/audio/speech          语音合成（TTS）
```

模型 ID 请通过 `/v1/models` 查询。

## 9. 其它兼容接口

| 能力 | 端点 |
| --- | --- |
| 补全 | `POST /v1/completions` |
| Responses | `POST /v1/responses`，`POST /v1/responses/compact` |
| Claude | `POST /v1/messages` |
| Gemini | `POST /v1beta/models/*path` |
| 重排 | `POST /v1/rerank` |
| 审核 | `POST /v1/moderations` |
| Midjourney | `/mj/submit/*`，`/mj/task/*`，`/mj/image/*` |
| Suno（音乐） | `/suno/submit/:action`，`/suno/fetch` |
| 实时 | `/v1/realtime`（WebSocket） |

## 10. 通用约定与错误码

### 通用约定

1. 模型 ID 通过 `GET /v1/models` 查询，随平台上架/下架动态变化。
2. 各接口请求/响应遵循 OpenAI 兼容格式，具体字段以模型为准。
3. 任务式接口（视频等）：创建返回 `task_id`，轮询状态，成功后下载成片。

### 常见错误码

| code | 说明 |
| --- | --- |
| `model_not_found` | 模型不存在或无可用渠道 |
| `insufficient_user_quota` | 余额不足 |
| `model_price_error` | 模型/参数不支持 |
| `invalid_seconds` | 时长非法 |
| `invalid_api_platform` | 调用了不支持的接口/模型类型 |
| `task_not_exist` | 任务不存在 |

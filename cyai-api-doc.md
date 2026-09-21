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
  "progress": 0,
  "created_at": 1788598144
}
```

视频输入能力：`metadata.image_url`（图生视频）、`metadata.video_url`（视频生视频）、多模态参考数组（见 5.1）。也提供兼容接口 `POST /v1/video/generations`。

### 5.1 参考素材（参考图 / 参考视频 / 参考音频）

多模态参考用 `content` 数组表达。**数组放在顶层（火山方舟官方写法）或 `metadata.content` 里都可以**，两处都写会合并成一份（同一个 URL 只保留一次）：

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "<model-id>",
    "prompt": "让参考图里的人物按参考视频的动作表演",
    "duration": 5,
    "content": [
      { "type": "image_url", "image_url": { "url": "https://example.com/char.jpg" }, "role": "reference_image" },
      { "type": "video_url", "video_url": { "url": "https://example.com/motion.mp4" }, "role": "reference_video" },
      { "type": "audio_url", "audio_url": { "url": "https://example.com/bgm.mp3" }, "role": "reference_audio" }
    ],
    "metadata": { "resolution": "720p", "ratio": "16:9" }
  }'
```

- `type`：`text` / `image_url` / `video_url` / `audio_url`；素材 URL 放在与 `type` 同名的对象里（如 `image_url.url`）。
- `role`：表达素材用途（意图），取值 `reference_image` / `reference_video` / `reference_audio`。视频与音频**必须**带 `role`；图片只有**多图**参考必须带（单张不写即按首帧图片）。
- 数组里的 `type=text` 可省：省略时用顶层 `prompt` 作为提示词（两者都写会合并成一条，不会丢其中一处）。
- 参考音频不能单独输入，至少要配 1 张参考图或 1 个参考视频（上游约束，本站不做校验）。
- `duration` 省略或填 `-1` 时，本站不向上游传时长、由上游按默认时长处理（本渠道默认 5 秒）；`metadata.resolution` 省略或为空时按 `720p` 处理。
- 视频 Remix（`POST /v1/videos/{id}/remix`）目前仅部分渠道支持，本渠道请用 `metadata.video_url`（或 5.1 的 `content` 数组）传参考视频。

没写 `role` 时按写法自动判断意图（**你自己写了 `role` 就一定按你写的来**）：

| 你的写法 | 会被当作 |
| --- | --- |
| `content` 里带 `role` 的元素 | 按 `role` 原样使用 |
| `content` 里不带 `role` 的图片 | 一张 = 首帧图片；两张及以上 = 参考图 |
| `input_reference` / `image` | 首帧图片 |
| `images` 数组 | 一张 = 首帧图片；多张 = 参考图 |
| `metadata.image_url` | 首帧图片 |
| `metadata.video_url` | 参考视频 |
| `metadata.audio_url` | 参考音频 |

> 注意：中转渠道会把不带 `role` 的图片自行补成 `reference_image`，因此**严格的首帧语义请走火山原生直连渠道**。

视频分辨率/比例/水印/种子等参数既可以写在顶层（`resolution`、`ratio`、`watermark`、`seed`、`camera_fixed`、`generate_audio`），也可以写进 `metadata`；两处都写时以 `metadata` 为准。

### 5.2 续拍（用上一段的尾帧继续生成）

创建任务时带 `return_last_frame: true`，任务完成后查询结果里的 `metadata.last_frame_url` 就是这一段的尾帧图片地址，把它当作下一段的首帧参考即可续接：

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "<model-id>",
    "prompt": "镜头推进，她抬头看向雨幕",
    "duration": 5,
    "return_last_frame": true,
    "input_reference": "<上一段的 metadata.last_frame_url>"
  }'
```

### 5.3 失败原因与退款

任务失败时查询结果里的 `metadata.fail_reason` 是上游返回的真实原因（例如上游内容审核提示输出视频涉及版权限制）。**这类失败会自动全额退款**预扣额度，无需人工申请。

```
GET /v1/videos/{task_id}        查询任务状态
GET /v1/videos/{task_id}/content 下载成片
```

```bash
curl "https://baseadd.vip/v1/videos/task_xxx" -H "Authorization: Bearer sk-..."
curl -L "https://baseadd.vip/v1/videos/task_xxx/content" -H "Authorization: Bearer sk-..." -o output.mp4
```

`status` 取值：`queued`（排队中）→ `in_progress`（生成中）→ `completed`（可取成片，`metadata.url` 即成片地址）/ `failed`（失败，看 `metadata.fail_reason`）。未完成时不会返回 `completed_at`。

### 5.4 取消任务

尚未结束的任务可以取消（等价写法 `DELETE /v1/videos/{task_id}`）：

```bash
curl -X POST "https://baseadd.vip/v1/videos/task_xxx/cancel" -H "Authorization: Bearer sk-..."
```

- 取消成功：任务变为 `failed`、`metadata.fail_reason` 为 `canceled by user`，并**全额退还**预扣额度。
- 任务已结束、上游不支持取消、或上游拒绝取消时返回错误（错误信息内含上游原文），此时本地状态与额度**不变**。
- 当前限制：本平台的取消请求会转发到上游，而 CyAI 渠道在「取消运行中任务」这一步会返回其内部调用的 401（其上游 Key 暂无取消权限），因此对**正在生成**的任务目前取消不会生效，需等任务自行结束；我们正在推动上游开放该权限。（对**已结束**的任务，CyAI 会直接删除该任务记录，因此本平台不允许对已结束任务发起取消，会返回 `task_already_finished`。）

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
| `invalid_seconds` | 时长非法（4–15 秒的整数，或 -1 由模型自动选择） |
| `invalid_resolution` | 分辨率档位不支持该渠道 |
| `invalid_api_platform` | 调用了不支持的接口/模型类型 |
| `task_not_exist` | 任务不存在 |

> 注意：**不认识的请求字段会被忽略而不是报错**。参考素材请按第 5.1 节写在顶层 `content` 或 `metadata.content` 里；写在其它位置（如自造的字段名）不会生效。任务失败的具体原因看 `metadata.fail_reason`（见 5.3）。

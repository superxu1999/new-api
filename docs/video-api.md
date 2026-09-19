# Video Generation API

## Overview

new-api 支持通过 OpenAI 兼容格式统一调用多种视频生成模型。当前支持的视频渠道：

| 渠道 | 适配模型 | API 格式 |
|------|---------|---------|
| Sora (OpenAI) | `sora-2`, `sora-2-pro` | OpenAI 兼容 (`POST /v1/videos`) |
| Veo | `veo-3.0-*`, `veo-3.1-*` | OpenAI 兼容 |
| Seedance (proxy) | `doubao-seedance-*` 系列 | OpenAI 兼容 JSON |
| Doubao Video | `doubao-seedance-*` 系列 (火山引擎直连) | 火山引擎格式 |
| Kling | `kling-*` 系列 | Kling 原生格式 |
| Jimeng | 火山引擎视觉模型 | Jimeng 原生格式 |
| MiniMax (Hailuo) | `hailuo-*` 系列 | OpenAI 兼容 JSON |
| Vidu | `vidu-*` 系列 | Vidu 原生格式 |
| Ali (通义万相) | `ali-video-*` 系列 | 阿里格式 |
| Gemini | `gemini-*-video` | Gemini 原生格式 |
| Vertex AI | `vertex-*-video` | Vertex 原生格式 |

---

## Authentication

所有 API 请求使用 Bearer Token 认证：

```
Authorization: Bearer <your-api-key>
```

API Key 需在后台「令牌」页面创建，并分配到有对应模型权限的分组。

---

## 通用 API（OpenAI 兼容格式）

适用于：**Sora、Veo、Seedance、Doubao Video、MiniMax (Hailuo)、Vidu**

### 提交视频生成任务

```bash
POST /v1/video/generations
POST /v1/videos
Content-Type: application/json
```

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名称，如 `doubao-seedance-2-0-260128` |
| `prompt` | string | ✅ | 视频内容描述。也可省略：会与 `content` 内 `type=text` 元素合并成一条提示词，两处都写不会丢其中一处 |
| `content` | array | | 多模态参考数组（火山方舟官方写法，与 `model` 同级）：参考图/视频/音频。与 `metadata.content` 完全等价，见「多模态参考」 |
| `seconds` | int | | 视频时长（秒），默认 4，最大 3600 |
| `size` | string | | 分辨率，如 `"1920x1080"`、`"1080x1920"` |
| `ratio` | string | | 画面比例，如 `"16:9"`、`"9:16"`、`"1:1"` |
| `resolution` | string | | 分辨率档位（doubao 专用），如 `"1080p"`、`"4k"` |
| `images` | string[] | | 参考图 URL 列表：**一张按首帧图片，两张及以上按参考图**（首帧最多 1 张） |
| `image` | string | | 单张参考图 URL（按首帧图片） |
| `input_reference` | string | | 参考文件 URL（OpenAI 格式，按首帧图片） |
| `duration` | int | | 同 `seconds`，部分渠道使用 |
| `watermark` | bool | | 是否添加水印 |
| `seed` | int | | 随机种子 |
| `camera_fixed` | bool | | 是否固定镜头 |
| `generate_audio` | bool | | 是否生成配乐 |
| `return_last_frame` | bool | | 是否额外返回尾帧图，用于续拍（见「续拍」） |
| `mode` | string | | 生成模式（渠道特定） |
| `callback_url` | string | | 异步回调地址（渠道特定） |
| `metadata` | object | | 透传给渠道适配器的额外参数 |

> 表里的 `resolution` / `ratio` / `watermark` / `seed` / `camera_fixed` / `generate_audio` / `return_last_frame` 和 `content` 都可以写在顶层（火山方舟官方写法），也可以写进 `metadata`；两处都写时以 `metadata` 内的值为准。

##### metadata 扩展参数

部分渠道支持通过 `metadata` 传递额外参数，支持以下字段（与顶层字段同名时优先使用 metadata 内的值）：

- `ratio`
- `resolution`
- `duration`
- `seed`
- `camera_fixed`
- `watermark`
- `generate_audio`
- `return_last_frame`
- `service_tier`
- `priority`
- `frames`
- `image_url`（图生视频，按首帧图片）/ `video_url`（视频生视频，参考视频）/ `audio_url`（参考音频）：单素材扁平写法

##### 多模态参考（content 数组）

参考图/视频/音频用 `content` 数组表达，数组放顶层（火山方舟官方写法）或 `metadata.content` 里都可以，两处都写会合并成一份（同一个 URL 只保留一次）：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    { "type": "text", "text": "让参考图里的人物按参考视频的动作表演" },
    { "type": "image_url", "image_url": { "url": "https://example.com/char.jpg" }, "role": "reference_image" },
    { "type": "video_url", "video_url": { "url": "https://example.com/motion.mp4" }, "role": "reference_video" },
    { "type": "audio_url", "audio_url": { "url": "https://example.com/bgm.mp3" }, "role": "reference_audio" }
  ]
}
```

`type` 取值：`text` / `image_url` / `video_url` / `audio_url`；参考素材的 URL 放在与 `type` 同名的对象里（如 `image_url.url`）。`role` 表达的是素材用途（意图），取值 `reference_image` / `reference_video` / `reference_audio`：视频与音频必须显式写，图片只有多图参考必须写（单图不写即按首帧图片）。

没写 `role` 时按写法推断意图（**显式写的 `role` 永远不会被覆盖**）：

| 写法 | 推断出的意图 |
|------|-------------|
| `content` 元素带 `role` | 原样使用 |
| `content` 里不带 `role` 的图片 | 一张 = 首帧图片；两张及以上 = 参考图（自动补 `reference_image`） |
| `input_reference` / `image` | 首帧图片 |
| `images` 数组 | 一张 = 首帧图片；多张 = 参考图 |
| `metadata.image_url` | 首帧图片 |
| `metadata.video_url` | `reference_video` |
| `metadata.audio_url` | `reference_audio` |

> 中转渠道（如 CyAI）会把不带 `role` 的图片自行补成 `reference_image`；需要严格的首帧语义请走火山原生直连渠道。

#### 响应格式

```json
{
  "id": "task_xxxxxxxxxxxx",
  "task_id": "task_xxxxxxxxxxxx",
  "object": "video",
  "status": "queued",
  "progress": 0,
  "created_at": 1712345678,
  "model": "doubao-seedance-2-0-260128"
}
```

| 字段 | 说明 |
|------|------|
| `id` | 公共任务 ID，用于后续轮询和下载 |
| `task_id` | 同 `id` |
| `object` | 固定为 `video` |
| `model` | 本次请求使用的模型 |
| `status` | 刚提交时为 `queued`，完整取值见「状态取值」 |
| `progress` | 进度（0-100 的数字） |
| `created_at` | 任务创建时间戳（秒） |

#### 示例：提交文本生视频

```bash
curl https://your-server.com/v1/video/generations \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "日落时分的海边，波浪轻轻拍打沙滩",
    "seconds": 5,
    "ratio": "16:9"
  }'
```

#### 示例：提交图生视频

```bash
curl https://your-server.com/v1/video/generations \
  -H "Authorization: Bearer sk-xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-2-0-260128",
    "prompt": "太阳缓缓升起，海面泛起金色光芒",
    "seconds": 5,
    "ratio": "16:9",
    "images": ["https://example.com/sunrise.jpg"]
  }'
```

### 查询任务状态

```bash
GET /v1/video/generations/:task_id
GET /v1/videos/:task_id
```

#### 响应格式（进行中）

```json
{
  "id": "task_xxxxxxxxxxxx",
  "task_id": "task_xxxxxxxxxxxx",
  "status": "in_progress",
  "progress": 50,
  "created_at": 1712345678,
  "model": "doubao-seedance-2-0-260128",
  "metadata": {}
}
```

未完成时**不返回** `completed_at`。

#### 响应格式（已完成）

```json
{
  "id": "task_xxxxxxxxxxxx",
  "task_id": "task_xxxxxxxxxxxx",
  "status": "completed",
  "progress": 100,
  "created_at": 1712345678,
  "completed_at": 1712345800,
  "model": "doubao-seedance-2-0-260128",
  "metadata": {
    "url": "https://your-server.com/v1/videos/task_xxxxxxxxxxxx/content",
    "last_frame_url": "https://.../last-frame.png"
  },
  "usage": {
    "completion_tokens": 108000,
    "total_tokens": 108000
  }
}
```

`metadata.last_frame_url` 仅在创建任务时带 `return_last_frame=true` 才有；`usage` 在结算完成后才出现。

#### 响应格式（失败）

```json
{
  "id": "task_xxxxxxxxxxxx",
  "task_id": "task_xxxxxxxxxxxx",
  "status": "failed",
  "progress": 100,
  "created_at": 1712345678,
  "completed_at": 1712345800,
  "model": "doubao-seedance-2-0-260128",
  "metadata": {
    "fail_reason": "The request failed because the output video may be related to copyright restrictions. Request id: 021789..."
  }
}
```

`metadata.fail_reason` 是上游返回的真实失败原因（如上游内容审核）。任务失败会**自动全额退款**预扣额度。

#### 状态取值

| 查询接口 | `status` 取值 |
|---------|--------------|
| `GET /v1/videos/:task_id`（OpenAI 格式） | `queued` / `in_progress` / `completed` / `failed` |
| `GET /v1/video/generations/:task_id`（原生格式） | 内部枚举：`NOT_START` / `SUBMITTED` / `QUEUED` / `IN_PROGRESS` / `SUCCESS` / `FAILURE` |

原生格式把任务包在 `{"code":"success","message":"","data":{...}}` 里，字段为 `data.task_id` / `data.status` / `data.fail_reason` / `data.result_url` / `data.last_frame_url` / `data.usage`；其中 `data.data` 是上游的原始响应（排障用）。

### 下载视频

```bash
GET /v1/videos/:task_id/content
```

认证方式：API Key（Bearer Token）或会话 Cookie（后台登录后）

返回：视频二进制流（`Content-Type: video/mp4`）

```bash
curl https://your-server.com/v1/videos/task_xxxxxxxxxxxx/content \
  -H "Authorization: Bearer sk-xxxx" \
  -o output.mp4
```

> **注意**：Seedance 渠道的视频需要经过 seedance-proxy 的 `/download` 端点进行 RSA 解密后返回，此过程对用户透明。

### 重新生成 (Remix)

```bash
POST /v1/videos/:video_id/remix
Content-Type: application/json
```

基于已有视频任务重新生成，复用原始任务的模型和参数。

```json
{
  "prompt": "新的视频描述"
}
```

### 续拍（尾帧图）

创建任务时带 `return_last_frame=true`，任务完成后响应里的 `metadata.last_frame_url` 就是这一段的**尾帧图片地址**，把它作为下一段的首帧参考（`images` / `image` / `input_reference`，或 `content` 里一条不带 `role` 的 `image_url`）即可续接。

```bash
# 1) 第一段：请求尾帧
curl https://your-server.com/v1/videos \
  -H "Authorization: Bearer sk-xxxx" -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedance-2-0-260128","prompt":"林晚站在便利店屋檐下","seconds":5,"return_last_frame":true}'

# 2) 轮询拿到 metadata.last_frame_url 后，用它作为下一段首帧
curl https://your-server.com/v1/videos \
  -H "Authorization: Bearer sk-xxxx" -H "Content-Type: application/json" \
  -d '{"model":"doubao-seedance-2-0-260128","prompt":"镜头推进，她抬头看向雨幕","seconds":5,"input_reference":"<上一步的 last_frame_url>"}'
```

> 尾帧图地址是上游的带签名直链（有效期有限），建议拿到后立即使用或转存。

---

## Kling 原生 API 格式

Kling 渠道使用 Kling 官方 API 格式，通过 `kling/v1` 前缀访问。

### 文本生视频

```bash
POST /kling/v1/videos/text2video
Content-Type: application/json

{
  "model": "kling-1.6",
  "prompt": "一只猫在弹钢琴"
}
```

### 图生视频

```bash
POST /kling/v1/videos/image2video
Content-Type: application/json

{
  "model": "kling-1.6",
  "prompt": "猫咪站起来鞠躬",
  "image": "https://example.com/cat.jpg"
}
```

### 查询任务

```bash
GET /kling/v1/videos/text2video/:task_id
GET /kling/v1/videos/image2video/:task_id
```

---

## Jimeng 原生 API 格式

Jimeng 渠道使用火山引擎 Jimeng API 格式。

```bash
POST /jimeng/
Content-Type: application/json

{
  "Action": "CVSync2AsyncSubmitTask",
  "Version": "2022-08-31",
  "ModelType": "jimeng-video",
  "Input": {
    "prompt": "赛博朋克城市夜景"
  }
}
```

查询结果：

```bash
GET /jimeng/?Action=CVSync2AsyncGetResult&TaskId=xxx
```

---

## Sora / OpenAI 视频 API

Sora 渠道兼容 OpenAI 视频 API 格式（multipart/form-data）。

```bash
POST /v1/videos
Authorization: Bearer sk-xxxx
Content-Type: multipart/form-data

-F "model=sora-2"
-F "prompt=A calico cat playing piano on stage"
-F "input_reference=@image.jpg"
```

---

## 状态轮询建议

建议采用指数退避策略轮询任务状态：

| 等待时间 | 推荐间隔 |
|---------|---------|
| 0-30 秒 | 每 2 秒 |
| 30-120 秒 | 每 5 秒 |
| 120 秒+ | 每 10 秒 |

超时时间：大部分视频任务在 2-5 分钟内完成，建议总超时设为 10 分钟。

---

## 计费说明

视频模型的计费公式：

```
消耗额度 = ModelRatio × OtherRatios 乘积
```

| 渠道 | 计费乘数 | 说明 |
|------|---------|------|
| Seedance / Doubao Video | 分档单价 × token / 1e6 | token 按官方公式估算：`(输出时长 + 输入时长) × 宽 × 高 × 24 / 1024`；**含参考视频时输入时长 = 输出时长（token 翻倍）且单价取「含视频」档**，任务完成后按上游返回的真实 token 做差额结算 |
| Sora | `ModelRatio` | 按次计费 |
| Kling | 渠道特定 | 按模型 + 时长计费 |

> 分档单价由管理员在后台按「模型 × 分辨率档 × 是否含参考视频」配置；`ModelRatio` 与分组倍率照常参与换算。

---

## 错误码

| HTTP 状态码 | 错误类型 | 说明 |
|------------|---------|------|
| 400 | `invalid_seconds` | 时长必须在 1-3600 之间 |
| 400 | `invalid_request_error` | 请求参数错误或缺少必填字段 |
| 401 |  | 认证失败或 Token 无效 |
| 403 |  | 无权限或模型被分组限制 |
| 404 | `invalid_request_error` | 任务不存在 |
| 502 |  | 上游服务返回错误 |
| 503 |  | 无可用渠道（模型未启用或渠道不可用） |

---

## 常见问题

### Q: 视频生成后能保存多久？

视频文件本身不在本地存储，下载时实时从上游拉取。建议在任务完成后立即下载。

### Q: 支持哪些视频比例？

支持主流比例：`16:9`、`9:16`、`1:1`、`4:3`、`3:4` 等。具体取决于上游模型。

### Q: 为什么我的任务一直卡在 processing？

检查渠道配置是否正确：渠道是否启用、Key 是否有效、模型是否已分配给分组。

### Q: Seedance 渠道为什么要配代理？

Seedance 使用 `seedance-proxy` 作为中间代理。该代理负责 RSA 解密加密后的视频流，因此渠道的 base_url 必须指向代理地址（含 `/aicc/seedance` 前缀）。

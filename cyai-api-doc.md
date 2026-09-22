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
- `role`：表达素材用途（意图），取值 `reference_image` / `first_frame`（首帧）/ `last_frame`（尾帧）/ `reference_video` / `reference_audio`。视频与音频**必须**带 `role`；图片只有**多图**参考必须带（单张不写即按首帧图片）。
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

> 注意：本渠道会为不带 `role` 的图片补 `reference_image`（其上游对无 `role` 的参考项会报错）。因此**需要严格的首帧语义时，请显式声明 `role: "first_frame"`**——显式声明的 `role` 一律原样下发，不会被改写。

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

## 11. 云端素材库

### 11.1 权限与准备

| 项目 | 说明 |
| --- | --- |
| 控制台显示 | 由管理员的侧边栏配置决定，与账号开关无关 |
| 素材功能 | 需开通账号开关「素材库」；未开通时素材接口返回 403 `asset_library_disabled` |
| 上传本地文件 | 需开通账号开关「上传素材」，与素材库开关相互独立；未开通时返回 403 `asset_upload_disabled` |
| 真人认证 | 不受上述开关限制，任何已登录账号均可使用 |
| 开通方式 | 由管理员在「用户 → 配置」中按账号开通；默认关闭 |

调用前可用 11.9 的能力查询接口确认账号权限与可用模型。

### 11.2 新建素材

```
POST /v1/assets
```

提交一个公网可访问的素材地址用于入库。入库为异步操作，状态变为 `ACTIVE` 后方可引用。

请求参数：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | — | 素材名称，用于列表展示与识别 |
| `url` | string | 是 | — | 公网 HTTP(S) 地址；本地文件见 11.6 |
| `asset_type` | string | 是 | — | 素材类型：`Image` / `Video` / `Audio` |
| `group_id` | integer | 否 | 默认素材组 | 所属素材组 ID；省略时使用默认素材组，不存在则自动创建 |
| `channel_id` | integer | 否 | 系统选择 | 素材所属渠道；省略时由系统选择 |
| `model` | string | 否 | — | 按模型确定素材所属渠道，与 `channel_id` 二选一 |

请求示例：

```bash
curl -X POST "https://baseadd.vip/v1/assets" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "name": "角色定妆图",
    "url": "https://cdn.example.com/portrait.png",
    "asset_type": "Image"
  }'
```

响应示例：

```json
{
  "success": true,
  "data": {
    "id": 12,
    "group_id": 14,
    "channel_id": 14,
    "name": "角色定妆图",
    "asset_type": "Image",
    "source_url": "https://cdn.example.com/portrait.png",
    "status": "PROCESSING",
    "fail_reason": "",
    "created_at": 1790047202,
    "updated_at": 1790047202
  }
}
```

响应字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 本站素材 ID，引用时写作 `asset://<id>` |
| `group_id` | integer | 所属素材组（本站 ID） |
| `channel_id` | integer | 素材绑定的渠道 |
| `name` | string | 素材名称 |
| `asset_type` | string | `Image` / `Video` / `Audio` |
| `source_url` | string | 提交入库的公网地址 |
| `status` | string | `PROCESSING`（入库中）/ `ACTIVE`（可用）/ `FAILED`（失败） |
| `fail_reason` | string | 失败原因，仅 `FAILED` 时有值 |
| `created_at` | integer | 创建时间戳（秒） |

入库为异步操作：状态变为 `ACTIVE` 后方可引用；可轮询 11.4 的详情接口获取最新状态。状态长时间停留在 `PROCESSING`，表示素材仍在处理中。

### 11.3 查询素材列表

```
GET /v1/assets
```

返回当前账号的素材列表，状态为最近一次同步结果。

请求参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `group_id` | integer | 否 | — | 按素材组筛选 |
| `asset_type` | string | 否 | — | 按类型筛选：`Image` / `Video` / `Audio` |
| `status` | string | 否 | — | 按状态筛选，多个用逗号分隔：`PROCESSING,ACTIVE,FAILED` |
| `keyword` | string | 否 | — | 按素材名称模糊匹配 |
| `channel_id` | integer | 否 | — | 按渠道筛选 |
| `page` | integer | 否 | `1` | 页码，从 1 开始 |
| `page_size` | integer | 否 | `20` | 每页条数，上限 100 |

请求示例：

```bash
curl "https://baseadd.vip/v1/assets?page=1&page_size=20&status=ACTIVE" \
  -H "Authorization: Bearer sk-..."
```

响应示例：

```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "group_id": 14,
      "channel_id": 14,
      "name": "角色定妆图",
      "asset_type": "Image",
      "source_url": "https://cdn.example.com/portrait.png",
      "status": "ACTIVE",
      "fail_reason": "",
      "created_at": 1790047202
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

响应字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data` | array | 素材数组，元素字段同 11.2 的响应字段 |
| `total` | integer | 符合条件的素材总数 |
| `page` | integer | 当前页码 |
| `page_size` | integer | 当前每页条数 |

### 11.4 素材详情 / 重命名 / 删除

**查询详情**：`GET /v1/assets/{id}`

查询单个素材并获取最新状态：入库完成后状态为 `ACTIVE` 或 `FAILED`。响应字段同 11.2。

```bash
curl https://baseadd.vip/v1/assets/12 \
  -H "Authorization: Bearer sk-..."
```

**重命名素材**：`PUT /v1/assets/{id}`

仅支持修改素材名称。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 新的素材名称 |

```bash
curl -X PUT https://baseadd.vip/v1/assets/12 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{ "name": "角色定妆图-正面" }'
```

**删除素材**：`DELETE /v1/assets/{id}`

删除素材；若该素材由本地上传产生，其临时文件一并清理。

```bash
curl -X DELETE https://baseadd.vip/v1/assets/12 \
  -H "Authorization: Bearer sk-..."
```

### 11.5 素材组

**查询素材组列表**：`GET /v1/assets/groups`。真人素材组由真人认证流程自动生成，不能通过建组接口创建。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group_type` | string | 否 | 按类型筛选：`AIGC` / `LivenessFace` |
| `channel_id` | integer | 否 | 按渠道筛选 |

```bash
curl https://baseadd.vip/v1/assets/groups \
  -H "Authorization: Bearer sk-..."
```

**新建素材组**：`POST /v1/assets/groups`，仅支持 `AIGC` 类型。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | — | 素材组名称 |
| `description` | string | 否 | 空 | 素材组描述 |
| `group_type` | string | 否 | `AIGC` | 仅支持 `AIGC` |
| `channel_id` | integer | 否 | 系统选择 | 素材组所属渠道；省略时由系统选择 |
| `model` | string | 否 | — | 按模型确定素材组所属渠道，与 `channel_id` 二选一 |

```bash
curl -X POST https://baseadd.vip/v1/assets/groups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{ "name": "角色定妆图组" }'
```

**修改素材组**：`PUT /v1/assets/groups/{id}`，修改名称与描述；未提交的字段保持原值。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 新的素材组名称 |
| `description` | string | 否 | 新的素材组描述 |

```bash
curl -X PUT https://baseadd.vip/v1/assets/groups/14 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{ "name": "角色定妆图组-2" }'
```

**删除素材组**：`DELETE /v1/assets/groups/{id}`，组内素材一并删除。

```bash
curl -X DELETE https://baseadd.vip/v1/assets/groups/14 \
  -H "Authorization: Bearer sk-..."
```

### 11.6 上传本地文件

```
POST /v1/assets/upload
```

素材文件在本地时使用本接口。该能力默认关闭，需开通账号开关「上传素材」，与素材库开关相互独立。

请求参数（`multipart/form-data`）：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `file` | file | 是 | — | 待上传文件；单文件上限 100MB，支持常见图片、视频、音频扩展名 |
| `name` | string | 否 | 文件名 | 素材名称 |
| `group_id` | integer | 否 | 默认素材组 | 所属素材组 ID |
| `channel_id` | integer | 否 | 系统选择 | 素材所属渠道；省略时由系统选择 |
| `model` | string | 否 | — | 按模型确定素材所属渠道，与 `channel_id` 二选一 |

```bash
curl -X POST "https://baseadd.vip/v1/assets/upload" \
  -H "Authorization: Bearer sk-..." \
  -F "file=@./portrait.png" \
  -F "name=角色定妆图"
```

响应与 11.2 新建素材一致，另含 `local_key`（临时文件名）。约束：

| 项目 | 说明 |
| --- | --- |
| 读取失败 | 返回 502 `asset_public_url_unreachable` 表示系统无法读取该文件（多为服务地址配置问题），请联系管理员 |
| 临时文件 | 上传的文件仅用于入库，删除素材时一并清理 |
| 大小与格式 | 超过 100MB 返回 `asset_file_too_large`；扩展名不在支持范围返回 `asset_file_type_not_allowed` |

### 11.7 在生成请求中引用素材

```
POST /v1/videos
```

在生成请求的媒体字段中填写 `asset://<本站素材 ID>`；系统校验素材归属与状态后再提交生成。

| 位置 | 写法 |
| --- | --- |
| `content` 数组元素 | `content[].image_url.url` / `video_url.url` / `audio_url.url` |
| `metadata` 扁平写法 | `metadata.image_url` / `video_url` / `audio_url` |

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "<model-id>",
    "prompt": "让画面轻轻动起来",
    "content": [
      { "type": "image_url", "image_url": { "url": "asset://12" }, "role": "reference_image" }
    ],
    "metadata": { "resolution": "480p", "ratio": "16:9" }
  }'
```

| 项目 | 说明 |
| --- | --- |
| 引用格式 | 只接受本站素材 ID（数字）；其它写法返回 400 `invalid_asset_ref` |
| 素材状态 | 仅 `ACTIVE` 素材可引用，否则返回 `asset_not_active` |
| 素材所属渠道 | 引用素材的生成请求会自动使用素材所属渠道；同一次请求引用的素材须属于同一渠道，否则返回 `asset_channel_mismatch` |
| 模型支持 | 仅部分模型支持引用素材，可用 11.9 查询；模型不支持时返回 `asset_not_supported` |
| 跨渠道使用 | 素材不能在其它渠道复用；如需在另一渠道使用同一文件，请在该渠道重新入库 |
| 计费 | 素材入库、上传与真人认证当前不单独计费；视频生成按既有规则计费 |

### 11.8 真人认证

**创建认证会话**：`POST /v1/assets/real-person/sessions`。认证由真人本人在手机上完成，不可绕过。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `callback_url` | string | 否 | 本站素材库页 | 认证完成后的回跳地址 |
| `channel_id` | integer | 否 | 系统选择 | 认证所用渠道；省略时由系统选择 |
| `model` | string | 否 | — | 按模型确定认证所用渠道，与 `channel_id` 二选一 |

```bash
curl -X POST "https://baseadd.vip/v1/assets/real-person/sessions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{}'
```

```json
{
  "success": true,
  "data": {
    "session_id": 7,
    "h5_link": "https://ark.volcengine.com/region:cn-beijing/mobile/livenees-face-manage/authorization?pl=...",
    "short_link": "https://ghyc.top/rp/masnwk4gvf",
    "expires_at": 1790042969,
    "status": "pending"
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `session_id` | integer | 会话 ID，用于查询认证结果 |
| `h5_link` | string | 上游认证页地址，约 900 字符 |
| `short_link` | string | 本站短链（`/rp/<短码>`，302 跳转到 `h5_link`）；二维码应编码该短链，避免码点过密 |
| `expires_at` | integer | 会话过期时间戳（秒），过期后重新创建 |
| `status` | string | 会话状态，创建时为 `pending` |

**查询认证结果**：`GET /v1/assets/real-person/sessions/{id}`。认证通过后返回真人素材组 `group_id`；未完成或已过期时 `status` 仍为 `pending`，`message` 给出上游提示。

```bash
curl https://baseadd.vip/v1/assets/real-person/sessions/7 \
  -H "Authorization: Bearer sk-..."
```

```json
{
  "success": true,
  "data": {
    "session_id": 7,
    "status": "verified",
    "group_id": 15
  }
}
```

**认证历史**：`GET /v1/assets/real-person/sessions`，最近的在前，分页参数同 11.3。

认证通过的真人素材组不能用 11.5 的建组接口创建；把真人图片或视频入库至该组（调用 11.2 时携带 `group_id`）后即可按 11.7 引用。

### 11.9 能力查询

```
GET /v1/assets/capabilities
```

返回当前账号的素材能力，不受开关限制，用于在调用前判断能否使用素材。

```bash
curl https://baseadd.vip/v1/assets/capabilities \
  -H "Authorization: Bearer sk-..."
```

```json
{
  "success": true,
  "data": {
    "asset_library_enabled": true,
    "asset_upload_enabled": false,
    "channels": [
      {
        "channel_id": 14,
        "models": ["seedance2.0-cyai-260128", "seedance2.0-cyai-fast-260128"]
      }
    ],
    "models": ["seedance2.0-cyai-260128", "seedance2.0-cyai-fast-260128"],
    "real_person_available": true
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `asset_library_enabled` | boolean | 素材功能是否已开通 |
| `asset_upload_enabled` | boolean | 上传本地文件是否已开通 |
| `channels` | array | 可用渠道及其支持的模型；`channel_name` 仅管理员可见 |
| `models` | array | 当前分组下支持素材的模型去重列表 |
| `real_person_available` | boolean | 是否存在可做真人认证的渠道 |

列表中的渠道与模型均为校验可用的结果，最长可能有 30 分钟缓存。

### 11.10 素材相关错误码

| code | HTTP | 说明 |
| --- | --- | --- |
| `asset_library_disabled` | 403 | 该账号未开通云端素材库，请联系管理员开通 |
| `asset_upload_disabled` | 403 | 该账号未开通上传权限，请联系管理员开通 |
| `asset_file_too_large` | 400 | 上传文件超过 100MB 上限 |
| `asset_file_type_not_allowed` | 400 | 上传文件类型不在支持范围内 |
| `asset_public_url_unreachable` | 502 | 系统无法读取上传的文件，请联系管理员检查服务地址配置 |
| `asset_not_supported` | 400 | 所用模型不支持素材 |
| `asset_not_found` | 400 | 素材不存在或不属于当前账号 |
| `invalid_asset_ref` | 400 | 素材引用写法非法（只接受 `asset://<本站素材 ID>`） |
| `asset_not_active` | 400 | 素材尚未入库完成（状态不是 `ACTIVE`） |
| `asset_channel_mismatch` | 400 | 单次请求引用了不同渠道的素材 |
| `asset_channel_disable` | 400 | 素材所属渠道已禁用，请联系管理员 |
| `asset_upstream_error` | 502 | 素材服务异常，错误信息含服务端原文 |

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
| `seconds` | int | | 视频时长（秒）。Seedance 系（含本站中转渠道）为 4–15 的整数，省略或 `-1` 由模型自动选择（2.0 系列默认 5 秒、2.5 系列默认 10 秒）；其它模型族以各自模型规格为准 |
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

`type` 取值：`text` / `image_url` / `video_url` / `audio_url`；参考素材的 URL 放在与 `type` 同名的对象里（如 `image_url.url`）。`role` 表达的是素材用途（意图），取值 `reference_image` / `first_frame` / `last_frame` / `reference_video` / `reference_audio`：视频与音频必须显式写，图片只有多图参考必须写（单图不写即按首帧图片）。

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

> 说明：`cyai` 适配器（`relay/channel/task/cyai`）会为未声明 `role` 的图片补 `reference_image`（其上游对无 `role` 的参考项会报错），而 `doubao` / `seedance` 适配器原样透传。需要严格的首帧语义时，请在请求里显式声明 `role: "first_frame"`。

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

## 素材库

素材入库后状态为 `ACTIVE` 方可被视频生成引用，引用写法为 `asset://<本站素材 ID>`；本节接口支持登录会话与 Bearer key 鉴权，路径前缀为 `/v1/assets`。

### 权限与准备

| 项目 | 说明 |
|------|------|
| 模块显示 | 由系统设置的侧边栏配置决定，与账号开关无关 |
| 素材功能 | 需开通账号开关「素材库」（`user.asset_library_enabled`）；未开通时素材接口返回 403 `asset_library_disabled` |
| 上传本地文件 | 需开通账号开关「上传素材」（`user.asset_upload_enabled`），与素材库开关相互独立；未开通时返回 403 `asset_upload_disabled` |
| 真人认证 | 不受上述开关限制，任何已登录账号均可使用 |
| 开通方式 | 超级管理员在「用户 → 配置」中按账号开通，默认关闭；管理员及以上同样受开关约束 |

### 新建素材

```
POST /v1/assets
```

提交一个公网可访问的素材地址，由上游服务端下载并入库。入库为异步操作，状态变为 `ACTIVE` 后方可引用。

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 是 | — | 素材名称 |
| `url` | string | 是 | — | 公网 HTTP(S) 地址；不支持文件直传 |
| `asset_type` | string | 是 | — | `Image` / `Video` / `Audio` |
| `group_id` | integer | 否 | 默认素材组 | 所属素材组 ID；省略时使用默认素材组，不存在则自动创建 |
| `channel_id` | integer | 否 | 自动选择 | 指定承载素材的渠道，须支持素材接口 |
| `model` | string | 否 | — | 按模型选择渠道，与 `channel_id` 二选一 |

```bash
curl -X POST "https://baseadd.vip/v1/assets" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{ "name": "角色定妆图", "url": "https://cdn.example.com/portrait.png", "asset_type": "Image" }'
```

```json
{
  "success": true,
  "data": {
    "id": 12, "group_id": 14, "channel_id": 14, "name": "角色定妆图",
    "asset_type": "Image", "source_url": "https://cdn.example.com/portrait.png",
    "status": "PROCESSING", "fail_reason": "", "created_at": 1790047202
  }
}
```

响应字段：`id`（本站素材 ID，引用时写作 `asset://<id>`）、`group_id`、`channel_id`、`name`、`asset_type`、`source_url`、`status`（`PROCESSING` / `ACTIVE` / `FAILED`）、`fail_reason`、`created_at`。

### 查询素材列表

```
GET /v1/assets
```

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `group_id` / `channel_id` | integer | 否 | — | 按素材组 / 渠道筛选 |
| `asset_type` | string | 否 | — | `Image` / `Video` / `Audio` |
| `status` | string | 否 | — | 逗号分隔：`PROCESSING,ACTIVE,FAILED` |
| `keyword` | string | 否 | — | 按名称模糊匹配 |
| `page` | integer | 否 | `1` | 页码，从 1 开始 |
| `page_size` | integer | 否 | `20` | 每页条数，上限 100 |

```bash
curl "https://baseadd.vip/v1/assets?page=1&page_size=20&status=ACTIVE" -H "Authorization: Bearer sk-..."
```

响应为 `{ success, data: [...], total, page, page_size }`；`data` 元素字段同「新建素材」的响应字段。

### 素材详情 / 重命名 / 删除

| 接口 | 说明 |
|------|------|
| `GET /v1/assets/{id}` | 查询单个素材，并同步一次上游状态（`PROCESSING` → `ACTIVE` / `FAILED`） |
| `PUT /v1/assets/{id}` | 重命名素材，请求体 `{ "name": "..." }`；上游只支持改名称 |
| `DELETE /v1/assets/{id}` | 删除素材：上游删除成功后清理本地登记与暂存文件 |

### 素材组

| 接口 | 说明 |
|------|------|
| `GET /v1/assets/groups` | 列出素材组，可按 `group_type`（`AIGC` / `LivenessFace`）、`channel_id` 筛选 |
| `POST /v1/assets/groups` | 新建素材组：`name`（必填）、`description`、`group_type`（仅 `AIGC`）、`channel_id` / `model` |
| `PUT /v1/assets/groups/{id}` | 修改名称与描述；未提交的字段保持原值 |
| `DELETE /v1/assets/groups/{id}` | 删除素材组，组内素材随上游一并删除 |

真人素材组（`LivenessFace`）由认证流程产生，不能通过建组接口创建。

### 上传本地文件

```
POST /v1/assets/upload
```

素材文件在本地时使用本接口：平台先暂存文件，再将其公网地址交由上游抓取入库。该能力默认关闭，需开通账号开关「上传素材」，与素材库开关相互独立。

`multipart/form-data` 字段：`file`（必填，≤ 100MB，常见图片 / 视频 / 音频扩展名）、`name`（可选，默认文件名）、`group_id`、`channel_id` / `model`。

```bash
curl -X POST "https://baseadd.vip/v1/assets/upload" \
  -H "Authorization: Bearer sk-..." -F "file=@./portrait.png" -F "name=角色定妆图"
```

| 项目 | 说明 |
|------|------|
| 公网可达 | 上游需访问本站地址抓取文件，故本站须部署在公网可达域名下；可用环境变量 `ASSET_UPLOAD_PUBLIC_BASE` 指定对外地址（默认取系统设置的服务器地址，其次取请求的 scheme://host） |
| 入库前自检 | 平台回抓该地址确认返回的正是刚上传的文件；不可达时返回 502 `asset_public_url_unreachable`，错误信息含实际地址 |
| 本地副本 | 暂存文件在素材删除时一并清理；素材入库完成后引用的是上游素材，不依赖该副本 |

### 在生成请求中引用素材

引用位置：`content[].image_url.url` / `video_url.url` / `audio_url.url`，或扁平写法 `metadata.image_url` / `video_url` / `audio_url`，值为 `asset://<本站素材 ID>`。

| 项目 | 说明 |
|------|------|
| 引用格式 | 只接受本站数字 ID；上游原始素材 ID（形如 `asset-2026...`）返回 400 `invalid_asset_ref` |
| 素材状态 | 仅 `ACTIVE` 素材可引用，否则返回 `asset_not_active` |
| 渠道绑定 | 引用素材的任务固定走素材所属渠道，单次请求引用的素材须属于同一渠道，否则返回 `asset_channel_mismatch`；同一上游素材不可跨渠道复用 |
| 渠道支持 | 素材能力取决于渠道是否支持素材接口：当前仅火山方舟系渠道（经 CyAI 等中转入口）支持，移动云 Seedance 渠道不支持，其模型无法引用素材 |
| 计费 | 素材入库、上传与真人认证当前不单独计费；视频生成按既有规则计费 |

### 真人认证

| 接口 | 说明 |
|------|------|
| `POST /v1/assets/real-person/sessions` | 创建认证会话，返回 `session_id`、`h5_link`、`short_link`、`expires_at`、`status`；可选 `callback_url`、`channel_id` / `model` |
| `GET /v1/assets/real-person/sessions/{id}` | 查询认证结果：通过后返回真人素材组 `group_id`；未完成时 `status` 为 `pending` |
| `GET /v1/assets/real-person/sessions` | 认证历史，最近的在前，分页参数同上 |

认证由真人本人在手机上完成，不可绕过；`short_link` 为本站短链（`/rp/<短码>`，302 跳转到约 900 字符的上游链接），二维码应编码短链。认证通过后把真人图片或视频入库至该组（`POST /v1/assets` 携带 `group_id`），即可按上一节引用。

### 能力查询

```
GET /v1/assets/capabilities
```

返回 `asset_library_enabled`、`asset_upload_enabled`、`channels`（可用渠道，`channel_name` 仅管理员可见）、`models`（当前分组下支持素材的模型）、`real_person_available`；不受开关限制。探测会向候选渠道实际发一次只读请求确认可用性并缓存 30 分钟，因此列出的渠道与模型均为已验证可用。

### 素材相关错误码

| code | HTTP | 说明 |
|------|------|------|
| `asset_library_disabled` | 403 | 该账号未开通云端素材库 |
| `asset_upload_disabled` | 403 | 该账号未开通上传权限 |
| `asset_file_too_large` | 400 | 上传文件超过 100MB 上限 |
| `asset_file_type_not_allowed` | 400 | 上传文件类型不在白名单内 |
| `asset_public_url_unreachable` | 502 | 暂存文件的地址无法被上游抓取，错误信息含实际地址 |
| `asset_not_supported` | 400 | 模型所在渠道不支持素材库 |
| `asset_not_found` | 400 | 素材不存在或不属于当前账号 |
| `invalid_asset_ref` | 400 | 素材引用写法非法（只接受 `asset://<本站素材 ID>`） |
| `asset_not_active` | 400 | 素材尚未入库完成（状态不是 `ACTIVE`） |
| `asset_channel_mismatch` | 400 | 单次请求引用了不同渠道的素材 |
| `asset_channel_disable` | 400 | 素材所属渠道已禁用 |
| `asset_upstream_error` | 502 | 上游素材接口报错，错误信息含上游原文 |

## 状态取值



| 查询接口 | `status` 取值 |
|---------|--------------|
| `GET /v1/videos/:task_id`（OpenAI 格式） | `queued` / `in_progress` / `completed` / `failed` |
| `GET /v1/video/generations/:task_id`（原生格式） | 内部枚举：`NOT_START` / `SUBMITTED` / `QUEUED` / `IN_PROGRESS` / `SUCCESS` / `FAILURE` |

原生格式把任务包在 `{"code":"success","message":"","data":{...}}` 里，字段为 `data.task_id` / `data.status` / `data.fail_reason` / `data.result_url` / `data.last_frame_url` / `data.usage`；其中 `data.data` 是上游的原始响应（排障用）。

### 取消任务

尚未结束的任务可以取消（两种写法等价）：

```bash
POST /v1/videos/:task_id/cancel
DELETE /v1/videos/:task_id
```

```bash
curl -X POST https://your-server.com/v1/videos/task_xxxxxxxxxxxx/cancel \
  -H "Authorization: Bearer sk-xxxx"
```

- 取消成功：任务置为 `failed`、`metadata.fail_reason` 为 `canceled by user`，并**全额退还**预扣额度。
- 以下情况返回错误，且**不改动**本地状态与额度：任务已结束（`task_already_finished`）、渠道未实现取消能力（`cancel_not_supported`）、上游拒绝取消（`cancel_rejected_by_upstream`，错误信息内含上游原文，例如 401 无取消权限）。
- 竞态保护：上游已受理取消、但轮询同时把任务推进到终态时，本地不重复退款。

> 能否取消取决于上游。本站已对 CyAI / Foxtoken 系中转与火山 ARK 原生接口实现。实测（同一把 key、同一路径）：对**运行中**的任务，CyAI 中转会去火山执行取消并在这一步返回 401（其上游 Key 无取消权限），取消因此不生效，只能等任务自行结束，需由中转方修复；对**已结束**的任务，中转则直接删除自己的任务记录（返回 `{"deleted":true}`）——因此本站不允许对已结束任务发起取消（`task_already_finished`），避免误删记录。

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

| 渠道 | 计费方式 | 说明 |
|------|---------|------|
| Seedance / Doubao Video | 分档单价 × token / 1e6 | token 按官方公式计算：`(输出时长 + 输入时长) × 宽 × 高 × 24 / 1024`；**含参考视频时输入时长 = 输出时长（token 翻倍）且单价取「含视频」档**，任务完成后按上游返回的真实 token 做差额结算 |
| Sora | 按次计费 | 每次调用固定价格 |
| Kling、Vidu 等其它渠道 | 渠道特定 | 按模型 + 时长等参数计费 |

> 分档单价由管理员在后台按「模型 × 分辨率档 × 是否含参考视频」配置，另叠加模型倍率与分组倍率。

---

## 错误码

| HTTP 状态码 | 错误类型 | 说明 |
|------------|---------|------|
| 400 | `invalid_seconds` | 时长非法：Seedance 系须为 4–15 的整数或 -1（自动），超出范围报此错 |
| 400 | `invalid_request_error` | 请求参数错误或缺少必填字段 |
| 401 |  | 认证失败或 Token 无效 |
| 403 |  | 无权限或模型被分组限制 |
| 400 | `task_not_exist` | 查询的任务不存在（核对 task_id） |
| 400 | `task_already_finished` | 任务已结束，无法取消 |
| 400 | `cancel_not_supported` | 该渠道未实现取消能力 |
| 400 | `cancel_rejected_by_upstream` | 上游拒绝取消（消息内含上游原文，如 401 无取消权限） |
| 404 | `invalid_request_error` | 仅下载接口 `/v1/videos/:task_id/content`：任务不存在 |
| 502 |  | 上游服务返回错误 |
| 503 |  | 无可用渠道（模型未启用或渠道不可用） |

---

## 常见问题

### Q: 视频生成后能保存多久？

视频文件本身不在本地存储，下载时实时从上游拉取。建议在任务完成后立即下载。

### Q: 支持哪些视频比例？

支持主流比例：`16:9`、`9:16`、`1:1`、`4:3`、`3:4` 等。具体取决于上游模型。

### Q: 为什么我的任务一直卡在 in_progress？

检查渠道配置是否正确：渠道是否启用、Key 是否有效、模型是否已分配给分组。

### Q: Seedance 渠道为什么要配代理？

Seedance 使用 `seedance-proxy` 作为中间代理。该代理负责 RSA 解密加密后的视频流，因此渠道的 base_url 必须指向代理地址（含 `/aicc/seedance` 前缀）。

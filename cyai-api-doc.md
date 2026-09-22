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

素材文件、转码、审核与真人活体认证均由上游渠道托管，平台只登记归属与状态。素材入库完成后（状态为 `ACTIVE`）才可用于视频生成，引用写法为 `asset://<素材 ID>`。

界面上的显示规则：侧边栏里的素材库模块由系统设置的侧边栏配置控制；账号开关只控制模块内的功能，两个开关互不依赖——「素材库」决定该账号能否浏览与管理素材（素材组、素材入库），「上传素材」决定能否上传本地文件（可单独开通，未开通素材库时页面只显示上传入口）。真人认证不受这两个开关限制，任何已登录账号都可以完成。

素材接口（`/v1/assets`、`/v1/assets/groups`）**默认按账号关闭**，需要超级管理员开通后才能调用；未开通时返回 403 `asset_library_disabled`。直传接口只按「上传素材」开关校验，可与素材库分开开通。真人认证接口（`/v1/assets/real-person/sessions`）不受开关限制。

素材能力依赖分组/模型所配的渠道是否支持素材接口：当前只有火山方舟系渠道（经 CyAI 等中转入口）支持，**移动云 Seedance 渠道不支持素材**，因此移动云模型上无法引用素材。同一个上游素材不能跨渠道复用——同一份源文件在两条渠道各入库一次会得到两个上游素材，各自绑定各自的渠道。

素材入库、上传与真人认证**当前不单独计费**；视频生成仍按既有计费规则结算。

### 11.1 接口一览

| 能力 | 接口 |
| --- | --- |
| 能力探测 | `GET /v1/assets/capabilities` |
| 素材组列表 / 新建 / 重命名 / 删除 | `GET /v1/assets/groups`、`POST /v1/assets/groups`、`PUT /v1/assets/groups/{id}`、`DELETE /v1/assets/groups/{id}` |
| 素材列表 / 新建 | `GET /v1/assets`、`POST /v1/assets` |
| 素材详情 / 重命名 / 删除 | `GET /v1/assets/{id}`、`PUT /v1/assets/{id}`、`DELETE /v1/assets/{id}` |
| 直接上传文件 | `POST /v1/assets/upload` |
| 真人认证（创建 / 查询 / 历史） | `POST /v1/assets/real-person/sessions`、`GET /v1/assets/real-person/sessions/{id}`、`GET /v1/assets/real-person/sessions` |

- 能力探测不受素材开关限制，用来回答「这个账号能不能用素材」：
  `asset_library_enabled`、`asset_upload_enabled` 为两个开关状态，`channels` 为可用渠道（管理员额外带 `channel_name`），`models` 为当前分组下支持素材的模型，`real_person_available` 表示是否有可用渠道做真人认证。探测会向每条候选渠道实际发一次只读列表请求确认可用性（每渠道缓存 30 分钟），因此列出的渠道与模型都是已验证可用的——上游没有素材路由的渠道不会出现。
- 列表接口（`GET /v1/assets`、`GET /v1/assets/real-person/sessions`）支持 `page`（从 1 开始）与 `page_size`（默认 20，上限 100），响应在 `data` 之外额外返回 `total`、`page`、`page_size`。
- 素材列表另支持 `group_id`、`asset_type`、`status`（逗号分隔）、`keyword` 筛选；素材组重命名只支持 `name` 与 `description`，空值表示不修改。

### 11.2 新建素材

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

- `url` 必须是**公网 HTTP(S) 地址**，不支持文件直传；
- `asset_type` 取 `Image` / `Video` / `Audio`；
- `group_id` 可省略，省略时自动使用（必要时自动创建）默认素材组；
- 入库是异步的：先返回 `PROCESSING`，状态变为 `ACTIVE` 后才可引用；查询详情接口会同步一次上游状态。

### 11.3 直接上传文件（可选）

若素材文件在本地，可直接上传（multipart/form-data，字段名 `file`，可附 `name`、`group_id`）：

```bash
curl -X POST "https://baseadd.vip/v1/assets/upload" \
  -H "Authorization: Bearer sk-..." \
  -F "file=@./portrait.png" \
  -F "name=角色定妆图"
```

- 该能力**默认关闭**，需要管理员为账号开通「上传素材」权限；它与素材库互不依赖，可以单独开通（此时控制台只显示上传入口，上传后返回的素材 ID 仍可用于生成）；未开通时返回 403 `asset_upload_disabled`；
- 本站会把文件临时保存一份，再把它的公网地址交给上游入库，因此本站需部署在**公网可访问**的域名下；
- 入库前本站会先回抓一次该地址，确认它返回的正是刚上传的文件。地址不可被上游访问时返回 502 `asset_public_url_unreachable`，错误信息里带有实际使用的地址，常见原因：对外地址是回环/内网地址（本地实例）、该域名尚未部署 `/asset-media` 路由、文件保存在另一台实例上；
- 本地实例无法完成直传（上游必须从公网下载文件）。需要固定对外地址时用环境变量 `ASSET_UPLOAD_PUBLIC_BASE` 指定，本地调试可指向内网穿透地址；
- 单文件上限 100MB，仅支持常见图片 / 视频 / 音频扩展名（其它返回 `asset_file_type_not_allowed`，超限返回 `asset_file_too_large`）；
- 本地副本在删除素材时一并删除。

### 11.4 在视频生成中引用素材

在 `content` 数组元素的 `image_url` / `video_url` / `audio_url`，或扁平写法 `metadata.image_url` / `video_url` / `audio_url` 中填 `asset://<素材 ID>`：

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

平台在提交上游前会校验素材归属与状态，并替换为上游素材 ID。**素材绑定渠道**：引用了素材的任务会固定走素材所属渠道，同一次请求引用的素材必须来自同一渠道（否则返回 `asset_channel_mismatch`）。

引用只接受**本站素材 ID**（数字）：上游原始素材 ID（形如 `asset-2026...`）一律拒绝并返回 `invalid_asset_ref`；原始 ID 属于上游账号下的对象，与本站用户不是一一对应，放行会绕过归属校验。

### 11.5 真人素材

真人素材必须先完成真人活体认证（上游流程，不可绕过）：

1. 调用 `POST /v1/assets/real-person/sessions` 拿到 `h5_link` 与 `short_link`（本站短链，形如 `/rp/<短码>`，302 跳转到 `h5_link`；上游链接近千字符，二维码建议编码短链，否则码点过密、低端手机扫不出来）；有效期较短，过期重新生成即可；
2. 由**素材中的真人本人**用手机打开链接完成活体认证；
3. 轮询 `GET /v1/assets/real-person/sessions/{id}`，认证通过后返回绑定的真人素材组 `group_id`；
4. 把真人图片或视频入库到该组，即可在生成请求中引用。

### 11.6 素材相关错误码

| code | HTTP | 说明 |
| --- | --- | --- |
| `asset_library_disabled` | 403 | 该账号未开通云端素材库，请联系管理员 |
| `asset_upload_disabled` | 403 | 该账号未开通直接上传权限，请联系管理员 |
| `asset_file_too_large` | 400 | 上传文件超过 100MB 上限 |
| `asset_file_type_not_allowed` | 400 | 上传文件类型不在白名单内 |
| `asset_not_supported` | 400 | 模型所在渠道不支持素材库 |
| `asset_not_found` | 400 | 素材不存在或不属于当前账号 |
| `invalid_asset_ref` | 400 | 素材引用写法非法（只接受 `asset://<本站素材 ID>`） |
| `asset_not_active` | 400 | 素材尚未入库完成（状态不是 `ACTIVE`） |
| `asset_channel_mismatch` | 400 | 同一次请求引用了不同渠道的素材 |
| `asset_channel_disable` | 400 | 素材所属渠道已禁用 |
| `asset_upstream_error` | 502 | 上游素材接口报错，错误信息含上游原文 |

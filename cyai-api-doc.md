# Seedance 视频生成 API 对接文档

> 本文档说明如何通过本平台调用 Seedance 系列模型生成视频，涵盖文本生视频、图生视频、视频生视频、视频 Remix、任务查询与成片下载。

## 1. 接入信息

| 项 | 值 |
| --- | --- |
| **Base URL** | `https://baseadd.vip` |
| **认证方式** | 请求头 `Authorization: Bearer <API Key>` |
| **API Key** | `sk-...`（由平台分配） |
| **Content-Type** | `application/json` |

## 2. 可用模型

| 模型 ID | 说明 |
| --- | --- |
| `seedance2.0-cyai-25-260628` | 高版本 |
| `seedance2.0-cyai-260128` | 标准版 |
| `seedance2.0-cyai-fast-260128` | 快速版 |
| `seedance2.0-cyai-mini-260615` | 轻量版 |

### 查询可用模型

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
      "id": "seedance2.0-cyai-25-260628",
      "object": "model",
      "created": 1626777600,
      "owned_by": "cyai seedance",
      "supported_endpoint_types": ["openai"]
    }
  ],
  "object": "list"
}
```

## 3. 视频生成任务

> 所有视频生成均为**异步任务**：先创建拿到 `task_id`，再轮询状态，成功后下载成片。

### 3.1 创建视频任务（文本生视频）

```
POST /v1/videos
```

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "一只猫在草地上奔跑，电影感，镜头缓慢推进",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9", "generate_audio": true }
  }'
```

```json
{
  "id": "task_xxx",
  "task_id": "task_xxx",
  "object": "video",
  "model": "seedance2.0-cyai-25-260628",
  "status": "queued",
  "progress": 0
}
```

> 也可使用兼容接口 `POST /v1/video/generations`，请求参数一致。

### 3.2 图生视频

在 `metadata` 传 `image_url`（或 `content` 数组含 `image_url`），即可基于图片生成视频。

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "让图片里的人物自然挥手",
    "metadata": {
      "resolution": "720p",
      "ratio": "16:9",
      "image_url": "https://example.com/input.jpg"
    }
  }'
```

### 3.3 视频生视频

在 `metadata` 传 `video_url`，基于已有视频生成新视频。

```bash
curl -X POST "https://baseadd.vip/v1/videos" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "调整为电影感，延长 5 秒",
    "metadata": {
      "resolution": "720p",
      "ratio": "16:9",
      "video_url": "https://example.com/input.mp4"
    }
  }'
```

### 3.4 视频 Remix

基于已有视频创建 Remix 任务，通过路径传入视频 id。

```
POST /v1/videos/{video_id}/remix
```

```bash
curl -X POST "https://baseadd.vip/v1/videos/video_xxx/remix" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{ "model": "seedance2.0-cyai-25-260628", "prompt": "调整为电影感" }'
```

## 4. 查询任务状态

```
GET /v1/videos/{task_id}
```

```bash
curl "https://baseadd.vip/v1/videos/task_xxx" \
  -H "Authorization: Bearer sk-..."
```

状态流转：`QUEUED` → `IN_PROGRESS` → `SUCCESS` / `FAILURE`。`SUCCESS` 后可从 `result_url` 获取成片。

## 5. 下载成片

```
GET /v1/videos/{task_id}/content
```

```bash
curl -L "https://baseadd.vip/v1/videos/task_xxx/content" \
  -H "Authorization: Bearer sk-..." \
  -o output.mp4
```

## 6. 请求参数说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 模型 ID |
| `prompt` | string | 是 | 画面描述（中文 ≤ 500 字、英文 ≤ 1000 词） |
| `duration` | integer | 否 | 时长（秒），不支持 0 与 -1（自动） |
| `metadata` | object | 否 | 扩展参数，见下表 |

### metadata 扩展参数

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `resolution` | string | `480p`/`720p`/`1080p`/`4k`（不支持 `2k`） |
| `ratio` | string | `16:9`/`9:16`/`4:3`/`3:4`/`21:9`/`1:1` |
| `generate_audio` | boolean | 是否生成音频，默认 true |
| `watermark` | boolean | 是否带水印，默认 false |
| `seed` | integer | 随机种子，留空为随机 |
| `image_url` | string | 输入图片 URL（图生视频） |
| `video_url` | string | 输入视频 URL（视频生视频） |

## 7. 常见错误码

| code | 说明 |
| --- | --- |
| `model_price_error` | 模型/参数不支持（如 `2k`、用 chat 调视频模型） |
| `invalid_seconds` | 时长非法（`-1`、超范围） |
| `insufficient_user_quota` | 余额不足 |
| `model_not_found` | 模型不存在或无可用渠道 |
| `invalid_api_platform` | 调用了不支持的接口/模型类型 |
| `task_not_exist` | 任务不存在（如 Remix 传入的视频 id 无效） |

## 8. 注意事项

1. 只能用视频接口，不能用 `/v1/chat/completions` 做对话。
2. 时长传固定秒数（4–15），不要传 `-1`（自动）。
3. 清晰度不要传 `2k`，用 `480p/720p/1080p/4k`。
4. 视频是异步任务：创建 → 轮询 → 下载成片，建议每 3–5 秒轮询一次。
5. 图生视频/视频生视频需传入公网可访问的图片/视频 URL。
6. 视频按时长、清晰度预扣费，余额不足会 `insufficient_user_quota`。

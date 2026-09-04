# Seedance 视频生成 API 对接文档

> 本文档面向使用本平台视频生成能力的客户，说明如何调用 Seedance 系列视频模型生成视频。

## 1. 接入信息

| 项 | 值 |
| --- | --- |
| **Base URL** | `https://baseadd.vip` |
| **认证方式** | 请求头 `Authorization: Bearer <API Key>` |
| **API Key** | `sk-...`（由平台分配） |
| **Content-Type** | `application/json` |

## 2. 可用模型（视频生成）

| 模型 ID | 说明 |
| --- | --- |
| `seedance2.0-cyai-25-260628` | 高版本 |
| `seedance2.0-cyai-260128` | 标准版 |
| `seedance2.0-cyai-fast-260128` | 快速版 |
| `seedance2.0-cyai-mini-260615` | 轻量版 |

> ⚠️ 这些是**纯视频生成模型**，只能通过视频接口调用，**不支持对话**（`/v1/chat/completions` 会报错）。

## 3. 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/v1/video/generations` | 创建视频生成任务 |
| GET | `/v1/video/generations/{task_id}` | 查询任务状态 |
| GET | `/v1/videos/{task_id}/content` | 下载成片视频 |

> 视频生成是**异步任务**：先创建任务拿到 `task_id`，再轮询状态，成功后下载成片。

## 4. 创建视频任务

**`POST /v1/video/generations`**

### 请求体参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 模型 ID，见第 2 节 |
| `prompt` | string | 是 | 画面描述（中文 ≤ 500 字、英文 ≤ 1000 词） |
| `duration` | integer | 否 | 时长（秒），**不支持 0 和 -1（自动）** |
| `metadata` | object | 否 | 扩展参数 |

### `metadata` 扩展参数

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `resolution` | string | `480p`/`720p`/`1080p`/`4k`（**不支持 `2k`**） |
| `ratio` | string | `16:9`/`9:16`/`4:3`/`3:4`/`21:9`/`1:1` |
| `generate_audio` | boolean | 是否生成音频，默认 true |
| `watermark` | boolean | 是否带水印 |
| `seed` | integer | 随机种子 |

### 请求示例

```bash
curl -X POST "https://baseadd.vip/v1/video/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-..." \
  -d '{
    "model": "seedance2.0-cyai-25-260628",
    "prompt": "一只猫在草地上奔跑，电影感，镜头缓慢推进",
    "duration": 5,
    "metadata": { "resolution": "720p", "ratio": "16:9", "generate_audio": true }
  }'
```

### 响应示例

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

## 5. 查询任务状态

**`GET /v1/video/generations/{task_id}`**

```bash
curl "https://baseadd.vip/v1/video/generations/task_xxx" \
  -H "Authorization: Bearer sk-..."
```

状态流转：`QUEUED` → `IN_PROGRESS` → `SUCCESS` / `FAILURE`。`SUCCESS` 后可从 `result_url` 获取成片。

## 6. 下载成片

**`GET /v1/videos/{task_id}/content`**

```bash
curl -L "https://baseadd.vip/v1/videos/task_xxx/content" \
  -H "Authorization: Bearer sk-..." \
  -o output.mp4
```

## 7. 常见错误码

| code | 说明 |
| --- | --- |
| `model_price_error` | 模型/参数不支持（如 `2k`、用 chat 调视频模型） |
| `invalid_seconds` | 时长非法（`-1`、超范围） |
| `insufficient_user_quota` | 余额不足 |
| `model_not_found` | 模型不存在或无可用渠道 |
| `invalid_api_platform` | 调用了不支持的接口/模型类型 |

## 8. 注意事项

1. 只能用视频接口，不能用 `/v1/chat/completions` 做对话。
2. 时长传固定秒数（4–15），不要传 `-1`（自动）。
3. 清晰度不要传 `2k`，用 `480p/720p/1080p/4k`。
4. 视频按时长、清晰度预扣费，余额不足会 `insufficient_user_quota`。
5. 视频是异步任务：创建 → 轮询 → 下载成片，建议每 3–5 秒轮询一次。

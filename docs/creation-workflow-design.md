# 视频创作工作流 · 系统级设计草案

> 状态：草案（未实施）。目标读者：本项目维护者。
> 范围：**所有**视频任务渠道（seedance / doubao / cyai / foxtoken / globalaiopc / kling / vidu / ali / jimeng / gemini / vertex / sora / hailuo / migu …），不针对单一渠道。

---

## 0. 一句话目标

把现在「一次性、单渠道、文生视频为主」的调用，升级为
**素材驱动、跨渠道行为一致、产出可复用的创作闭环**。

---

## 1. 目标效果（用户视角）

### S1 · 素材驱动生成
| | |
|---|---|
| 现在 | 用户得自己把参考图挂到公网，再填进 `metadata.image_url`；素材库只有 3 个渠道能用；能不能吃参考图全凭运气 |
| 做完 | 从素材库选图/选视频 → 系统只展示「能吃这种素材」的模型并标价 → 生成 → 结果自动成为素材，可继续二次创作 |

### S2 · 跨渠道行为一致
| | |
|---|---|
| 现在 | 同一个请求打到不同渠道结果不同：Kling 会**静默忽略**参考视频（结构里没有该字段），Vidu 按图片张数切换模式，CyAI 对无 role 的图片直接报错；用户无从预知 |
| 做完 | 提交前就知道「这个模型能不能吃视频/音频/首尾帧」；不能吃就明确报错并给出可用模型，**绝不静默降级**；选路阶段自动绕开不支持的渠道 |

### S3 · 连拍（把 5 秒接成长视频）
| | |
|---|---|
| 现在 | 有 `return_last_frame` 拿尾帧的能力，但没有任何调度 |
| 做完 | 给一个脚本和总时长，系统自动切段 → 上一段尾帧作下一段首帧 → 串行生成 → 汇总进度与费用 → 输出一条完整视频 |

### S4 · 角色一致（数字人）
| | |
|---|---|
| 现在 | 真人认证能产出真人素材组，但只能用在支持素材库的渠道；跨镜头一致性没有产品化 |
| 做完 | 认证一次得到角色素材 → 所有镜头引用同一素材 → 跨镜头人物一致；不支持素材库的渠道用本站素材地址降级实现 |

### S5 · API 可编排
| | |
|---|---|
| 现在 | 一次请求 = 一个任务，甲方要自己写轮询、重试、拼接 |
| 做完 | 一次请求 = 一个 workflow（多个镜头/多段），返回聚合状态；对外仍是任务语义，向后兼容 |

---

## 2. 现状盘点

### 2.1 已经具备的地基（不要重造）

| 能力 | 落点 | 说明 |
|---|---|---|
| 统一任务请求协议 | `relay/common/relay_info.go:685` `TaskSubmitReq` | prompt / model / image(s) / input_reference / duration / seconds / size / metadata / content / return_last_frame |
| 参考素材**语义归一** | `relay/common/relay_utils.go` `normalizeTaskReferences` | `content` 数组与扁平写法统一到 `metadata.content`；role 推断（单图=首帧、多图=reference_image）已有回归测试 `task_content_test.go` |
| 参考素材**位置归一** | `normalizeOfficialVideoParams` | 火山官方顶层写法（resolution/ratio/seed…）并入 metadata |
| 尾帧返回 | `TaskSubmitReq.ReturnLastFrame` → `Task.PrivateData.LastFrameURL` | 连拍的原料 |
| 素材库 + `asset://` 解析 + 任务锁渠道 | `controller/asset_task.go:60`、`/v1/assets`、`/asset-media/:key` | 素材是一等公民的框架已成立 |
| 渠道素材接口抽象 | `relay/channel/adapter.go:100` `AssetLibrary{AssetAction, AssetProbe}` | 已有两个实现：`seedance/asset.go`（REST 型）、`foxtoken`（动作式） |
| 含视频输入的分档价 | `setting/operation_setting/seedance_price.go` | `no_*` / `with_*` 档位齐备 |
| 计费差额结算框架 | `service/task_polling.go:694` | 上游给官方用量就重算，不给就保持预扣 |
| 任务取消抽象 | `relay/channel/adapter.go:90` `TaskCanceller` | 可选接口的既有范式，本设计沿用 |

### 2.2 各渠道能力现状（代码审读得出，需运行期复核）

| 渠道 | 参考图 | 参考视频 | 参考音频 | 首尾帧 | 尾帧返回 | 素材库 |
|---|---|---|---|---|---|---|
| seedance / doubao | ✅ content | ✅ | ✅ | ✅ role | ✅ | ✅ |
| cyai / foxtoken | ✅ | ✅ | ✅ | ⚠️ 无 role 会被改写成参考图 | — | ✅ |
| globalaiopc | ✅ | ✅（计费按不含视频） | ✅ | — | — | ❌ |
| kling | ✅ 单图 | ❌ | ❌ | — | — | ❌ |
| vidu | ✅ 1/2/多图三种模式 | ❌ | ❌ | 2 图即首尾 | — | ❌ |
| ali | ✅ + input_reference | ❌ | ✅（wan2.5） | ✅ last_frame_url | — | ❌ |
| jimeng / gemini / vertex | ✅ 首图 | ❌ | ❌ | — | — | ❌ |
| sora | ✅ input_reference | ❌ | ❌ | — | — | ❌ |
| hailuo | ✅ 首图 | ❌ | ❌ | — | — | ❌ |
| migu | ❌（当前仅文生） | ❌ | ❌ | ❌ | — | ❌ |

**这张表目前只存在于散落的适配器代码里** —— 这是本设计的出发点。

### 2.3 四个系统性缺口

1. **没有权威的能力描述。** 前端 `web/default/src/features/playground/components/input/video-parameter-controls.tsx` 按**模型名硬编码**分辨率/时长（注释里就写着「各上游支持的分辨率不同…CyAI 只认…」）；后端每个适配器自己校验。用户能选出上游不支持的组合，提交后才 400，个别路径甚至预扣费之后才失败。
2. **能力不参与选路。** 渠道选择只看 `group + model`（`service/channel_select.go:84` → `model/ability.go:108`）。带参考视频的请求可能落到 Kling，参考视频被**静默丢弃**，用户拿到文生视频结果还以为成功。
3. **素材库只覆盖少数渠道。** 素材必须建在实现了 `AssetLibrary` 的渠道上；其余渠道完全用不了 `asset://`。
4. **产出不回流。** 任务成功只留 `result_url`，不进素材库；而「视频延长 / 参考生 / 视频编辑」都要求输入是**已登记的素材**，于是「生成 → 再创作」这条线是断的。

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│ 第 4 层  编排层   workflow：连拍 / 分镜 / 角色一致性           │
├──────────────────────────────────────────────────────────────┤
│ 第 3 层  回流层   成片 → 素材（带生成元数据）                  │
├──────────────────────────────────────────────────────────────┤
│ 第 2 层  素材层   Reference Resolver：素材/外链/base64 → 渠道可用形态 │
├──────────────────────────────────────────────────────────────┤
│ 第 1 层  能力层   Capability Registry：声明 - 合并 - 校验 - 选路 │
└──────────────────────────────────────────────────────────────┘
        ▲ 复用：统一请求协议 / role 归一 / 任务锁渠道 / 计费框架
```

设计原则（与仓库既有风格一致）：
- **可选接口 + 保守默认**：像 `TaskCanceller` 一样，适配器不实现新接口也能跑，只是能力表按最保守值（仅文生）处理并记日志 —— 14 个适配器可以分批补齐，不必一次性改完。
- **不改变既有语义**：所有新增能力默认走「观察模式」，确认无副作用后再切硬校验。
- **能力表就是契约**：用测试锁住「声明 × 实际行为」，防止能力表与适配器漂移。

---

## 4. 分层设计

### 4.1 第 1 层 · 能力注册表（Capability Registry）

#### 数据结构

```go
// relay/channel/capability.go（新增）
type VideoInputKind string

const (
    InputText           VideoInputKind = "text"
    InputFirstFrame     VideoInputKind = "image"            // 单图 = 首帧
    InputReferenceImage VideoInputKind = "reference_image"  // 多图参考
    InputFirstLastFrame VideoInputKind = "first_last_frame"
    InputReferenceVideo VideoInputKind = "reference_video"
    InputReferenceAudio VideoInputKind = "reference_audio"
)

// ReferenceMode 决定素材要用什么形态喂给上游。
type ReferenceMode string

const (
    RefModeURL          ReferenceMode = "url"           // 直接给公网 URL
    RefModeBase64       ReferenceMode = "base64"        // 本地编码
    RefModeUpload       ReferenceMode = "upload"        // multipart 上传
    RefModeUpstreamAsset ReferenceMode = "upstream_asset" // 需先在上游登记（ARK / 咪咕 /materials）
)

type VideoCapability struct {
    Inputs           []VideoInputKind
    MaxImages        int
    MaxVideos        int
    MaxAudios        int
    Duration         DurationRange
    Resolutions      []string
    Ratios           []string
    SupportsAudioOut bool
    ReturnsLastFrame bool
    HasVideoTier     bool          // 计费是否存在「含视频输入」档
    ReferenceMode    ReferenceMode
}

// 可选接口：与 TaskCanceller / AssetLibrary 同一范式。
type VideoCapabilityProvider interface {
    VideoCapability() VideoCapability
}
```

#### 动态能力（上游权威表）

部分上游能直接给出能力（咪咕 `GET /models` 返回 `supportedContentTypes/durationRange/resolutions`；移动云、豆包同理）：

```go
type UpstreamModelLister interface {
    ListUpstreamModels(baseUrl, key, proxy string) ([]UpstreamModelCapability, error)
}
```

合并规则：**静态声明 ∩ 动态结果**（动态更严），动态拉取失败时回退静态；结果落入渠道缓存（见下）。

#### 三个消费方

| 消费方 | 落点 | 行为 |
|---|---|---|
| 前端参数控件 | `video-parameter-controls.tsx`、模型广场 | 只渲染该模型真正支持的时长/分辨率/素材入口 |
| 提交前校验 | `relay/relay_task.go` 步骤 1（`ValidateRequestAndSetAction` 之前） | 不支持就返回结构化错误 + 可用模型列表 |
| 选路过滤 | `service/channel_select.go:84` / `model/ability.go:108` | 按请求的「内容特征」筛掉不满足的渠道 |

#### 对外接口

```
GET /v1/video/capabilities?model=xxx
{
  "models": [{
    "model": "seedance2.0-cyai-260128",
    "channel_id": 14,
    "inputs": ["text","image","reference_image","first_last_frame","reference_video","reference_audio"],
    "limits": {"images":9,"videos":3,"audios":3,"duration":{"min":4,"max":15}},
    "resolutions": ["480p","720p","1080p"],
    "returns_last_frame": true,
    "pricing": {"has_video_tier": true}
  }]
}
```

也可以并进现有 `/api/pricing`（它已经返回 `video_billing.tier_prices`），前端少一次请求。

#### 缓存与失效

渠道能力 = 静态声明 ∪ 动态拉取 → 存 `channels` 新增 JSON 列（如 `model_capabilities`），或独立表 `channel_model_capabilities`。TTL 与失效：渠道保存时、`/api/channel/fetch_models/:id` 时、TTL 到期时刷新。

---

### 4.2 第 2 层 · 素材层（Reference Resolver）

#### 核心判断：把「素材」与「上游素材接口」解耦

仓库里其实已经有**不依赖上游**的素材通路：

- `POST /v1/assets/upload` 本地落盘暂存
- `GET /asset-media/:key` 匿名可取的公网地址（`router/asset-router.go:45`）
- `Asset.LocalKey` / `Asset.SourceUrl`（`model/asset.go:66`）

因此对 **Kling / Vidu / Sora / Jimeng 这类没有素材接口的渠道**，素材库完全可以走「本站公网地址直传」。上游素材接口（ARK asset://、移动云 aicc、咪咕 /materials）从**必需**降级为**增强**：它带来持久化、角色一致性、真人认证，而不是用素材库的前提。

结论：`Asset` 增加储存维度

```go
const (
    AssetStorageUpstream = "upstream" // 实体在上游，ChannelId 绑定，换渠道不可用
    AssetStorageLocal    = "local"    // 实体在本站暂存，任何渠道可用
)
// Asset 新增：StorageKind string；LocalKey 已有；PublicURL 由 LocalKey 推导
```

只有 `AssetStorageUpstream` 的素材才需要「任务锁到素材所属渠道」（现有行为）；`local` 素材不锁渠道。

#### 统一入口

```go
// service/reference/resolver.go（新增）
func Resolve(ctx, ch *model.Channel, refs []Reference) ([]ResolvedRef, error)

type Reference struct { Kind string; Raw string } // asset://12 / https://… / data:…
type ResolvedRef struct { Kind string; Value string; Mode ReferenceMode }
```

分派规则：`asset://` → 查本地 asset → 按 `StorageKind` 与渠道 `ReferenceMode` 决定「直接给 PublicURL / 本地 base64 / 上传到上游 / 上游登记」；外链 → 下载（复用 `common/ssrf_protection.go` 挡内网、限体积/超时）后同上；base64 → 直接转换。

#### 上游登记缓存

```
asset_upstream_refs(asset_id, channel_id, upstream_ref, asset_type, expire_at, created_at)
```
同一张人物参考图会在几十个任务里复用，不能每次都重传；TTL 到期或上游返回 4xx 时自动重传一次。

#### 必须一起修的已知坑

`controller/asset_task.go:105` 现在固定把上游引用拼成 `asset://<UpstreamAssetId>`。对 ARK 系是对的，但对**引用形态是 URL 的上游**（咪咕 `/materials` 返回 url）会产出 `asset://https://…` 这种坏值。应改为「上游引用形态由渠道能力声明，原样透传」。

---

### 4.3 第 3 层 · 回流层（Output → Asset）

任务进入终态（成功）时，把成片登记为素材：

- `StorageKind=local` + `SourceUrl=<result_url>`，可选下载落盘（上游成片 URL 通常有时效，落盘才可长期复用）
- 附带生成元数据：`prompt / model / duration / resolution / seed / 消耗 quota / 来源任务 ID`
- 触发方式：**手动为主 + 渠道开关**（自动回流会迅速撑爆素材库，也让计费口径变模糊）
- 可选同时登记到上游素材库（这样 `video_extend`/参考生可直接引用）

做完这一步，闭环成立：

```
素材 → 生成 → 存为素材 → 延长/编辑/参考生 → 再存 → …
        ↑ 任一渠道产出，可作任一渠道输入（靠第 2 层的跨渠道重登记）
```

---

### 4.4 第 4 层 · 编排层（Workflow）

| 级别 | 内容 | 依赖 |
|---|---|---|
| **L1 连拍** | 首段正常生成 → 取尾帧 → 作下一段首帧 → 串行；聚合进度/费用/失败重试 | 只需 `return_last_frame`（已有）+ 任务父子关系 |
| **L2 分镜** | 一次请求给镜头数组（各自 model/参数/prompt）→ 并发 → 可选角色素材锁定一致性 | 需要第 1、2 层 |
| **L3 工程化** | workflow 成为一等任务类型（DAG、依赖、部分失败回滚、计费聚合） | 视业务需要，暂不做 |

数据模型建议（L1 即可用）：

```
tasks 新增：parent_task_id、segment_index
task_groups（或复用 system task）：workflow_id、status、expected_segments、completed_segments、aggregated_quota
```

对外保持兼容：父任务仍是 `task_id`，`GET /v1/videos/{id}` 返回聚合状态与已完成段列表。

---

## 5. 里程碑与验收标准

| 期 | 范围 | 验收（可观测） | 风险 |
|---|---|---|---|
| **P0** 能力层（观察模式） | 能力注册表 + `GET /v1/video/capabilities` + 提交前校验（仅警告日志）+ 选路过滤（dry-run） | 能力矩阵可查；日志能列出「本会误判/静默降级」的请求，且**零行为变化** | 适配器补齐工作量 → 用保守默认兜底 |
| **P1** 能力层（强制 + UI） | 切硬校验、按能力选路、前端参数控件改为能力驱动 | 选不出不支持的组合；错误码从「上游 400」变成「提交前 `unsupported_input_for_model` + 可用模型」 | 动态能力缓存失效 → TTL + 拉取失败回退静态 |
| **P2** 素材通用化 | `StorageKind`、Reference Resolver、外链/本地摄取、上游登记缓存；修 `asset://` URL 型引用坑 | 任意渠道都能用素材库；同一素材切渠道不再报「不属于该渠道」 | 存储成本、SSRF、大文件带宽 → 体积上限 + 流式 + 清理策略 |
| **P3** 成片回流 | 终态回流（手动 + 渠道开关）、可选上游登记 | 生成结果可直接作为下一个任务的输入 | 上游 URL 过期 → 落盘开关 |
| **P4** 连拍 | 任务父子关系 + 尾帧串接 + 聚合状态 | 一次请求产出跨段连贯长视频 | 段间失败 → 断点续做/退款策略 |
| **P5** 分镜 | 镜头数组 + 并发 + 角色一致性 | 一次请求产出多镜头成片 | 成本控制、并发上限 |

---

## 6. 兼容与迁移

- **接口**：全部新增；`TaskSubmitReq` 不动，现有请求行为不变。
- **数据库**：新增列/表（AutoMigrate 自动加列，SQLite/MySQL/PG 通用）：`channels.model_capabilities`（或独立表）、`assets.storage_kind`、`asset_upstream_refs`、`tasks.parent_task_id/segment_index`。
- **行为开关**：每个里程碑都有「观察 → 强制」两档，可在系统设置里回退。
- **测试**：能力表用「声明 × 请求样本」的表格测试锁死（沿用 `task_content_test.go`、`return_last_frame_test.go` 的风格）；素材解析用 httptest 锁 URL/形态。

---

## 7. 风险与反模式

| 风险 | 对策 |
|---|---|
| 能力表与实际行为漂移 | 能力声明与适配器同文件、同 PR 修改；表格测试断言「声明支持的输入 → 适配器确实把它写进了上游请求体」 |
| 为一个渠道特判污染公共路径 | 公共层只认能力表，不认渠道类型（本设计的硬约束） |
| 素材落盘的存储与合规 | 体积上限、生命周期清理、可选对象存储；默认只存引用不落盘 |
| 静默降级（当前最危险） | 任何「忽略用户提供的素材」都必须报错，禁止静默 |
| 编排放大成本 | L2 起必须支持并发上限与预估总额确认 |

---

## 8. 待决策项

1. 能力表来源：静态声明 / 动态拉取 / 合并（**倾向合并**，静态兜底）
2. 素材存储：只依赖上游 / 本站暂存+公网地址 / 引入对象存储（**倾向本站暂存为通用路径**，量大再上对象存储）
3. 成片回流：自动 / 手动 / 按渠道开关（**倾向手动 + 渠道开关**）
4. 编排起步：连拍 / 分镜（**倾向连拍**，字段与适配器已就绪）
5. 能力矩阵的对外形态：独立接口 / 并入 `/api/pricing`（**倾向并入**，前端省一次请求）

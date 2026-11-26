# Jev 接口契约

Manifest 通过一个中立的 HTTP 契约接入 Jev。游戏侧的实现是 `manifest-ai` 中的 `JevAdjudicator`
（cargo feature `jev`）；接入方只需写一个小适配层，把本契约转到真实的 Jev 服务。

- 适配层与游戏之间只传 JSON，编码 UTF-8，`Content-Type: application/json`。
- 契约版本：v1（路径前缀 `/v1`）。以后若有不兼容的改动，使用新的路径前缀。
- 游戏不向 Jev 发送任何密钥、玩家本机信息或存档内容；只发送提案本体与少量上下文特征。

## Jev 的职责

1. **裁决**：对 LLM 生成的提案给出 Accept / Reject / Modify（参数修正），附理由标签与置信度。
2. **意图分类**：对玩家议价时输入的自由文本分类（让价、威胁、贿赂、套交情、无关）。
3. **合理性分数**：对提案给出 0–1 的分数，低于阈值的不执行。

无论 Jev 如何裁决，提案转成命令前都还要经过内核校验（schema、参数范围、冷却、频率上限、
不得凭空增减资产）。Jev 接受了非法提案时，内核仍会拒绝；Jev 给出的修正也会被内核夹紧或拒绝。

## 配置

设置文件中的 `ai.jev`（不配置则使用规则裁决器 `RuleAdjudicator`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `base_url` | 字符串 | 适配层地址，例如 `http://127.0.0.1:7700`，不含 `/v1/...` |
| `timeout_ms` | 整数 | 单次请求超时（毫秒） |
| `min_score` | 浮点 | 合理性分数阈值；低于该值的提案不执行（规则裁决器回退时也使用） |

## 1. 裁决 `POST /v1/adjudicate`

### 请求

```json
{
  "task": "adjudicate",
  "kind": "director",
  "proposal": { "events": [ { "event": "storm_season", "params": { "region": "frost_west", "mult": 2.0, "days": 60 } } ] },
  "features": {
    "rule_decision": "Accept",
    "rule_reasons": ["规则检查通过"]
  }
}
```

| 字段 | 说明 |
|---|---|
| `task` | 固定为 `"adjudicate"` |
| `kind` | 提案类型：`director` / `rumor` / `bargain` / `strategy` / `contract` / `chronicle` / `composed` / `outlook` / `market_report` / `review` / `prologue` |
| `proposal` | 提案本体，结构见下文"提案 schema" |
| `features.rule_decision` | 规则裁决器对同一提案的结论：`Accept` / `Reject` / `Modify`（供 Jev 参考） |
| `features.rule_reasons` | 规则裁决器给出的理由标签 |

### 响应

```json
{
  "verdict": "modify",
  "confidence": 0.82,
  "score": 0.74,
  "reasons": ["risk_too_high"],
  "modifications": { "risk": 0.35 }
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `verdict` | 是 | `"accept"` / `"reject"` / `"modify"` |
| `confidence` | 否 | 0–1，缺省为 0 |
| `score` | 否 | 合理性分数 0–1，缺省等于 `confidence`；`accept`/`modify` 时低于 `min_score` 视为拒绝 |
| `reasons` | 否 | 理由标签（字符串数组），写入 AI 审计日志 |
| `modifications` | `modify` 时 | 要替换的**顶层字段**及新值；游戏把它合并进提案本体后按 schema 重新解析，不符合 schema（例如出现未知字段、类型不对）则整体拒绝。组合事件要改效果时整体替换 `effects` 数组 |

组合事件（`kind = "composed"`）的请求示例：

```json
{
  "task": "adjudicate",
  "kind": "composed",
  "proposal": {
    "title": "码头大火",
    "narrative": "据港务厅档案记载，焦油仓在深夜起火……",
    "effects": [
      { "effect": "location_supply", "loc": "chenggang", "mult": 0.7, "days": 30 },
      { "effect": "demand_shift", "loc": "chenggang", "good": "timber", "mult": 1.5, "days": 45 }
    ]
  },
  "features": { "rule_decision": "Accept", "rule_reasons": ["规则检查通过"] }
}
```

修正示例：`{"verdict": "modify", "score": 0.8, "modifications": {"effects": [ …降低幅度后的效果… ]}}`。
Jev 可以判断叙事与效果是否一致、幅度是否与局势相称；边界、冷却、叠加等硬约束无论 Jev 如何裁决都由内核再查一次。

## 2. 意图分类 `POST /v1/classify`

### 请求

```json
{ "task": "classify_intent", "text": "看在老朋友的份上，再便宜点", "features": { "loc": "澄港" } }
```

### 响应

```json
{ "label": "rapport", "confidence": 0.91 }
```

`label` 取值：`discount`（让价）、`threat`（威胁）、`bribe`（贿赂）、`rapport`（套交情）、`irrelevant`（无关）。
折扣、贿赂金额与声望变化由内核按意图、关系与交易能力计算，并有上限；Jev 只决定意图。

## 3. 超时与错误

以下情况一律回退到 `RuleAdjudicator`（审计日志中裁决来源记为 `rule(回退)`，并记录原因）：

- 超过 `timeout_ms` 未响应；
- 无法连接；
- HTTP 状态码不是 2xx；
- 响应体不是 JSON，或缺少 `verdict` / `label`，或取值不在上述集合中。

回退时意图分类改用关键词规则。游戏不会重试同一请求，也不会因为 Jev 不可用而阻塞模拟。

## 4. 提案 schema

所有提案都拒绝未知字段（例如"凭空给钱"的额外字段会在解析阶段被拒绝）。key 均为 `data/` 中的标识。

| 类型 | 字段 |
|---|---|
| `director` | `events`: 0–3 个 `{ "event": 事件 key, "params": { loc?, good?, region?, faction_a?, faction_b?, mult?, days?, delta? } }`；事件必须在 `data/events.toml` 中，参数按事件效果取用，并受该事件的范围约束 |
| `rumor` | `text`: 传闻文字（真假由内核决定，不受文字影响） |
| `bargain` | `reply`: NPC 回复台词 |
| `strategy` | `risk`: 风险偏好（内核夹紧到 0.2–0.8）；`preferred`: 至多 3 个商品 key；`memo`: 备注 |
| `contract` | `issuer`: 势力 key；`good`: 商品 key；`to`: 目的港 key（须属于发布方势力）；`qty`；`days`（20–180）；`reward`（须在合理区间内） |
| `chronicle` | `text`: 编年史正文 |
| `composed` | `title`: 标题；`narrative`: 叙事；`effects`: 1–`max_effects` 个效果，每个是按 `effect` 标签区分的对象，参数全部必填（见下表）；边界、条数上限与总强度预算（各效果 \|mult − 1\| 之和）来自 `data/effects.toml` |
| `outlook` | 商会展望：`views`: 至多 4 个 `{ "good": 商品 key, "view": -2…2 }`（同一商品不重复）；`method`: `fundamental` / `trend` / `adaptive`；`memo`: 不超过 60 字的备忘。内核另查距上次展望 ≥ 25 天 |
| `market_report` | `text`: 市场月报正文（≤ 400 字；只能引用内核给的事实） |
| `review` | `text`: 预测复盘点评（≤ 300 字；按需、只返回文字，不产生命令） |
| `prologue` | `text`: 身世序章（≤ 400 字；按需、只返回文字，不产生命令） |

组合事件的效果词表：

| `effect` | 参数 |
|---|---|
| `good_supply` / `good_demand` | `good`, `mult`, `days` |
| `supply_shift` / `demand_shift` | `loc`, `good`, `mult`, `days` |
| `location_supply` / `location_demand` | `loc`, `mult`, `days` |
| `popularity` | `loc`, `good`, `days` |
| `region_storm` / `region_pirates` | `region`, `mult`, `days` |
| `relation_shift` | `faction_a`, `faction_b`, `delta` |
| `faction_tax` | `faction`, `mult`, `days` |
| `development` | `loc`（港口）, `delta` |
| `interest_shift` / `industry_efficiency` | `mult`, `days` |
| `colony_output` | `loc`（已有殖民地的殖民点）, `building`（有产出的殖民地建筑 key，或 `all` 表示全部建筑）, `mult`, `days` |
| `colony_morale` | `loc`（已有殖民地的殖民点）, `delta` |
| `colony_growth` | `loc`（已有殖民地的殖民点）, `mult`, `days` |
| `site_claim` | `loc`（无主的殖民点）, `faction`（一次性；遵守殖民竞赛的节奏限制，交战中的势力不能占领） |
| `discovery_rumor` | `discovery`（玩家尚未发现的发现物；一次性，只让玩家得知其大致海区） |
| `export_ban` | `faction`, `good`, `days`（该势力的地点不许买走这种商品；势力须有地点交易它） |
| `import_tariff` / `export_tariff` | `faction`, `good`, `mult`, `days`（在该势力的地点卖出 / 买入这种商品时交易税乘上系数） |
| `subsidy` | `loc`, `good`, `mult`, `days`（该地这种商品的产量乘上系数；该地须交易它） |

殖民地都属于玩家：殖民地效果的负面幅度有硬上限（`effects.toml` 中 mult 下限 ≥ 0.6、delta 下限 ≥ −15），
新建立或正处困境（断粮、近期遭袭）的殖民地不受负面效果；殖民地是否存在、殖民点归属、玩家名声由内核按局势检查。

发给 LLM 的 JSON Schema 由 `manifest_ai::schema::output_schema(kind, &StaticData)` 从数据生成（满足严格模式：全部字段必填、
`additionalProperties: false`，边界写成 `minimum` / `maximum`，key 写成 `enum`），写在提示词里，也用于供应商侧的结构化输出
（Anthropic 工具调用 / OpenAI 兼容 json_schema）。由类型推导的通用 Schema 见 `manifest_ai::proposal::schema_json(kind)`。

## 5. 适配层示例（伪代码）

```text
POST /v1/adjudicate:
    jev_input  = { "type": body.kind, "payload": body.proposal, "hints": body.features }
    jev_output = jev.judge(jev_input)
    return { "verdict": jev_output.decision, "confidence": jev_output.conf,
             "score": jev_output.plausibility, "reasons": jev_output.tags,
             "modifications": jev_output.patch }

POST /v1/classify:
    out = jev.intent(body.text)
    return { "label": map_label(out.label), "confidence": out.conf }
```

## 6. 测试

`crates/manifest-ai/tests/jev.rs` 用 wiremock 模拟本契约：正常（接受、拒绝、修正、低分、意图分类、请求体格式）、
超时、错误响应（5xx、非 JSON、缺字段、未知取值、无法连接）；以及 Jev 接受非法提案后内核仍拒绝。
`crates/manifest-ai/tests/jev_composed.rs` 覆盖组合事件：请求体、整体替换 `effects` 的修正、越出词表的修正被拒绝、
Jev 接受越界的组合事件后内核仍拒绝。
运行：`cargo test -p manifest-ai --features jev`（`cargo xtask verify` 使用 `--all-features`，已包含）。

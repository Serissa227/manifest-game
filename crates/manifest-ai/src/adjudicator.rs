//! 裁决：对提案给出 Accept / Reject / Modify（参数修正），附理由标签、置信度与合理性分数；
//! 以及对玩家议价输入做意图分类。
//!
//! [`RuleAdjudicator`] 是没有 Jev 时的默认裁决器：基于 schema、参数范围与局势一致性规则。
//! 无论裁决结果如何，转成命令前内核还会再校验一次。

use crate::proposal::{ComposedEventProposal, Proposal, StrategyProposal};
use crate::resolve::{resolve_composed_effect, resolve_contract, resolve_event, resolve_strategy};
use manifest_core::StaticData;
use manifest_core::composed::{ComposedEffect, EffectTarget, fx_short, strength};
use manifest_core::defs::EventRequire;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::fixed::Fx;
use manifest_core::ids::FactionId;
use manifest_core::news::{self, Intent};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// 裁决结论。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Decision {
    Accept,
    Reject,
    Modify,
}

/// 裁决结果。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Verdict {
    pub decision: Decision,
    /// 接受或修正后的提案；拒绝时为 None
    pub proposal: Option<Proposal>,
    /// 理由标签
    pub reasons: Vec<String>,
    pub confidence: f64,
    /// 合理性分数 0–1
    pub score: f64,
    /// 裁决来源：rule / jev / rule(回退)
    pub via: String,
}

/// 裁决所需的上下文（在准备任务时从世界状态中截取）。
#[derive(Clone, Debug)]
pub struct AdjudicationContext {
    pub defs: Arc<StaticData>,
    pub relations: Vec<(FactionId, FactionId, DiploStatus)>,
}

impl AdjudicationContext {
    fn status(&self, a: FactionId, b: FactionId) -> DiploStatus {
        self.relations
            .iter()
            .find(|(x, y, _)| (*x == a && *y == b) || (*x == b && *y == a))
            .map(|(_, _, s)| *s)
            .unwrap_or(DiploStatus::Peace)
    }
}

/// 基于规则的裁决器。
#[derive(Clone, Debug)]
pub struct RuleAdjudicator {
    /// 合理性分数低于该值的提案不执行
    pub min_score: f64,
}

impl Default for RuleAdjudicator {
    fn default() -> Self {
        Self { min_score: 0.5 }
    }
}

fn reject(reasons: Vec<String>) -> Verdict {
    Verdict { decision: Decision::Reject, proposal: None, reasons, confidence: 0.95, score: 0.0, via: "rule".into() }
}

fn accept(p: &Proposal, score: f64) -> Verdict {
    Verdict {
        decision: Decision::Accept,
        proposal: Some(p.clone()),
        reasons: vec!["规则检查通过".into()],
        confidence: 0.9,
        score,
        via: "rule".into(),
    }
}

/// 检查一段生成文字。
fn text_ok(text: &str, max: usize) -> Result<(), String> {
    news::check_text(text, max).map_err(|e| e.to_string())?;
    let lower = text.to_lowercase();
    for bad in ["http://", "https://", "api key", "apikey", "sk-", "密钥"] {
        if lower.contains(bad) {
            return Err(format!("文字包含不允许的内容“{bad}”"));
        }
    }
    Ok(())
}

impl RuleAdjudicator {
    pub fn adjudicate(&self, p: &Proposal, ctx: &AdjudicationContext) -> Verdict {
        let defs = &ctx.defs;
        let v = match p {
            Proposal::Ripple(r) => match crate::pipeline::f9::ripple::static_check(r, ctx) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Persona(_)
            | Proposal::Daily(_)
            | Proposal::Narration(_)
            | Proposal::Letter(_)
            | Proposal::AltChronicle(_)
            | Proposal::Diary(_) => match crate::pipeline::f9::static_check(p, defs) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Director(d) => {
                if d.events.len() > 3 {
                    return reject(vec!["一次最多 3 个事件".into()]);
                }
                let mut reasons = Vec::new();
                let mut seen = Vec::new();
                for pick in &d.events {
                    if seen.contains(&pick.event) {
                        reasons.push(format!("事件“{}”重复", pick.event));
                        continue;
                    }
                    seen.push(pick.event.clone());
                    match resolve_event(defs, pick) {
                        Err(e) => reasons.push(e),
                        Ok((kind, params)) => {
                            let def = defs.event_type(kind);
                            let e = def.effect;
                            let presence = [
                                (e.needs_loc(), params.loc.is_some()),
                                (e.needs_good(), params.good.is_some()),
                                (e.needs_region(), params.region.is_some()),
                                (e.needs_faction_a(), params.faction_a.is_some()),
                                (e.needs_faction_b(), params.faction_b.is_some()),
                                (e.needs_mult(), params.mult.is_some()),
                                (e.needs_days(), params.days.is_some()),
                                (e.needs_delta(), params.delta.is_some()),
                            ];
                            if presence.iter().any(|(need, has)| need != has) {
                                reasons.push(format!("事件“{}”的参数与效果不符", def.key));
                                continue;
                            }
                            if let (Some(m), Some((lo, hi))) = (params.mult, def.mult)
                                && (m < lo || m > hi)
                            {
                                reasons.push(format!("事件“{}”的系数越界", def.key));
                            }
                            if let (Some(d), Some((lo, hi))) = (params.days, def.days)
                                && (d < lo || d > hi)
                            {
                                reasons.push(format!("事件“{}”的天数越界", def.key));
                            }
                            if let (Some(d), Some((lo, hi))) = (params.delta, def.delta)
                                && (d < lo || d > hi)
                            {
                                reasons.push(format!("事件“{}”的变化量越界", def.key));
                            }
                            if let Some(loc) = params.loc {
                                if def.port_only && !defs.loc(loc).is_port() {
                                    reasons.push(format!("事件“{}”只能发生在港口", def.key));
                                }
                                if let Some(g) = params.good
                                    && !defs.loc(loc).market.iter().any(|m| m.good == g)
                                {
                                    reasons.push(format!("事件“{}”：该地不交易这种商品", def.key));
                                }
                                if !def.locs.is_empty() && !def.locs.contains(&loc) {
                                    reasons.push(format!("事件“{}”不适用于这个地点", def.key));
                                }
                            }
                            if let Some(r) = params.region
                                && !def.regions.is_empty()
                                && !def.regions.contains(&r)
                            {
                                reasons.push(format!("事件“{}”不适用于这片海区", def.key));
                            }
                            if !def.factions.is_empty()
                                && [params.faction_a, params.faction_b]
                                    .into_iter()
                                    .flatten()
                                    .any(|f| !def.factions.contains(&f))
                            {
                                reasons.push(format!("事件“{}”不适用于这个势力", def.key));
                            }
                            if let Some(g) = params.good
                                && !def.goods.is_empty()
                                && !def.goods.contains(&g)
                            {
                                reasons.push(format!("事件“{}”不适用于这种商品", def.key));
                            }
                            if params.faction_a.is_some() && params.faction_a == params.faction_b {
                                reasons.push(format!("事件“{}”的两个势力相同", def.key));
                            }
                            // 局势一致性：例如和平状态下不能直接出现战争风声
                            if let (Some(a), Some(b)) = (params.faction_a, params.faction_b) {
                                let status = ctx.status(a, b);
                                let ok = match def.requires {
                                    EventRequire::None => true,
                                    EventRequire::Tension => status == DiploStatus::Tension,
                                    EventRequire::TensionOrWar => {
                                        matches!(status, DiploStatus::Tension | DiploStatus::War)
                                    }
                                };
                                if !ok {
                                    reasons.push(format!("事件“{}”与当前外交局势不符", def.key));
                                }
                            }
                        }
                    }
                }
                if reasons.is_empty() { accept(p, 1.0) } else { reject(reasons) }
            }
            Proposal::Rumor(r) => match text_ok(&r.text, news::MAX_NEWS_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Bargain(b) => match text_ok(&b.reply, news::MAX_REPLY_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Chronicle(c) => match text_ok(&c.text, news::MAX_CHRONICLE_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Strategy(s) => match resolve_strategy(defs, s) {
                Err(e) => reject(vec![e]),
                Ok((risk, goods)) => {
                    // 夹紧到允许范围，丢弃未知商品：以"修正"接受
                    let (lo, hi) = news::RISK_RANGE;
                    let clamped = risk.clamp(lo, hi);
                    let keys: Vec<String> = goods.iter().map(|g| defs.good(*g).key.clone()).collect();
                    let memo_ok = s.memo.chars().count() <= 200;
                    if clamped == risk && keys == s.preferred && memo_ok {
                        accept(p, 1.0)
                    } else {
                        let fixed = StrategyProposal {
                            risk: clamped.raw() as f64 / Fx::SCALE as f64,
                            preferred: keys,
                            memo: s.memo.chars().take(200).collect(),
                        };
                        Verdict {
                            decision: Decision::Modify,
                            proposal: Some(Proposal::Strategy(fixed)),
                            reasons: vec!["参数已夹紧到允许范围".into()],
                            confidence: 0.9,
                            score: 0.8,
                            via: "rule".into(),
                        }
                    }
                }
            },
            Proposal::Composed(c) => {
                let reasons = check_composed(c, ctx);
                if reasons.is_empty() { accept(p, 1.0) } else { reject(reasons) }
            }
            Proposal::Outlook(o) => {
                let mut reasons = Vec::new();
                if o.views.len() > manifest_core::commerce::OUTLOOK_MAX_VIEWS {
                    reasons.push(format!(
                        "看法 {} 条，最多 {} 条",
                        o.views.len(),
                        manifest_core::commerce::OUTLOOK_MAX_VIEWS
                    ));
                }
                match crate::resolve::resolve_outlook(defs, o) {
                    Err(e) => reasons.push(e),
                    Ok((views, _)) => {
                        for (i, (g, v)) in views.iter().enumerate() {
                            if !(-2..=2).contains(v) {
                                reasons.push(format!("看法 {v} 不在 -2 到 2 之间"));
                            }
                            if views[..i].iter().any(|(h, _)| h == g) {
                                reasons.push("同一种商品的看法重复".into());
                            }
                        }
                    }
                }
                if let Err(e) = text_ok(&o.memo, manifest_core::commerce::MAX_MEMO_CHARS) {
                    reasons.push(e);
                }
                if reasons.is_empty() { accept(p, 1.0) } else { reject(reasons) }
            }
            Proposal::MarketReport(t) => match text_ok(&t.text, manifest_core::report::MAX_REPORT_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Review(t) => match text_ok(&t.text, crate::proposal::MAX_REVIEW_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Prologue(t) => match text_ok(&t.text, crate::proposal::MAX_PROLOGUE_CHARS) {
                Ok(()) => accept(p, 1.0),
                Err(e) => reject(vec![e]),
            },
            Proposal::Contract(c) => match resolve_contract(defs, c) {
                Err(e) => reject(vec![e]),
                Ok((issuer, good, qty, to, days, reward)) => {
                    let mut reasons = Vec::new();
                    if !defs.loc(to).is_port() || defs.loc(to).faction != issuer {
                        reasons.push("目的港必须是发布方势力的港口".to_string());
                    }
                    if !defs.loc(to).market.iter().any(|m| m.good == good) {
                        reasons.push("目的港不交易该商品".to_string());
                    }
                    if !(1..=2_000).contains(&qty) {
                        reasons.push("数量越界".to_string());
                    }
                    if !(20..=180).contains(&days) {
                        reasons.push("期限越界".to_string());
                    }
                    let fair = if defs.rules.contracts.v2.enabled {
                        let listed = defs.loc(to).market.iter().any(|m| m.good == good && !m.specialty);
                        if !listed
                            || defs.good(good).license
                            || !manifest_core::contract::route_allowed(defs, to, good, false)
                        {
                            return reject(vec!["没有起运地".into()]);
                        }
                        manifest_core::contract::fair_reward_v2(defs, good, qty.max(1), to, days as i64)
                    } else {
                        Some(manifest_core::contract::fair_reward(defs, good, qty.max(1), days as i64))
                    };
                    let Some(fair) = fair else { return reject(vec!["没有起运地".into()]) };
                    if reward < fair / 2 || reward > fair * 2 {
                        reasons.push(format!("报酬 {reward} 不在合理区间 {}–{}", fair / 2, fair * 2));
                    }
                    if reasons.is_empty() { accept(p, 1.0) } else { reject(reasons) }
                }
            },
        };
        if v.decision != Decision::Reject && v.score < self.min_score {
            return reject(vec![format!("合理性分数 {:.2} 低于阈值", v.score)]);
        }
        v
    }

    /// 议价意图分类：关键词与简单规则。
    pub fn classify_intent(&self, text: &str) -> (Intent, f64) {
        const TABLE: [(Intent, &[&str]); 4] = [
            (
                Intent::Threat,
                &["否则", "不然", "小心", "后果", "砸了", "告发", "报官", "找人", "揍", "威胁", "走着瞧", "别怪"],
            ),
            (
                Intent::Bribe,
                &["好处", "红包", "意思意思", "酬谢", "孝敬", "塞点", "银子", "送你", "小费", "茶钱", "打点"],
            ),
            (Intent::Rapport, &["老朋友", "交情", "兄弟", "老主顾", "常来", "老乡", "朋友", "照顾", "看在", "熟人"]),
            (
                Intent::Discount,
                &["便宜", "优惠", "打折", "折扣", "降价", "少算", "让点", "砍价", "划算", "贵了", "再少"],
            ),
        ];
        // 英文界面的议价（EXPANSION.md §12）：同样的关键词规则，不区分大小写
        const TABLE_EN: [(Intent, &[&str]); 4] = [
            (
                Intent::Threat,
                &[
                    "or else",
                    "otherwise",
                    "watch out",
                    "consequences",
                    "you'll regret",
                    "threat",
                    "report you",
                    "smash",
                ],
            ),
            (
                Intent::Bribe,
                &["bribe", "a little something", "for your trouble", "a tip", "sweeten", "grease", "a gift"],
            ),
            (
                Intent::Rapport,
                &["old friend", "friend", "brother", "regular", "old times", "go way back", "loyal customer"],
            ),
            (
                Intent::Discount,
                &["discount", "cheaper", "lower", "better price", "too expensive", "reduce", "knock off", "deal"],
            ),
        ];
        let lower = text.to_lowercase();
        let mut best = (Intent::Irrelevant, 0usize);
        for ((intent, words), (_, en)) in TABLE.into_iter().zip(TABLE_EN) {
            let hits =
                words.iter().filter(|w| text.contains(**w)).count() + en.iter().filter(|w| lower.contains(**w)).count();
            if hits > best.1 {
                best = (intent, hits);
            }
        }
        let confidence = if best.1 == 0 { 0.6 } else { best.1 as f64 / (best.1 as f64 + 1.0) };
        (best.0, confidence)
    }
}

/// 组合事件的规则检查，返回全部问题（空表示通过）：效果数量、文字、效果在词表中、目标存在、
/// 参数范围（含系数不为 1、变化量不为 0）、港口与市场、殖民点与建筑、外交前提、同一目标重复、总强度预算。
/// 冷却、频率、"不与进行中的效果叠加"、殖民地是否存在与殖民点归属依赖世界状态，由内核校验。
pub fn check_composed(c: &ComposedEventProposal, ctx: &AdjudicationContext) -> Vec<String> {
    let defs = &ctx.defs;
    let rules = &defs.composed;
    let mut reasons = Vec::new();
    if let Err(e) = text_ok(&c.title, rules.max_title_chars) {
        reasons.push(format!("标题：{e}"));
    }
    if let Err(e) = text_ok(&c.narrative, rules.max_text_chars) {
        reasons.push(format!("叙事：{e}"));
    }
    if c.effects.is_empty() || c.effects.len() > rules.max_effects {
        reasons.push(format!("效果数量 {} 不在 1–{} 之间", c.effects.len(), rules.max_effects));
        return reasons;
    }
    let mut resolved: Vec<ComposedEffect> = Vec::new();
    for raw in &c.effects {
        let key = raw.kind().key();
        let Some(b) = rules.bounds(raw.kind()) else {
            reasons.push(format!("效果 {key} 不在效果词表中"));
            continue;
        };
        let e = match resolve_composed_effect(defs, raw) {
            Ok(e) => e,
            Err(why) => {
                reasons.push(format!("效果 {key}：{why}"));
                continue;
            }
        };
        let p = &e.params;
        if let (Some(m), Some((lo, hi))) = (p.mult, b.mult) {
            if m < lo || m > hi {
                reasons.push(format!("效果 {key} 的系数越界"));
            }
            if m == Fx::ONE {
                reasons.push(format!("效果 {key} 的系数为 1，没有效果"));
            }
        }
        if let (Some(d), Some((lo, hi))) = (p.days, b.days)
            && (d < lo || d > hi)
        {
            reasons.push(format!("效果 {key} 的天数越界"));
        }
        if let (Some(d), Some((lo, hi))) = (p.delta, b.delta) {
            if d < lo || d > hi {
                reasons.push(format!("效果 {key} 的变化量越界"));
            }
            if d == 0 {
                reasons.push(format!("效果 {key} 的变化量为 0，没有效果"));
            }
        }
        if let Some(loc) = p.loc {
            let l = defs.loc(loc);
            if b.port_only && !l.is_port() {
                reasons.push(format!("效果 {key} 只能作用于港口"));
            }
            if e.effect.targets_site() {
                // 殖民地与占领类效果只作用于殖民点（有没有殖民地、是否无主由内核按局势再查）
                if !l.is_site() {
                    reasons.push(format!("效果 {key} 只能作用于殖民点"));
                }
            } else {
                if l.is_site() {
                    reasons.push(format!("效果 {key} 不能作用于殖民点"));
                } else if l.market.is_empty() {
                    reasons.push(format!("效果 {key}：该地没有市场"));
                }
                if let Some(g) = p.good
                    && !l.market.iter().any(|m| m.good == g)
                {
                    reasons.push(format!("效果 {key}：该地不交易这种商品"));
                }
            }
        }
        if let Some(bld) = p.building
            && !manifest_core::colony::is_productive(defs, bld)
        {
            reasons.push(format!("效果 {key}：这种殖民地建筑没有产出"));
        }
        // 外交限制：交战中的势力不能因事件占领殖民点
        if let (manifest_core::defs::EffectKind::SiteClaim, Some(f)) = (e.effect, p.faction_a)
            && ctx.relations.iter().any(|(a, x, s)| (*a == f || *x == f) && *s == DiploStatus::War)
        {
            reasons.push(format!("效果 {key}：该势力正处于战争中，不能占领殖民点"));
        }
        if p.faction_a.is_some() && p.faction_a == p.faction_b {
            reasons.push(format!("效果 {key} 的两个势力相同"));
        }
        // 外交前提：和平或停战的两国之间，关系不能一次剧烈变化
        if let (Some(a), Some(f), Some(d), Some((lo, hi))) = (p.faction_a, p.faction_b, p.delta, b.peace_delta) {
            let status = ctx.status(a, f);
            if matches!(status, DiploStatus::Peace | DiploStatus::Truce) && !(lo..=hi).contains(&d) {
                reasons.push(format!("效果 {key} 与当前外交局势不符（和平时变化量须在 {lo}–{hi} 之间）"));
            }
        }
        let target = EffectTarget::of(e.effect, p);
        if resolved.iter().any(|x| EffectTarget::of(x.effect, &x.params) == target) {
            reasons.push(format!("效果 {key} 与前面的效果重复（同一目标的同类效果）"));
        }
        resolved.push(e);
    }
    let total = strength(&resolved);
    if total > rules.budget {
        reasons.push(format!("总强度 {} 超出预算 {}", fx_short(total), fx_short(rules.budget)));
    }
    reasons
}

/// 意图的英文标签（Jev 契约与离线模板使用）。
pub fn intent_label(i: Intent) -> &'static str {
    match i {
        Intent::Discount => "discount",
        Intent::Threat => "threat",
        Intent::Bribe => "bribe",
        Intent::Rapport => "rapport",
        Intent::Irrelevant => "irrelevant",
    }
}

pub fn intent_from_label(s: &str) -> Option<Intent> {
    Some(match s {
        "discount" => Intent::Discount,
        "threat" => Intent::Threat,
        "bribe" => Intent::Bribe,
        "rapport" => Intent::Rapport,
        "irrelevant" => Intent::Irrelevant,
        _ => return None,
    })
}

/// Jev 连接配置（可写入设置文件）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct JevConfig {
    pub base_url: String,
    pub timeout_ms: u64,
    /// 合理性分数阈值
    pub min_score: f64,
}

#[cfg(feature = "jev")]
pub use jev::JevAdjudicator;

#[cfg(feature = "jev")]
mod jev {
    //! Jev 裁决器：实现 docs/JEV_CONTRACT.md 中的 HTTP 契约；超时或出错时回退到 RuleAdjudicator。

    use super::*;
    use crate::proposal::Proposal;
    use serde_json::json;
    use std::time::Duration;

    pub struct JevAdjudicator {
        config: JevConfig,
        client: reqwest::Client,
        fallback: RuleAdjudicator,
    }

    impl JevAdjudicator {
        pub fn new(config: JevConfig) -> Self {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_millis(config.timeout_ms.max(1)))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());
            let fallback = RuleAdjudicator { min_score: config.min_score };
            Self { config, client, fallback }
        }

        fn url(&self, path: &str) -> String {
            format!("{}{}", self.config.base_url.trim_end_matches('/'), path)
        }

        async fn post(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
            let resp = self
                .client
                .post(self.url(path))
                .json(&body)
                .send()
                .await
                .map_err(|e| if e.is_timeout() { "Jev 超时".to_string() } else { "Jev 连接失败".to_string() })?;
            if !resp.status().is_success() {
                return Err(format!("Jev 返回错误 {}", resp.status().as_u16()));
            }
            resp.json().await.map_err(|_| "Jev 响应无法解析".to_string())
        }

        fn fallback_verdict(&self, p: &Proposal, ctx: &AdjudicationContext, why: String) -> Verdict {
            let mut v = self.fallback.adjudicate(p, ctx);
            v.via = "rule(回退)".into();
            v.reasons.insert(0, why);
            v
        }

        pub async fn adjudicate(&self, p: &Proposal, ctx: &AdjudicationContext) -> Verdict {
            let rule = self.fallback.adjudicate(p, ctx);
            let body = json!({
                "task": "adjudicate",
                "kind": p.kind().key(),
                "proposal": p.body_json(),
                "features": {
                    "rule_decision": format!("{:?}", rule.decision),
                    "rule_reasons": rule.reasons,
                },
            });
            let resp = match self.post("/v1/adjudicate", body).await {
                Ok(v) => v,
                Err(why) => return self.fallback_verdict(p, ctx, why),
            };
            let decision = match resp["verdict"].as_str() {
                Some("accept") => Decision::Accept,
                Some("reject") => Decision::Reject,
                Some("modify") => Decision::Modify,
                _ => return self.fallback_verdict(p, ctx, "Jev 响应缺少 verdict".into()),
            };
            let confidence = resp["confidence"].as_f64().unwrap_or(0.0);
            let score = resp["score"].as_f64().unwrap_or(confidence);
            let reasons: Vec<String> = resp["reasons"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let proposal = match decision {
                Decision::Reject => None,
                Decision::Accept => Some(p.clone()),
                Decision::Modify => {
                    // 把修正合并进提案本体后重新按 schema 解析
                    let mut body = p.body_json();
                    if let (Some(obj), Some(mods)) = (body.as_object_mut(), resp["modifications"].as_object()) {
                        for (k, v) in mods {
                            obj.insert(k.clone(), v.clone());
                        }
                    }
                    match Proposal::from_body(p.kind(), body) {
                        Ok(fixed) => Some(fixed),
                        Err(_) => {
                            return Verdict {
                                decision: Decision::Reject,
                                proposal: None,
                                reasons: vec!["Jev 的修正不符合 schema".into()],
                                confidence,
                                score: 0.0,
                                via: "jev".into(),
                            };
                        }
                    }
                }
            };
            if decision != Decision::Reject && score < self.config.min_score {
                return Verdict {
                    decision: Decision::Reject,
                    proposal: None,
                    reasons: vec![format!("合理性分数 {score:.2} 低于阈值")],
                    confidence,
                    score,
                    via: "jev".into(),
                };
            }
            Verdict { decision, proposal, reasons, confidence, score, via: "jev".into() }
        }

        pub async fn classify_intent(&self, text: &str, loc: &str) -> (Intent, f64, String) {
            let body = json!({"task": "classify_intent", "text": text, "features": {"loc": loc}});
            match self.post("/v1/classify", body).await {
                Ok(v) => match v["label"].as_str().and_then(intent_from_label) {
                    Some(i) => (i, v["confidence"].as_f64().unwrap_or(0.0), "jev".into()),
                    None => {
                        let (i, c) = self.fallback.classify_intent(text);
                        (i, c, "rule(回退)".into())
                    }
                },
                Err(_) => {
                    let (i, c) = self.fallback.classify_intent(text);
                    (i, c, "rule(回退)".into())
                }
            }
        }
    }
}

/// 裁决器：默认规则裁决；启用 `jev` 特性时可使用 Jev。
pub enum Adjudicator {
    Rule(RuleAdjudicator),
    #[cfg(feature = "jev")]
    Jev(JevAdjudicator),
}

impl Adjudicator {
    pub async fn adjudicate(&self, p: &Proposal, ctx: &AdjudicationContext) -> Verdict {
        match self {
            Adjudicator::Rule(r) => r.adjudicate(p, ctx),
            #[cfg(feature = "jev")]
            Adjudicator::Jev(j) => j.adjudicate(p, ctx).await,
        }
    }

    /// 意图分类，返回（意图, 置信度, 来源）。
    pub async fn classify_intent(&self, text: &str, loc: &str) -> (Intent, f64, String) {
        match self {
            Adjudicator::Rule(r) => {
                let _ = loc;
                let (i, c) = r.classify_intent(text);
                (i, c, "rule".into())
            }
            #[cfg(feature = "jev")]
            Adjudicator::Jev(j) => j.classify_intent(text, loc).await,
        }
    }

    /// 是否通过网络裁决（Jev）。
    pub fn is_remote(&self) -> bool {
        match self {
            Adjudicator::Rule(_) => false,
            #[cfg(feature = "jev")]
            Adjudicator::Jev(_) => true,
        }
    }

    /// 规则裁决的同步版本（离线模式与无 Jev 时使用）。
    pub fn rule(&self) -> RuleAdjudicator {
        match self {
            Adjudicator::Rule(r) => r.clone(),
            #[cfg(feature = "jev")]
            Adjudicator::Jev(_) => RuleAdjudicator::default(),
        }
    }
}

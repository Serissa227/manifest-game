//! AI 管线：LLM 提案 → 裁决 → 内核校验 → 命令。
//!
//! 1. [`AiPipeline::prepare`]（同步，读世界）：生成有长度上限的世界摘要、模板变量、离线备选与裁决上下文。
//! 2. [`AiPipeline::process`]（异步，不读世界，不阻塞 tick）：议价先做意图分类；渲染提示词；
//!    按缓存 → 预算 → 提供商的顺序取得原始文字（未配置、超预算或失败时用离线模板）；
//!    解析（失败则修复一次，仍失败丢弃）；裁决。
//! 3. [`AiPipeline::finalize`]（同步，读世界）：转为命令并经内核校验，通过的命令由会话排到未来的 tick 并写入日志。
//!
//! 输出结构（[`crate::schema::output_schema`]）由代码从数据生成，既写进提示词，也交给提供商做结构化输出
//! （Anthropic 工具调用 / OpenAI 兼容 json_schema）；结构化输出只保证格式，内容仍要经过裁决与内核校验。
//!
//! 每一步都写入审计日志。

pub mod f9;

use crate::adjudicator::{
    AdjudicationContext, Adjudicator, Decision, JevConfig, RuleAdjudicator, Verdict, intent_label,
};
use crate::gate::CallGate;
use crate::offline;
use crate::parse::{ParseStage, parse_proposal};
use crate::proposal::Proposal;
use crate::provider::{LlmRequest, ModelTier, Provider, ProviderConfig};
use crate::resolve::{resolve_composed_effect, resolve_contract, resolve_event, resolve_strategy};
use crate::schema::output_schema;
use manifest_core::calendar::Calendar;
use manifest_core::composed::{ComposedSource, effect_vocabulary, frontier_catalog, recent_history};
use manifest_core::fixed::{Fx, mul_div};
use manifest_core::ids::*;
use manifest_core::news::{Intent, NewsPlan, NewsSource};
use manifest_core::summary::{
    event_catalog, fact_text, key_catalog, owner_name, report_facts_text, world_date_text, world_summary,
    year_facts_text, year_text,
};
use manifest_core::text::TextRef;
use manifest_core::{Command, World};
use manifest_data::{AiContent, Locale, LocaleBundle, PromptTemplate, ProposalKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// AI 运行模式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AiMode {
    /// 不运行 AI（重放与读档时）
    Off,
    /// 只用离线模板
    Offline,
    /// 使用 Mock LLM（测试与演示）
    Mock,
    /// 使用配置的真实提供商
    Live,
}

/// AI 设置（可写入设置文件；密钥另存于系统凭据管理器）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiSettings {
    pub mode: AiMode,
    pub provider: Option<ProviderConfig>,
    pub tier: ModelTier,
    /// 每游戏月的调用次数上限
    pub monthly_calls: u32,
    /// 每游戏月的 token 上限
    pub monthly_tokens: u64,
    /// Jev（启用 `jev` 特性时生效）
    pub jev: Option<JevConfig>,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            mode: AiMode::Offline,
            provider: None,
            tier: ModelTier::Balanced,
            monthly_calls: 60,
            monthly_tokens: 200_000,
            jev: None,
        }
    }
}

/// 任务请求。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskRequest {
    Ripple {
        event: String,
    },
    Narration {
        event: String,
        phase: String,
    },
    Letter {
        id: String,
        purpose: String,
    },
    AltChronicle {
        year: u32,
    },
    Diary {
        year: u32,
        month: u32,
    },
    Director,
    Rumor,
    Bargain {
        owner: OwnerId,
        loc: LocId,
        player_text: String,
    },
    Strategy {
        company: CompanyId,
    },
    Contract,
    Chronicle {
        year: u32,
    },
    /// 组合事件：模型在结构约束下从效果词表中组合事件
    Composed,
    /// 商会展望（每家商会每月一次）
    Outlook {
        company: CompanyId,
    },
    /// 市场月报（每月至多两个海区）
    MarketReport {
        region: RegionId,
    },
    /// 预测复盘点评（按需；诊断与驱动由界面按当前语言写好）
    Review {
        place: String,
        facts: Vec<String>,
    },
    Persona {
        owner: OwnerId,
        person: String,
        player_text: String,
    },
    Daily {
        owner: OwnerId,
        person: String,
    },
    /// 身世序章（按需；身世由应用层按当前语言写好）
    Prologue {
        captain: crate::offline::PrologueFacts,
    },
}

/// 任务附带的内核信息。
#[derive(Clone, Debug)]
pub enum TaskExtra {
    F9(Box<f9::F9Context>),
    None,
    Rumor {
        plan: NewsPlan,
    },
    Bargain {
        owner: OwnerId,
        loc: LocId,
        player_text: String,
        options: Vec<(Intent, Fx, String)>,
        /// 各意图的离线回复的模板位置（与 `options` 一一对应）
        tpls: Vec<Option<TextRef>>,
    },
    Strategy {
        company: CompanyId,
    },
    Chronicle {
        year: u32,
    },
    Outlook {
        company: CompanyId,
    },
    MarketReport {
        region: RegionId,
        month: u32,
    },
    /// 只返回文字的任务（复盘点评、身世序章）
    Text,
}

/// 准备好的任务（不再依赖世界状态，可以交给异步执行）。
#[derive(Clone, Debug)]
pub struct AiTask {
    pub kind: ProposalKind,
    pub day: u32,
    pub vars: BTreeMap<String, String>,
    /// 离线模板生成的备选提案（议价在意图确定后再选）
    pub offline: Option<Proposal>,
    /// 离线备选的模板位置与参数（传闻、议价回复、编年史）：采用的文字与离线备选逐字相同时随命令保存，
    /// 显示时按界面语言重新格式化
    pub offline_tpl: Option<TextRef>,
    pub ctx: AdjudicationContext,
    pub extra: TaskExtra,
}

/// 提案来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProposalSource {
    Llm,
    Cache,
    Offline,
}

/// 处理结果。
#[derive(Clone, Debug)]
pub struct AiOutcome {
    pub task: AiTask,
    pub source: Option<ProposalSource>,
    pub verdict: Option<Verdict>,
    pub intent: Option<Intent>,
}

impl AiOutcome {
    pub fn accepted(&self) -> Option<&Proposal> {
        self.verdict.as_ref().filter(|v| v.decision != Decision::Reject).and_then(|v| v.proposal.as_ref())
    }
}

/// 审计日志条目。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEntry {
    pub day: u32,
    pub kind: ProposalKind,
    pub stage: String,
    pub detail: String,
}

/// 本月预算使用情况（界面显示）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetStatus {
    pub month: u32,
    pub calls_used: u32,
    pub calls_limit: u32,
    pub tokens_used: u64,
    pub tokens_limit: u64,
}

const AUDIT_KEPT: usize = 400;
const CACHE_KEPT: usize = 256;
const AUDIT_DETAIL_CHARS: usize = 600;

#[derive(Default)]
struct Inner {
    budget: BudgetStatus,
    cache: BTreeMap<String, String>,
    cache_order: Vec<String>,
    audit: Vec<AuditEntry>,
}

/// AI 管线。
pub struct AiPipeline {
    account_budget: Option<(Arc<crate::account_budget::AccountBudget>, u64)>,
    content: Arc<AiContent>,
    mode: AiMode,
    tier: ModelTier,
    provider: Option<Provider>,
    adjudicator: Adjudicator,
    limits: (u32, u64),
    inner: Mutex<Inner>,
    /// 写作语言：（中文显示内容, 目标语言显示内容）；为空时按中文（EXPANSION.md §12.1）
    locale: Option<(Arc<LocaleBundle>, Arc<LocaleBundle>)>,
    /// 按现实时间的调用闸门（网页版按玩家设置，见 [`crate::gate`]）
    gate: Option<Arc<dyn CallGate>>,
}

fn source_name(s: NewsSource) -> &'static str {
    match s {
        NewsSource::Tavern => "酒馆传言",
        NewsSource::Merchant => "商人消息",
        NewsSource::Official => "官方公告",
    }
}

fn intent_name(i: Intent) -> &'static str {
    match i {
        Intent::Discount => "让价",
        Intent::Threat => "威胁",
        Intent::Bribe => "贿赂",
        Intent::Rapport => "套交情",
        Intent::Irrelevant => "无关",
    }
}

const ALL_INTENTS: [Intent; 5] = [Intent::Discount, Intent::Threat, Intent::Bribe, Intent::Rapport, Intent::Irrelevant];

/// 专名对照的长度上限（字符）。
const GLOSSARY_MAX: usize = 3_000;

/// 采用的文字与离线备选逐字相同时（离线模板、或 Mock 照抄了备选），返回离线备选的模板位置；
/// 模型写的文字没有模板位置，显示时原样显示。
///
/// 超出内核规模上限的引用（例如某年事件极多、编年史的事件列表过长）不随命令保存：
/// 引用只用于显示，不能因为它让命令被内核拒绝（那样会改变世界）；没有引用时显示中文原文。
pub fn offline_tpl_for(outcome: &AiOutcome, text: &str) -> Option<TextRef> {
    let same = match &outcome.task.offline {
        Some(Proposal::Rumor(r)) => r.text == text,
        Some(Proposal::Bargain(b)) => b.reply == text,
        Some(Proposal::Chronicle(c)) => c.text == text,
        Some(Proposal::Outlook(o)) => o.memo == text,
        Some(Proposal::MarketReport(t) | Proposal::Review(t) | Proposal::Prologue(t)) => t.text == text,
        _ => false,
    };
    if same { outcome.task.offline_tpl.clone().filter(|t| t.check().is_ok()) } else { None }
}

impl AiPipeline {
    /// 创建管线。`provider` 为 None 时（或模式为离线）一律使用离线模板。
    pub fn new(content: Arc<AiContent>, settings: &AiSettings, provider: Option<Provider>) -> Self {
        #[cfg(feature = "jev")]
        let adjudicator = match &settings.jev {
            Some(cfg) => Adjudicator::Jev(crate::adjudicator::JevAdjudicator::new(cfg.clone())),
            None => Adjudicator::Rule(RuleAdjudicator::default()),
        };
        #[cfg(not(feature = "jev"))]
        let adjudicator = Adjudicator::Rule(RuleAdjudicator::default());
        Self {
            account_budget: None,
            content,
            mode: settings.mode,
            tier: settings.tier,
            provider,
            adjudicator,
            limits: (settings.monthly_calls, settings.monthly_tokens),
            inner: Mutex::new(Inner::default()),
            locale: None,
            gate: None,
        }
    }

    /// 设置按现实时间的调用闸门：闸门关上时，这次改用离线模板（与预算用完时相同）。
    pub fn with_call_gate(mut self, gate: Arc<dyn CallGate>) -> Self {
        self.gate = Some(gate);
        self
    }

    /// 设置写作语言：提示词换成该语言的版本（有覆盖时），并要求模型用该语言写作；非中文时附上专名对照。
    /// `zh` 为中文显示内容（原数据），`to` 为目标语言。离线备选仍用中文模板生成（世界状态与语言无关），
    /// 显示时再按界面语言重新格式化。
    pub fn with_locale(mut self, zh: Arc<LocaleBundle>, to: Arc<LocaleBundle>) -> Self {
        self.locale = Some((zh, to));
        self
    }

    /// 写作语言。
    pub fn locale(&self) -> Locale {
        self.locale.as_ref().map(|(_, to)| to.locale).unwrap_or_default()
    }

    pub fn mode(&self) -> AiMode {
        self.mode
    }

    fn audit(&self, day: u32, kind: ProposalKind, stage: &str, detail: impl Into<String>) {
        let detail: String = detail.into().chars().take(AUDIT_DETAIL_CHARS).collect();
        if let Ok(mut inner) = self.inner.lock() {
            inner.audit.push(AuditEntry { day, kind, stage: stage.to_string(), detail });
            if inner.audit.len() > AUDIT_KEPT {
                let excess = inner.audit.len() - AUDIT_KEPT;
                inner.audit.drain(0..excess);
            }
        }
    }

    /// 审计日志快照。
    pub fn audit_log(&self) -> Vec<AuditEntry> {
        self.inner.lock().map(|i| i.audit.clone()).unwrap_or_default()
    }

    /// 本月预算使用情况。
    pub fn budget(&self, day: u32) -> BudgetStatus {
        self.budget_in(day, &Calendar::default())
    }

    pub fn budget_in(&self, day: u32, calendar: &Calendar) -> BudgetStatus {
        if let Some((account, binding)) = &self.account_budget {
            return account.status(*binding, day, calendar, self.limits);
        }
        let month = calendar.month_index(day);
        let inner = self.inner.lock().map(|i| i.budget.clone()).unwrap_or_default();
        let (calls_used, tokens_used) =
            if inner.month == month { (inner.calls_used, inner.tokens_used) } else { (0, 0) };
        BudgetStatus { month, calls_used, calls_limit: self.limits.0, tokens_used, tokens_limit: self.limits.1 }
    }

    /// 预留一次调用额度：检查与记账在同一把锁内完成，同时发出的多个请求也不会超出上限。
    /// 预留后请求失败也计入调用次数（按尝试次数计费，偏保守）。
    #[cfg(test)]
    fn budget_reserve(&self, day: u32) -> bool {
        self.budget_reserve_in(day, &Calendar::default())
    }

    #[cfg(test)]
    fn budget_reserve_in(&self, day: u32, calendar: &Calendar) -> bool {
        self.reserve(day, calendar, 0).is_some()
    }

    /// 记入实际消耗的 token。只记入请求所属的月份：跨月后才返回的结果不会改写新月份的预算。
    #[cfg(test)]
    fn budget_record(&self, day: u32, tokens: u64) {
        self.budget_record_in(day, tokens, &Calendar::default());
    }

    #[cfg(test)]
    fn budget_record_in(&self, day: u32, tokens: u64, calendar: &Calendar) {
        self.settle(f9::runtime::Reservation::Local { month: calendar.month_index(day), reserved: 0 }, tokens);
    }

    /// 处理任务时是否可能访问网络（真实提供商或 Jev）。这类管线的任务应在后台处理，不能持锁等待。
    pub fn uses_network(&self) -> bool {
        matches!(self.provider, Some(Provider::Http(_))) || self.adjudicator.is_remote()
    }

    fn cache_get(&self, key: &str) -> Option<String> {
        self.inner.lock().ok().and_then(|i| i.cache.get(key).cloned())
    }

    fn cache_put(&self, key: String, value: String) {
        if let Ok(mut inner) = self.inner.lock() {
            if inner.cache.insert(key.clone(), value).is_none() {
                inner.cache_order.push(key);
            }
            while inner.cache_order.len() > CACHE_KEPT {
                let old = inner.cache_order.remove(0);
                inner.cache.remove(&old);
            }
        }
    }

    // ───────────────────────────── 1. 准备 ─────────────────────────────

    /// 从世界状态准备一个任务；没有可做的内容时返回 None。
    pub fn prepare(&self, world: &World, request: TaskRequest) -> Option<AiTask> {
        let defs = &world.defs;
        if !self.content.lore.world.is_empty() && self.content.lore.world != defs.world_key {
            return None;
        }
        let t = &self.content.templates;
        let day = world.day();
        let kind = match &request {
            TaskRequest::Ripple { event } => return self.prepare_ripple(world, event.clone()),
            TaskRequest::Narration { .. }
            | TaskRequest::Letter { .. }
            | TaskRequest::AltChronicle { .. }
            | TaskRequest::Diary { .. } => return self.prepare_text(world, request),
            TaskRequest::Persona { .. } | TaskRequest::Daily { .. } => return self.prepare_f9(world, request),
            TaskRequest::Director => ProposalKind::Director,
            TaskRequest::Rumor => ProposalKind::Rumor,
            TaskRequest::Bargain { .. } => ProposalKind::Bargain,
            TaskRequest::Strategy { .. } => ProposalKind::Strategy,
            TaskRequest::Contract => ProposalKind::Contract,
            TaskRequest::Chronicle { .. } => ProposalKind::Chronicle,
            TaskRequest::Composed => ProposalKind::Composed,
            TaskRequest::Outlook { .. } => ProposalKind::Outlook,
            TaskRequest::MarketReport { .. } => ProposalKind::MarketReport,
            TaskRequest::Review { .. } => ProposalKind::Review,
            TaskRequest::Prologue { .. } => ProposalKind::Prologue,
        };
        let max_summary = self.prompt(kind).map(|p| p.max_summary_chars).unwrap_or(1_000);
        let mut vars: BTreeMap<String, String> = BTreeMap::new();
        vars.insert("date".into(), world_date_text(&defs.rules.world, day));
        let ctx = AdjudicationContext {
            defs: defs.clone(),
            relations: world.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
        };
        let mut offline_tpl = None;
        let (offline, extra) = match request {
            TaskRequest::Ripple { .. } => return None,
            TaskRequest::Narration { .. }
            | TaskRequest::Letter { .. }
            | TaskRequest::AltChronicle { .. }
            | TaskRequest::Diary { .. } => return None,
            TaskRequest::Persona { .. } | TaskRequest::Daily { .. } => return None,
            TaskRequest::Director => {
                vars.insert("summary".into(), world_summary(world, max_summary));
                vars.insert("catalog".into(), event_catalog(world));
                vars.insert("keys".into(), key_catalog(world));
                (Some(Proposal::Director(offline::director(world, t))), TaskExtra::None)
            }
            TaskRequest::Rumor => {
                let plan = world.plan_news()?;
                vars.insert("fact".into(), fact_text(world, &plan.fact));
                vars.insert("source".into(), source_name(plan.source).into());
                vars.insert("summary".into(), world_summary(world, max_summary));
                let (proposal, tpl) = offline::rumor_with_ref(world, &plan, t);
                offline_tpl = tpl;
                (Some(Proposal::Rumor(proposal)), TaskExtra::Rumor { plan })
            }
            TaskRequest::Bargain { owner, loc, player_text } => {
                // 地点必须存在
                defs.locations.get(loc.idx())?;
                vars.insert("player_text".into(), player_text.clone());
                vars.insert("loc".into(), defs.loc(loc).name.clone());
                let mut tpls = Vec::new();
                let options = ALL_INTENTS
                    .iter()
                    .map(|i| {
                        let d = world.bargain_outcome(owner, loc, *i).discount;
                        let (reply, tpl) = offline::bargain_with_ref(world, *i, d, loc, t);
                        tpls.push(tpl);
                        (*i, d, reply.reply)
                    })
                    .collect();
                (None, TaskExtra::Bargain { owner, loc, player_text, options, tpls })
            }
            TaskRequest::Strategy { company } => {
                let owner = OwnerId::Company(company);
                let agent = world.state.agents.get(&owner)?;
                if agent.bankrupt {
                    return None;
                }
                let s = agent.strategy.clone()?;
                let pref: Vec<String> = s.preferred.iter().map(|g| defs.good(*g).name.clone()).collect();
                vars.insert(
                    "company".into(),
                    format!(
                        "{}（key={}），本据港 {}，当前风险偏好 {}，偏好商品：{}",
                        owner_name(world, owner),
                        defs.company(company).key,
                        defs.loc(agent.home).name,
                        s.risk,
                        if pref.is_empty() { "无".into() } else { pref.join("、") }
                    ),
                );
                vars.insert("summary".into(), world_summary(world, max_summary));
                vars.insert("keys".into(), key_catalog(world));
                (Some(Proposal::Strategy(offline::strategy(world, company, t))), TaskExtra::Strategy { company })
            }
            TaskRequest::Contract => {
                vars.insert("summary".into(), world_summary(world, max_summary));
                vars.insert("keys".into(), key_catalog(world));
                (Some(Proposal::Contract(offline::contract(world, t)?)), TaskExtra::None)
            }
            TaskRequest::Chronicle { year } => {
                let facts = world.state.news.year_facts.iter().find(|f| f.year == year)?.clone();
                vars.insert("facts".into(), year_facts_text(world, &facts));
                vars.insert("year".into(), year_text(&defs.rules.world, year));
                let (proposal, tpl) = offline::chronicle_with_ref(world, &facts, t);
                offline_tpl = tpl;
                (Some(Proposal::Chronicle(proposal)), TaskExtra::Chronicle { year })
            }
            TaskRequest::Composed => {
                // 冷却期或年度上限未到时不发出请求（不消耗预算）
                world.check_composed_schedule().ok()?;
                vars.insert("summary".into(), world_summary(world, max_summary));
                vars.insert("effects".into(), effect_vocabulary(world));
                vars.insert("keys".into(), key_catalog(world));
                vars.insert("history".into(), recent_history(world, max_summary));
                vars.insert("frontier".into(), frontier_catalog(world, max_summary));
                (offline::composed(world, t).map(Proposal::Composed), TaskExtra::None)
            }
            TaskRequest::Outlook { company } => {
                let owner = OwnerId::Company(company);
                let agent = world.state.agents.get(&owner)?;
                if agent.bankrupt {
                    return None;
                }
                let s = agent.strategy.clone()?;
                let def = defs.company(company);
                let pref: Vec<String> = s.preferred.iter().map(|g| defs.good(*g).name.clone()).collect();
                // 手上本据港的行情（随船传递时是自己知道的）：偏好商品的近 30 天涨跌
                let sight = world.sight(owner);
                let moves: Vec<String> = s
                    .preferred
                    .iter()
                    .filter_map(|g| {
                        let k = sight.market(agent.home, *g)?;
                        let n = k.history_len();
                        let old = k.history_at(n.checked_sub(31)?)?;
                        let now = k.history_at(n - 1)?;
                        Some(format!("{} {:+}%", defs.good(*g).name, mul_div(now - old, 100, old.max(1))))
                    })
                    .collect();
                vars.insert(
                    "company".into(),
                    format!(
                        "{}（key={}），性格：{}；本据港 {}，现用的预测方法：{}，偏好商品：{}；本据港近 30 天：{}",
                        owner_name(world, owner),
                        def.key,
                        if def.persona.is_empty() { "无" } else { def.persona.as_str() },
                        defs.loc(agent.home).name,
                        crate::resolve::method_key(world.company_method(owner)),
                        if pref.is_empty() { "无".into() } else { pref.join("、") },
                        if moves.is_empty() { "不详".into() } else { moves.join("、") }
                    ),
                );
                vars.insert("summary".into(), world_summary(world, max_summary));
                vars.insert("keys".into(), key_catalog(world));
                let (proposal, tpl) = offline::outlook(world, company, t);
                offline_tpl = tpl;
                (Some(Proposal::Outlook(proposal)), TaskExtra::Outlook { company })
            }
            TaskRequest::MarketReport { region } => {
                let facts = world.report_facts(region).filter(|f| f.has_news())?;
                vars.insert("region".into(), defs.region(region).name.clone());
                vars.insert("facts".into(), report_facts_text(world, &facts));
                let (proposal, tpl) = offline::market_report_with_ref(world, &facts, t);
                offline_tpl = tpl;
                (Some(Proposal::MarketReport(proposal)), TaskExtra::MarketReport { region, month: facts.month })
            }
            TaskRequest::Review { place, facts } => {
                if facts.is_empty() {
                    return None;
                }
                vars.insert("place".into(), place.clone());
                vars.insert("facts".into(), facts.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n"));
                let (proposal, tpl) = offline::review_with_ref(world, &place, &facts, t);
                offline_tpl = Some(tpl);
                (Some(Proposal::Review(proposal)), TaskExtra::Text)
            }
            TaskRequest::Prologue { captain } => {
                vars.insert(
                    "captain".into(),
                    format!(
                        "名字：{}\n星座：{}\n身世：{}\n启航的港口：{}",
                        captain.name,
                        captain.sign,
                        captain.answers.join("；"),
                        captain.port
                    ),
                );
                let (proposal, tpl) = offline::prologue_with_ref(world, &captain, t);
                offline_tpl = Some(tpl);
                (Some(Proposal::Prologue(proposal)), TaskExtra::Text)
            }
        };
        if defs.world_key != "classic" {
            let lore = &self.content.lore;
            vars.insert("world_lore".into(), lore.summary.clone());
            vars.insert("world_terms".into(), lore.terms.clone());
            vars.insert("world_taboos".into(), lore.taboos.clone());
            let date = manifest_core::summary::world_date_text_in(&defs.rules.world, &defs.calendar, day);
            vars.insert("calendar".into(), date.clone());
            vars.insert("date".into(), date);
        }
        self.language_vars(day, &mut vars);
        Some(AiTask { kind, day, vars, offline, offline_tpl, ctx, extra })
    }

    /// 写作语言与专名对照（EXPANSION.md §12.1）：`{language}` 为语言的英文名；非中文时 `{date}` 换成该语言的日期，
    /// `{glossary}` 列出提示词中出现的专名的“中文 = 该语言”对照，要求模型照此拼写。
    fn language_vars(&self, day: u32, vars: &mut BTreeMap<String, String>) {
        let Some((zh, to)) = &self.locale else {
            vars.insert("language".into(), Locale::ZhCn.english_name().into());
            vars.insert("glossary".into(), String::new());
            return;
        };
        vars.insert("language".into(), to.locale.english_name().into());
        if to.locale.is_chinese() {
            vars.insert("glossary".into(), String::new());
            return;
        }
        let all: String = vars.values().cloned().collect::<Vec<_>>().join("\n");
        vars.insert("glossary".into(), manifest_data::locale::glossary(zh, to, &all, GLOSSARY_MAX));
        vars.insert("date".into(), to.date_text(day));
    }

    /// 某类提案的提示词模板（写作语言有覆盖时用覆盖）。
    fn prompt(&self, kind: ProposalKind) -> Option<&PromptTemplate> {
        match &self.locale {
            Some((_, to)) => to.prompts.get(&kind).or_else(|| self.content.prompts.get(&kind)),
            None => self.content.prompts.get(&kind),
        }
    }

    /// 渲染后的提示词（系统, 用户），输出结构按数据生成（测试与调试面板用）。
    pub fn prompt_text(&self, task: &AiTask) -> (String, String) {
        let output = f9::task_schema(task);
        let schema_text = serde_json::to_string(&output.schema).unwrap_or_default();
        let (system, user, _, _) = self.render(task.kind, &task.vars, &schema_text);
        (system, user)
    }

    // ───────────────────────────── 2. 处理 ─────────────────────────────

    fn render(&self, kind: ProposalKind, vars: &BTreeMap<String, String>, schema: &str) -> (String, String, u32, u32) {
        let Some(p) = self.prompt(kind) else { return (String::new(), String::new(), 600, 0) };
        let mut all = vars.clone();
        all.insert("schema".into(), schema.to_string());
        let fill = |text: &str| {
            if kind.is_f9() {
                return f9::fill(text, &all);
            }
            let mut out = text.to_string();
            for (k, v) in &all {
                out = out.replace(&format!("{{{k}}}"), v);
            }
            out
        };
        let mut system = fill(&p.system);
        // 非中文：提示词模板没有写明语言时补上一句（缺少该语言的提示词覆盖时也能按语言写作）
        let locale = self.locale();
        if !locale.is_chinese() && !format!("{}{}", p.system, p.user).contains("{language}") {
            let glossary = vars.get("glossary").cloned().unwrap_or_default();
            system.push_str(&format!(
                "\n\nWrite every text field of your answer in {}. Keep the JSON keys and the object keys (ids) unchanged.",
                locale.english_name()
            ));
            if !glossary.is_empty() {
                system.push_str(&format!("\nUse these English names for proper nouns:\n{glossary}"));
            }
        }
        (system, fill(&p.user), p.max_tokens, p.version)
    }

    /// 异步处理任务（不读世界状态）。
    pub async fn process(&self, mut task: AiTask) -> AiOutcome {
        if task.kind.is_f9() {
            return self.process_f9(task).await;
        }
        let kind = task.kind;
        let day = task.day;
        let mut intent = None;
        // 议价：先分类意图，再确定折扣与离线回复
        if let TaskExtra::Bargain { player_text, options, loc, tpls, .. } = &task.extra {
            let loc_name = task.ctx.defs.loc(*loc).name.clone();
            let (i, conf, via) = self.adjudicator.classify_intent(player_text, &loc_name).await;
            self.audit(day, kind, "意图分类", format!("{}（置信度 {conf:.2}，来源 {via}）", intent_name(i)));
            if let Some(pos) = options.iter().position(|(x, _, _)| *x == i) {
                let (_, d, reply) = &options[pos];
                task.vars.insert("intent".into(), intent_name(i).into());
                task.vars.insert("discount".into(), offline::percent(*d));
                task.offline = Some(Proposal::Bargain(crate::proposal::BargainProposal { reply: reply.clone() }));
                task.offline_tpl = tpls.get(pos).cloned().flatten();
            }
            intent = Some(i);
        }
        // 输出结构由代码从数据生成：写进提示词，并交给提供商做结构化输出（工具调用 / json_schema）
        let output = f9::task_schema(&task);
        let schema_text = serde_json::to_string(&output.schema).unwrap_or_default();
        let (system, user, max_tokens, version) = self.render(kind, &task.vars, &schema_text);
        self.audit(day, kind, "提示词", format!("v{version}：{}", user.chars().take(200).collect::<String>()));

        let use_llm = matches!(self.mode, AiMode::Mock | AiMode::Live) && self.provider.is_some();
        let mut raw: Option<(String, ProposalSource)> = None;
        if use_llm {
            let cache_key = blake3::hash(
                format!(
                    "{}|{}|{}|{version}|{system}|{user}",
                    task.ctx.defs.world_key,
                    task.ctx.defs.meta.hash,
                    kind.key()
                )
                .as_bytes(),
            )
            .to_hex()
            .to_string();
            if let Some(hit) = self.cache_get(&cache_key) {
                self.audit(day, kind, "缓存命中", "使用相同输入的缓存结果");
                raw = Some((hit, ProposalSource::Cache));
            } else if let Some(ticket) = self.reserve(day, &task.ctx.defs.calendar, 0) {
                if self.gate.as_ref().is_some_and(|g| !g.try_acquire()) {
                    self.audit(day, kind, "预算", "近一段时间的调用已达上限，改用离线模板");
                } else if let Some(provider) = &self.provider {
                    let req = LlmRequest {
                        system,
                        user,
                        max_tokens,
                        tier: self.tier,
                        hint: task.offline.as_ref().map(|p| p.body_json()),
                    };
                    match provider.complete_with(&req, Some(&output)).await {
                        Ok(resp) => {
                            self.settle(ticket, resp.input_tokens.saturating_add(resp.output_tokens));
                            if let Some(g) = &self.gate {
                                g.record(resp.input_tokens + resp.output_tokens);
                            }
                            let via = if resp.structured {
                                format!("结构化输出 {}", output.name)
                            } else if provider.structured() {
                                "服务未返回结构化输出，按文本解析".to_string()
                            } else {
                                "文本".to_string()
                            };
                            self.audit(
                                day,
                                kind,
                                "LLM 输出",
                                format!(
                                    "（{via}；{} + {} tokens）{}",
                                    resp.input_tokens, resp.output_tokens, resp.text
                                ),
                            );
                            // 只缓存能解析的结果
                            if parse_proposal(kind, &resp.text).is_ok() {
                                self.cache_put(cache_key, resp.text.clone());
                            }
                            raw = Some((resp.text, ProposalSource::Llm));
                        }
                        Err(e) => {
                            self.audit(day, kind, "降级", format!("{e}，改用离线模板"));
                        }
                    }
                }
            } else {
                self.audit(day, kind, "预算", "本月预算已用完，改用离线模板");
            }
        }

        let (proposal, source) = match raw {
            Some((text, src)) => match parse_proposal(kind, &text) {
                Ok((p, stage)) => {
                    if stage == ParseStage::Repaired {
                        self.audit(day, kind, "解析", "首次解析失败，自动修复后成功");
                    }
                    (Some(p), Some(src))
                }
                Err(e) => {
                    // 结论放在前面：详情过长被截断时仍能看到“已丢弃”
                    self.audit(day, kind, "解析", format!("已丢弃：{e}"));
                    (None, Some(src))
                }
            },
            None => {
                if task.offline.is_some() {
                    self.audit(day, kind, "离线模板", "使用离线模板生成");
                }
                (task.offline.clone(), Some(ProposalSource::Offline))
            }
        };
        let verdict = match &proposal {
            Some(p) => {
                let v = if let TaskExtra::F9(ctx) = &task.extra
                    && let Err(reason) = ctx.check(p)
                {
                    Verdict {
                        decision: Decision::Reject,
                        proposal: None,
                        reasons: vec![reason],
                        confidence: 1.0,
                        score: 0.0,
                        via: "rule".into(),
                    }
                } else {
                    self.adjudicator.adjudicate(p, &task.ctx).await
                };
                self.audit(
                    day,
                    kind,
                    "裁决",
                    format!(
                        "{:?}（{}，置信度 {:.2}，分数 {:.2}）：{}",
                        v.decision,
                        v.via,
                        v.confidence,
                        v.score,
                        v.reasons.join("；")
                    ),
                );
                Some(v)
            }
            None => None,
        };
        AiOutcome { task, source, verdict, intent }
    }

    // ───────────────────────────── 3. 转为命令 ─────────────────────────────

    /// 把裁决通过的提案转为命令，并经内核校验；返回可以排期执行的命令。
    pub fn finalize(&self, world: &World, outcome: &AiOutcome) -> Vec<Command> {
        if world.defs.world_key != outcome.task.ctx.defs.world_key
            || world.defs.meta.hash != outcome.task.ctx.defs.meta.hash
        {
            return Vec::new();
        }
        if outcome.task.kind.is_f9() {
            return self.finalize_f9(world, outcome);
        }
        let kind = outcome.task.kind;
        let day = world.day();
        let Some(p) = outcome.accepted() else { return Vec::new() };
        let defs = &world.defs;
        let mut cmds: Vec<Command> = Vec::new();
        let reject = |why: String| self.audit(day, kind, "内核校验", format!("拒绝：{why}"));
        match (p, &outcome.task.extra) {
            (Proposal::Director(d), _) => {
                for pick in &d.events {
                    match resolve_event(defs, pick) {
                        Ok((event, params)) => cmds.push(Command::ApplyEvent { event, params }),
                        Err(e) => reject(e),
                    }
                }
            }
            (Proposal::Rumor(r), TaskExtra::Rumor { plan }) => cmds.push(Command::PublishNews {
                fact: plan.fact.clone(),
                source: plan.source,
                credibility: plan.credibility,
                text: r.text.clone(),
                tpl: offline_tpl_for(outcome, &r.text),
            }),
            (Proposal::Bargain(b), TaskExtra::Bargain { owner, loc, player_text, .. }) => {
                if let Some(intent) = outcome.intent {
                    cmds.push(Command::ApplyBargain {
                        owner: *owner,
                        loc: *loc,
                        intent,
                        player_text: player_text.clone(),
                        reply: b.reply.clone(),
                        reply_tpl: offline_tpl_for(outcome, &b.reply),
                    });
                }
            }
            (Proposal::Strategy(s), TaskExtra::Strategy { company }) => match resolve_strategy(defs, s) {
                Ok((risk, preferred)) => {
                    // 内核负责把参数夹紧到允许范围（执行时还会再夹紧一次）；日志中记录夹紧后的值
                    let (lo, hi) = manifest_core::news::RISK_RANGE;
                    let clamped = risk.clamp(lo, hi);
                    if clamped != risk {
                        self.audit(day, kind, "内核校验", format!("风险偏好 {risk} 夹紧为 {clamped}"));
                    }
                    cmds.push(Command::AdjustStrategy { company: *company, risk: clamped, preferred })
                }
                Err(e) => reject(e),
            },
            (Proposal::Contract(c), _) => match resolve_contract(defs, c) {
                Ok((issuer, good, qty, to, days, reward)) => {
                    cmds.push(Command::OfferContract { issuer, good, qty, to, days, reward })
                }
                Err(e) => reject(e),
            },
            (Proposal::Chronicle(c), TaskExtra::Chronicle { year }) => cmds.push(Command::RecordChronicle {
                year: *year,
                text: c.text.clone(),
                tpl: offline_tpl_for(outcome, &c.text),
            }),
            (Proposal::Outlook(o), TaskExtra::Outlook { company }) => match crate::resolve::resolve_outlook(defs, o) {
                Ok((views, method)) => cmds.push(Command::SetOutlook {
                    company: *company,
                    views,
                    method,
                    memo: o.memo.clone(),
                    tpl: offline_tpl_for(outcome, &o.memo),
                }),
                Err(e) => reject(e),
            },
            (Proposal::MarketReport(r), TaskExtra::MarketReport { region, month }) => {
                cmds.push(Command::RecordMarketReport {
                    region: *region,
                    month: *month,
                    text: r.text.clone(),
                    tpl: offline_tpl_for(outcome, &r.text),
                })
            }
            // 只返回文字（复盘点评、身世序章）：不产生命令，由调用方取 [`AiPipeline::text_result`]
            (Proposal::Review(_) | Proposal::Prologue(_), TaskExtra::Text) => {}
            (Proposal::Composed(c), _) => {
                let effects: Result<Vec<_>, String> =
                    c.effects.iter().map(|e| resolve_composed_effect(defs, e)).collect();
                match effects {
                    Ok(effects) => {
                        // 来源只用于显示：模型（含缓存的模型输出）或离线模板
                        let source = match outcome.source {
                            Some(ProposalSource::Llm | ProposalSource::Cache) => ComposedSource::Model,
                            _ => ComposedSource::Template,
                        };
                        cmds.push(Command::ApplyComposedEvent {
                            title: c.title.clone(),
                            text: c.narrative.clone(),
                            effects,
                            source,
                        })
                    }
                    Err(e) => reject(e),
                }
            }
            _ => reject("提案与任务不匹配".into()),
        }
        let mut valid = Vec::new();
        for c in cmds {
            match c.validate(world) {
                Ok(()) => valid.push(c),
                Err(e) => reject(e.to_string()),
            }
        }
        if !valid.is_empty() {
            self.audit(day, kind, "排期", format!("{} 条命令通过内核校验", valid.len()));
        }
        valid
    }

    /// 只返回文字的任务（复盘点评、身世序章）的结果：采用的文字与它的模板位置（离线模板或照抄了离线备选时有，
    /// 显示时按界面语言重新格式化）；被拒绝时为 None（调用方改用离线备选）。
    pub fn text_result(&self, outcome: &AiOutcome) -> Option<(String, Option<TextRef>)> {
        if outcome.task.kind.is_f9() {
            return f9::text_result(outcome).map(|t| (t, None));
        }
        let text = match outcome.accepted()? {
            Proposal::Review(t) | Proposal::Prologue(t) => t.text.clone(),
            _ => return None,
        };
        let same = match &outcome.task.offline {
            Some(Proposal::Review(o) | Proposal::Prologue(o)) => o.text == text,
            _ => false,
        };
        let tpl = if same { outcome.task.offline_tpl.clone() } else { None };
        Some((text, tpl))
    }

    /// 议价意图的英文标签（界面显示用）。
    pub fn intent_label(i: Intent) -> &'static str {
        intent_label(i)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockLlm;

    fn pipeline(calls: u32) -> AiPipeline {
        let dir = manifest_data::find_data_dir().expect("找到 data/");
        let content = Arc::new(manifest_data::load_ai_content(&dir).expect("AI 内容"));
        let settings = AiSettings { mode: AiMode::Mock, monthly_calls: calls, ..AiSettings::default() };
        AiPipeline::new(content, &settings, Some(Provider::Mock(MockLlm::plausible())))
    }

    #[test]
    fn budget_reservation_never_exceeds_the_monthly_limit() {
        let p = pipeline(2);
        // 同一个月内连续预留：前两次成功，之后一律拒绝（请求还没返回也一样）
        assert!(p.budget_reserve(3));
        assert!(p.budget_reserve(3));
        assert!(!p.budget_reserve(4));
        assert_eq!(p.budget(4).calls_used, 2);
        // 新的月份重新计数
        assert!(p.budget_reserve(31));
        assert_eq!(p.budget(31).calls_used, 1);
    }

    #[test]
    fn late_reservations_do_not_reset_the_new_month() {
        let p = pipeline(10);
        assert!(p.budget_reserve(30));
        assert!(p.budget_reserve(31));
        // 第 0 个月的任务迟到：拒绝（改用离线模板），且不清零第 1 个月的计数
        assert!(!p.budget_reserve(29));
        let b = p.budget(31);
        assert_eq!((b.month, b.calls_used), (1, 2));
    }

    #[test]
    fn late_results_do_not_overwrite_the_new_month() {
        let p = pipeline(10);
        assert!(p.budget_reserve(29));
        // 第 1 个月开始后，第 0 个月的请求才返回
        assert!(p.budget_reserve(30));
        p.budget_record(29, 5_000);
        p.budget_record(30, 100);
        let b = p.budget(30);
        assert_eq!((b.month, b.calls_used, b.tokens_used), (1, 1, 100));
    }
    #[test]
    fn real_month_budget_resets_on_february_and_march_boundaries() {
        let c = Calendar::new(
            vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
            vec![3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3],
            "公元".into(),
            vec![],
        )
        .unwrap();
        let p = pipeline(1);
        assert!(p.budget_reserve_in(29, &c));
        assert!(!p.budget_reserve_in(30, &c));
        assert_eq!(p.budget_in(30, &c).month, 0);
        assert!(p.budget_reserve_in(31, &c));
        assert!(!p.budget_reserve_in(58, &c));
        assert!(p.budget_reserve_in(59, &c));
        assert!(!p.budget_reserve_in(58, &c));
        p.budget_record_in(58, 5000, &c);
        p.budget_record_in(59, 100, &c);
        let b = p.budget_in(59, &c);
        assert_eq!((b.month, b.calls_used, b.tokens_used), (2, 1, 100));
    }
}

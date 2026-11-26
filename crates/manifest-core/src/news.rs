//! 新闻与传闻、议价、商会战略、编年史——这些内容的文字由 LLM（或离线模板）撰写，数值后果全部由内核决定。
//!
//! - 传闻：内核挑选"事实"并决定散布真事还是假事；发布时由内核判定真假并记录。界面只显示来源与可信度，不揭示真假。
//! - 议价：意图由裁决器分类；折扣由内核按意图、声望与上限计算。
//! - 编年史：内核只提供年度事实，文字不影响任何数值。

use crate::diplomacy::DiploStatus;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::rng::{Domain, Rng};
use crate::text::TextRef;
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 传闻所述的事实。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NewsFact {
    /// 某地某商品价格高企（现价 ≥ 基准价 × 1.3）
    PriceHigh { loc: LocId, good: GoodId },
    /// 某地某商品价格低迷（现价 ≤ 基准价 × 0.7）
    PriceLow { loc: LocId, good: GoodId },
    /// 某地某商品短缺（库存 < 目标 × 0.3）
    Shortage { loc: LocId, good: GoodId },
    /// 两个势力处于某种外交状态
    Relation { a: FactionId, b: FactionId, status: DiploStatus },
    /// 某类事件正在发生
    EventActive { event: EventTypeId },
}

/// 消息来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum NewsSource {
    /// 酒馆传言
    Tavern,
    /// 商人消息
    Merchant,
    /// 官方公告
    Official,
}

/// 一条新闻或传闻。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct News {
    pub id: u32,
    pub day: u32,
    pub fact: NewsFact,
    /// 发布时由内核判定的真假（界面不显示）
    pub truthful: bool,
    pub text: String,
    pub source: NewsSource,
    /// 可信度 0–100（与真假无必然联系）
    pub credibility: u8,
    /// 离线模板生成时的模板位置与参数（显示时按语言重新格式化）；模型写的传闻与旧存档为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tpl: Option<TextRef>,
}

/// 内核为传闻任务准备的事实。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewsPlan {
    pub fact: NewsFact,
    pub source: NewsSource,
    pub credibility: u8,
    /// 内核打算散布的是真事还是假事（发布时仍以当时的判定为准）
    pub intended_truth: bool,
}

/// 议价意图（由裁决器对玩家输入分类）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Intent {
    /// 让价
    Discount,
    /// 威胁
    Threat,
    /// 贿赂
    Bribe,
    /// 套交情
    Rapport,
    /// 无关
    Irrelevant,
}

/// 某地的议价成果：在期限内买入降价、卖出加价。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bargain {
    pub discount: Fx,
    /// 截止日（不含）
    pub until: u32,
}

/// 议价结果（由内核计算）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BargainOutcome {
    pub discount: Fx,
    pub bribe: Money,
    pub reputation: i64,
}

/// 一段议价对话。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dialog {
    pub day: u32,
    pub owner: OwnerId,
    pub loc: LocId,
    pub intent: Intent,
    pub player_text: String,
    pub reply: String,
    pub discount: Fx,
    /// 离线模板生成的回复的模板位置与参数（显示时按语言重新格式化）；模型写的回复与旧存档为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_tpl: Option<TextRef>,
}

/// 编年史的一年。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chronicle {
    pub year: u32,
    pub text: String,
    /// 离线模板生成时的模板位置与参数（显示时按语言重新格式化）；模型写的编年史与旧存档为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tpl: Option<TextRef>,
}

/// 内核整理的年度事实（编年史的素材）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct YearFacts {
    pub year: u32,
    pub events: Vec<EventTypeId>,
    pub wars: Vec<(FactionId, FactionId)>,
    pub bankrupt: Vec<OwnerId>,
    pub richest: Option<OwnerId>,
    pub player_net_worth: Money,
    /// 当年组合事件的标题
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub composed: Vec<String>,
}

/// 新闻、对话、编年史等状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewsState {
    pub news: Vec<News>,
    pub next_news: u32,
    pub dialogs: Vec<Dialog>,
    pub chronicles: Vec<Chronicle>,
    pub year_facts: Vec<YearFacts>,
    /// 各商会上次调整战略的日期
    pub strategy_last: BTreeMap<CompanyId, u32>,
    /// 各月份由 AI 发布的合同数量
    pub ai_contracts: BTreeMap<u32, u32>,
    /// 市场月报（ECONOMY.md 8.5；AI 打开时每月至多两篇；没有时不写进存档）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reports: Vec<crate::report::MarketReport>,
}

const NEWS_KEPT: usize = 200;
const DIALOGS_KEPT: usize = 100;
/// 每天最多发布的新闻条数。
pub const MAX_NEWS_PER_DAY: usize = 3;
/// 文字长度上限（字符）。
pub const MAX_NEWS_CHARS: usize = 240;
pub const MAX_REPLY_CHARS: usize = 240;
pub const MAX_PLAYER_TEXT_CHARS: usize = 200;
pub const MAX_CHRONICLE_CHARS: usize = 3000;
/// 议价折扣上限。
pub const MAX_DISCOUNT: Fx = Fx(800);
/// 议价效果持续天数。
pub const BARGAIN_DAYS: u32 = 15;
/// 每月最多由 AI 发布的合同数。
pub const MAX_AI_CONTRACTS_PER_MONTH: u32 = 3;
/// 商会战略调整的最短间隔。
pub const STRATEGY_INTERVAL: u32 = 25;
/// 商会风险偏好的允许范围。
pub const RISK_RANGE: (Fx, Fx) = (Fx(2_000), Fx(8_000));

/// 检查 AI 生成的文字：长度与控制字符。
pub fn check_text(text: &str, max: usize) -> Result<(), CommandError> {
    let n = text.chars().count();
    if n == 0 || n > max {
        return Err(CommandError::OutOfRange(format!("文字长度 {n} 不在 1–{max} 之间")));
    }
    if text.chars().any(|c| c.is_control() && c != '\n') {
        return Err(CommandError::OutOfRange("文字包含控制字符".into()));
    }
    Ok(())
}

impl World {
    /// 事实的真假（按当前世界状态判定）。
    pub fn evaluate_fact(&self, fact: &NewsFact) -> bool {
        match fact {
            NewsFact::PriceHigh { loc, good } => {
                self.market(*loc, *good).is_some_and(|e| e.price * 10 >= e.base_price * 13)
            }
            NewsFact::PriceLow { loc, good } => {
                self.market(*loc, *good).is_some_and(|e| e.price * 10 <= e.base_price * 7)
            }
            NewsFact::Shortage { loc, good } => self.market(*loc, *good).is_some_and(|e| e.stock * 10 < e.target * 3),
            NewsFact::Relation { a, b, status } => self.relation(*a, *b).is_some_and(|r| r.status == *status),
            NewsFact::EventActive { event } => {
                self.state.events.active.iter().any(|e| e.catalog_kind() == Some(*event))
            }
        }
    }

    /// 事实所引用的对象是否存在。
    pub fn validate_fact(&self, fact: &NewsFact) -> Result<(), CommandError> {
        let defs = &self.defs;
        let ok = match fact {
            NewsFact::PriceHigh { loc, good } | NewsFact::PriceLow { loc, good } | NewsFact::Shortage { loc, good } => {
                self.market(*loc, *good).is_some()
            }
            NewsFact::Relation { a, b, .. } => self.relation(*a, *b).is_some(),
            NewsFact::EventActive { event } => defs.events.get(event.idx()).is_some(),
        };
        if ok { Ok(()) } else { Err(CommandError::NotFound("新闻所述的对象".into())) }
    }

    /// 内核挑选今天要散布的事实：约七成为真，三成为假；来源与可信度独立抽取。
    pub fn plan_news(&self) -> Option<NewsPlan> {
        let day = self.state.day;
        let mut rng = Rng::derive(self.state.seed, day, Domain::News, 0, 0);
        let mut true_facts: Vec<NewsFact> = Vec::new();
        let mut normal: Vec<(LocId, GoodId)> = Vec::new();
        for (li, ls) in self.state.locations.iter().enumerate() {
            let loc = LocId::from_idx(li);
            for (g, e) in &ls.market {
                if e.price * 10 >= e.base_price * 13 {
                    true_facts.push(NewsFact::PriceHigh { loc, good: *g });
                } else if e.price * 10 <= e.base_price * 7 {
                    true_facts.push(NewsFact::PriceLow { loc, good: *g });
                } else {
                    normal.push((loc, *g));
                }
                if e.stock * 10 < e.target * 3 {
                    true_facts.push(NewsFact::Shortage { loc, good: *g });
                }
            }
        }
        for r in &self.state.relations {
            if r.status != DiploStatus::Peace {
                true_facts.push(NewsFact::Relation { a: r.a, b: r.b, status: r.status });
            }
        }
        // 只有目录事件可以作为传闻事实（组合事件没有事件类型）
        for e in &self.state.events.active {
            if let Some(kind) = e.catalog_kind() {
                true_facts.push(NewsFact::EventActive { event: kind });
            }
        }
        let want_true = rng.chance_bp(7_000);
        let fact = if want_true && !true_facts.is_empty() {
            true_facts[rng.below(true_facts.len() as u64) as usize].clone()
        } else if !normal.is_empty() {
            // 假消息：声称一个价格正常的商品价格高企或短缺
            let (loc, good) = normal[rng.below(normal.len() as u64) as usize];
            if rng.chance_bp(5_000) { NewsFact::PriceHigh { loc, good } } else { NewsFact::Shortage { loc, good } }
        } else {
            return None;
        };
        let source = match rng.weighted(&[50, 35, 15]) {
            Some(0) => NewsSource::Tavern,
            Some(1) => NewsSource::Merchant,
            _ => NewsSource::Official,
        };
        let credibility = match source {
            NewsSource::Tavern => rng.range(25, 65),
            NewsSource::Merchant => rng.range(55, 85),
            NewsSource::Official => rng.range(80, 95),
        } as u8;
        let intended_truth = self.evaluate_fact(&fact);
        Some(NewsPlan { fact, source, credibility, intended_truth })
    }

    pub(crate) fn check_publish(&self, fact: &NewsFact, text: &str, credibility: u8) -> Result<(), CommandError> {
        self.validate_fact(fact)?;
        check_text(text, MAX_NEWS_CHARS)?;
        if credibility > 100 {
            return Err(CommandError::OutOfRange("可信度必须在 0–100 之间".into()));
        }
        let today = self.state.news.news.iter().filter(|n| n.day == self.state.day).count();
        if today >= MAX_NEWS_PER_DAY {
            return Err(CommandError::Precondition("今天的新闻数量已达上限".into()));
        }
        Ok(())
    }

    pub(crate) fn publish_news(
        &mut self,
        fact: NewsFact,
        text: String,
        source: NewsSource,
        credibility: u8,
        tpl: Option<TextRef>,
    ) {
        let truthful = self.evaluate_fact(&fact);
        // 本地商人的预期随传闻偏移（无论真假；ECONOMY.md 8.3）
        self.rumor_moves_expectations(&fact, credibility);
        let id = self.state.news.next_news.max(1);
        self.state.news.next_news = id + 1;
        let day = self.state.day;
        self.state.news.news.push(News { id, day, fact, truthful, text, source, credibility, tpl });
        if self.state.news.news.len() > NEWS_KEPT {
            let excess = self.state.news.news.len() - NEWS_KEPT;
            self.state.news.news.drain(0..excess);
        }
    }

    /// 某所有者在某地的有效议价折扣。
    pub fn bargain_discount(&self, owner: OwnerId, loc: LocId) -> Fx {
        self.state
            .agents
            .get(&owner)
            .and_then(|a| a.bargains.get(&loc))
            .filter(|b| b.until > self.state.day)
            .map(|b| b.discount)
            .unwrap_or(Fx::ZERO)
    }

    /// 议价结果：按意图、当地势力声望与交易能力计算，折扣不超过上限。
    pub fn bargain_outcome(&self, owner: OwnerId, loc: LocId, intent: Intent) -> BargainOutcome {
        let faction = self.location_faction(loc);
        let rep = self.reputation(owner, faction);
        let mut rng =
            Rng::derive(self.state.seed, self.state.day, Domain::Market, 7_000 + loc.0 as u64, owner_code(owner));
        let skill = self.trade_skill_bonus(owner);
        let (base, bribe, reputation) = match intent {
            Intent::Discount => (Fx::from_bp(300), 0, 0),
            Intent::Rapport => (Fx::from_bp(100) + Fx::from_bp(rep.max(0) * 4), 0, 1),
            Intent::Threat => {
                if rng.chance_bp(4_000) {
                    (Fx::from_bp(500), 0, -2)
                } else {
                    (Fx::ZERO, 0, -5)
                }
            }
            Intent::Bribe => {
                let cash = self.state.agents.get(&owner).map(|a| a.cash).unwrap_or(0);
                (Fx::from_bp(600), (300 + mul_div(cash.max(0), 1, 100)).min(3_000), 0)
            }
            Intent::Irrelevant => (Fx::ZERO, 0, 0),
        };
        // 主角的口才另加一点（总上限不变）
        let hook = crate::captain::AttrHook::BargainDiscount;
        let attributes = Fx(self.attr_hook(owner, hook));
        // 经典议价原本把主角与交易员相加；保留这一个历史例外，其他世界与岗位一样取较高者。
        let combined = if self.defs.captain.legacy {
            (skill + attributes).min(Fx(self.defs.rules.attributes.cap(hook)))
        } else {
            Fx(self.staffed_hook(owner, hook, crate::mates::RoleTarget::Owner))
        };
        let discount = if base > Fx::ZERO { (base + combined).min(MAX_DISCOUNT) } else { Fx::ZERO };
        BargainOutcome { discount, bribe, reputation }
    }

    /// 交易能力带来的议价加成（航海士系统启用后由会计或交易员提供）。
    pub fn trade_skill_bonus(&self, owner: OwnerId) -> Fx {
        self.state.agents.get(&owner).map(|a| a.trade_bonus).unwrap_or(Fx::ZERO)
    }

    pub(crate) fn check_bargain(
        &self,
        owner: OwnerId,
        loc: LocId,
        player_text: &str,
        reply: &str,
    ) -> Result<(), CommandError> {
        if self.defs.locations.get(loc.idx()).is_none() {
            return Err(CommandError::NotFound(format!("{loc:?}")));
        }
        let present = self.fleets_of(owner).any(|f| f.docked_at() == Some(loc))
            || self.caravans_of(owner).any(|c| c.at() == Some(loc));
        if !present {
            return Err(crate::error::Reason::new("bargain.presence", "须有舰队或商队在当地").rule());
        }
        check_text(player_text, MAX_PLAYER_TEXT_CHARS)?;
        check_text(reply, MAX_REPLY_CHARS)?;
        Ok(())
    }

    pub(crate) fn apply_bargain(
        &mut self,
        owner: OwnerId,
        loc: LocId,
        intent: Intent,
        player_text: String,
        reply: String,
        reply_tpl: Option<TextRef>,
    ) -> Result<BargainOutcome, CoreError> {
        let day = self.state.day;
        let out = self.bargain_outcome(owner, loc, intent);
        let cash = self.agent(owner)?.cash;
        let bribe = out.bribe.min(cash.max(0));
        if bribe > 0 {
            self.book_external(
                owner,
                Flow::License,
                self.treasury_of(loc),
                JournalEntry::new(day, Memo::Bargain, CashClass::Operating)
                    .dr(Account::Fees, bribe)
                    .cr(Account::Cash, bribe),
            )?;
        }
        let faction = self.location_faction(loc);
        self.adjust_reputation(owner, faction, out.reputation);
        if out.discount > Fx::ZERO {
            self.agent_mut(owner)?.bargains.insert(loc, Bargain { discount: out.discount, until: day + BARGAIN_DAYS });
        }
        self.state.news.dialogs.push(Dialog {
            day,
            owner,
            loc,
            intent,
            player_text,
            reply,
            discount: out.discount,
            reply_tpl,
        });
        if self.state.news.dialogs.len() > DIALOGS_KEPT {
            let excess = self.state.news.dialogs.len() - DIALOGS_KEPT;
            self.state.news.dialogs.drain(0..excess);
        }
        Ok(out)
    }

    /// 年末整理年度事实。
    pub(crate) fn record_year_facts(&mut self, day: u32) {
        let year = day / self.defs.calendar.year_days();
        let start = year * self.defs.calendar.year_days();
        let events: Vec<EventTypeId> = self
            .state
            .events
            .history
            .iter()
            .filter(|r| r.day >= start && r.day <= day)
            .filter_map(|r| r.catalog_kind())
            .collect();
        let composed: Vec<String> = self
            .state
            .events
            .composed
            .iter()
            // 规则触发的势力政策是日常政令，不算年鉴里的大事（ECONOMY.md 6.10）
            .filter(|r| r.day >= start && r.day <= day && r.source != crate::composed::ComposedSource::Rule)
            .map(|r| r.title.clone())
            .collect();
        let wars: Vec<(FactionId, FactionId)> =
            self.state.relations.iter().filter(|r| r.status == DiploStatus::War).map(|r| (r.a, r.b)).collect();
        let bankrupt: Vec<OwnerId> = self
            .state
            .log
            .iter()
            .filter(|e| e.day >= start)
            .filter_map(|e| match e.kind {
                crate::log::LogKind::Bankrupt { owner } => Some(owner),
                _ => None,
            })
            .collect();
        let richest = self
            .state
            .agents
            .values()
            .filter(|a| !a.bankrupt)
            .max_by_key(|a| (a.ledger.equity(), a.owner))
            .map(|a| a.owner);
        let player_net_worth = self.state.agents.get(&OwnerId::Player).map(|a| a.ledger.equity()).unwrap_or(0);
        self.state.news.year_facts.push(YearFacts {
            year,
            events,
            wars,
            bankrupt,
            richest,
            player_net_worth,
            composed,
        });
        if self.state.news.year_facts.len() > 50 {
            self.state.news.year_facts.remove(0);
        }
    }
}

/// 所有者的数字编码（随机数派生用）。
fn owner_code(owner: OwnerId) -> u64 {
    match owner {
        OwnerId::Player => 0,
        OwnerId::Company(c) => 1 + c.0 as u64,
    }
}

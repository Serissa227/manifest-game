//! 组合事件：模型（或离线模板）在结构约束下从效果词表中组合出的事件。
//!
//! 与封闭集合的目录事件（`data/events.toml`）不同，组合事件没有预设类型：标题与叙事只是文字，
//! 效果从 [`EffectKind`] 词表中选 1–`max_effects` 条，每条效果的参数边界来自 `data/effects.toml`。
//!
//! 内核校验（[`World::validate_composed`]）：效果数量；每条效果按共用的 [`World::validate_effect`]
//! 检查参数齐全、目标存在、当地交易该商品、数值在边界内；系数不能为 1、变化量不能为 0；
//! 外交前提（和平或停战的两国之间关系变化受更窄的范围约束）；同一事件中不能重复同一目标的同类效果；
//! 不与进行中的同类同目标效果叠加；同一目标近期不重复；各效果 |系数 − 1| 之和不超过总强度预算；
//! 组合事件的冷却期、每年上限与每日事件数上限。效果本身不含任何金额参数，因此无法凭空增减资产。
//!
//! 组合事件开始时：一次性效果立即生效，持续性效果各自加入进行中列表（来源记为组合事件），
//! 并在 `EventState::composed` 中保存标题、叙事、效果与来源（模型 / 模板），供情报界面显示。

use crate::defs::EffectKind;
use crate::diplomacy::DiploStatus;
use crate::error::{CommandError, CoreError};
use crate::events::{ActiveEvent, COMPOSED_KIND, EffectLimits, EventOrigin, EventParams};
use crate::fixed::Fx;
use crate::ids::*;
use crate::log::{LogEvent, LogKind};
use crate::news;
use crate::summary::{truncate_chars, world_date_text};
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::fmt::Write;

/// 保留的组合事件记录条数。
pub const COMPOSED_KEPT: usize = 100;
/// 提示词“新大陆局势”中每个列表最多列出的条目数。
const FRONTIER_LIST_MAX: usize = 12;

impl EffectKind {
    /// 全部效果（数据文件与提案中使用的顺序）。
    pub const ALL: [EffectKind; 23] = [
        EffectKind::GoodSupply,
        EffectKind::GoodDemand,
        EffectKind::SupplyShift,
        EffectKind::DemandShift,
        EffectKind::LocationSupply,
        EffectKind::LocationDemand,
        EffectKind::Popularity,
        EffectKind::RegionStorm,
        EffectKind::RegionPirates,
        EffectKind::RelationShift,
        EffectKind::FactionTax,
        EffectKind::Development,
        EffectKind::InterestShift,
        EffectKind::IndustryEfficiency,
        EffectKind::ColonyOutput,
        EffectKind::ColonyMorale,
        EffectKind::ColonyGrowth,
        EffectKind::SiteClaim,
        EffectKind::DiscoveryRumor,
        EffectKind::ExportBan,
        EffectKind::ImportTariff,
        EffectKind::ExportTariff,
        EffectKind::Subsidy,
    ];

    /// 数据文件与提案中使用的 key。
    pub fn key(self) -> &'static str {
        match self {
            EffectKind::GoodSupply => "good_supply",
            EffectKind::GoodDemand => "good_demand",
            EffectKind::SupplyShift => "supply_shift",
            EffectKind::DemandShift => "demand_shift",
            EffectKind::LocationSupply => "location_supply",
            EffectKind::LocationDemand => "location_demand",
            EffectKind::Popularity => "popularity",
            EffectKind::RegionStorm => "region_storm",
            EffectKind::RegionPirates => "region_pirates",
            EffectKind::RelationShift => "relation_shift",
            EffectKind::FactionTax => "faction_tax",
            EffectKind::Development => "development",
            EffectKind::InterestShift => "interest_shift",
            EffectKind::IndustryEfficiency => "industry_efficiency",
            EffectKind::ColonyOutput => "colony_output",
            EffectKind::ColonyMorale => "colony_morale",
            EffectKind::ColonyGrowth => "colony_growth",
            EffectKind::SiteClaim => "site_claim",
            EffectKind::DiscoveryRumor => "discovery_rumor",
            EffectKind::ExportBan => "export_ban",
            EffectKind::ImportTariff => "import_tariff",
            EffectKind::ExportTariff => "export_tariff",
            EffectKind::Subsidy => "subsidy",
        }
    }

    pub fn from_key(key: &str) -> Option<EffectKind> {
        EffectKind::ALL.into_iter().find(|e| e.key() == key)
    }

    /// 一次性效果（立即生效，不进入进行中列表）。
    pub fn is_instant(self) -> bool {
        use EffectKind::*;
        matches!(self, Popularity | RelationShift | Development | ColonyMorale | SiteClaim | DiscoveryRumor)
    }

    /// 效果是否对目标不利（系数小于 1 或变化量为负）；殖民地的负面效果另有保护期与困境限制。
    pub fn is_harmful(self, p: &EventParams) -> bool {
        p.mult.is_some_and(|m| m < Fx::ONE) || p.delta.is_some_and(|d| d < 0)
    }
}

/// 效果词表中一种效果的边界（来自 `data/effects.toml`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectBounds {
    pub effect: EffectKind,
    /// 显示名（界面与提示词）
    pub name: String,
    /// 说明（提示词）
    pub description: String,
    /// 系数范围（含端点）
    pub mult: Option<(Fx, Fx)>,
    /// 持续天数范围
    pub days: Option<(u32, u32)>,
    /// 变化量范围
    pub delta: Option<(i64, i64)>,
    /// 地点必须是港口
    pub port_only: bool,
    /// 两个势力处于和平或停战时允许的关系变化量范围（仅关系类效果；None 表示不另加限制）
    pub peace_delta: Option<(i64, i64)>,
}

impl EffectBounds {
    pub fn limits(&self) -> EffectLimits<'static> {
        EffectLimits { mult: self.mult, days: self.days, delta: self.delta, port_only: self.port_only, goods: &[] }
    }
}

/// 组合事件的规则（来自 `data/effects.toml`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComposedRules {
    /// 每个组合事件最多几条效果
    pub max_effects: usize,
    /// 两个组合事件之间至少间隔的天数
    pub cooldown_days: u32,
    /// 每年最多几个组合事件
    pub max_per_year: u32,
    /// 同一目标上的同类效果（来自组合事件）两次之间至少间隔的天数
    pub repeat_days: u32,
    /// 总强度预算：各效果 |系数 − 1| 之和的上限
    pub budget: Fx,
    /// 标题的最大字数
    pub max_title_chars: usize,
    /// 叙事的最大字数
    pub max_text_chars: usize,
    /// 新建立的殖民地在多少天内不受负面的殖民地效果影响
    pub colony_grace_days: u32,
    /// 效果词表（按数据文件顺序）；不在词表中的效果不能使用
    pub effects: Vec<EffectBounds>,
}

impl Default for ComposedRules {
    /// 空词表：不允许任何组合事件。
    fn default() -> Self {
        ComposedRules {
            max_effects: 0,
            cooldown_days: 1,
            max_per_year: 0,
            repeat_days: 0,
            budget: Fx::ZERO,
            max_title_chars: 24,
            max_text_chars: 240,
            colony_grace_days: 0,
            effects: Vec::new(),
        }
    }
}

impl ComposedRules {
    /// 某种效果的边界；不在词表中返回 None。
    pub fn bounds(&self, effect: EffectKind) -> Option<&EffectBounds> {
        self.effects.iter().find(|b| b.effect == effect)
    }
}

/// 组合事件的来源（写入命令，情报界面显示）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComposedSource {
    /// 离线模板
    #[default]
    Template,
    /// 语言模型（含缓存的模型输出）
    Model,
    /// 内核规则触发的政策（ECONOMY.md 6.10；标题与叙事由内核按政策写成）
    Rule,
}

/// 组合事件的一条效果（内核标识与定点数）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComposedEffect {
    pub effect: EffectKind,
    pub params: EventParams,
}

/// 组合事件记录。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComposedRecord {
    pub id: u32,
    /// 开始日
    pub day: u32,
    pub title: String,
    /// 叙事
    pub text: String,
    pub effects: Vec<ComposedEffect>,
    pub source: ComposedSource,
}

impl ComposedRecord {
    /// 全部效果结束的日子（不含）；只有一次性效果时为开始日的次日。
    pub fn end(&self) -> u32 {
        self.effects
            .iter()
            .filter(|e| !e.effect.is_instant())
            .map(|e| self.day + e.params.days.unwrap_or(1))
            .max()
            .unwrap_or(self.day + 1)
    }
}

/// 效果作用的目标：同一目标上的同类效果视为重复。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EffectTarget {
    pub effect: EffectKind,
    pub loc: Option<LocId>,
    pub good: Option<GoodId>,
    pub region: Option<RegionId>,
    /// 两个势力（较小的在前，与顺序无关）
    pub factions: (Option<FactionId>, Option<FactionId>),
    /// 发现物（传闻）
    pub discovery: Option<DiscoveryId>,
}

impl EffectTarget {
    /// 殖民地产量效果的目标是整个殖民地（不区分建筑），同一殖民地上的产量效果不叠加；
    /// 占领殖民点的目标是殖民点本身（不论哪个势力）。
    pub fn of(effect: EffectKind, p: &EventParams) -> EffectTarget {
        let factions = match (p.faction_a, p.faction_b) {
            (Some(a), Some(b)) if b < a => (Some(b), Some(a)),
            other => other,
        };
        let factions = if effect == EffectKind::SiteClaim { (None, None) } else { factions };
        EffectTarget { effect, loc: p.loc, good: p.good, region: p.region, factions, discovery: p.discovery }
    }
}

/// 各效果 |系数 − 1| 之和（总强度）。
pub fn strength(effects: &[ComposedEffect]) -> Fx {
    effects
        .iter()
        .filter_map(|e| e.params.mult)
        .map(|m| if m > Fx::ONE { m - Fx::ONE } else { Fx::ONE - m })
        .fold(Fx::ZERO, |a, b| a + b)
}

/// 系数的简短文字（去掉末尾的 0，例如 1.2、0.85）。
pub fn fx_short(f: Fx) -> String {
    let s = f.to_string();
    let s = s.trim_end_matches('0');
    s.trim_end_matches('.').to_string()
}

impl World {
    /// 今天能否开始组合事件：冷却期、每年上限与每日事件数上限。
    pub fn check_composed_schedule(&self) -> Result<(), CommandError> {
        self.check_composed_schedule_in_batch(false)
    }
    fn check_composed_schedule_in_batch(&self, same_batch: bool) -> Result<(), CommandError> {
        let rules = &self.defs.composed;
        if rules.effects.is_empty() || rules.max_effects == 0 || rules.max_per_year == 0 {
            return Err(CommandError::Precondition("数据中没有启用组合事件".into()));
        }
        let day = self.state.day;
        let hist = &self.state.events.history;
        if let Some(last) = hist.iter().rev().find(|r| !r.origin.is_catalog())
            && !same_batch
            && last.day + rules.cooldown_days > day
        {
            return Err(CommandError::Precondition("组合事件仍在冷却期".into()));
        }
        let year_start = day - day % self.defs.calendar.year_days();
        let this_year = hist.iter().filter(|r| !r.origin.is_catalog() && r.day >= year_start).count() as u32;
        if this_year >= rules.max_per_year {
            return Err(CommandError::Precondition("组合事件今年已达上限".into()));
        }
        self.check_daily_event_cap()
    }

    /// 校验一条组合事件的效果（不含冷却与频率）；`earlier` 为同一事件中排在它前面的效果。
    pub fn validate_composed_effect(&self, e: &ComposedEffect, earlier: &[ComposedEffect]) -> Result<(), CommandError> {
        let rules = &self.defs.composed;
        let day = self.state.day;
        let b = rules
            .bounds(e.effect)
            .ok_or_else(|| CommandError::OutOfRange(format!("效果 {} 不在效果词表中", e.effect.key())))?;
        let p = &e.params;
        self.validate_effect(e.effect, p, &b.limits())?;
        // 地点必须有市场（尚未开发的地点不受市场类效果影响）；殖民点上的效果另查殖民地与归属
        if let Some(loc) = p.loc
            && !e.effect.targets_site()
            && self.defs.loc(loc).market.is_empty()
        {
            return Err(CommandError::NotTraded);
        }
        self.validate_frontier_effect(e.effect, p)?;
        self.validate_policy_effect(e.effect, p)?;
        if p.mult == Some(Fx::ONE) {
            return Err(CommandError::OutOfRange("系数为 1，没有效果".into()));
        }
        if p.delta == Some(0) {
            return Err(CommandError::OutOfRange("变化量为 0，没有效果".into()));
        }
        // 外交前提：和平或停战的两国之间，关系不能一次剧烈变化
        if let (Some(a), Some(f), Some(d), Some((lo, hi))) = (p.faction_a, p.faction_b, p.delta, b.peace_delta) {
            let status = self.relation(a, f).map(|r| r.status).unwrap_or(DiploStatus::Peace);
            if matches!(status, DiploStatus::Peace | DiploStatus::Truce) && !(lo..=hi).contains(&d) {
                return Err(CommandError::Precondition(format!("两势力处于{status:?}，关系变化量须在 {lo}–{hi} 之间")));
            }
        }
        let target = EffectTarget::of(e.effect, p);
        if earlier.iter().any(|x| EffectTarget::of(x.effect, &x.params) == target) {
            return Err(CommandError::OutOfRange("同一目标的同类效果重复".into()));
        }
        if self.state.events.active.iter().any(|a| a.effect.is_some_and(|k| EffectTarget::of(k, &a.params) == target)) {
            return Err(CommandError::Precondition("该目标上已有进行中的同类效果".into()));
        }
        if self.state.events.composed.iter().any(|r| {
            r.day + rules.repeat_days > day && r.effects.iter().any(|x| EffectTarget::of(x.effect, &x.params) == target)
        }) {
            return Err(CommandError::Precondition("该目标近期已有同类的组合事件效果".into()));
        }
        Ok(())
    }

    /// 殖民扩展效果的局势检查：目标必须存在且处于可以作用的状态（其余效果直接通过）。
    ///
    /// - 殖民地效果：该殖民点上有殖民地；产量效果指定的建筑已建成且有产出，不指定时殖民地至少有一座产出建筑；
    ///   负面效果不作用于刚建立（保护期内）或正处困境（断粮、近 30 天遭袭）的殖民地。
    /// - 占领殖民点：与殖民竞赛相同的限制（无主、开局保护期、占领上限、距离、冷却），另外交战中的势力不能占领。
    /// - 发现物传闻：玩家尚未发现、尚无传闻，且玩家名声达到门槛。
    pub fn validate_frontier_effect(&self, effect: EffectKind, p: &EventParams) -> Result<(), CommandError> {
        let day = self.state.day;
        if effect.targets_colony() {
            let loc = p.loc.ok_or_else(|| CommandError::OutOfRange("缺少参数 loc".into()))?;
            let c = self.colony_at(loc).ok_or_else(|| CommandError::NotFound("该殖民点上没有殖民地".into()))?;
            if effect == EffectKind::ColonyOutput {
                match p.building {
                    Some(b) => {
                        if !crate::colony::is_productive(&self.defs, b) {
                            return Err(CommandError::OutOfRange("这种建筑没有产出".into()));
                        }
                        if c.level(b) == 0 {
                            return Err(CommandError::Precondition("殖民地还没有这座建筑".into()));
                        }
                    }
                    None => {
                        if !c.buildings.iter().any(|(b, lvl)| *lvl > 0 && crate::colony::is_productive(&self.defs, *b))
                        {
                            return Err(CommandError::Precondition("殖民地还没有产出建筑".into()));
                        }
                    }
                }
            }
            if effect.is_harmful(p) {
                if day < c.founded + self.defs.composed.colony_grace_days {
                    return Err(CommandError::Precondition("新建立的殖民地尚在保护期内".into()));
                }
                let raided = c.last_raid.is_some_and(|d| d + crate::calendar::DAYS_PER_MONTH > day);
                if c.starving_days > 0 || raided {
                    return Err(CommandError::Precondition("殖民地正处困境，不再施加负面效果".into()));
                }
            }
        }
        if effect == EffectKind::SiteClaim {
            let (Some(loc), Some(f)) = (p.loc, p.faction_a) else {
                return Err(CommandError::OutOfRange("缺少参数 loc 或 faction".into()));
            };
            if let Some(why) = crate::colony::claim_blocker(self, f, loc) {
                return Err(CommandError::Precondition(why));
            }
            // 外交限制：处于战争中的势力无暇开拓，不会因事件占领殖民点
            if self.state.relations.iter().any(|r| (r.a == f || r.b == f) && r.status == DiploStatus::War) {
                return Err(CommandError::Precondition(format!("{}正处于战争中，无暇开拓", self.defs.faction(f).name)));
            }
        }
        if effect == EffectKind::DiscoveryRumor {
            let d = p.discovery.ok_or_else(|| CommandError::OutOfRange("缺少参数 discovery".into()))?;
            if let Some(why) = self.rumor_blocker(d) {
                return Err(CommandError::Precondition(why));
            }
        }
        Ok(())
    }

    /// 势力经济政策的局势检查（ECONOMY.md 8.4）：禁运与关税的势力至少有一处地点交易这种商品，补贴的地点交易这种商品。
    pub fn validate_policy_effect(&self, effect: EffectKind, p: &EventParams) -> Result<(), CommandError> {
        match effect {
            EffectKind::ExportBan | EffectKind::ImportTariff | EffectKind::ExportTariff => {
                let (Some(f), Some(g)) = (p.faction_a, p.good) else {
                    return Err(CommandError::OutOfRange("缺少参数 faction 或 good".into()));
                };
                let traded = self.defs.loc_ids().any(|l| self.location_faction(l) == f && self.market(l, g).is_some());
                if !traded {
                    return Err(CommandError::NotTraded);
                }
            }
            EffectKind::Subsidy => {
                let (Some(l), Some(g)) = (p.loc, p.good) else {
                    return Err(CommandError::OutOfRange("缺少参数 loc 或 good".into()));
                };
                if self.market(l, g).is_none() {
                    return Err(CommandError::NotTraded);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// 校验一个组合事件。
    pub fn validate_composed(&self, title: &str, text: &str, effects: &[ComposedEffect]) -> Result<(), CommandError> {
        self.validate_composed_in_batch(title, text, effects, false)
    }
    /// 只在一批原子涟漪的第二条事件中略过刚由第一条产生的冷却；年度、每日及目标上限仍逐条检查。
    pub(crate) fn validate_composed_in_batch(
        &self,
        title: &str,
        text: &str,
        effects: &[ComposedEffect],
        same_batch: bool,
    ) -> Result<(), CommandError> {
        let rules = &self.defs.composed;
        self.check_composed_schedule_in_batch(same_batch)?;
        news::check_text(title, rules.max_title_chars)?;
        news::check_text(text, rules.max_text_chars)?;
        if effects.is_empty() || effects.len() > rules.max_effects {
            return Err(CommandError::OutOfRange(format!(
                "效果数量 {} 不在 1–{} 之间",
                effects.len(),
                rules.max_effects
            )));
        }
        for (i, e) in effects.iter().enumerate() {
            self.validate_composed_effect(e, &effects[..i])?;
        }
        let total = strength(effects);
        if total > rules.budget {
            return Err(CommandError::OutOfRange(format!(
                "总强度 {} 超出预算 {}",
                fx_short(total),
                fx_short(rules.budget)
            )));
        }
        Ok(())
    }

    /// 开始一个组合事件（调用前须已通过校验）。
    pub(crate) fn start_composed(
        &mut self,
        title: &str,
        text: &str,
        effects: &[ComposedEffect],
        source: ComposedSource,
    ) -> Result<(), CoreError> {
        self.begin_composed(title, text, effects, source, true)
    }

    /// 开始一个组合事件；`history` 为假时不记入事件的开始记录（规则触发的政策不占组合事件的冷却与年度上限）。
    pub(crate) fn begin_composed(
        &mut self,
        title: &str,
        text: &str,
        effects: &[ComposedEffect],
        source: ComposedSource,
        history: bool,
    ) -> Result<(), CoreError> {
        let day = self.state.day;
        let id = self.state.events.next_composed.max(1);
        self.state.events.next_composed = id + 1;
        let origin = EventOrigin::Composed { id };
        if history {
            self.record_event_start(COMPOSED_KIND, origin);
        }
        for e in effects {
            if !self.apply_instant_effect(e.effect, &e.params)? {
                let end = day + e.params.days.unwrap_or(1);
                self.push_active(COMPOSED_KIND, e.effect, e.params.clone(), end, origin);
            }
        }
        self.state.events.composed.push(ComposedRecord {
            id,
            day,
            title: title.to_string(),
            text: text.to_string(),
            effects: effects.to_vec(),
            source,
        });
        if self.state.events.composed.len() > COMPOSED_KEPT {
            let excess = self.state.events.composed.len() - COMPOSED_KEPT;
            self.state.events.composed.drain(0..excess);
        }
        let loc = effects.iter().find_map(|e| e.params.loc);
        self.push_log(LogEvent {
            day,
            kind: LogKind::ComposedEventStarted { composed: id, title: title.to_string(), loc },
        });
        self.recompute_modifiers();
        Ok(())
    }

    /// 编号对应的组合事件记录（只保留最近的若干条）。
    pub fn composed_record(&self, id: u32) -> Option<&ComposedRecord> {
        self.state.events.composed.iter().find(|r| r.id == id)
    }

    /// 进行中条目的名称：目录事件取类型名，组合事件取标题。
    pub fn active_event_name(&self, e: &ActiveEvent) -> String {
        match e.origin {
            EventOrigin::Catalog => self.defs.events.get(e.kind.idx()).map(|d| d.name.clone()).unwrap_or_default(),
            EventOrigin::Composed { id } => self.composed_record(id).map(|r| r.title.clone()).unwrap_or_default(),
        }
    }

    /// 进行中事件的文字（世界摘要用）：目录事件逐条列出，组合事件按事件合并。
    pub fn active_events_text(&self) -> String {
        let day = self.day();
        let mut seen: Vec<u32> = Vec::new();
        let mut parts: Vec<String> = Vec::new();
        for e in &self.state.events.active {
            if let Some(id) = e.origin.composed_id() {
                if seen.contains(&id) {
                    continue;
                }
                seen.push(id);
                let end = self.composed_record(id).map(|r| r.end()).unwrap_or(e.end);
                parts.push(format!("【{}】（还剩 {} 天）", self.active_event_name(e), end.saturating_sub(day)));
            } else {
                parts.push(format!("{}（还剩 {} 天）", self.active_event_name(e), e.end.saturating_sub(day)));
            }
        }
        if parts.is_empty() { "无".to_string() } else { parts.join("、") }
    }
}

/// 一条效果的文字（提示词、审计与离线叙事用）：效果名与参数。
pub fn effect_text(world: &World, e: &ComposedEffect) -> String {
    let defs = &world.defs;
    let p = &e.params;
    let name = defs.composed.bounds(e.effect).map(|b| b.name.clone()).unwrap_or_else(|| e.effect.key().to_string());
    let mut parts: Vec<String> = Vec::new();
    if let Some(l) = p.loc.and_then(|l| defs.locations.get(l.idx())) {
        parts.push(l.name.clone());
    }
    if let Some(g) = p.good.and_then(|g| defs.goods.get(g.idx())) {
        parts.push(g.name.clone());
    }
    if let Some(b) = p.building.and_then(|b| defs.colony_buildings.get(b.idx())) {
        parts.push(b.name.clone());
    } else if e.effect.allows_building() {
        parts.push("全部建筑".into());
    }
    if let Some(d) = p.discovery.and_then(|d| defs.discoveries.get(d.idx())) {
        parts.push(d.name.clone());
    }
    if let Some(r) = p.region.and_then(|r| defs.regions.get(r.idx())) {
        parts.push(r.name.clone());
    }
    for f in [p.faction_a, p.faction_b].into_iter().flatten() {
        if let Some(f) = defs.factions.get(f.idx()) {
            parts.push(f.name.clone());
        }
    }
    if let Some(m) = p.mult {
        parts.push(format!("×{}", fx_short(m)));
    }
    if let Some(d) = p.delta {
        parts.push(format!("{d:+}"));
    }
    if let Some(d) = p.days {
        parts.push(format!("{d} 天"));
    }
    format!("{name}（{}）", parts.join(" · "))
}

/// 效果词表与边界（写进组合事件的提示词）。
pub fn effect_vocabulary(world: &World) -> String {
    let rules = &world.defs.composed;
    let mut s = String::new();
    let _ = writeln!(
        s,
        "每个事件 1–{} 条效果；各效果 |mult − 1| 之和不超过 {}；mult 不能等于 1，delta 不能为 0；\
         同一事件中同一目标的同类效果不能重复，也不能与进行中的同类同目标效果叠加；同一目标 {} 天内不再受同类效果。",
        rules.max_effects,
        fx_short(rules.budget),
        rules.repeat_days
    );
    let _ = writeln!(s, "标题不超过 {} 字，叙事不超过 {} 字。", rules.max_title_chars, rules.max_text_chars);
    for b in &rules.effects {
        let k = b.effect;
        let mut params: Vec<String> = Vec::new();
        if k.needs_loc() {
            params.push(if k.targets_colony() {
                "loc（已有殖民地的殖民点 key）".into()
            } else if k == EffectKind::SiteClaim {
                "loc（无主的殖民点 key）".into()
            } else if b.port_only {
                "loc（港口 key）".into()
            } else {
                "loc（有市场的地点 key）".into()
            });
        }
        if k.allows_building() {
            params.push("building（有产出的殖民地建筑 key，all 表示全部建筑）".into());
        }
        if k.needs_discovery() {
            params.push("discovery（玩家尚未发现的发现物 key）".into());
        }
        if k.needs_good() {
            params.push(if k.needs_loc() {
                "good（当地交易的商品 key）".into()
            } else {
                "good（商品 key）".into()
            });
        }
        if k.needs_region() {
            params.push("region（海区 key）".into());
        }
        if k.needs_faction_b() {
            params.push("faction_a、faction_b（两个不同的势力 key）".into());
        } else if k.needs_faction_a() {
            params.push("faction（势力 key）".into());
        }
        if let (true, Some((lo, hi))) = (k.needs_mult(), b.mult) {
            params.push(format!("mult（{}–{}）", fx_short(lo), fx_short(hi)));
        }
        if let (true, Some((lo, hi))) = (k.needs_days(), b.days) {
            params.push(format!("days（{lo}–{hi}）"));
        }
        if let (true, Some((lo, hi))) = (k.needs_delta(), b.delta) {
            match b.peace_delta {
                Some((plo, phi)) => params.push(format!("delta（{lo} 至 {hi}；两国和平或停战时 {plo} 至 {phi}）")),
                None => params.push(format!("delta（{lo} 至 {hi}）")),
            }
        }
        let _ = writeln!(s, "- {}：{}。{}参数：{}", k.key(), b.name, b.description, params.join("，"));
    }
    s
}

/// 殖民地与殖民点的局势（写进组合事件的提示词）：现有的殖民地及其产出建筑、无主的殖民点与可以占领它的势力、
/// 各势力已占领的数目、可以流传传闻的发现物；有长度上限。殖民地效果、占领殖民点与发现物传闻只能用这里列出的对象。
pub fn frontier_catalog(world: &World, max_chars: usize) -> String {
    let defs = &world.defs;
    let mut s = String::new();
    let colonies: Vec<String> = world
        .state
        .colonies
        .values()
        .map(|c| {
            let site = defs.loc(c.loc);
            let buildings: Vec<String> = c
                .buildings
                .iter()
                .filter(|(b, l)| **l > 0 && crate::colony::is_productive(defs, **b))
                .map(|(b, l)| format!("{}={} {l} 级", defs.colony_building(*b).key, defs.colony_building(*b).name))
                .collect();
            let trouble = if c.starving_days > 0 { "，正在断粮" } else { "" };
            format!(
                "{}={}（殖民地“{}”，人口 {}，士气 {}{trouble}；产出建筑：{}）",
                site.key,
                site.name,
                c.name,
                c.population,
                c.morale,
                if buildings.is_empty() { "无".to_string() } else { buildings.join("、") }
            )
        })
        .collect();
    let _ = writeln!(
        s,
        "殖民地：{}",
        if colonies.is_empty() { "无（不能使用殖民地效果）".to_string() } else { colonies.join("；") }
    );
    let held: Vec<String> =
        defs.faction_ids().map(|f| format!("{} {} 处", defs.faction(f).name, world.faction_claims(f))).collect();
    let total = defs.site_ids().count();
    let _ = writeln!(s, "各势力已占领的殖民点（共 {total} 处殖民点）：{}", held.join("、"));
    // 列表有长度上限，较长的无主殖民点放在最后
    let rumors: Vec<String> = defs
        .discovery_ids()
        .filter(|d| world.rumor_blocker(*d).is_none())
        .take(FRONTIER_LIST_MAX)
        .map(|d| format!("{}={}", defs.discovery(d).key, defs.discovery(d).name))
        .collect();
    let _ = writeln!(
        s,
        "可以流传传闻的发现物：{}",
        if rumors.is_empty() { "暂无（不能使用 discovery_rumor）".to_string() } else { rumors.join("、") }
    );
    let free: Vec<String> = defs
        .site_ids()
        .filter(|l| world.claim_of(*l).is_none())
        .filter_map(|l| {
            let fs: Vec<&str> = defs
                .faction_ids()
                .filter(|f| crate::colony::claim_blocker(world, *f, l).is_none())
                .map(|f| defs.faction(f).key.as_str())
                .collect();
            (!fs.is_empty()).then(|| format!("{}={}（可占领：{}）", defs.loc(l).key, defs.loc(l).name, fs.join("、")))
        })
        .take(FRONTIER_LIST_MAX)
        .collect();
    let _ = writeln!(
        s,
        "势力可以占领的无主殖民点：{}",
        if free.is_empty() { "暂无（不能使用 site_claim）".to_string() } else { free.join("、") }
    );
    truncate_chars(&s, max_chars)
}

/// 近期历史（写进组合事件的提示词）：最近开始的事件、最近的组合事件与新闻，有长度上限。
pub fn recent_history(world: &World, max_chars: usize) -> String {
    let defs = &world.defs;
    let mut s = String::new();
    let recent: Vec<String> = world
        .state
        .events
        .history
        .iter()
        .rev()
        .filter_map(|r| r.catalog_kind().and_then(|k| defs.events.get(k.idx())).map(|d| (r.day, d)))
        .take(8)
        .map(|(day, d)| format!("{} {}", world_date_text(&defs.rules.world, day), d.name))
        .collect();
    let _ = writeln!(s, "近来的事件：{}", if recent.is_empty() { "无".to_string() } else { recent.join("；") });
    let composed: Vec<String> = world
        .state
        .events
        .composed
        .iter()
        .rev()
        .take(6)
        .map(|r| {
            let effects: Vec<String> = r.effects.iter().map(|e| effect_text(world, e)).collect();
            format!("{} 《{}》：{}", world_date_text(&defs.rules.world, r.day), r.title, effects.join("；"))
        })
        .collect();
    if composed.is_empty() {
        let _ = writeln!(s, "近来的组合事件：无");
    } else {
        let _ = writeln!(s, "近来的组合事件（不要重复这些题材与目标）：");
        for c in composed {
            let _ = writeln!(s, "- {c}");
        }
    }
    let chronicle = world.state.news.chronicles.last();
    if let Some(c) = chronicle {
        let _ = writeln!(s, "上一年的编年史：{}", truncate_chars(&c.text, 200));
    }
    truncate_chars(&s, max_chars)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_keys_round_trip() {
        for e in EffectKind::ALL {
            assert_eq!(EffectKind::from_key(e.key()), Some(e));
        }
        assert_eq!(EffectKind::from_key("gold_rain"), None);
    }

    #[test]
    fn short_numbers_and_strength() {
        assert_eq!(fx_short(Fx::from_pct(120)), "1.2");
        assert_eq!(fx_short(Fx(8_500)), "0.85");
        assert_eq!(fx_short(Fx::ONE), "1");
        let e = |m: i64| ComposedEffect {
            effect: EffectKind::InterestShift,
            params: EventParams { mult: Some(Fx(m)), days: Some(10), ..EventParams::default() },
        };
        assert_eq!(strength(&[e(12_000), e(7_000)]), Fx(5_000));
    }

    #[test]
    fn targets_ignore_faction_order() {
        let p = |a: u16, b: u16| EventParams {
            faction_a: Some(FactionId(a)),
            faction_b: Some(FactionId(b)),
            delta: Some(5),
            ..EventParams::default()
        };
        assert_eq!(
            EffectTarget::of(EffectKind::RelationShift, &p(1, 2)),
            EffectTarget::of(EffectKind::RelationShift, &p(2, 1))
        );
    }
}

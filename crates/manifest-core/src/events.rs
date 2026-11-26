//! 世界事件：事件类型是 `data/events.toml` 中的封闭集合，效果由内核实现。
//!
//! 事件由 AI 事件导演（或离线模板）提议，经裁决后以 [`crate::command::Command::ApplyEvent`] 执行。
//! 内核校验：类型存在、参数齐全且没有多余参数、数值在范围内、冷却期、每年次数上限、每日数量上限、
//! 势力关系前提。事件本身不含任何金额参数，因此无法凭空增减资产。
//!
//! 持续性事件保存在进行中列表，每天（以及事件开始时）重新计算全部修正系数；一次性事件（关系、发展度、流行）立即生效。
//!
//! 进行中列表同时容纳两种来源：目录事件（`events.toml` 中的封闭集合）与组合事件（见 [`crate::composed`]）。
//! 每个条目开始时记录自己的效果类型，重算修正系数时只看条目本身，不再回查事件类型定义。
//! 两种来源共用按效果的参数校验 [`World::validate_effect`]。

use crate::composed::ComposedRecord;
use crate::defs::{EffectKind, EventRequire};
use crate::diplomacy::DiploStatus;
use crate::error::{CommandError, CoreError};
use crate::fixed::Fx;
use crate::ids::*;
use crate::log::{LogEvent, LogKind};
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 事件参数（按效果类型使用其中的一部分）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventParams {
    pub loc: Option<LocId>,
    pub good: Option<GoodId>,
    pub region: Option<RegionId>,
    pub faction_a: Option<FactionId>,
    pub faction_b: Option<FactionId>,
    pub mult: Option<Fx>,
    pub days: Option<u32>,
    pub delta: Option<i64>,
    /// 殖民地建筑（仅殖民地产量效果；不填表示全部建筑）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub building: Option<ColonyBuildingId>,
    /// 发现物（仅发现物传闻）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovery: Option<DiscoveryId>,
}

/// 事件来源：目录事件或组合事件。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventOrigin {
    /// 目录事件（`events.toml` 中的封闭集合）；条目的 `kind` 有效
    #[default]
    Catalog,
    /// 组合事件；条目的 `kind` 为占位值 [`COMPOSED_KIND`]，标题、叙事与全部效果见 `EventState::composed` 中同编号的记录
    Composed { id: u32 },
}

impl EventOrigin {
    pub fn is_catalog(&self) -> bool {
        *self == EventOrigin::Catalog
    }

    /// 组合事件的编号。
    pub fn composed_id(&self) -> Option<u32> {
        match self {
            EventOrigin::Catalog => None,
            EventOrigin::Composed { id } => Some(*id),
        }
    }
}

/// 组合事件条目在 `kind` 字段中使用的占位值：不对应任何事件类型。
/// 读取 `kind` 前先看来源（或用 [`ActiveEvent::catalog_kind`] / [`EventRecord::catalog_kind`]）。
pub const COMPOSED_KIND: EventTypeId = EventTypeId(u16::MAX);

/// 进行中的事件（组合事件的每条持续效果各占一个条目）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveEvent {
    pub id: u32,
    /// 目录事件的类型；组合事件为 [`COMPOSED_KIND`]
    pub kind: EventTypeId,
    pub params: EventParams,
    pub start: u32,
    /// 结束日（不含）
    pub end: u32,
    /// 效果（开始时记录；旧存档缺失时由读档对齐按事件类型补上）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<EffectKind>,
    /// 来源
    #[serde(default, skip_serializing_if = "EventOrigin::is_catalog")]
    pub origin: EventOrigin,
}

impl ActiveEvent {
    /// 目录事件的类型；组合事件返回 None。
    pub fn catalog_kind(&self) -> Option<EventTypeId> {
        self.origin.is_catalog().then_some(self.kind)
    }
}

/// 事件开始记录（用于冷却与频率上限）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventRecord {
    /// 目录事件的类型；组合事件为 [`COMPOSED_KIND`]
    pub kind: EventTypeId,
    pub day: u32,
    /// 来源
    #[serde(default, skip_serializing_if = "EventOrigin::is_catalog")]
    pub origin: EventOrigin,
}

impl EventRecord {
    /// 目录事件的类型；组合事件返回 None。
    pub fn catalog_kind(&self) -> Option<EventTypeId> {
        self.origin.is_catalog().then_some(self.kind)
    }
}

/// 一条效果的参数边界（目录事件取自事件类型定义，组合事件取自 `effects.toml`）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct EffectLimits<'a> {
    /// 系数范围（含端点）
    pub mult: Option<(Fx, Fx)>,
    /// 持续天数范围
    pub days: Option<(u32, u32)>,
    /// 变化量范围
    pub delta: Option<(i64, i64)>,
    /// 地点必须是港口
    pub port_only: bool,
    /// 允许的商品（空表示任意）
    pub goods: &'a [GoodId],
}

/// 由进行中事件得出的修正系数（每天重算）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Modifiers {
    pub region_storm: Vec<Fx>,
    pub region_pirate: Vec<Fx>,
    pub faction_tax: Vec<Fx>,
    pub interest: Fx,
    pub industry: Fx,
    /// 出口禁令：(势力, 商品)（ECONOMY.md 8.4；没有时为空、不写进存档）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub export_ban: Vec<(FactionId, GoodId)>,
    /// 进口关税与出口税：(势力, 商品, 交易税系数)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub import_tariff: Vec<(FactionId, GoodId, Fx)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub export_tariff: Vec<(FactionId, GoodId, Fx)>,
}

/// 事件系统状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventState {
    pub active: Vec<ActiveEvent>,
    pub next_id: u32,
    pub history: Vec<EventRecord>,
    pub mods: Modifiers,
    /// 最近的组合事件（标题、叙事、效果、来源），旧的在前
    #[serde(default)]
    pub composed: Vec<ComposedRecord>,
    /// 下一个组合事件的编号
    #[serde(default)]
    pub next_composed: u32,
}

/// 每天最多开始的事件数（目录事件与组合事件合计）。
pub const MAX_EVENTS_PER_DAY: usize = 3;
/// 保留的事件开始记录条数。
pub(crate) const HISTORY_KEPT: usize = 400;

impl World {
    /// 校验一个事件提议。
    pub fn validate_event(&self, kind: EventTypeId, p: &EventParams) -> Result<(), CommandError> {
        let defs = &self.defs;
        let def = defs.events.get(kind.idx()).ok_or_else(|| CommandError::NotFound(format!("事件类型 {kind:?}")))?;
        let day = self.state.day;
        let limits = EffectLimits {
            mult: def.mult,
            days: def.days,
            delta: def.delta,
            port_only: def.port_only,
            goods: &def.goods,
        };
        self.validate_effect(def.effect, p, &limits)?;
        // 事件类型限定的地点、海区与势力（空表示任意）
        if let Some(loc) = p.loc
            && !def.locs.is_empty()
            && !def.locs.contains(&loc)
        {
            return Err(CommandError::OutOfRange("该事件不适用于这个地点".into()));
        }
        if let Some(region) = p.region
            && !def.regions.is_empty()
            && !def.regions.contains(&region)
        {
            return Err(CommandError::OutOfRange("该事件不适用于这片海区".into()));
        }
        if !def.factions.is_empty()
            && [p.faction_a, p.faction_b].into_iter().flatten().any(|f| !def.factions.contains(&f))
        {
            return Err(CommandError::OutOfRange("该事件不适用于这个势力".into()));
        }
        // 势力关系前提
        if def.requires != EventRequire::None {
            let (Some(a), Some(b)) = (p.faction_a, p.faction_b) else {
                return Err(CommandError::OutOfRange("缺少势力参数".into()));
            };
            let status = self.relation(a, b).map(|r| r.status).unwrap_or(DiploStatus::Peace);
            let ok = match def.requires {
                EventRequire::None => true,
                EventRequire::Tension => status == DiploStatus::Tension,
                EventRequire::TensionOrWar => matches!(status, DiploStatus::Tension | DiploStatus::War),
            };
            if !ok {
                return Err(CommandError::Precondition(format!("势力关系为 {status:?}，不满足该事件的前提")));
            }
        }
        // 冷却、每年次数、每日数量
        let hist = &self.state.events.history;
        if let Some(last) = hist.iter().rev().find(|r| r.catalog_kind() == Some(kind))
            && last.day + def.cooldown_days > day
        {
            return Err(CommandError::Precondition("该类事件仍在冷却期".into()));
        }
        let year_start = day - day % self.defs.calendar.year_days();
        let this_year = hist.iter().filter(|r| r.catalog_kind() == Some(kind) && r.day >= year_start).count() as u32;
        if this_year >= def.max_per_year {
            return Err(CommandError::Precondition("该类事件今年已达上限".into()));
        }
        self.check_daily_event_cap()
    }

    /// 今天开始的事件（两种来源合计）是否已达上限。
    pub(crate) fn check_daily_event_cap(&self) -> Result<(), CommandError> {
        let day = self.state.day;
        if self.state.events.history.iter().filter(|r| r.day == day).count() >= MAX_EVENTS_PER_DAY {
            return Err(CommandError::Precondition("今天的事件数量已达上限".into()));
        }
        Ok(())
    }

    /// 按效果校验一组参数：参数齐全且没有多余、引用的对象存在、地点交易该商品、数值在边界内。
    /// 目录事件与组合事件共用；冷却、频率与外交前提由各自的校验另查。
    pub fn validate_effect(&self, e: EffectKind, p: &EventParams, limits: &EffectLimits) -> Result<(), CommandError> {
        let defs = &self.defs;
        // 参数齐全且不多余
        let presence = [
            ("loc", e.needs_loc(), p.loc.is_some()),
            ("good", e.needs_good(), p.good.is_some()),
            ("region", e.needs_region(), p.region.is_some()),
            ("faction_a", e.needs_faction_a(), p.faction_a.is_some()),
            ("faction_b", e.needs_faction_b(), p.faction_b.is_some()),
            ("mult", e.needs_mult(), p.mult.is_some()),
            ("days", e.needs_days(), p.days.is_some()),
            ("delta", e.needs_delta(), p.delta.is_some()),
            ("discovery", e.needs_discovery(), p.discovery.is_some()),
        ];
        for (name, need, has) in presence {
            if need && !has {
                return Err(CommandError::OutOfRange(format!("缺少参数 {name}")));
            }
            if !need && has {
                return Err(CommandError::OutOfRange(format!("多余的参数 {name}")));
            }
        }
        // 建筑参数可选（不填表示全部建筑），只有殖民地产量效果可以带
        if p.building.is_some() && !e.allows_building() {
            return Err(CommandError::OutOfRange("多余的参数 building".into()));
        }
        if let Some(loc) = p.loc {
            let l = defs.locations.get(loc.idx()).ok_or_else(|| CommandError::NotFound(format!("{loc:?}")))?;
            if limits.port_only && !l.is_port() {
                return Err(CommandError::NotAPort);
            }
            if e.targets_site() {
                // 殖民地与占领类效果只作用于殖民点
                if !l.is_site() {
                    return Err(CommandError::Precondition("这种效果只适用于殖民点".into()));
                }
            } else if l.is_site() {
                // 殖民点没有市场与发展度，现有的市场类事件不适用
                return Err(CommandError::Precondition("殖民点不适用这种事件".into()));
            }
        }
        if let Some(b) = p.building
            && defs.colony_buildings.get(b.idx()).is_none()
        {
            return Err(CommandError::NotFound(format!("{b:?}")));
        }
        if let Some(d) = p.discovery
            && defs.discoveries.get(d.idx()).is_none()
        {
            return Err(CommandError::NotFound(format!("{d:?}")));
        }
        if let Some(good) = p.good {
            if defs.goods.get(good.idx()).is_none() {
                return Err(CommandError::NotFound(format!("{good:?}")));
            }
            if !limits.goods.is_empty() && !limits.goods.contains(&good) {
                return Err(CommandError::OutOfRange("该事件不适用于这种商品".into()));
            }
            if let Some(loc) = p.loc
                && self.market(loc, good).is_none()
            {
                return Err(CommandError::NotTraded);
            }
        }
        if let Some(r) = p.region
            && defs.regions.get(r.idx()).is_none()
        {
            return Err(CommandError::NotFound(format!("{r:?}")));
        }
        for f in [p.faction_a, p.faction_b].into_iter().flatten() {
            if defs.factions.get(f.idx()).is_none() {
                return Err(CommandError::NotFound(format!("{f:?}")));
            }
        }
        if p.faction_a.is_some() && p.faction_a == p.faction_b {
            return Err(CommandError::OutOfRange("两个势力不能相同".into()));
        }
        if let (Some(m), Some((lo, hi))) = (p.mult, limits.mult)
            && (m < lo || m > hi)
        {
            return Err(CommandError::OutOfRange(format!("系数 {m} 不在 {lo}–{hi} 之间")));
        }
        if let (Some(d), Some((lo, hi))) = (p.days, limits.days)
            && (d < lo || d > hi)
        {
            return Err(CommandError::OutOfRange(format!("天数 {d} 不在 {lo}–{hi} 之间")));
        }
        if let (Some(d), Some((lo, hi))) = (p.delta, limits.delta)
            && (d < lo || d > hi)
        {
            return Err(CommandError::OutOfRange(format!("变化量 {d} 不在 {lo}–{hi} 之间")));
        }
        Ok(())
    }

    /// 记下一次事件开始（冷却与频率上限用），只保留最近的若干条。
    pub(crate) fn record_event_start(&mut self, kind: EventTypeId, origin: EventOrigin) {
        let day = self.state.day;
        self.state.events.history.push(EventRecord { kind, day, origin });
        if self.state.events.history.len() > HISTORY_KEPT {
            let excess = self.state.events.history.len() - HISTORY_KEPT;
            self.state.events.history.drain(0..excess);
        }
    }

    /// 开始一个事件（调用前须已通过校验）。
    pub(crate) fn start_event(&mut self, kind: EventTypeId, params: EventParams) -> Result<(), CoreError> {
        let day = self.state.day;
        let effect = self.defs.event_type(kind).effect;
        self.record_event_start(kind, EventOrigin::Catalog);
        if !self.apply_instant_effect(effect, &params)? {
            let end = day + params.days.unwrap_or(1);
            self.push_active(kind, effect, params.clone(), end, EventOrigin::Catalog);
        }
        self.push_log(LogEvent {
            day,
            kind: LogKind::EventStarted { event: kind, loc: params.loc, good: params.good },
        });
        self.recompute_modifiers();
        Ok(())
    }

    /// 加入一个进行中的条目。
    pub(crate) fn push_active(
        &mut self,
        kind: EventTypeId,
        effect: EffectKind,
        params: EventParams,
        end: u32,
        origin: EventOrigin,
    ) {
        let id = self.state.events.next_id.max(1);
        self.state.events.next_id = id + 1;
        let start = self.state.day;
        self.state.events.active.push(ActiveEvent { id, kind, params, start, end, effect: Some(effect), origin });
    }

    /// 一次性效果（关系、发展度、流行、殖民地士气、占领殖民点、发现物传闻）立即生效并返回 true；
    /// 持续性效果返回 false，由调用方加入进行中列表。
    pub(crate) fn apply_instant_effect(&mut self, effect: EffectKind, params: &EventParams) -> Result<bool, CoreError> {
        let day = self.state.day;
        match effect {
            EffectKind::RelationShift => {
                let (Some(a), Some(b), Some(d)) = (params.faction_a, params.faction_b, params.delta) else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                self.apply_relation_delta(a, b, d)?;
            }
            EffectKind::Development => {
                let (Some(loc), Some(d)) = (params.loc, params.delta) else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                if let Some(ls) = self.state.locations.get_mut(loc.idx()) {
                    let r = &self.defs.rules.development;
                    if r.enabled {
                        let before = ls.development;
                        ls.development = before.saturating_add(r.event_delta(before, d)).clamp(1, r.max);
                        ls.growth.month_events = ls
                            .growth
                            .month_events
                            .saturating_add((ls.development - before) * crate::development::POINT_BP);
                    } else {
                        ls.development = (ls.development + d).clamp(1, 100);
                    }
                }
            }
            EffectKind::Popularity => {
                let (Some(loc), Some(good), Some(days)) = (params.loc, params.good, params.days) else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                if let Some(e) = self.market_mut(loc, good) {
                    e.popular_until = e.popular_until.max(day + days);
                }
            }
            EffectKind::ColonyMorale => {
                let (Some(loc), Some(d)) = (params.loc, params.delta) else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                self.shift_colony_morale(loc, d);
            }
            EffectKind::SiteClaim => {
                let (Some(loc), Some(f)) = (params.loc, params.faction_a) else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                self.claim_site(f, loc);
            }
            EffectKind::DiscoveryRumor => {
                let Some(d) = params.discovery else {
                    return Err(CoreError::Internal("事件参数缺失".into()));
                };
                self.record_rumor(d);
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// tick 第 6 步：结束到期事件，重算修正系数。
    pub(crate) fn event_day(&mut self) {
        let day = self.state.day;
        self.state.events.active.retain(|e| e.end > day + 1);
        self.recompute_modifiers();
    }

    /// 读档对齐：旧存档中的进行中事件没有记录效果，按事件类型补上（找不到类型的条目无法生效，丢弃）。
    pub(crate) fn fill_event_effects(&mut self) {
        let defs = self.defs.clone();
        for ev in self.state.events.active.iter_mut() {
            if ev.effect.is_none() && ev.origin.is_catalog() {
                ev.effect = defs.events.get(ev.kind.idx()).map(|d| d.effect);
            }
        }
        self.state.events.active.retain(|e| e.effect.is_some());
    }

    /// 由进行中事件重算全部修正系数（只看各条目记录的效果与参数，不回查事件类型定义）。
    ///
    /// 各地市场的事件系数（`event_supply` / `event_demand`）先只读地算出应有的值，与现值不同的才写回去。
    /// 结果与“全部清回 1、再按进行中列表的顺序逐条乘上去”逐位相同：每个市场条目上乘的仍是同一串系数、同一个顺序
    /// （定点乘法逐步舍入，顺序不能换），只是没有变化的条目不再写一遍。各地的市场是写时复制的（[`crate::shared`]）：
    /// 试算用的世界副本（涟漪、剧情选项的校验）在这里不写，就不用把整块市场拷一份。
    pub(crate) fn recompute_modifiers(&mut self) {
        let mut mods = Modifiers {
            region_storm: vec![Fx::ONE; self.defs.regions.len()],
            region_pirate: vec![Fx::ONE; self.defs.regions.len()],
            faction_tax: vec![Fx::ONE; self.defs.factions.len()],
            interest: Fx::ONE,
            industry: Fx::ONE,
            export_ban: Vec::new(),
            import_tariff: Vec::new(),
            export_tariff: Vec::new(),
        };
        // 会动市场的条目，按进行中列表的顺序：（地点下标, 商品, 是否产量, 系数）；地点、商品为 None 表示“每一处”“每一种”
        let mut market_mods: Vec<(Option<usize>, Option<GoodId>, bool, Fx)> = Vec::new();
        for ev in &self.state.events.active {
            // 效果在开始时写入；旧存档由读档对齐补上
            let Some(effect) = ev.effect else { continue };
            let p = &ev.params;
            let m = p.mult.unwrap_or(Fx::ONE);
            match effect {
                EffectKind::GoodSupply | EffectKind::GoodDemand => {
                    if let Some(g) = p.good {
                        market_mods.push((None, Some(g), effect == EffectKind::GoodSupply, m));
                    }
                }
                EffectKind::SupplyShift | EffectKind::DemandShift | EffectKind::Subsidy => {
                    if let (Some(l), Some(g)) = (p.loc, p.good) {
                        market_mods.push((Some(l.idx()), Some(g), effect != EffectKind::DemandShift, m));
                    }
                }
                EffectKind::LocationSupply | EffectKind::LocationDemand => {
                    if let Some(l) = p.loc {
                        market_mods.push((Some(l.idx()), None, effect == EffectKind::LocationSupply, m));
                    }
                }
                EffectKind::RegionStorm => {
                    if let Some(r) = p.region.and_then(|r| mods.region_storm.get_mut(r.idx())) {
                        *r = r.mul(m);
                    }
                }
                EffectKind::RegionPirates => {
                    if let Some(r) = p.region.and_then(|r| mods.region_pirate.get_mut(r.idx())) {
                        *r = r.mul(m);
                    }
                }
                EffectKind::FactionTax => {
                    if let Some(f) = p.faction_a.and_then(|f| mods.faction_tax.get_mut(f.idx())) {
                        *f = f.mul(m);
                    }
                }
                EffectKind::ExportBan => {
                    if let (Some(f), Some(g)) = (p.faction_a, p.good)
                        && !mods.export_ban.contains(&(f, g))
                    {
                        mods.export_ban.push((f, g));
                    }
                }
                EffectKind::ImportTariff | EffectKind::ExportTariff => {
                    if let (Some(f), Some(g)) = (p.faction_a, p.good) {
                        let list = if effect == EffectKind::ImportTariff {
                            &mut mods.import_tariff
                        } else {
                            &mut mods.export_tariff
                        };
                        list.push((f, g, m));
                    }
                }
                EffectKind::InterestShift => mods.interest = mods.interest.mul(m),
                EffectKind::IndustryEfficiency => mods.industry = mods.industry.mul(m),
                // 一次性效果不进入进行中列表；殖民地产量与增长系数由殖民地逐日按进行中的条目读取
                EffectKind::Popularity
                | EffectKind::RelationShift
                | EffectKind::Development
                | EffectKind::ColonyOutput
                | EffectKind::ColonyMorale
                | EffectKind::ColonyGrowth
                | EffectKind::SiteClaim
                | EffectKind::DiscoveryRumor => {}
            }
        }
        // 只读地扫一遍：每个市场条目从 1 起，按顺序乘上落在它头上的系数；与现值不同的记下来
        let mut changes: Vec<(usize, GoodId, Fx, Fx)> = Vec::new();
        let mut local: Vec<(Option<GoodId>, bool, Fx)> = Vec::new();
        for (li, ls) in self.state.locations.iter().enumerate() {
            local.clear();
            local.extend(
                market_mods
                    .iter()
                    .filter(|(loc, ..)| loc.is_none_or(|l| l == li))
                    .map(|&(_, g, supply, m)| (g, supply, m)),
            );
            for (good, e) in &ls.market {
                let (mut supply, mut demand) = (Fx::ONE, Fx::ONE);
                for &(g, is_supply, m) in &local {
                    if g.is_none_or(|g| g == *good) {
                        if is_supply {
                            supply = supply.mul(m);
                        } else {
                            demand = demand.mul(m);
                        }
                    }
                }
                if e.event_supply != supply || e.event_demand != demand {
                    changes.push((li, *good, supply, demand));
                }
            }
        }
        if !changes.is_empty() {
            // 写时复制到这里才可能真的拷：确实有条目要改
            let locations = &mut *self.state.locations;
            for (li, good, supply, demand) in changes {
                if let Some(e) = locations.get_mut(li).and_then(|ls| ls.market.get_mut(&good)) {
                    e.event_supply = supply;
                    e.event_demand = demand;
                }
            }
        }
        self.state.events.mods = mods;
    }

    /// 海区风暴概率修正。
    pub fn storm_mult(&self, region: RegionId) -> Fx {
        self.state.events.mods.region_storm.get(region.idx()).copied().unwrap_or(Fx::ONE)
    }

    /// 海区海盗概率修正。
    pub fn pirate_mult(&self, region: RegionId) -> Fx {
        self.state.events.mods.region_pirate.get(region.idx()).copied().unwrap_or(Fx::ONE)
    }

    /// 势力交易税修正。
    pub fn faction_tax_event_mult(&self, faction: FactionId) -> Fx {
        self.state.events.mods.faction_tax.get(faction.idx()).copied().unwrap_or(Fx::ONE)
    }

    pub fn interest_mult(&self) -> Fx {
        let m = self.state.events.mods.interest;
        if m == Fx::ZERO { Fx::ONE } else { m }
    }

    pub fn industry_mult(&self) -> Fx {
        let m = self.state.events.mods.industry;
        if m == Fx::ZERO { Fx::ONE } else { m }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::{Domain, Rng};
    use crate::shared::Shared;
    use crate::testkit::tiny_defs;

    /// P12 之前的算法，冻结在这里作对照：各地市场的事件系数全部清回 1，再按进行中列表的顺序逐条乘上去。
    fn market_modifiers_before_p12(w: &mut World) {
        for ls in w.state.locations.iter_mut() {
            for e in ls.market.values_mut() {
                e.event_supply = Fx::ONE;
                e.event_demand = Fx::ONE;
            }
        }
        let active = w.state.events.active.clone();
        for ev in &active {
            let Some(effect) = ev.effect else { continue };
            let p = &ev.params;
            let m = p.mult.unwrap_or(Fx::ONE);
            match effect {
                EffectKind::GoodSupply | EffectKind::GoodDemand => {
                    let supply = effect == EffectKind::GoodSupply;
                    if let Some(g) = p.good {
                        for ls in w.state.locations.iter_mut() {
                            if let Some(e) = ls.market.get_mut(&g) {
                                if supply {
                                    e.event_supply = e.event_supply.mul(m);
                                } else {
                                    e.event_demand = e.event_demand.mul(m);
                                }
                            }
                        }
                    }
                }
                EffectKind::SupplyShift | EffectKind::DemandShift | EffectKind::Subsidy => {
                    let supply = effect != EffectKind::DemandShift;
                    if let (Some(l), Some(g)) = (p.loc, p.good)
                        && let Some(e) = w.market_mut(l, g)
                    {
                        if supply {
                            e.event_supply = e.event_supply.mul(m);
                        } else {
                            e.event_demand = e.event_demand.mul(m);
                        }
                    }
                }
                EffectKind::LocationSupply | EffectKind::LocationDemand => {
                    let supply = effect == EffectKind::LocationSupply;
                    if let Some(ls) = p.loc.and_then(|l| w.state.locations.get_mut(l.idx())) {
                        for e in ls.market.values_mut() {
                            if supply {
                                e.event_supply = e.event_supply.mul(m);
                            } else {
                                e.event_demand = e.event_demand.mul(m);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn world() -> World {
        let mut w = World::new(tiny_defs(), ScenarioId(0), 3).expect("开局");
        for _ in 0..3 {
            w.end_day().expect("日结");
        }
        w
    }

    /// 随机的一条进行中条目：每种效果都会出现，参数有时缺、有时越界（旧存档与外部构造的状态都要照原样处理）。
    fn random_event(w: &World, rng: &mut Rng, id: u32) -> ActiveEvent {
        let effect = EffectKind::ALL[rng.below(EffectKind::ALL.len() as u64) as usize];
        let some = |rng: &mut Rng| rng.below(8) != 0;
        // 偶尔指向不存在的地点、商品
        let loc = some(rng).then(|| LocId(rng.below(w.defs.locations.len() as u64 + 1) as u16));
        let good = some(rng).then(|| GoodId(rng.below(w.defs.goods.len() as u64 + 1) as u16));
        let region = some(rng).then(|| RegionId(rng.below(w.defs.regions.len() as u64 + 1) as u16));
        let faction_a = some(rng).then(|| FactionId(rng.below(w.defs.factions.len() as u64 + 1) as u16));
        // 不整的系数：连乘的舍入与顺序有关
        let mult = some(rng).then(|| Fx(rng.range(3_333, 23_457)));
        ActiveEvent {
            id,
            kind: COMPOSED_KIND,
            params: EventParams { loc, good, region, faction_a, mult, days: Some(10), ..EventParams::default() },
            start: w.day(),
            end: w.day() + 10,
            effect: some(rng).then_some(effect),
            origin: EventOrigin::Composed { id },
        }
    }

    #[test]
    fn modifiers_match_reset_then_multiply_in_order() {
        let base = world();
        for round in 0..300u32 {
            let mut rng = Rng::derive(12, round, Domain::Market, 0, 0);
            let mut w = base.clone();
            w.state.events.active = (0..rng.below(9) as u32).map(|i| random_event(&w, &mut rng, i + 1)).collect();
            // 现值有时已经是脏的（测试或上一轮事件留下的）：也要回到应有的值
            if round % 3 == 0 {
                for ls in w.state.locations.iter_mut() {
                    for e in ls.market.values_mut() {
                        e.event_supply = Fx(rng.range(0, 20_000));
                        e.event_demand = Fx(rng.range(0, 20_000));
                    }
                }
            }
            let mut old = w.clone();
            market_modifiers_before_p12(&mut old);
            w.recompute_modifiers();
            assert_eq!(w.state.locations, old.state.locations, "第 {round} 轮：各地市场的事件系数");
            // 再算一遍：已经是应有的值，一处也不写
            let again = w.clone();
            w.recompute_modifiers();
            assert_eq!(w.state, again.state, "第 {round} 轮：重算是幂等的");
            assert!(Shared::same(&w.state.locations, &again.state.locations), "第 {round} 轮：没有变化就不拷");
        }
    }

    #[test]
    fn unchanged_modifiers_leave_a_shared_market_block_alone() {
        let w = world();
        let storm = |mult: i64| ActiveEvent {
            id: 90,
            kind: COMPOSED_KIND,
            params: EventParams { region: Some(RegionId(0)), mult: Some(Fx(mult)), ..EventParams::default() },
            start: w.day(),
            end: w.day() + 5,
            effect: Some(EffectKind::RegionStorm),
            origin: EventOrigin::Composed { id: 90 },
        };
        // 试算用的副本：日结刚算过，系数没有变化——不写，各地市场仍与原世界共用
        let mut trial = w.clone();
        trial.recompute_modifiers();
        assert!(Shared::same(&w.state.locations, &trial.state.locations));
        // 不动市场的效果（海区风暴）：照样生效，市场仍然共用
        trial.state.events.active.push(storm(15_000));
        trial.recompute_modifiers();
        assert_eq!(trial.storm_mult(RegionId(0)), Fx(15_000));
        assert!(Shared::same(&w.state.locations, &trial.state.locations));
        // 动市场的效果：副本自己拷一份再改，原世界不受影响
        let before = w.state.locations[0].market[&GoodId(0)].event_supply;
        trial.state.events.active.push(ActiveEvent {
            id: 91,
            params: EventParams { loc: Some(LocId(0)), mult: Some(Fx(7_000)), ..EventParams::default() },
            effect: Some(EffectKind::LocationSupply),
            origin: EventOrigin::Composed { id: 91 },
            ..storm(10_000)
        });
        trial.recompute_modifiers();
        assert!(!Shared::same(&w.state.locations, &trial.state.locations));
        assert_eq!(trial.state.locations[0].market[&GoodId(0)].event_supply, before.mul(Fx(7_000)));
        assert_eq!(w.state.locations[0].market[&GoodId(0)].event_supply, before);
        // 各地的市场按地点各自写时复制：只有改到的那一处是另拷的，其余地点的市场仍与原世界共用
        for (i, (a, b)) in w.state.locations.iter().zip(trial.state.locations.iter()).enumerate() {
            assert_eq!(Shared::same(&a.market, &b.market), i != 0, "地点 {i}");
        }
    }

    /// 试算用的世界副本做一笔只动一处市场的事（玩家的一笔买卖、一条只影响一地的事件）：只拷那一处的市场。
    #[test]
    fn writing_one_market_on_a_trial_copy_copies_only_that_location() {
        let w = world();
        let at = w.state.locations.iter().position(|l| !l.market.is_empty()).expect("有市场的地点");
        let good = *w.state.locations[at].market.keys().next().expect("商品");
        let plain = serde_json::to_string(&w.state.locations).expect("序列化");
        let mut trial = w.clone();
        // 只读不拷
        assert!(trial.state.locations.iter().map(|l| l.market.len()).sum::<usize>() > 0);
        assert!(Shared::same(&w.state.locations, &trial.state.locations));
        trial.market_mut(LocId::from_idx(at), good).expect("市场").stock += 7;
        for (i, (a, b)) in w.state.locations.iter().zip(trial.state.locations.iter()).enumerate() {
            assert_eq!(Shared::same(&a.market, &b.market), i != at, "地点 {i}");
            assert!(Shared::same(&a.board, &b.board), "地点 {i} 的告示板");
        }
        assert_eq!(trial.state.locations[at].market[&good].stock, w.state.locations[at].market[&good].stock + 7);
        // 原世界一个字节也没变；包了这一层之后序列化仍是原来的写法
        assert_eq!(serde_json::to_string(&w.state.locations).expect("序列化"), plain);
        assert!(plain.contains("\"market\":{"));
    }
}

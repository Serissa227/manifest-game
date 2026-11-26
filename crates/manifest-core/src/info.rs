//! 信息时效（docs/ECONOMY.md 第 7 节，规则见 [`crate::defs::InfoRules`]）：远方的行情有时效、随船传播。
//!
//! - 开局时选“行情情报”（[`InfoMode`]）：实时（经典；旧存档与没有选择时）或随船传递。实时模式下这里什么也不做，
//!   状态里没有这些字段（与 E5 逐日一致）。
//! - 随船传递时，玩家与各商会各自记着每个地点最近一次得到的行情快照（[`Snapshot`]：快照日、各商品的价格与库存、市况）：
//!   1. 自己的舰队或商队在那里（商会还有本据港）：看得到实时的行情；每天结算之后记一次，离开时再记一次；
//!   2. 随船消息：任何舰队从港口出航时带上出发港的快照，抵达时贴到目的港的告示板上（比板上的新才换）；
//!      那时玩家有舰队或商队在目的港，就顺便读到（比自己手上的新才换）；
//!   3. 行情通报：玩家在港口的交易所付费（[`crate::command::Command::BuyMarketReport`]），买下告示板上所有比自己手上新的快照。
//!
//!   商会只知道自己的船队带回来的（开局时熟悉整个海域：记着第 0 天各地的快照），不读告示板。
//! - 快照日 d：包含 d 之前各天的收盘（不含 d 当天）；今天 − d 是过时的天数，日线只知道到 d − 1。
//!   结算进行到收盘之后记下的快照包含当天的收盘，算作明天的（[`World::info_day`]）。
//! - [`World::sight`] 给出某方此刻的眼界，[`Sight::market`] 给出所知的某地某商品的行情（[`Known`]）：
//!   实时模式或在场时是实时的，否则是快照。商会的规划、bot 与界面都经由它看远方的行情。

use crate::error::{CommandError, CoreError, Reason};
use crate::fixed::Money;
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::people::Condition;
use crate::treasury::Flow;
use crate::world::{MarketEntry, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 行情情报的模式（开局时选）。只允许追加。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InfoMode {
    /// 实时（经典）：到过的港口，行情一直实时可见
    #[default]
    Live,
    /// 随船传递：远方的行情有时效，随船传播
    Carried,
}

impl InfoMode {
    pub fn key(self) -> &'static str {
        match self {
            InfoMode::Live => "live",
            InfoMode::Carried => "carried",
        }
    }
}

/// 快照的来源。只允许追加。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InfoSource {
    /// 自己的舰队或商队（商会还有本据港）在那里时看到的
    Visit,
    /// 随船消息：在告示板上读到的
    Ship,
    /// 行情通报：付费买到的
    Report,
}

impl InfoSource {
    pub fn key(self) -> &'static str {
        match self {
            InfoSource::Visit => "visit",
            InfoSource::Ship => "ship",
            InfoSource::Report => "report",
        }
    }
}

/// 某地的一份行情快照。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub loc: LocId,
    /// 快照日：包含这一天之前各天的收盘（不含当天）
    pub day: u32,
    pub source: InfoSource,
    /// 各商品（按商品编号）：(商品, 价格, 库存)
    pub goods: Vec<(GoodId, Money, i64)>,
    /// 当时的市况
    #[serde(default, skip_serializing_if = "is_stable")]
    pub condition: Condition,
}

fn is_stable(c: &Condition) -> bool {
    *c == Condition::Stable
}

impl Snapshot {
    /// 某商品的价格与库存（这里不交易时为 None）。
    pub fn good(&self, good: GoodId) -> Option<(Money, i64)> {
        self.goods.binary_search_by_key(&good, |(g, _, _)| *g).ok().map(|i| (self.goods[i].1, self.goods[i].2))
    }
}

/// 信息时效的状态：模式与各方所知的快照（实时模式下为空、不写进存档）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InfoState {
    #[serde(default)]
    pub mode: InfoMode,
    /// 各方所知的各地行情（随船传递时）。体量仅次于各地的市场，同样包成写时复制（见 [`crate::shared`]）。
    #[serde(default, skip_serializing_if = "known_is_empty")]
    pub known: crate::shared::Shared<BTreeMap<OwnerId, BTreeMap<LocId, Snapshot>>>,
}

/// 没有任何快照（不写进存档；与原来的 `BTreeMap::is_empty` 同一个条件）。
fn known_is_empty(known: &crate::shared::Shared<BTreeMap<OwnerId, BTreeMap<LocId, Snapshot>>>) -> bool {
    known.is_empty()
}

impl InfoState {
    /// 实时模式、没有任何快照（不写进存档）。
    pub fn is_live(&self) -> bool {
        self.mode == InfoMode::Live && self.known.is_empty()
    }
}

/// 某方所知的某地某商品的行情。
#[derive(Clone, Copy, Debug)]
pub struct Known<'a> {
    /// 这个市场（基准价、目标库存等结构性的数据取实时的）
    pub entry: &'a MarketEntry,
    /// 所知的价格与库存
    pub price: Money,
    pub stock: i64,
    /// 快照日（实时为 None）
    pub day: Option<u32>,
    /// 过时的天数：记下行情时的“今天” − 快照日（实时为 0）
    pub age: i64,
    /// 日线末尾不知道的天数（快照日之后的收盘，不超过日线的长度）
    pub hidden: usize,
}

impl<'a> Known<'a> {
    /// 实时的行情。
    pub fn live(entry: &'a MarketEntry) -> Known<'a> {
        Known { entry, price: entry.price, stock: entry.stock, day: None, age: 0, hidden: 0 }
    }

    pub fn is_live(&self) -> bool {
        self.day.is_none()
    }

    /// 所知日线的长度。
    pub fn history_len(&self) -> usize {
        self.entry.history.len().saturating_sub(self.hidden)
    }

    /// 所知日线的第 i 天（最早的为 0）。
    pub fn history_at(&self, i: usize) -> Option<Money> {
        if i < self.history_len() { self.entry.history.get(i).copied() } else { None }
    }

    /// 所知的日线（最早的在前）。
    pub fn history(&self) -> impl Iterator<Item = Money> + 'a {
        let n = self.history_len();
        self.entry.history.iter().take(n).copied()
    }
}

/// 某方此刻的眼界：在场的地点与手上的快照（规划前算一次，逐个市场查询时不用每次都数舰队）。
pub struct Sight<'a> {
    world: &'a World,
    live: bool,
    here: Vec<LocId>,
    known: Option<&'a BTreeMap<LocId, Snapshot>>,
    today: u32,
    /// 各地此刻开不开放（[`World::location_open`]），问过的记下：0 没问过，1 不开放，2 开放。
    /// 眼界借着世界（只读），这期间答案不会变；商会规划时同一个目的港要按每种货各问一遍。
    open: Vec<std::cell::Cell<u8>>,
}

impl<'a> Sight<'a> {
    /// 某地此刻开不开放：与 [`World::location_open`] 相同，同一个眼界里每个地点只算一次。
    fn location_open(&self, loc: LocId) -> bool {
        let Some(slot) = self.open.get(loc.idx()) else { return self.world.location_open(loc) };
        if slot.get() == 0 {
            slot.set(if self.world.location_open(loc) { 2 } else { 1 });
        }
        slot.get() == 2
    }

    /// 是否看得到某地的实时行情（实时模式下处处都是）。
    pub fn present(&self, loc: LocId) -> bool {
        self.live || self.here.contains(&loc)
    }

    /// 某地的快照（看得到实时行情时为 None）。
    pub fn snapshot(&self, loc: LocId) -> Option<&'a Snapshot> {
        if self.present(loc) { None } else { self.known?.get(&loc) }
    }

    /// 是否知道某地的行情（实时或有快照）。
    pub fn knows(&self, loc: LocId) -> bool {
        self.present(loc) || self.known.is_some_and(|k| k.contains_key(&loc))
    }

    /// 所知的某地某商品的行情：看得到实时行情时是实时的，否则是快照；不知道或这里不交易时为 None。
    pub fn market(&self, loc: LocId, good: GoodId) -> Option<Known<'a>> {
        // 同 `World::market`：不开放的地点没有市场
        if !self.location_open(loc) {
            return None;
        }
        let entry = self.world.state.locations.get(loc.idx())?.market.get(&good)?;
        if self.present(loc) {
            return Some(Known::live(entry));
        }
        let snap = self.known?.get(&loc)?;
        let (price, stock) = snap.good(good)?;
        let age = self.today.saturating_sub(snap.day) as i64;
        Some(Known { entry, price, stock, day: Some(snap.day), age, hidden: (age as usize).min(entry.history.len()) })
    }
}

/// 行情通报的预检结果：在哪里买、买到哪些地点的快照、价格。
pub(crate) struct BulletinPlan {
    pub loc: LocId,
    pub locs: Vec<LocId>,
    pub cost: Money,
}

impl World {
    pub fn info_mode(&self) -> InfoMode {
        self.state.info.mode
    }

    /// 记下行情时的“今天”：结算进行到收盘之后记下的包含当天的收盘，算作明天的快照。
    pub fn info_day(&self) -> u32 {
        self.state.day + u32::from(self.state.closed)
    }

    /// 某方此刻在场的地点（按地点编号、不重复）：玩家——舰队停靠或商队所在；商会——舰队停靠与本据港。
    pub fn presence(&self, owner: OwnerId) -> Vec<LocId> {
        let mut out: Vec<LocId> = self.fleets_of(owner).filter_map(|f| f.docked_at()).collect();
        if owner.is_player() {
            out.extend(self.caravans_of(owner).filter_map(|c| c.at()));
        } else if let Some(a) = self.state.agents.get(&owner)
            && !a.bankrupt
        {
            out.push(a.home);
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// 某方此刻的眼界。
    pub fn sight(&self, owner: OwnerId) -> Sight<'_> {
        Sight { open: vec![std::cell::Cell::new(0); self.state.locations.len()], ..self.sight_once(owner) }
    }

    /// 只问一处的眼界：不备“各地开不开放”的表，问到时现算。
    fn sight_once(&self, owner: OwnerId) -> Sight<'_> {
        let live = self.state.info.mode == InfoMode::Live;
        Sight {
            world: self,
            live,
            here: if live { Vec::new() } else { self.presence(owner) },
            known: self.state.info.known.get(&owner),
            today: self.info_day(),
            open: Vec::new(),
        }
    }

    /// 所知的某地某商品的行情（一次性的查询；逐个市场查询时先取 [`World::sight`]）。
    pub fn known_market(&self, owner: OwnerId, loc: LocId, good: GoodId) -> Option<Known<'_>> {
        self.sight_once(owner).market(loc, good)
    }

    /// 此刻某地的快照。
    pub fn take_snapshot(&self, loc: LocId, source: InfoSource) -> Snapshot {
        let ls = &self.state.locations[loc.idx()];
        Snapshot {
            loc,
            day: self.info_day(),
            source,
            goods: ls.market.iter().map(|(g, e)| (*g, e.price, e.stock)).collect(),
            condition: ls.people.condition,
        }
    }

    /// 记下一份快照：比手上的新（快照日更晚）才换；同一天的只有亲眼看到的才换。返回是否换了。
    pub(crate) fn learn(&mut self, owner: OwnerId, snap: Snapshot) -> bool {
        let map = self.state.info.known.entry(owner).or_default();
        let newer = match map.get(&snap.loc) {
            Some(old) => snap.day > old.day || (snap.day == old.day && snap.source == InfoSource::Visit),
            None => true,
        };
        if newer {
            map.insert(snap.loc, snap);
        }
        newer
    }

    fn has_market(&self, loc: LocId) -> bool {
        self.state.locations.get(loc.idx()).is_some_and(|l| !l.market.is_empty())
    }

    /// 从港口出航（随船传递时）：记下出发港此刻的行情，舰队带着它上路。
    pub(crate) fn info_depart(&mut self, fleet: FleetId, from: LocId) {
        if self.state.info.mode != InfoMode::Carried || !self.has_market(from) {
            return;
        }
        let Some(owner) = self.state.fleets.get(&fleet).map(|f| f.owner) else { return };
        let snap = self.take_snapshot(from, InfoSource::Visit);
        self.learn(owner, snap.clone());
        if let Some(f) = self.state.fleets.get_mut(&fleet) {
            f.news = Some(snap);
        }
    }

    /// 商队离开某地（随船传递时）：记下那里此刻的行情。
    pub(crate) fn info_leave(&mut self, owner: OwnerId, from: LocId) {
        if self.state.info.mode != InfoMode::Carried || !self.has_market(from) {
            return;
        }
        let snap = self.take_snapshot(from, InfoSource::Visit);
        self.learn(owner, snap);
    }

    /// 抵达（随船传递时）：带来的消息贴到告示板上（比板上的新才换）；玩家那时在场就顺便读到。
    pub(crate) fn info_arrive(&mut self, arrivals: &[(FleetId, LocId)]) {
        if self.state.info.mode != InfoMode::Carried {
            return;
        }
        let mut posted: Vec<(LocId, Snapshot)> = Vec::new();
        for (id, dest) in arrivals {
            let Some(news) = self.state.fleets.get_mut(id).and_then(|f| f.news.take()) else { continue };
            // 带回出发港的消息不用贴
            if news.loc == *dest {
                continue;
            }
            let Some(ls) = self.state.locations.get_mut(dest.idx()) else { continue };
            if ls.board.get(&news.loc).is_some_and(|old| old.day > news.day) {
                continue;
            }
            ls.board.insert(news.loc, news.clone());
            posted.push((*dest, news));
        }
        if posted.is_empty() {
            return;
        }
        let here = self.presence(OwnerId::Player);
        for (dest, mut news) in posted {
            if here.contains(&dest) {
                news.source = InfoSource::Ship;
                self.learn(OwnerId::Player, news);
            }
        }
    }

    /// 每天结算之后（随船传递时）：在场各方记下实时的行情；撕掉告示板上过旧的消息。
    pub(crate) fn info_day_end(&mut self) {
        if self.state.info.mode != InfoMode::Carried {
            return;
        }
        let owners: Vec<OwnerId> = self.state.agents.values().filter(|a| !a.bankrupt).map(|a| a.owner).collect();
        for owner in owners {
            for loc in self.presence(owner) {
                if self.has_market(loc) {
                    let snap = self.take_snapshot(loc, InfoSource::Visit);
                    self.learn(owner, snap);
                }
            }
        }
        let keep = self.defs.rules.info.board_days;
        let today = self.info_day();
        for ls in &mut self.state.locations {
            ls.board.retain(|_, s| s.day.saturating_add(keep) >= today);
        }
    }

    /// 行情通报：某港告示板上比玩家手上新的快照（按地点编号）与价格（没有时价格为 0）。
    /// 隐藏未知港口的世界只卖玩家已经知道的港口（不能借通报得知没望见过的港口；经典世界港口都可见，不受影响）。
    pub fn report_offer(&self, loc: LocId) -> (Vec<LocId>, Money) {
        let Some(ls) = self.state.locations.get(loc.idx()) else { return (Vec::new(), 0) };
        let mine = self.state.info.known.get(&OwnerId::Player);
        let newer: Vec<LocId> = ls
            .board
            .values()
            .filter(|s| self.location_visible(s.loc))
            .filter(|s| mine.and_then(|m| m.get(&s.loc)).is_none_or(|m| s.day > m.day))
            .map(|s| s.loc)
            .collect();
        let r = &self.defs.rules.info;
        let cost = if newer.is_empty() { 0 } else { r.report_base + r.report_per_port * newer.len() as Money };
        (newer, cost)
    }
}

/// `SetInfoMode` 的预检：只有玩家、只在开局（第 0 天）时。
pub(crate) fn check_mode(world: &World, owner: OwnerId) -> Result<(), CommandError> {
    if !owner.is_player() {
        return Err(CommandError::Precondition("只有玩家选择行情情报".into()));
    }
    if world.state.day != world.player_start_day() {
        return Err(Reason::new("info.mode_start", "行情情报只能在开局时选择").rule());
    }
    Ok(())
}

/// 选定行情情报的模式：清空已有的快照与消息；随船传递时商会记下第 0 天各地的行情（熟悉整个海域）。
pub(crate) fn exec_mode(world: &mut World, mode: InfoMode) {
    world.state.info.mode = mode;
    world.state.info.known.clear();
    for ls in &mut world.state.locations {
        ls.board.clear();
    }
    for f in world.state.fleets.values_mut() {
        f.news = None;
    }
    if mode != InfoMode::Carried {
        return;
    }
    let companies: Vec<OwnerId> =
        world.state.agents.values().filter(|a| !a.bankrupt && a.owner.company().is_some()).map(|a| a.owner).collect();
    let locs: Vec<LocId> = world.defs.loc_ids().filter(|l| world.has_market(*l)).collect();
    for owner in companies {
        for l in &locs {
            let snap = world.take_snapshot(*l, InfoSource::Visit);
            world.learn(owner, snap);
        }
    }
}

/// `BuyMarketReport` 的预检：随船传递、玩家在这个港口、告示板上有比手上新的行情、现金够。
pub(crate) fn check_report(world: &World, owner: OwnerId, loc: LocId) -> Result<BulletinPlan, CommandError> {
    if !owner.is_player() {
        return Err(CommandError::Precondition("只有玩家需要行情通报".into()));
    }
    if world.defs.locations.get(loc.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{loc:?}")));
    }
    if world.info_mode() != InfoMode::Carried {
        return Err(Reason::new("info.live", "实时行情模式下不需要行情通报").rule());
    }
    if !world.defs.loc(loc).is_port() || !world.has_market(loc) {
        return Err(Reason::new("info.report_port", "行情通报要在港口的交易所买").rule());
    }
    if !world.presence(owner).contains(&loc) {
        return Err(Reason::new("explore.presence", "须有舰队或商队在该港口").rule());
    }
    let (locs, cost) = world.report_offer(loc);
    if locs.is_empty() {
        return Err(Reason::new("info.report_nothing", "告示板上没有比你手上更新的行情").rule());
    }
    let have = world.state.agents.get(&owner).map(|a| a.cash).unwrap_or(0);
    if have < cost {
        return Err(CommandError::InsufficientCash { need: cost, have });
    }
    Ok(BulletinPlan { loc, locs, cost })
}

/// 买下行情通报：付费（货币流出），告示板上比手上新的快照记为“行情通报”。
pub(crate) fn exec_report(world: &mut World, owner: OwnerId, plan: BulletinPlan) -> Result<(), CoreError> {
    let day = world.state.day;
    world.book_external(
        owner,
        Flow::MarketReport,
        world.town_sector(plan.loc),
        JournalEntry::new(day, Memo::MarketReport, CashClass::Operating)
            .dr(Account::Fees, plan.cost)
            .cr(Account::Cash, plan.cost),
    )?;
    for l in plan.locs {
        let Some(mut snap) = world.state.locations[plan.loc.idx()].board.get(&l).cloned() else { continue };
        snap.source = InfoSource::Report;
        world.learn(owner, snap);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{DynamicPort, PortStatus};
    use crate::testkit::tiny_defs;

    /// 眼界里“各地开不开放”记下来反复用（P12），答案要与每次现问 [`World::market`] 相同：
    /// 实时与随船传递两种模式、在场与不在场、开放与休眠的港口，同一处连问两遍。
    #[test]
    fn sight_market_matches_asking_the_world_each_time() {
        let mut w = World::new(tiny_defs(), ScenarioId(0), 3).expect("开局");
        for _ in 0..3 {
            w.end_day().expect("日结");
        }
        let owners = [OwnerId::Player, OwnerId::Company(CompanyId(0))];
        let locs: Vec<LocId> = w.defs.loc_ids().collect();
        let goods: Vec<GoodId> = w.defs.good_ids().collect();
        for carried in [false, true] {
            if carried {
                // 随船传递：各方只记着一部分地点三天前的行情
                w.state.info.mode = InfoMode::Carried;
                for owner in owners {
                    for loc in locs.iter().step_by(2) {
                        let snap = w.take_snapshot(*loc, InfoSource::Visit);
                        w.learn(owner, snap);
                    }
                }
                for _ in 0..3 {
                    w.end_day().expect("日结");
                }
            }
            // 一处休眠的港口：没有市场可问
            let closed = locs[1];
            w.state
                .history
                .ports
                .insert(closed, DynamicPort { faction: None, status: PortStatus::Dormant, until: None });
            assert!(!w.location_open(closed));
            for owner in owners {
                let sight = w.sight(owner);
                let mut seen = 0;
                for loc in &locs {
                    for good in &goods {
                        // 逐个现问的参照：先看开不开放（`World::market`），再按在场与否取实时或快照
                        let expect = w.market(*loc, *good).and_then(|entry| {
                            if sight.present(*loc) {
                                return Some((entry.price, entry.stock, None, 0, 0));
                            }
                            let snap = w.state.info.known.get(&owner)?.get(loc)?;
                            let (price, stock) = snap.good(*good)?;
                            let age = w.info_day().saturating_sub(snap.day) as i64;
                            Some((price, stock, Some(snap.day), age, (age as usize).min(entry.history.len())))
                        });
                        for _ in 0..2 {
                            let got = sight.market(*loc, *good);
                            assert_eq!(got.map(|k| (k.price, k.stock, k.day, k.age, k.hidden)), expect);
                            let once = w.known_market(owner, *loc, *good);
                            assert_eq!(once.map(|k| (k.price, k.stock, k.day, k.age, k.hidden)), expect);
                            if let (Some(k), Some(entry)) = (got, w.market(*loc, *good)) {
                                assert!(std::ptr::eq(k.entry, entry));
                                seen += 1;
                            }
                        }
                        if *loc == closed {
                            assert!(sight.market(*loc, *good).is_none());
                        }
                    }
                }
                assert!(seen > 0, "至少问得到一些市场");
            }
            w.state.history.ports.remove(&closed);
        }
    }
}

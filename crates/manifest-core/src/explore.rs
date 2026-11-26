//! 探索：海图迷雾、海图、发现物与名声。只对玩家生效（NPC 商会熟悉整个海域）。
//!
//! - 舰队每天揭开周围若干格；商队揭开所在地周围。
//! - 首次抵达港口或城市才解锁其市场信息。
//! - 可在任意港口购买某个海区的海图，揭开该海区范围内的全部格子。
//! - 玩家舰队（与停在城市的商队）的视野覆盖到发现物所在格即"发现"（海图不算）；
//!   在任意港口报告发现，领取赏金（`Flow::Discovery`）、所在势力声望与名声。
//! - 迷雾位图按行优先存储并记录宽高；地图向右下扩展后，读档时按旧宽度重映射，已揭开的格子位置不变。
//! - 组合事件的“发现物传闻”只告诉玩家某件发现物的大致海区（记在 `rumors` 中），不揭开迷雾，也不算发现。

use crate::error::{CommandError, CoreError};
use crate::fixed::Money;
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 玩家的探索进度。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Exploration {
    /// 已揭开的格子（按行优先的位图）；为空表示尚未初始化
    pub cells: Vec<u64>,
    /// 位图对应的地图宽高（v4 起记录；旧存档为 0，读档时按 `rules.world.legacy_map` 解释）
    #[serde(default)]
    pub width: u16,
    #[serde(default)]
    pub height: u16,
    /// 到过的地点（解锁市场信息）
    pub visited: BTreeSet<LocId>,
    /// 手动航行世界已看见的地点；经典世界不写入此字段。
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub sighted: BTreeSet<LocId>,
    /// 买过海图的海区
    pub charts: BTreeSet<RegionId>,
    /// 已发现的发现物（发现日期）
    #[serde(default)]
    pub discovered: BTreeMap<DiscoveryId, u32>,
    /// 已报告的发现物
    #[serde(default)]
    pub reported: BTreeSet<DiscoveryId>,
    /// 听到的发现物传闻（发现之后仍保留）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub rumors: BTreeMap<DiscoveryId, Rumor>,
    /// 迷雾增量的派生窗口，不改变旧存档与世界哈希。
    #[serde(skip)]
    fog_history: FogHistory,
}

/// 一条发现物传闻：听到的日期与传闻所指的大致海区。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rumor {
    pub day: u32,
    pub region: RegionId,
}

/// 传闻搜索最近海区的半径（格）：发现物在陆上时，取离它最近的海格所在的海区。
const RUMOR_SEARCH_RADIUS: i64 = 24;

/// 发现物所在的大致海区：所在格属于某海区时即为该海区，否则取最近的有海区的格子（同距离按行优先取第一个）。
pub fn discovery_region(defs: &crate::defs::StaticData, id: DiscoveryId) -> Option<RegionId> {
    let d = defs.discoveries.get(id.idx())?;
    let map = &defs.map;
    let (cx, cy) = (d.cell.x as i64, d.cell.y as i64);
    if let Some(r) = map.region_of(d.cell) {
        return Some(r);
    }
    let mut best: Option<(i64, usize, RegionId)> = None;
    for dy in -RUMOR_SEARCH_RADIUS..=RUMOR_SEARCH_RADIUS {
        for dx in -RUMOR_SEARCH_RADIUS..=RUMOR_SEARCH_RADIUS {
            let Some(cell) = map.topology().normalize(cx + dx, cy + dy) else { continue };
            let dist = map.topology().squared_distance(d.cell, cell);
            let index = map.idx(cell);
            if dist > RUMOR_SEARCH_RADIUS * RUMOR_SEARCH_RADIUS || best.is_some_and(|(b, i, _)| (dist, index) >= (b, i))
            {
                continue;
            }
            if let Some(r) = map.region_of(cell) {
                best = Some((dist, index, r));
            }
        }
    }
    best.map(|(_, _, r)| r)
}

fn words_for(width: u16, height: u16) -> usize {
    (width as usize * height as usize).div_ceil(64)
}

impl Exploration {
    pub fn is_revealed(&self, idx: usize) -> bool {
        self.cells.get(idx / 64).is_some_and(|w| w & (1u64 << (idx % 64)) != 0)
    }

    fn reveal(&mut self, idx: usize) {
        if idx >= usize::from(self.width) * usize::from(self.height) || self.is_revealed(idx) {
            return;
        }
        if !self.fog_history.tracking {
            let rev = self.revealed_count();
            self.fog_history = FogHistory { tracking: true, rev, floor: rev, changes: Default::default() };
        }
        let Some(word) = self.cells.get_mut(idx / 64) else { return };
        *word |= 1u64 << (idx % 64);
        let width = usize::from(self.width);
        self.fog_history.record((idx / width) as u16, (idx % width) as u16);
    }

    /// 已揭开的格子数（界面据此判断迷雾是否变化）。
    pub fn revealed_count(&self) -> u32 {
        self.cells.iter().map(|w| w.count_ones()).sum()
    }
}

/// 传输窗口同时限制区间数与新增格数，避免长局的派生历史无界增长。
const FOG_HISTORY_RUNS: usize = 512;
const FOG_HISTORY_CELLS: u32 = 8192;

#[derive(Clone, Debug)]
struct FogChange {
    /// 本段最后一格对应的版本；段内按列递增，每个新格占一个版本。
    rev: u32,
    run: [u16; 3],
}

/// 只在内存中派生的传输缓存；不存档、不进入 state_hash，也不参与游戏状态的相等比较。
#[derive(Clone, Debug, Default)]
struct FogHistory {
    tracking: bool,
    rev: u32,
    floor: u32,
    changes: std::collections::VecDeque<FogChange>,
}

impl PartialEq for FogHistory {
    fn eq(&self, _other: &Self) -> bool {
        true
    }
}
impl Eq for FogHistory {}

impl FogHistory {
    fn record(&mut self, row: u16, column: u16) {
        self.rev += 1;
        if let Some(last) = self.changes.back_mut()
            && last.run[0] == row
            && last.run[2].checked_add(1) == Some(column)
        {
            last.rev = self.rev;
            last.run[2] = column;
        } else {
            self.changes.push_back(FogChange { rev: self.rev, run: [row, column, column] });
        }
        self.floor = self.floor.max(self.rev.saturating_sub(FOG_HISTORY_CELLS));
        while self.changes.front().is_some_and(|c| c.rev <= self.floor) || self.changes.len() > FOG_HISTORY_RUNS {
            if let Some(old) = self.changes.pop_front() {
                self.floor = self.floor.max(old.rev);
            }
        }
    }
}

impl Exploration {
    /// 延用经典迷雾版本的数值：每揭开一个新格加一；重放、存档与旧概览不变。
    pub fn fog_revision(&self) -> u32 {
        if self.fog_history.tracking { self.fog_history.rev } else { self.revealed_count() }
    }

    /// 窗口之外、未来游标或读档后尚无历史时返回 None，应用层改发全量。
    /// 每行独立合并相交/相邻区间，不把远隔舰队或跨缝区域合成包围盒。
    pub fn fog_runs_since(&self, since: u64) -> Option<Vec<[u16; 3]>> {
        let rev = u64::from(self.fog_revision());
        if since > rev {
            return None;
        }
        if since == rev {
            return Some(Vec::new());
        }
        let history = &self.fog_history;
        if !history.tracking || since < u64::from(history.floor) {
            return None;
        }
        let mut runs = Vec::new();
        for change in &history.changes {
            if u64::from(change.rev) <= since {
                continue;
            }
            let [row, start, end] = change.run;
            let first = u64::from(change.rev) - u64::from(end - start);
            let skipped = since.saturating_add(1).saturating_sub(first) as u16;
            runs.push([row, start + skipped, end]);
        }
        runs.sort_unstable();
        let mut merged: Vec<[u16; 3]> = Vec::with_capacity(runs.len());
        for run in runs {
            if let Some(last) = merged.last_mut()
                && last[0] == run[0]
                && u32::from(run[1]) <= u32::from(last[2]) + 1
            {
                last[2] = last[2].max(run[2]);
            } else {
                merged.push(run);
            }
        }
        Some(merged)
    }
}

/// 海图预检结果。
pub(crate) struct ChartPlan {
    pub region: RegionId,
    pub cost: Money,
}

impl World {
    /// 揭开某格周围半径 `radius` 内的格子（圆形）。
    pub(crate) fn reveal_around(&mut self, cell: Cell, radius: i64) {
        let map = &self.defs.map;
        let (cx, cy) = (cell.x as i64, cell.y as i64);
        let exp = &mut self.state.explore;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let Some(target) = map.topology().normalize(cx + dx, cy + dy) else { continue };
                if map.topology().squared_distance(cell, target) <= radius * radius {
                    exp.reveal(map.idx(target));
                }
            }
        }
    }

    /// 读档时把迷雾位图对齐到当前地图：按记录的（旧存档按 `rules.world.legacy_map` 的）宽高逐格搬到新位置。
    /// 迷雾按坐标保留（EXPANSION §10.2：地图重做后海岸线可能不同，但已揭开的坐标仍然揭开）；无法解释的位图丢弃后重新初始化。
    pub(crate) fn remap_exploration(&mut self) {
        let (w, h) = (self.defs.map.width, self.defs.map.height);
        let legacy = self.defs.rules.world.legacy_map;
        let e = &mut self.state.explore;
        e.fog_history = FogHistory::default();
        if e.cells.is_empty() {
            return;
        }
        let (ow, oh) = if e.width > 0 && e.height > 0 {
            (e.width, e.height)
        } else if legacy.0 > 0 && legacy.1 > 0 && e.cells.len() == words_for(legacy.0, legacy.1) {
            legacy
        } else if e.cells.len() == words_for(w, h) {
            (w, h)
        } else {
            e.cells.clear();
            e.width = 0;
            e.height = 0;
            return;
        };
        if (ow, oh) != (w, h) {
            let old = std::mem::take(&mut e.cells);
            let bit = |i: usize| old.get(i / 64).is_some_and(|word| word & (1u64 << (i % 64)) != 0);
            let mut cells = vec![0u64; words_for(w, h)];
            for y in 0..oh.min(h) as usize {
                for x in 0..ow.min(w) as usize {
                    if bit(y * ow as usize + x) {
                        let j = y * w as usize + x;
                        cells[j / 64] |= 1u64 << (j % 64);
                    }
                }
            }
            e.cells = cells;
        }
        e.width = w;
        e.height = h;
    }

    /// 初始化探索状态（新游戏或旧存档）：揭开玩家舰队、商队与开局港周围。
    pub(crate) fn init_exploration(&mut self) {
        if !self.state.explore.cells.is_empty() {
            return;
        }
        let map = &self.defs.map;
        let (w, h) = (map.width, map.height);
        self.state.explore.fog_history = FogHistory::default();
        self.state.explore.cells = vec![0; words_for(w, h)];
        self.state.explore.width = w;
        self.state.explore.height = h;
        let start = self.defs.scenarios.get(self.state.scenario.idx()).map(|s| s.start);
        let mut spots: Vec<(Cell, Option<LocId>)> = Vec::new();
        if let Some(s) = start {
            spots.push((self.defs.loc(s).cell, Some(s)));
        }
        for f in self.fleets_of(OwnerId::Player) {
            spots.push((f.cell(&self.defs), f.docked_at()));
        }
        for c in self.caravans_of(OwnerId::Player) {
            if let Some(l) = c.at() {
                spots.push((self.defs.loc(l).cell, Some(l)));
            }
        }
        let sight = self.defs.rules.explore.sight;
        for (cell, loc) in spots {
            self.reveal_around(cell, sight * 2);
            if let Some(l) = loc {
                self.state.explore.visited.insert(l);
            }
        }
    }

    /// tick 第 5 步之后：玩家舰队与商队揭开周围的格子，记录到过的地点。
    pub(crate) fn explore_day(&mut self) {
        let sight = self.defs.rules.explore.sight;
        let mut spots: Vec<(Cell, Option<LocId>)> = Vec::new();
        for f in self.fleets_of(OwnerId::Player) {
            spots.push((f.cell(&self.defs), f.docked_at()));
        }
        for c in self.caravans_of(OwnerId::Player) {
            if let Some(l) = c.at() {
                spots.push((self.defs.loc(l).cell, Some(l)));
            }
        }
        for (cell, loc) in &spots {
            self.reveal_around(*cell, sight);
            if let Some(l) = loc {
                self.state.explore.visited.insert(*l);
            }
        }
        self.detect_discoveries(&spots, sight, 0);
        self.record_sighted_locations();
    }

    /// 能否传出某发现物的传闻：返回不能的原因。玩家尚未发现、尚无传闻、名声达到门槛、能确定大致海区。
    pub fn rumor_blocker(&self, id: DiscoveryId) -> Option<String> {
        let defs = &self.defs;
        if defs.discoveries.get(id.idx()).is_none() {
            return Some("发现物不存在".into());
        }
        let e = &self.state.explore;
        if e.discovered.contains_key(&id) {
            return Some("玩家已经发现了它".into());
        }
        if e.rumors.contains_key(&id) {
            return Some("已经有这件发现物的传闻".into());
        }
        let fame = self.state.agents.get(&OwnerId::Player).map(|a| a.fame).unwrap_or(0);
        if fame < defs.rules.discovery.rumor_min_fame {
            return Some(format!("玩家的名声不足 {}，还听不到这样的传闻", defs.rules.discovery.rumor_min_fame));
        }
        if discovery_region(defs, id).is_none() {
            return Some("无法确定它的大致海区".into());
        }
        None
    }

    /// 记下一条发现物传闻（调用前须已通过 [`World::rumor_blocker`]）。
    pub(crate) fn record_rumor(&mut self, id: DiscoveryId) {
        let day = self.state.day;
        if let Some(region) = discovery_region(&self.defs, id) {
            self.state.explore.rumors.insert(id, Rumor { day, region });
        }
    }

    /// 视野覆盖到发现物所在格即发现（按发现物下标顺序）。
    pub(crate) fn detect_discoveries(&mut self, spots: &[(Cell, Option<LocId>)], sight: i64, radius_bonus: i64) {
        let day = self.state.day;
        let defs = self.defs.clone();
        for id in defs.discovery_ids() {
            if self.state.explore.discovered.contains_key(&id) {
                continue;
            }
            let seen = spots.iter().any(|(s, loc)| self.can_sight_discovery(id, *s, *loc, sight, radius_bonus));
            if seen {
                self.state.explore.discovered.insert(id, day);
                self.push_log(LogEvent { day, kind: LogKind::Discovered { discovery: id, owner: OwnerId::Player } });
            }
        }
    }

    /// 已发现但尚未报告的发现物。
    pub fn unreported_discoveries(&self) -> impl Iterator<Item = DiscoveryId> + '_ {
        self.state.explore.discovered.keys().copied().filter(|d| !self.state.explore.reported.contains(d))
    }

    /// 某地的市场信息是否已解锁。
    pub fn loc_known(&self, loc: LocId) -> bool {
        self.state.explore.visited.contains(&loc)
    }

    pub fn hides_unknown_locations(&self) -> bool {
        self.defs.manual_navigation && self.defs.navigation.hide_unknown_ports
    }

    /// 海图、开局知识与已到访地点同样构成见识；市场信息仍用 loc_known。
    pub fn location_visible(&self, loc: LocId) -> bool {
        if self.realm_key_at_port(loc).is_some_and(|key| self.realm_status(key) < crate::realms::RealmStatus::Entered) {
            return false;
        }
        self.defs.locations.get(loc.idx()).is_some_and(|l| {
            !self.hides_unknown_locations()
                || self.state.explore.sighted.contains(&loc)
                || self.loc_known(loc)
                || self.state.explore.is_revealed(self.defs.map.idx(l.cell))
        })
    }

    pub fn visible_locations(&self) -> impl Iterator<Item = LocId> + '_ {
        self.defs.loc_ids().filter(|id| self.location_visible(*id))
    }

    pub(crate) fn record_sighted_locations(&mut self) {
        if !self.hides_unknown_locations() || !self.state.agents.contains_key(&OwnerId::Player) {
            return;
        }
        let found: Vec<_> = self.visible_locations().filter(|id| !self.state.explore.sighted.contains(id)).collect();
        for loc in found {
            self.state.explore.sighted.insert(loc);
            if let Some(player) = self.state.agents.get_mut(&OwnerId::Player) {
                player.fame += self.defs.navigation.sight_fame.max(0);
            }
            self.push_log(LogEvent { day: self.day(), kind: LogKind::LocationSighted { loc, owner: OwnerId::Player } });
        }
    }

    /// 某海区海图的价格。
    pub fn chart_price(&self, region: RegionId) -> Money {
        let r = self.defs.region(region);
        let (_, y0, _, y1) = r.rect;
        let area = self.defs.map.topology().rect_width(r.rect) * (y1 as i64 - y0 as i64 + 1).max(0);
        let e = &self.defs.rules.explore;
        e.chart_base + e.chart_per_100_cells * area / 100
    }
}

/// 报告发现物的预检结果。
pub(crate) struct ReportPlan {
    pub discovery: DiscoveryId,
    pub loc: LocId,
    pub reward: Money,
    pub fame: i64,
}

pub(crate) fn check_report(
    world: &World,
    owner: OwnerId,
    discovery: DiscoveryId,
    loc: LocId,
) -> Result<ReportPlan, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::Precondition("只有玩家会报告发现".into()));
    }
    let defs = &world.defs;
    let d = defs.discoveries.get(discovery.idx()).ok_or_else(|| CommandError::NotFound(format!("{discovery:?}")))?;
    let l = defs.locations.get(loc.idx()).ok_or_else(|| CommandError::NotFound(format!("{loc:?}")))?;
    if !world.state.explore.discovered.contains_key(&discovery) {
        return Err(crate::error::Reason::new("explore.not_found", "尚未发现").rule());
    }
    if world.state.explore.reported.contains(&discovery) {
        return Err(crate::error::Reason::new("explore.reported", "已经报告过").rule());
    }
    if !l.is_port() {
        return Err(CommandError::NotAPort);
    }
    let present = world.fleets_of(owner).any(|f| f.docked_at() == Some(loc))
        || world.caravans_of(owner).any(|c| c.at() == Some(loc));
    if !present {
        return Err(crate::error::Reason::new("explore.presence", "须有舰队或商队在该港口").rule());
    }
    Ok(ReportPlan { discovery, loc, reward: d.value.max(0), fame: d.fame.max(0) })
}

pub(crate) fn exec_report(world: &mut World, owner: OwnerId, plan: ReportPlan) -> Result<(), CoreError> {
    let day = world.state.day;
    if plan.reward > 0 {
        world.book_external(
            owner,
            Flow::Discovery,
            world.treasury_of(plan.loc),
            JournalEntry::new(day, Memo::Discovery, CashClass::Operating)
                .dr(Account::Cash, plan.reward)
                .cr(Account::OtherIncome, plan.reward),
        )?;
    }
    let faction = world.location_faction(plan.loc);
    let rep = world.defs.rules.discovery.report_reputation;
    if rep != 0 {
        world.adjust_reputation(owner, faction, rep);
    }
    world.agent_mut(owner)?.fame += plan.fame;
    world.state.explore.reported.insert(plan.discovery);
    world.push_log(LogEvent {
        day,
        kind: LogKind::DiscoveryReported {
            discovery: plan.discovery,
            owner,
            loc: plan.loc,
            reward: plan.reward,
            fame: plan.fame,
        },
    });
    Ok(())
}

pub(crate) fn check_chart(world: &World, owner: OwnerId, region: RegionId) -> Result<ChartPlan, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::Precondition("只有玩家需要海图".into()));
    }
    if world.defs.regions.get(region.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{region:?}")));
    }
    if world.state.explore.charts.contains(&region) {
        return Err(crate::error::Reason::new("explore.has_chart", "已经有这个海区的海图").rule());
    }
    let in_port = world.fleets_of(owner).any(|f| f.docked_at().is_some_and(|l| world.defs.loc(l).is_port()))
        || world.caravans_of(owner).any(|c| c.at().is_some_and(|l| world.defs.loc(l).is_port()));
    if !in_port {
        return Err(crate::error::Reason::new("explore.chart_port", "须在港口的酒馆或商人处购买").rule());
    }
    let cost = world.chart_price(region);
    let have = world.state.agents.get(&owner).map(|a| a.cash).unwrap_or(0);
    if have < cost {
        return Err(CommandError::InsufficientCash { need: cost, have });
    }
    Ok(ChartPlan { region, cost })
}

pub(crate) fn exec_chart(world: &mut World, owner: OwnerId, plan: ChartPlan) -> Result<(), CoreError> {
    let day = world.state.day;
    if plan.cost > 0 {
        world.book_external(
            owner,
            Flow::Other,
            world.owner_port(owner),
            JournalEntry::new(day, Memo::Other, CashClass::Operating)
                .dr(Account::Fees, plan.cost)
                .cr(Account::Cash, plan.cost),
        )?;
    }
    world.init_exploration();
    let map = &world.defs.map;
    for cell in map.topology().rect_cells(world.defs.region(plan.region).rect) {
        world.state.explore.reveal(map.idx(cell));
    }
    world.state.explore.charts.insert(plan.region);
    world.record_sighted_locations();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn empty(width: u16, height: u16) -> Exploration {
        Exploration { cells: vec![0; words_for(width, height)], width, height, ..Default::default() }
    }

    fn revealed(runs: &[[u16; 3]], width: u16) -> BTreeSet<usize> {
        runs.iter()
            .flat_map(|[y, start, end]| {
                (*start..=*end).map(move |x| usize::from(*y) * usize::from(width) + usize::from(x))
            })
            .collect()
    }

    #[test]
    fn revisions_are_idempotent_and_partial_row_cursors_are_exact() {
        let mut e = empty(120, 6);
        for x in 10..20 {
            e.reveal(120 + x);
        }
        assert_eq!(e.fog_revision(), 10);
        assert_eq!(e.fog_runs_since(5), Some(vec![[1, 15, 19]]));
        e.reveal(130);
        assert_eq!(e.fog_revision(), 10);
        for index in [3 * 120 + 1, 3 * 120 + 100, 3 * 120 + 2, 4 * 120 + 119, 4 * 120] {
            e.reveal(index);
        }
        assert_eq!(e.fog_runs_since(10), Some(vec![[3, 1, 2], [3, 100, 100], [4, 0, 0], [4, 119, 119]]));
        assert_eq!(e.fog_runs_since(15), Some(Vec::new()));
        assert_eq!(e.fog_runs_since(16), None);
        assert_eq!(e.fog_revision(), e.revealed_count());
    }

    #[test]
    fn history_is_bounded_by_both_cells_and_spatial_runs() {
        let mut e = empty(1024, 12);
        for index in 0..12 * 1024 {
            e.reveal(index);
        }
        assert_eq!(e.fog_history.floor, 4096);
        assert!(e.fog_history.changes.len() <= FOG_HISTORY_RUNS);
        assert!(e.fog_runs_since(4095).is_none());
        let seen = revealed(&e.fog_runs_since(4097).unwrap(), 1024);
        assert_eq!(seen, (4097..12 * 1024).collect());
        let mut scattered = empty(100, 100);
        for column in 0..10 {
            for row in 0..100 {
                scattered.reveal(row * 100 + column);
            }
        }
        assert_eq!(scattered.fog_history.changes.len(), FOG_HISTORY_RUNS);
        assert!(scattered.fog_runs_since(0).is_none());
        let latest = scattered.fog_runs_since(u64::from(scattered.fog_history.floor)).unwrap();
        assert_eq!(revealed(&latest, 100).len(), FOG_HISTORY_RUNS);
    }

    #[test]
    fn derived_history_does_not_change_save_bytes_or_state_equality() {
        let mut e = empty(12, 3);
        for index in [0, 1, 2, 17, 30] {
            e.reveal(index);
        }
        let json = serde_json::to_string(&e).unwrap();
        let expected = format!(
            "{{\"cells\":{},\"width\":12,\"height\":3,\"visited\":[],\"charts\":[],\"discovered\":{{}},\"reported\":[]}}",
            serde_json::to_string(&e.cells).unwrap()
        );
        assert_eq!(json, expected);
        let mut restored: Exploration = serde_json::from_str(&json).unwrap();
        assert_eq!(e, restored);
        assert_eq!(restored.fog_revision(), 5);
        assert!(restored.fog_runs_since(0).is_none());
        restored.reveal(31);
        assert_eq!(restored.fog_runs_since(5), Some(vec![[2, 7, 7]]));
        assert_eq!(restored.fog_revision(), 6);
    }

    proptest! {
        #[test]
        fn arbitrary_reordering_duplicates_and_skipped_queries_equal_the_full_bitmap(
            points in prop::collection::vec((0u16..48,0u16..16),0..300)
        ) {
            let mut e=empty(48,16);
            let mut deltas=Vec::new();
            for batch in points.chunks(11) {
                let since=e.fog_revision();
                for &(x,y) in batch { e.reveal(usize::from(y)*48+usize::from(x)); }
                deltas.push(e.fog_runs_since(u64::from(since)).unwrap());
            }
            let expected: BTreeSet<_>=points.iter().map(|&(x,y)|usize::from(y)*48+usize::from(x)).collect();
            let mut reordered=BTreeSet::new();
            for delta in deltas.iter().rev().chain(deltas.iter()) { reordered.extend(revealed(delta,48)); }
            prop_assert_eq!(&reordered,&expected);
            prop_assert_eq!(revealed(&e.fog_runs_since(0).unwrap(),48),expected.clone());
            for index in 0..48*16 { prop_assert_eq!(e.is_revealed(index),expected.contains(&index)); }
            prop_assert_eq!(e.fog_revision(),expected.len() as u32);
        }
    }
}

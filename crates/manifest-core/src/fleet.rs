//! 舰队：航行、补给与海上风险。

use crate::defs::{SeasonWeather, StaticData};
use crate::error::CoreError;
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::nav::{current_mult, sail_mult};
use crate::rng::{Domain, Rng};
use crate::seafaring::VoyageMods;
use crate::weather::{DayTable, DayWeather, E8, Sky};
use crate::world::{Fleet, FleetLocation, RouteVoyage, Ship, Voyage, World};
use std::collections::BTreeMap;

#[path = "fleet/provisions.rs"]
mod provisions;
pub(crate) use provisions::consume_supplies;
pub use provisions::{SupplyRemainder, daily_supply_milli, supplies_for_days};

/// 新船（满耐久）。
pub fn new_ship(defs: &StaticData, kind: ShipTypeId) -> Ship {
    let t = defs.ship(kind);
    Ship {
        legend: None,
        kind,
        durability: t.durability,
        max_durability: t.durability,
        capacity: t.capacity,
        guns: t.guns,
        speed_bonus: Fx::ZERO,
        refits: Vec::new(),
        book_value: t.price,
        built: 0,
    }
}

/// 最低航速（格/天），避免无风时完全停滞。
const MIN_SPEED: Fx = Fx(5_000);

/// 舰队朝某方向航行的实际航速（格/天）：取最慢的船，计风、洋流、船员与士气。
pub fn step_speed(defs: &StaticData, fleet: &Fleet, heading: u8, w: Option<&SeasonWeather>) -> Fx {
    speed_of(defs, &fleet.ships, fleet.crew, fleet.morale, heading, w, &VoyageMods::NEUTRAL)
}

/// 舰队在某天的天气下朝某方向航行的实际航速（格/天）：用当天的风向与风力（公式同 [`step_speed`]），
/// 再乘天况系数（雾 ×0.9、暴风雨 ×0.8）。舰长加成另计。
pub fn step_speed_on(defs: &StaticData, fleet: &Fleet, heading: u8, w: Option<&DayWeather>) -> Fx {
    step_speed_with(defs, fleet, heading, w, &VoyageMods::NEUTRAL)
}

/// 同 [`step_speed_on`]，另计 H01 / H02 的航速修正（[`VoyageMods`]；中性值时与 [`step_speed_on`] 逐位相同）。
pub fn step_speed_with(defs: &StaticData, fleet: &Fleet, heading: u8, w: Option<&DayWeather>, mods: &VoyageMods) -> Fx {
    day_speed_ex(defs, &fleet.ships, fleet.crew, fleet.morale, heading, w, mods)
}

/// 当天天气下的航速。
fn day_speed_ex(
    defs: &StaticData,
    ships: &[Ship],
    crew: i64,
    morale: i64,
    heading: u8,
    w: Option<&DayWeather>,
    mods: &VoyageMods,
) -> Fx {
    if ships.iter().any(|s| s.legend.is_some()) {
        return crate::legend_ships::mechanics::speed(crate::legend_ships::mechanics::SpeedInput {
            defs,
            ships,
            crew,
            morale,
            heading,
            weather: w,
            minute: 720,
            mods: if defs.rules.ships.s02_enabled { mods } else { &VoyageMods::NEUTRAL },
        });
    }
    let speed = speed_of(defs, ships, crew, morale, heading, w.map(|w| &w.sea), mods);
    match w {
        // H01 `fog_sailing`：抵消雾天降速的一部分（0.9 → 1.0 之间按比例）
        Some(w) if w.sky == Sky::Fog && mods.fog_offset > 0 => {
            let lost = Fx::ONE.raw() - w.speed_mult().raw();
            speed.mul(Fx(w.speed_mult().raw() + lost * mods.fog_offset.clamp(0, 100) / 100))
        }
        Some(w) => speed.mul(w.speed_mult()),
        None => speed,
    }
}

fn speed_of(
    defs: &StaticData,
    ships: &[Ship],
    crew: i64,
    morale: i64,
    heading: u8,
    w: Option<&SeasonWeather>,
    mods: &VoyageMods,
) -> Fx {
    // H02：病号不干活，人手按船员减病号算
    let crew = crew - mods.idle_crew.max(0);
    let per_ship = ships.iter().map(|s| {
        let t = defs.ship(s.kind);
        let base = t.speed + s.speed_bonus;
        match w {
            Some(w) => base.mul(sail_mult(t.sail, heading, w)),
            None => base,
        }
    });
    let mut speed = if mods.coordination > 0 && ships.len() > 1 {
        // H01 `fleet_coordination`：最慢 + (次慢 − 最慢) × 比例
        let mut all: Vec<Fx> = per_ship.collect();
        all.sort();
        Fx(all[0].raw() + (all[1].raw() - all[0].raw()) * mods.coordination.clamp(0, 100) / 100)
    } else {
        per_ship.min().unwrap_or(Fx::ONE)
    };
    if let Some(w) = w {
        speed = speed.mul(current_mult(heading, w));
    }
    let min_crew: i64 = ships.iter().map(|s| crate::legend_ships::crew_min(defs, s)).sum();
    if crew < min_crew && min_crew > 0 {
        speed = speed.mul(Fx::ratio(crew, min_crew).max(Fx::from_pct(30)));
    }
    if morale < 30 {
        speed = speed.mul(Fx::from_pct(80));
    }
    if mods.speed_bp != 10_000 {
        // H02 的船况、疲劳、载重、节奏等乘数合在一起（见 `seafaring`）
        speed = speed.mul(Fx(mods.speed_bp.max(0)));
    }
    speed.max(MIN_SPEED)
}

/// H03：海盗按分钟追击时的航速（格 / 天）：与舰队同一公式，海盗不计士气。
pub(crate) fn pirate_speed_on(defs: &StaticData, ships: &[Ship], crew: i64, heading: u8, w: Option<&DayWeather>) -> Fx {
    day_speed_ex(defs, ships, crew, 100, heading, w, &VoyageMods::NEUTRAL)
}

/// 舰队走完一条航线的预计天数：按每艘船的帆装与航速取最慢者，并计船员不足的减速。
pub fn fleet_days(defs: &StaticData, fleet: &Fleet, path: &crate::nav::Path) -> i64 {
    fleet_days_by(defs, fleet, |sail, speed| path.days_for(sail, speed))
}

pub fn fleet_days_compressed(defs: &StaticData, fleet: &Fleet, path: &crate::nav::CompressedPath) -> i64 {
    fleet_days_by(defs, fleet, |sail, speed| path.days_for(sail, speed))
}

fn fleet_days_by(defs: &StaticData, fleet: &Fleet, days_for: impl Fn(crate::defs::SailType, Fx) -> i64) -> i64 {
    let mut days = fleet
        .ships
        .iter()
        .map(|s| {
            let t = defs.ship(s.kind);
            days_for(t.sail, t.speed + s.speed_bonus)
        })
        .max()
        .unwrap_or(1);
    let min_crew = fleet.crew_min(defs);
    if fleet.crew < min_crew && fleet.crew > 0 {
        days = days * min_crew / fleet.crew;
    }
    days.max(1)
}

/// 补给安全余量：至少 `base` 天，且不少于航程的四分之一。
pub fn supply_margin(base: i64, days: i64) -> i64 {
    base.max(days / 4)
}

/// 每日粮水需求：ceil(船员 / 每单位供养人数)。
pub fn daily_supply_need(defs: &StaticData, crew: i64) -> i64 {
    let per = defs.rules.crew_per_supply_unit.max(1);
    let crew = crew.max(0);
    crew / per + i64::from(crew % per != 0)
}

impl World {
    /// 港口与所在海区的封冻原因保留给命令层；查询本身不改状态。
    pub fn check_navigation(&self, fleet: &Fleet, dest: LocId) -> Result<(), crate::error::CommandError> {
        use crate::error::{CommandError, Reason};
        use crate::nav::NavError;
        self.require_open_port(dest)?;
        self.check_port_access(fleet, dest)?;
        let grid = &self.defs.nav.grid;
        if grid.is_empty() {
            return Ok(());
        }
        let period = grid.period_on(self.day());
        let check = || {
            if let Some(from) = fleet.docked_at() {
                grid.check_port(period, from)?;
            }
            grid.check_cell(period, fleet.cell(&self.defs))?;
            grid.check_port(period, dest)?;
            grid.check_cell(period, self.defs.loc(dest).cell)
        };
        check().map_err(|error| match error {
            NavError::FrozenPort => Reason::new("frozen_port", "港口封冻，暂时无法通航").rule(),
            NavError::FrozenRegion => Reason::new("frozen_region", "海区封冻，暂时无法通航").rule(),
            _ => CommandError::NoRoute,
        })
    }

    /// 计算航线：在港时优先使用预计算航线，否则用 A* 实时寻路。
    pub fn route_for(&self, fleet: &Fleet, dest: LocId) -> Option<Vec<Cell>> {
        if !self.defs.realms.is_empty() {
            return self.realm_route(fleet, dest).map(|p| p.cells);
        }
        self.check_navigation(fleet, dest).ok()?;
        let defs = &self.defs;
        let season = defs.nav.grid.period_on(self.day());
        if let Some(from) = fleet.docked_at()
            && let Some(p) = defs.nav.compressed_path(season, from, dest)
        {
            return Some(p.cells(defs.map.topology()).collect());
        }
        let start = fleet.cell(defs);
        defs.nav.find_path(&defs.map, &defs.regions, season, start, defs.loc(dest).cell).map(|p| p.cells)
    }

    /// 预计航行天数。
    pub fn estimate_days(&self, fleet: &Fleet, dest: LocId) -> Option<i64> {
        if !self.defs.realms.is_empty() {
            return self.realm_route(fleet, dest).map(|p| fleet_days(&self.defs, fleet, &p));
        }
        self.check_navigation(fleet, dest).ok()?;
        let defs = &self.defs;
        let season = defs.nav.grid.period_on(self.day());
        if let Some(from) = fleet.docked_at()
            && let Some(p) = defs.nav.compressed_path(season, from, dest)
        {
            return Some(fleet_days_compressed(defs, fleet, p));
        }
        let start = fleet.cell(defs);
        defs.nav
            .find_path(&defs.map, &defs.regions, season, start, defs.loc(dest).cell)
            .map(|p| fleet_days(defs, fleet, &p))
    }

    /// 航线与预计天数（只寻路一次）。
    pub fn route_with_days(&self, fleet: &Fleet, dest: LocId) -> Option<(Vec<Cell>, i64)> {
        if !self.defs.realms.is_empty() {
            return self.realm_route(fleet, dest).map(|p| {
                let days = fleet_days(&self.defs, fleet, &p);
                (p.cells, days)
            });
        }
        self.check_navigation(fleet, dest).ok()?;
        let defs = &self.defs;
        let season = defs.nav.grid.period_on(self.day());
        if let Some(from) = fleet.docked_at()
            && let Some(p) = defs.nav.compressed_path(season, from, dest)
        {
            return Some((p.cells(defs.map.topology()).collect(), fleet_days_compressed(defs, fleet, p)));
        }
        let start = fleet.cell(defs);
        let p = defs.nav.find_path(&defs.map, &defs.regions, season, start, defs.loc(dest).cell)?;
        let days = fleet_days(defs, fleet, &p);
        Some((p.cells, days))
    }

    /// tick 第 5 步（海上部分）：舰队移动、补给消耗与海上风险。
    pub(crate) fn move_fleets(&mut self) -> Result<Vec<(FleetId, LocId)>, CoreError> {
        self.move_fleets_for(None)
    }

    /// 轻量养成只调度借出的实习船；完整日结仍按原顺序处理全部舰队。
    pub(crate) fn move_fleets_for(&mut self, only: Option<FleetId>) -> Result<Vec<(FleetId, LocId)>, CoreError> {
        // H02：昨天的选项留下的标记（许诺靠港、复工、哗变）先兑现
        self.wear_flags()?;
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let period = defs.nav.grid.period_on(day);
        // 当天各海区的天气（航速用当天的风与天况；海上风险只在暴风雨天判定）
        let mut today = DayTable::new(self);
        let ids: Vec<FleetId> = self.state.fleets.keys().copied().filter(|id| only.is_none_or(|f| f == *id)).collect();
        // 交战中的舰队不移动；舰长提高航速
        let engaged: Vec<FleetId> = ids.iter().copied().filter(|f| self.fleet_in_battle(*f)).collect();
        let bonus: BTreeMap<FleetId, Fx> = ids.iter().map(|f| (*f, Fx::ONE + self.fleet_speed_bonus(*f))).collect();
        // H01 / H02 的航速修正（只对玩家舰队；开关关闭时是中性值）
        let mods: BTreeMap<FleetId, VoyageMods> = ids.iter().map(|f| (*f, self.voyage_mods(*f))).collect();
        let mut manual_courses: BTreeMap<_, _> = ids
            .iter()
            .filter_map(|id| {
                let fleet = self.state.fleets.get(id)?;
                (matches!(fleet.location, FleetLocation::AtSea(Voyage::Manual { .. })) && !engaged.contains(id))
                    .then(|| (*id, self.manual_course(fleet, &[], crate::navigation::course::MINUTES_PER_DAY)))
            })
            .collect();
        // H03：玩家手动航行的舰队当天在风暴团里的受损概率按分钟折算（Σ 每分钟所在格的受损概率 ÷ 1440）；
        // 按分钟追击的海盗算出当天的结果，留给 battle_day。两个开关都关着时什么也不做。
        let mut storm_exposure: BTreeMap<FleetId, i64> = BTreeMap::new();
        if defs.rules.weather_cells.enabled {
            for (id, course) in &manual_courses {
                if self.state.fleets.get(id).is_some_and(|f| f.owner == OwnerId::Player) {
                    let mut sum = 0i64;
                    for p in course.points.iter().skip(1).take(usize::from(crate::navigation::course::MINUTES_PER_DAY))
                    {
                        sum += today.at_pos(&defs, p.pos.cell()).map_or(0, |w| w.storm_hit_e8);
                    }
                    storm_exposure.insert(*id, sum / i64::from(crate::navigation::course::MINUTES_PER_DAY));
                }
            }
        }
        self.state.battles.pursued.clear();
        if defs.rules.pursuit.enabled {
            let mut taken = std::collections::BTreeSet::new();
            let mut outcomes = Vec::new();
            for (id, course) in &manual_courses {
                let Some(fleet) = self.state.fleets.get(id) else { continue };
                for t in self.pursuit_tracks(fleet, &course.points, &taken) {
                    taken.insert(t.pirate);
                    let pos = t.points.last().copied().unwrap_or_default();
                    outcomes.push(crate::navigation::pursuit::PursuitOutcome {
                        pirate: t.pirate,
                        fleet: t.fleet,
                        contact: t.contact,
                        cell: pos.cell(),
                        end: t.end,
                    });
                }
            }
            self.state.battles.pursued = outcomes;
        }
        let mut navigation_logs = Vec::new();
        let mut realm_contacts = Vec::new();
        let mut arrivals = Vec::new();
        let mut docked_today = Vec::new();
        // H02：今天按分钟靠过港的舰队（可能当天又出了港）也算靠港一次：断鲜清零、疲劳与病号缓一缓
        let touched_port: Vec<FleetId> = self.state.navigation.arrived.keys().copied().collect();
        for id in ids {
            if self.creature_delayed(id)
                && self
                    .state
                    .fleets
                    .get(&id)
                    .is_some_and(|f| matches!(f.location, FleetLocation::AtSea(Voyage::Route(_))))
            {
                if let Some(f) = self.state.fleets.get_mut(&id).filter(|f| f.docked_at().is_none()) {
                    f.days_at_sea = f.days_at_sea.saturating_add(1);
                }
                continue;
            }
            if engaged.contains(&id) {
                continue;
            }
            if let Some(course) = manual_courses.remove(&id) {
                self.reveal_navigation_course(id, &course);
                self.touch_sightings(id, &course.points, course.voyage.sail);
                self.voyage_log_track(id, &course.points);
                self.record_pilot_modes(id, self.fleet(id)?.owner, &course.pilot_modes);
                let previous = self.state.navigation.traces.get(&id).cloned();
                let f = self.fleet_mut(id)?;
                for stop in &course.stops {
                    if previous.as_ref().is_some_and(|trace| trace.stops.contains(stop)) {
                        continue;
                    }
                    if let Some(kind) = crate::navigation::stop_log(stop, id, f.owner) {
                        navigation_logs.push(LogEvent { day, kind });
                    }
                }
                if let Some(dest) = course.arrival {
                    f.location = FleetLocation::Docked(dest);
                    f.days_at_sea = 0;
                    arrivals.push((id, dest));
                    self.note_route_arrival(id, dest, crate::navigation::routing::arrival_minute(&course.stops));
                } else {
                    f.location = FleetLocation::AtSea(Voyage::Manual { manual: course.voyage });
                    f.days_at_sea += 1;
                }
                continue;
            }
            let speed_mult = bonus.get(&id).copied().unwrap_or(Fx::ONE);
            let fleet_mods = mods.get(&id).copied().unwrap_or_default();
            if self.state.navigation.landings.contains_key(&id) {
                continue;
            }
            let arrived_today = self.state.navigation.arrived.contains_key(&id);
            let owner = self.fleet(id)?.owner;
            let passes = self.realm_passes(owner);
            let Some(fleet) = self.state.fleets.get_mut(&id) else { continue };
            let Fleet { ships, crew, morale, location, days_at_sea, idle_days, .. } = fleet;
            let FleetLocation::AtSea(voyage) = location else {
                // 当天已经按分钟抵港的舰队，不额外结算一整日在港收益。
                if arrived_today {
                    continue;
                }
                // 在港：士气恢复，闲置天数加一
                *morale = (*morale + 10).min(100);
                *days_at_sea = 0;
                *idle_days += 1;
                docked_today.push(id);
                continue;
            };
            let Voyage::Route(voyage) = voyage else {
                *days_at_sea += 1;
                continue;
            };
            let mut remaining = Fx::ONE;
            let mut guard = 0;
            while remaining > Fx::ZERO && voyage.step + 1 < voyage.path.len() && guard < 10_000 {
                guard += 1;
                let from = voyage.path[voyage.step];
                let to = voyage.path[voyage.step + 1];
                if let Some(r) = defs.realms.at(&defs, to) {
                    let entered = passes.contains(&r.key);
                    if owner == OwnerId::Player {
                        realm_contacts.push((r.key.clone(), entered));
                    }
                    if !entered {
                        voyage.step = voyage.step.saturating_sub(usize::from(r.veil.push));
                        voyage.leg_progress = Fx::ZERO;
                        break;
                    }
                }
                // 换月后原航线可能结冰：原地等候解冻，不进入封冻格或斜穿冰角。
                let grid = &defs.nav.grid;
                if !grid.is_empty() && (grid.check_cell(period, from).is_err() || grid.check_cell(period, to).is_err())
                {
                    break;
                }
                let heading = defs.map.dir_between(from, to);
                if grid.rules().is_some() && heading % 2 == 1 {
                    // 与 NavGrid::next_at 一致：斜步两侧都阻塞才不能穿过。
                    let blocked = [(heading + 7) % 8, (heading + 1) % 8].into_iter().all(|dir| {
                        defs.map
                            .topology()
                            .neighbor(from, dir)
                            .is_none_or(|cell| grid.check_cell(period, cell).is_err())
                    });
                    if blocked {
                        break;
                    }
                }
                // H03：玩家舰队取位置天况（天气团）；NPC 仍取海区天况
                let w = if owner == OwnerId::Player { today.at_pos(&defs, to) } else { today.at(&defs, to) };
                let speed =
                    day_speed_ex(&defs, ships, *crew, *morale, heading, w.as_ref(), &fleet_mods).mul(speed_mult);
                let step_time = defs.nav.grid.travel_length(to, heading).div(speed);
                let need = step_time - voyage.leg_progress;
                if need <= remaining {
                    remaining -= need;
                    voyage.step += 1;
                    voyage.leg_progress = Fx::ZERO;
                } else {
                    voyage.leg_progress += remaining;
                    remaining = Fx::ZERO;
                }
            }
            if voyage.step + 1 >= voyage.path.len()
                && (defs.nav.grid.is_empty()
                    || (defs.nav.grid.check_port(period, voyage.dest).is_ok()
                        && defs.nav.grid.check_cell(period, defs.loc(voyage.dest).cell).is_ok()))
            {
                let dest = voyage.dest;
                *location = FleetLocation::Docked(dest);
                *days_at_sea = 0;
                arrivals.push((id, dest));
            } else {
                *days_at_sea += 1;
            }
        }
        // H02：在港一天（疲劳、断鲜、病号、情绪阶段）；今天靠过港的（分钟抵港、日结抵港）各算一次
        let port_days: std::collections::BTreeSet<FleetId> =
            docked_today.into_iter().chain(touched_port).chain(arrivals.iter().map(|(id, _)| *id)).collect();
        for id in port_days {
            self.wear_port_day(id);
        }
        for (key, entered) in realm_contacts {
            self.record_realm_contact(&key, entered);
        }
        let landings = std::mem::take(&mut self.state.navigation.landings);
        self.state.navigation = crate::navigation::orders::NavigationState { landings, ..Default::default() };
        for event in navigation_logs {
            self.push_log(event);
        }
        for (id, loc) in &arrivals {
            let owner = self.fleet(*id)?.owner;
            self.push_log(LogEvent { day, kind: LogKind::Arrived { fleet: *id, owner, loc: *loc } });
        }
        // 信息时效：带来的消息贴到告示板上
        self.info_arrive(&arrivals);
        // 海上风险与补给
        let at_sea: Vec<FleetId> = self
            .state
            .fleets
            .values()
            .filter(|f| {
                only.is_none_or(|id| id == f.id)
                    && matches!(f.location, FleetLocation::AtSea(_))
                    && !self.state.navigation.landings.contains_key(&f.id)
            })
            .map(|f| f.id)
            .collect();
        for id in at_sea {
            let mut rng = Rng::derive(seed, day, Domain::Voyage, id.0 as u64, 0);
            self.sea_day(id, &mut rng, &mut today, storm_exposure.get(&id).copied())?;
        }
        self.wear_prune();
        Ok(arrivals)
    }

    /// 一支在海上的舰队度过一天：补给、风暴、海盗、疾病、士气。
    pub(crate) fn sea_day(
        &mut self,
        id: FleetId,
        rng: &mut Rng,
        today: &mut DayTable,
        storm_exposure: Option<i64>,
    ) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let rules = &defs.rules;
        let day = self.state.day;
        let (owner, cell, crew, days_at_sea) = {
            let f = self.fleet(id)?;
            (f.owner, f.cell(&defs), f.crew, f.days_at_sea)
        };
        // H03：玩家舰队取位置天况；手动航行的风暴受损按当天在风暴团里的时间折算
        let weather = if owner == OwnerId::Player { today.at_pos(&defs, cell) } else { today.at(&defs, cell) };
        // H01 岗位效果（开关关闭或非玩家舰队时都是中性值：保留 100%、推迟 0 天）
        // H02：口粮档位与会计的节省相乘；规则关着时都是 100
        let supply_keep = self.post_supply_keep(id) * self.ration_keep(id) / 100;
        let wear_on = self.wear_applies(id);
        let morale_delay = self.post_morale_delay(id);
        let storm_keep = self.post_storm_keep(id);
        let disease_keep = self.post_disease_keep(id);
        let healing_keep = self.post_healing_keep(id);

        // ── 补给 ──
        {
            let f = self.fleet_mut(id)?;
            let short = provisions::consume_supplies_keep(&defs, f, 1, supply_keep);
            if short && f.crew > 0 {
                let deaths = rules.starvation_loss.apply(f.crew).max(1).min(f.crew);
                f.crew -= deaths;
                f.morale = (f.morale - rules.starvation_morale).max(0);
                self.push_log(LogEvent { day, kind: LogKind::Starvation { fleet: id, owner, deaths } });
            }
        }
        {
            let f = self.fleet_mut(id)?;
            if days_at_sea > rules.morale_decay_after.saturating_add(morale_delay)
                && (f.crew > 0
                    || !f.ships.iter().all(|s| crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ghost)))
            {
                f.morale = (f.morale - 1).max(0);
            }
        }

        // ── H05 下网与接雨水（规则关着时什么也不做）──
        self.shore_sea_day(id, weather.as_ref())?;
        let shelter_keep = self.shelter_keep(id, weather.as_ref());

        // ── H02 船况、口粮与船员状态 ──
        if wear_on && self.wear_sea_day(id, weather.as_ref())? {
            return Ok(());
        }

        // ── 风暴 ──
        // 只有所在海区当天是暴风雨时才可能受损；受损概率已按暴风雨出现的频率折算（含事件修正），
        // 长期平均的每日受损概率仍等于海区风暴概率 × 事件修正（见 weather.rs）。海盗由海盗舰队处理，见 battle.rs。
        let storm_guard = self.arcana_bonus(id, "storm_guard");
        let storm_hit = storm_exposure.unwrap_or_else(|| weather.map(|w| w.storm_hit_e8).unwrap_or(0));
        if storm_hit > 0 && (rng.below(E8 as u64) as i64) < storm_hit {
            let mut damage_total = 0;
            {
                let f = self.fleet_mut(id)?;
                for s in f.ships.iter_mut() {
                    let pct = rng.range(5, 20);
                    let dmg = if crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::StormRider) {
                        0
                    } else {
                        let dmg = mul_div(mul_div(s.max_durability, pct, 100), 100 - storm_guard, 100);
                        // H01 `storm_check`：与秘术的 storm_guard 相乘
                        let dmg = if storm_keep == 100 { dmg } else { mul_div(dmg, storm_keep, 100) };
                        // H05 避风：陆地下风一侧收帆锚泊
                        let dmg = crate::seafaring::shore::sheltered_damage(dmg, shelter_keep);
                        if rules.ships.s02_enabled
                            && crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::StormWard)
                        {
                            mul_div(dmg, 100 - rules.ships.storm_ward_pct, 100)
                        } else {
                            dmg
                        }
                    };
                    s.durability -= dmg;
                    damage_total += dmg;
                }
            }
            let f = self.fleet(id)?;
            let exposed = f
                .ships
                .iter()
                .filter(|s| !crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::StormRider))
                .map(|s| {
                    if rules.ships.s02_enabled
                        && crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::StormWard)
                    {
                        mul_div(s.capacity, 100 - rules.ships.storm_ward_pct, 100)
                    } else {
                        s.capacity
                    }
                })
                .sum::<i64>();
            let mut loss_max = mul_div(10, exposed, f.capacity().max(1));
            if storm_keep != 100 {
                loss_max = mul_div(loss_max, storm_keep, 100);
            }
            loss_max = crate::seafaring::shore::sheltered_damage(loss_max, shelter_keep);
            let lost = self.lose_cargo_fraction(id, rng, 0, loss_max)?;
            self.push_log(LogEvent {
                day,
                kind: LogKind::Storm { fleet: id, owner, damage: damage_total, cargo_lost: lost },
            });
            self.sink_wrecked_ships(id)?;
            if !self.state.fleets.contains_key(&id) {
                return Ok(());
            }
        }

        // ── 疾病 ──
        let mut disease_bp = mul_div(rules.disease_bp_per_30_days, days_at_sea.min(90) as i64, 30);
        if disease_keep != 100 {
            // H01 `disease_guard`
            disease_bp = mul_div(disease_bp, disease_keep, 100);
        }
        if (crew > 0
            || !self
                .fleet(id)?
                .ships
                .iter()
                .all(|s| crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ghost)))
            // H02 打开时由坏血病取代按航行天数掷的疾病
            && !wear_on
            && rng.chance_bp(disease_bp)
        {
            let f = self.fleet_mut(id)?;
            let mut deaths = mul_div(f.crew, rng.range(5, 15), 100).min(f.crew);
            if healing_keep != 100 {
                // H01 `healing`
                deaths = mul_div(deaths, healing_keep, 100);
            }
            f.crew -= deaths;
            f.morale = (f.morale - 5).max(0);
            if deaths > 0 {
                self.push_log(LogEvent { day, kind: LogKind::Disease { fleet: id, owner, deaths } });
            }
        }

        // ── 哗变 ──
        let morale = self.fleet(id)?.morale;
        if (self.fleet(id)?.crew > 0
            || !self
                .fleet(id)?
                .ships
                .iter()
                .all(|s| crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ghost)))
            // H02 打开时由分阶段的怨言、怠工、哗变取代
            && !wear_on
            && morale < rules.mutiny_morale
            && rng.chance_bp(1_000)
        {
            let deserters = {
                let f = self.fleet_mut(id)?;
                let d = mul_div(f.crew, 20, 100);
                f.crew -= d;
                f.morale = 40;
                d
            };
            let lost = self.lose_cargo_fraction(id, rng, 20, 20)?;
            self.push_log(LogEvent { day, kind: LogKind::Mutiny { fleet: id, owner, deserters, cargo_lost: lost } });
        }

        self.abandon_unmanned_ships(id)?;
        // ── 船员全部损失：舰队覆灭 ──
        if crate::legend_ships::mechanics::fleet_unmanned(&defs, self.fleet(id)?) {
            self.destroy_fleet(id)?;
            return Ok(());
        }
        Ok(())
    }

    /// 每种货物损失 [lo, hi]% 的随机比例，按平均成本记损失，返回损失件数。
    pub(crate) fn lose_cargo_fraction(
        &mut self,
        id: FleetId,
        rng: &mut Rng,
        lo: i64,
        hi: i64,
    ) -> Result<i64, CoreError> {
        let day = self.state.day;
        let (owner, cargo) = {
            let f = self.fleet(id)?;
            (f.owner, f.cargo.clone())
        };
        let mut lost_total = 0;
        for (good, qty) in cargo {
            let pct = rng.range(lo, hi);
            let lost = mul_div(qty, pct, 100).min(qty);
            if lost > 0 {
                self.remove_cargo_with_loss(owner, id, good, lost, day)?;
                lost_total += lost;
            }
        }
        Ok(lost_total)
    }

    /// 从舰队移除货物并按平均成本记为损失。
    pub(crate) fn remove_cargo_with_loss(
        &mut self,
        owner: OwnerId,
        id: FleetId,
        good: GoodId,
        qty: i64,
        day: u32,
    ) -> Result<(), CoreError> {
        {
            let f = self.fleet_mut(id)?;
            let have = f.cargo.get(&good).copied().unwrap_or(0);
            let q = qty.min(have);
            if q <= 0 {
                return Ok(());
            }
            if have - q == 0 {
                f.cargo.remove(&good);
            } else {
                f.cargo.insert(good, have - q);
            }
        }
        let agent = self.agent_mut(owner)?;
        let cost = agent.book.remove(good, qty);
        self.book_internal(
            owner,
            JournalEntry::new(day, Memo::CargoLoss, CashClass::Operating)
                .dr(Account::Losses, cost)
                .cr(Account::Inventory, cost),
        )?;
        Ok(())
    }

    /// 耐久归零的船沉没；超出剩余舱位的货物随之损失。
    pub(crate) fn sink_wrecked_ships(&mut self, id: FleetId) -> Result<(), CoreError> {
        let day = self.state.day;
        let (owner, sunk) = {
            let f = self.fleet_mut(id)?;
            let mut sunk = Vec::new();
            let mut kept = Vec::new();
            for s in f.ships.drain(..) {
                if s.durability <= 0 {
                    sunk.push(s);
                } else {
                    kept.push(s);
                }
            }
            f.ships = kept;
            (f.owner, sunk)
        };
        for s in &sunk {
            self.book_internal(
                owner,
                JournalEntry::new(day, Memo::ShipLoss, CashClass::Investing)
                    .dr(Account::Losses, s.book_value)
                    .cr(Account::Ships, s.book_value),
            )?;
            self.push_log(LogEvent { day, kind: LogKind::ShipSunk { fleet: id, owner, ship: s.kind } });
        }
        if self.fleet(id)?.ships.is_empty() {
            return self.destroy_fleet(id);
        }
        self.trim_to_capacity(id)
    }

    /// 超出舱位时先丢粮水、再按比例丢货。
    pub(crate) fn trim_to_capacity(&mut self, id: FleetId) -> Result<(), CoreError> {
        let day = self.state.day;
        let (owner, over, cargo) = {
            let f = self.fleet_mut(id)?;
            let cap = f.capacity();
            let mut over = f.used() - cap;
            if over > 0 {
                let w = over.min(f.water);
                f.water -= w;
                over -= w;
                let fd = over.min(f.food);
                f.food -= fd;
                over -= fd;
                f.normalize_supplies();
            }
            (f.owner, over, f.cargo.clone())
        };
        if over <= 0 {
            return Ok(());
        }
        let mut remaining = over;
        for (good, qty) in cargo {
            if remaining <= 0 {
                break;
            }
            let lost = qty.min(remaining);
            self.remove_cargo_with_loss(owner, id, good, lost, day)?;
            remaining -= lost;
        }
        Ok(())
    }

    /// 舰队覆灭：船与货全部核销。
    pub(crate) fn destroy_fleet(&mut self, id: FleetId) -> Result<(), CoreError> {
        let day = self.state.day;
        let (owner, cargo, ships_value) = {
            let f = self.fleet(id)?;
            (f.owner, f.cargo.clone(), f.book_value())
        };
        for (good, qty) in cargo {
            self.remove_cargo_with_loss(owner, id, good, qty, day)?;
        }
        if ships_value != 0 {
            self.book_internal(
                owner,
                JournalEntry::new(day, Memo::ShipLoss, CashClass::Investing)
                    .dr(Account::Losses, ships_value)
                    .cr(Account::Ships, ships_value),
            )?;
        }
        self.state.fleets.remove(&id);
        self.state.navigation.pending.remove(&id);
        self.push_log(LogEvent { day, kind: LogKind::FleetLost { fleet: id, owner } });
        Ok(())
    }

    /// 读档修正（EXPANSION §10.2）：地图重做后，海上舰队的所在格或剩余航路上可能有格已不是海，
    /// 或航路终点已不是目的地现在的停泊格。这样的舰队从所在格重新寻路到原目的地：
    /// 所在格不是海、或与目的地不连通（例如被新海岸围成的潟湖）时，先移到与目的地连通的最近海格。
    /// 数据校验保证每个港口与殖民点都在同一片海域，因此总能找到航线；万一找不到，舰队直接停泊到目的地。
    /// 手动航行的舰队：所在粗格不是海时移到最近海格的格心；粗格是海、船位却在细海岸的陆上时
    /// （第九批 M02 之前的存档），挪到同一粗格里最近的水。
    ///
    /// 按舰队编号顺序处理，只依赖状态与静态数据，结果确定；地图未变时不做任何改动。返回被修正的舰队。
    pub(crate) fn reroute_fleets_at_sea(&mut self) -> Vec<FleetId> {
        let defs = self.defs.clone();
        let map = &defs.map;
        let season = defs.nav.grid.period_on(self.day());
        // 各目的地所在海域（同一目的地只算一次）
        let mut reach: BTreeMap<LocId, Vec<bool>> = BTreeMap::new();
        let mut fixed = Vec::new();
        for (id, fleet) in self.state.fleets.iter_mut() {
            let FleetLocation::AtSea(v) = &mut fleet.location else { continue };
            let Voyage::Route(v) = v else {
                let Voyage::Manual { manual } = v else { continue };
                let moved = if !map.is_sea_in_bounds(manual.pos.cell()) {
                    // 粗格已不是海：移到最近海格的格心（格心在细海岸里一定是水），撤掉领航
                    let cell = map.nearest_cell(manual.pos.cell(), |i| map.terrain[i] != crate::nav::Terrain::Land);
                    if cell.is_some() {
                        manual.autopilot = None;
                        manual.pilot = None;
                    }
                    cell.map(crate::navigation::SubCell::center)
                } else {
                    // 粗格是海、船却压在细海岸的陆上（细碰撞之前的存档，或细海岸重新生成过）：
                    // 挪到同一粗格里最近的、与格心连着的水；粗格没变，领航的路径仍然有效，留着
                    defs.fine_coast
                        .as_deref()
                        .filter(|fine| !fine.water_at(manual.pos.x, manual.pos.y))
                        .map(|fine| crate::navigation::nearest_fine_water(fine, manual.pos))
                };
                if let Some(pos) = moved {
                    manual.pos = pos;
                    manual.remainder = [0; 2];
                    if let Some(trip) = self.state.navigation.landings.get_mut(id) {
                        trip.anchor = manual.pos;
                    }
                    fixed.push(*id);
                }
                continue;
            };
            let Some(dest_def) = defs.locations.get(v.dest.idx()) else { continue };
            let (dest, goal) = (v.dest, dest_def.cell);
            let remaining = v.path.get(v.step..).unwrap_or(&[]);
            let intact = !remaining.is_empty()
                && remaining.iter().all(|c| map.is_sea_in_bounds(*c))
                && v.path.last() == Some(&goal);
            if intact {
                continue;
            }
            let cur = v.path.get(v.step).or(v.path.last()).copied().unwrap_or(goal);
            let area = reach.entry(dest).or_insert_with(|| map.reachable_from(goal));
            let connected = |c: Cell| map.is_sea_in_bounds(c) && area[map.idx(c)];
            let start = if connected(cur) { Some(cur) } else { map.nearest_cell(cur, |i| area[i]) };
            let path = start.and_then(|s| {
                defs.nav.find_path(map, &defs.regions, season, s, goal).or_else(|| {
                    defs.nav.grid.rules().and_then(|r| {
                        map.find_path(&defs.regions, r.calendar.season_of(self.state.day).index(), s, goal)
                    })
                })
            });
            fleet.location = match path {
                Some(p) => FleetLocation::AtSea(Voyage::Route(RouteVoyage {
                    dest,
                    path: p.cells,
                    step: 0,
                    leg_progress: Fx::ZERO,
                })),
                None => FleetLocation::Docked(dest),
            };
            fixed.push(*id);
        }
        fixed
    }

    /// 开始航行。
    pub(crate) fn start_voyage(&mut self, id: FleetId, dest: LocId, path: Vec<Cell>) -> Result<(), CoreError> {
        let f = self.fleet_mut(id)?;
        f.location = FleetLocation::AtSea(Voyage::Route(RouteVoyage { dest, path, step: 0, leg_progress: Fx::ZERO }));
        Ok(())
    }

    /// 修理全舰队的费用。
    pub fn repair_cost(&self, fleet: &Fleet) -> Money {
        let per = self.defs.rules.repair_cost_per_point;
        fleet.ships.iter().map(|s| (s.max_durability - s.durability).max(0) * per).sum()
    }

    /// 卖船回收价。
    pub fn ship_resale(&self, ship: &Ship) -> Money {
        let t = self.defs.ship(ship.kind);
        let base = self.defs.rules.ship_resale.apply(t.price);
        mul_div(base, ship.durability.max(0), ship.max_durability.max(1))
    }

    /// 目的地清单、航线预览与出发命令共用名船和王国的进港限制。
    pub fn check_port_access(&self, fleet: &Fleet, dest: LocId) -> Result<(), crate::error::CommandError> {
        if !self.legend_port_allowed(fleet, dest) {
            return Err(crate::societies::blocked("legend_ship.port"));
        }
        if !self.realm_port_allowed(fleet.owner, dest) {
            return Err(crate::societies::blocked("realm.key"));
        }
        Ok(())
    }
}

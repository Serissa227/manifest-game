//! 手动航行的共用积分器。24 个基础小时段，每段按整分钟切分；查询与日结只用这一份计算。

use super::autopilot::Steer;
use super::{ManualVoyage, Sail, SubCell};
use crate::nav::SeaMap;
use crate::weather::{DayWeather, Sky};
use crate::world::Fleet;
use crate::{Cell, Fx, LocId, StaticData};
use serde::{Deserialize, Serialize};

pub const MINUTES_PER_DAY: u16 = 1440;
/// 速度用万分之一格/天；每分钟推进 1/256 格后，剩余分子留到下一分钟／下一天。
pub const REMAINDER_SCALE: i64 = 1440 * Fx::SCALE;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Steering {
    pub minute: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sail: Option<Sail>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StopKind {
    Land,
    Port,
    Storm,
    Sight,
    /// H03：风暴团进入“视野 × 2”
    #[serde(rename = "storm_ahead")]
    StormAhead,
    /// H03：雾团进入“视野 × 2”
    #[serde(rename = "fog_ahead")]
    FogAhead,
    /// H03：被按分钟追击的海盗追上
    Overtaken,
    /// H04：碰上海上所见（自动暂停，出小卡片）
    Sighting,
    #[serde(rename = "supplies_low")]
    SuppliesLow,
}

impl StopKind {
    /// 同一分钟里几种停船的先后（排序用）。
    pub fn order(self) -> u8 {
        match self {
            StopKind::Port => 0,
            StopKind::Land => 1,
            StopKind::Storm => 2,
            StopKind::Sight => 3,
            StopKind::Overtaken => 4,
            StopKind::StormAhead => 5,
            StopKind::FogAhead => 6,
            StopKind::Sighting => 7,
            StopKind::SuppliesLow => 9,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CourseStop {
    pub minute: u16,
    pub kind: StopKind,
    pub loc: Option<LocId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoursePoint {
    pub pos: SubCell,
    pub minute: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Course {
    pub voyage: ManualVoyage,
    pub points: Vec<CoursePoint>,
    pub stops: Vec<CourseStop>,
    pub arrival: Option<LocId>,
    /// 包括一分钟内高速越过的格子，不能从分钟端点反推。
    pub cells: Vec<SweptCell>,
    pub contacts: Vec<CourseContact>,
    pub realms: Vec<(String, bool)>,
    /// 本次积分中的领航模式入口；落实时才记日志，不参与暂停点。
    pub pilot_modes: Vec<(super::autopilot::PilotMode, u16)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SweptCell {
    pub cell: Cell,
    pub minute: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CourseContact {
    pub minute: u16,
    pub pirate: bool,
    pub id: u32,
}

pub struct CourseInput<'a> {
    pub defs: &'a StaticData,
    pub fleet: &'a Fleet,
    pub start: &'a ManualVoyage,
    pub from: u16,
    pub until: u16,
    pub steers: &'a [Steering],
    pub day: u32,
    pub speed_bonus: Fx,
    /// H01 / H02 的航速与死区修正（[`World::voyage_mods`](crate::World::voyage_mods)；缺省中性）
    pub mods: crate::seafaring::VoyageMods,
}

/// 0°正北、顺时针。只使用 E14 的整数余弦表，输出万分之一的单位向量。
pub fn direction(heading: u16) -> [i64; 2] {
    fn cosine(degree: u16) -> i64 {
        let d = degree % 360;
        let (angle, sign) = match d {
            0..=90 => (d, 1),
            91..=180 => (180 - d, -1),
            181..=270 => (d - 180, -1),
            _ => (360 - d, 1),
        };
        crate::nav::climate::cos_latitude(i32::from(angle) * 60).0 * sign
    }
    [cosine((450 - heading % 360) % 360), -cosine(heading)]
}

pub fn angle_between(a: u16, b: u16) -> u16 {
    let delta = (i32::from(a) - i32::from(b)).rem_euclid(360) as u16;
    delta.min(360 - delta)
}

/// 混合船队由逆风能力最弱的船限制航向。
pub fn sail_limit(defs: &StaticData, fleet: &Fleet) -> u16 {
    fleet.ships.iter().map(|s| crate::legend_ships::mechanics::ship_limit(defs, s)).max().unwrap_or(67)
}

/// 计入 H01 `upwind` 与 H02 帆缆磨损之后的顶风死区（度）；中性修正时等于 [`sail_limit`]。
pub fn sail_limit_with(defs: &StaticData, fleet: &Fleet, mods: &crate::seafaring::VoyageMods) -> u16 {
    let base = sail_limit(defs, fleet);
    if mods.upwind == 0 {
        return base;
    }
    (i64::from(base) + mods.upwind).clamp(0, 180) as u16
}

/// 复用旧航速公式（船员、士气、天气、船型和改造）；45°采样之间线性插值。
/// 洋流单独作向量叠加，不再同时算进旧公式的顺逆流乘数。
pub fn velocity(input: &CourseInput<'_>, voyage: &ManualVoyage, weather: Option<DayWeather>) -> [i64; 2] {
    velocity_at(input, voyage, weather, input.from)
}
pub(super) fn velocity_at(
    input: &CourseInput<'_>,
    voyage: &ManualVoyage,
    weather: Option<DayWeather>,
    minute: u16,
) -> [i64; 2] {
    if voyage.sail == Sail::Furled {
        return [0, 0];
    }
    let wind_from = weather.map(|w| (u16::from(w.sea.wind_dir) * 45 + 180) % 360);
    let calm_fleet = input.defs.rules.ships.s02_enabled
        && weather.is_some_and(|w| w.sea.wind_strength <= input.defs.rules.ships.calm_wind_max)
        && !input.fleet.ships.is_empty()
        && input
            .fleet
            .ships
            .iter()
            .all(|s| crate::legend_ships::has(input.defs, s, crate::legend_ships::Trait::CalmFloor));
    let in_irons = weather.is_some_and(|w| w.sea.wind_strength > 0)
        && !calm_fleet
        && wind_from.is_some_and(|dir| {
            angle_between(voyage.heading, dir) < sail_limit_with(input.defs, input.fleet, &input.mods)
        });
    let mut still = weather;
    if let Some(w) = &mut still {
        w.sea.current_strength = 0;
    }
    let mut speed = if in_irons {
        Fx::ZERO
    } else {
        let heading = voyage.heading % 360;
        let speed = |direction| {
            if input.fleet.ships.iter().any(|s| s.legend.is_some()) {
                crate::legend_ships::mechanics::speed(crate::legend_ships::mechanics::SpeedInput {
                    defs: input.defs,
                    ships: &input.fleet.ships,
                    crew: input.fleet.crew,
                    morale: input.fleet.morale,
                    heading: direction,
                    weather: still.as_ref(),
                    minute: (minute + 360) % 1440,
                    mods: if input.defs.rules.ships.s02_enabled {
                        &input.mods
                    } else {
                        &crate::seafaring::VoyageMods::NEUTRAL
                    },
                })
            } else {
                crate::fleet::step_speed_with(input.defs, input.fleet, direction, still.as_ref(), &input.mods)
            }
        };
        let a = speed((heading / 45) as u8);
        let b = speed(((heading / 45 + 1) % 8) as u8);
        Fx(a.0 + (b.0 - a.0) * i64::from(heading % 45) / 45).mul(Fx::ONE + input.speed_bonus)
    };
    if voyage.sail == Sail::Half {
        speed = Fx(speed.0 / 2);
    }
    let [sx, sy] = direction(voyage.heading);
    let mut vector = [speed.0 * sx / Fx::SCALE, speed.0 * sy / Fx::SCALE];
    if let Some(w) = weather {
        // 一级流为 0.5 格/天，与帆面积和船型无关；收帆视为锚泊，整船停下。
        let drift = 5_000 * w.sea.current_strength.clamp(0, 3);
        let [cx, cy] = direction(u16::from(w.sea.current_dir) * 45);
        vector[0] += drift * cx / Fx::SCALE;
        vector[1] += drift * cy / Fx::SCALE;
    }
    project_velocity(input, voyage.pos, vector)
}

fn project_velocity(input: &CourseInput<'_>, pos: SubCell, mut vector: [i64; 2]) -> [i64; 2] {
    if let Some(p) = input.defs.nav.grid.rules().and_then(|r| r.projection.as_ref()).filter(|p| p.lat_scale) {
        let cos = p.row_cos(pos.cell().y).0.max(100);
        // 与 E14 同样的 cos² 航速修正，东西格长还需除以 cos。
        vector[0] = (i128::from(vector[0]) * i128::from(cos) / i128::from(Fx::SCALE)) as i64;
        vector[1] = (i128::from(vector[1]) * i128::from(cos).pow(2) / i128::from(Fx::SCALE).pow(2)) as i64;
    }
    vector
}

/// 与帆行相同的海流与纬度修正；抢风先折算对水推进，再叠加这个向量。
pub(super) fn current_velocity(input: &CourseInput<'_>, pos: SubCell, weather: Option<DayWeather>) -> [i64; 2] {
    let vector = weather.map_or([0; 2], |w| {
        let drift = 5_000 * w.sea.current_strength.clamp(0, 3);
        direction(u16::from(w.sea.current_dir) * 45).map(|v| drift * v / Fx::SCALE)
    });
    project_velocity(input, pos, vector)
}

fn normalize(map: &SeaMap, pos: SubCell) -> Option<SubCell> {
    let width = i64::from(map.width) * SubCell::SCALE;
    let height = i64::from(map.height) * SubCell::SCALE;
    if width == 0 || pos.y < 0 || pos.y >= height {
        return None;
    }
    let x = if map.wrap_x { pos.x.rem_euclid(width) } else { pos.x };
    (x >= 0 && x < width).then_some(SubCell { x, y: pos.y })
}

/// 本次扫掠可使用的已知海域、目的港与帷幕通行权。
#[derive(Clone, Copy)]
pub(super) struct SweepAccess<'a> {
    pub(super) known: Option<&'a crate::explore::Exploration>,
    pub(super) only_port: Option<LocId>,
    pub(super) passes: &'a std::collections::BTreeSet<String>,
}

impl SweepAccess<'_> {
    /// 粗格能不能走，与扫掠是同一条规则：界内海格、当前周期不封冻、限定已知海域时须已探明、帷幕须有通行权。
    /// 领航在细海岸里找路时用它圈出窗口里能走的粗格。
    pub(super) fn navigable(&self, input: &CourseInput<'_>, c: Cell) -> bool {
        let map = &input.defs.map;
        map.is_sea_in_bounds(c)
            && input.defs.nav.grid.check_cell(input.defs.nav.grid.period_on(input.day), c).is_ok()
            && self.known.is_none_or(|e| e.is_revealed(map.idx(c)))
            && input.defs.realms.at(input.defs, c).is_none_or(|r| self.passes.contains(&r.key))
    }
}

/// 这一分钟要走的整数位移（1/256 格）与走完后的余数。
/// `target` 是领航的目标点：这一分钟会越过它时正好停在它上面，余数清零。
fn minute_step(remainder: [i64; 2], velocity: [i64; 2], pos: SubCell, target: Option<SubCell>) -> ([i64; 2], [i64; 2]) {
    let mut delta = [0; 2];
    let mut rest = [0; 2];
    for axis in 0..2 {
        let total = remainder[axis] + velocity[axis] * SubCell::SCALE;
        delta[axis] = total.div_euclid(REMAINDER_SCALE);
        rest[axis] = total.rem_euclid(REMAINDER_SCALE);
    }
    if let Some(target) = target {
        let remaining = [target.x - pos.x, target.y - pos.y];
        let dot = i128::from(delta[0]) * i128::from(remaining[0]) + i128::from(delta[1]) * i128::from(remaining[1]);
        let distance = i128::from(remaining[0]).pow(2) + i128::from(remaining[1]).pow(2);
        if dot >= distance {
            delta = remaining;
            rest = [0; 2];
        }
    }
    (delta, rest)
}

/// 领航试走一分钟：照这一分钟真正要用的算法（余数、越过目标就停在目标上、同一套扫掠）走一遍，
/// 只回答会不会被岸（粗格的陆、细海岸的陆、未知海域或帷幕）挡住。不改任何状态。
pub(super) fn minute_blocked(
    input: &CourseInput<'_>,
    voyage: &ManualVoyage,
    velocity: [i64; 2],
    target: SubCell,
    access: SweepAccess<'_>,
) -> bool {
    let (delta, _) = minute_step(voyage.remainder, velocity, voyage.pos, Some(target));
    let (_, stop, _) = sweep(input, voyage.pos, delta, access, &mut Vec::new(), &mut Vec::new());
    stop == Some(StopKind::Land)
}

/// 自动领航的可见性检查；整条瞄准弦与实际移动共用粗格、细岸和通行权规则。
pub(super) fn line_blocked(input: &CourseInput<'_>, pos: SubCell, target: SubCell, access: SweepAccess<'_>) -> bool {
    // 开阔粗格不必逐定点检查；混合细岸才交给正式扫掠。
    let mut mixed = false;
    for span in super::line_pilot::spans(pos, target, 0) {
        let Some(cell) = input.defs.map.topology().normalize(span.x, span.y) else { return true };
        if !access.navigable(input, cell) {
            return true;
        }
        mixed |= input.defs.fine_coast.as_ref().is_some_and(|f| f.kind(cell) != crate::nav::FineKind::Water);
    }
    mixed
        && sweep(input, pos, [target.x - pos.x, target.y - pos.y], access, &mut Vec::new(), &mut Vec::new()).1
            == Some(StopKind::Land)
}

/// 检查整段扫过的每个 1/256 格位置，防止高速穿岸，也检查斜向切过的陆地角。
/// 有细海岸时（[`StaticData::fine_coast`]），除了粗格能不能走，还要求落脚的细格是水，
/// 斜着从一个细格进另一个细格时夹着的两个细格不能都是陆；撞上细层的陆与撞上粗格的陆是同一种结果。
fn sweep(
    input: &CourseInput<'_>,
    start: SubCell,
    delta: [i64; 2],
    access: SweepAccess<'_>,
    cells: &mut Vec<Cell>,
    realms: &mut Vec<(String, bool)>,
) -> (SubCell, Option<StopKind>, Option<LocId>) {
    let SweepAccess { known, only_port, passes } = access;
    let map = &input.defs.map;
    let period = input.defs.nav.grid.period_on(input.day);
    let navigable = |c: Cell| {
        map.is_sea_in_bounds(c)
            && input.defs.nav.grid.check_cell(period, c).is_ok()
            && known.is_none_or(|e| e.is_revealed(map.idx(c)))
            && input.defs.realms.at(input.defs, c).is_none_or(|r| passes.contains(&r.key))
    };
    let fine = input.defs.fine_coast.as_deref();
    let count = delta[0].abs().max(delta[1].abs());
    let mut last = start;
    for step in 1..=count {
        let pos = SubCell { x: start.x + delta[0] * step / count, y: start.y + delta[1] * step / count };
        let Some(next) = normalize(map, pos) else {
            return (last, Some(StopKind::Land), None);
        };
        let cell = next.cell();
        let previous = last.cell();
        if let Some(r) = input.defs.realms.at(input.defs, cell) {
            let entered = passes.contains(&r.key);
            if !realms.contains(&(r.key.clone(), entered)) {
                realms.push((r.key.clone(), entered));
            }
            if !entered {
                let pos = crate::realms::push_back(input.defs, last, delta, r.veil.push);
                return (pos, Some(StopKind::Land), None);
            }
        }
        if !navigable(cell) {
            return (last, Some(StopKind::Land), None);
        }
        if previous.x != cell.x
            && previous.y != cell.y
            && (!navigable(Cell::new(previous.x, cell.y)) || !navigable(Cell::new(cell.x, previous.y)))
        {
            return (last, Some(StopKind::Land), None);
        }
        if let Some(fine) = fine {
            // 细层：换了细格才查。整张图上的细格坐标 = 位置 × 细分数 ÷ 256。
            let sub = i64::from(fine.sub());
            let from = [last.x * sub / SubCell::SCALE, last.y * sub / SubCell::SCALE];
            let to = [next.x * sub / SubCell::SCALE, next.y * sub / SubCell::SCALE];
            // 斜着换细格时：夹着的两个细格都是陆（两块陆只在角上相接的“掐口”）才挡；
            // 只有一边是陆时算擦过陆角，放行——细格不到一千米，阶梯状的海岸线上处处是这种角，
            // 照粗格那样严格会让沿岸斜走的船被看不见的角绊住（领航在岸边来回抖、走不出去）。
            if from != to
                && (!fine.water_at(next.x, next.y)
                    || (from[0] != to[0]
                        && from[1] != to[1]
                        && !fine.water_at(next.x, last.y)
                        && !fine.water_at(last.x, next.y)))
            {
                return (last, Some(StopKind::Land), None);
            }
        }
        last = next;
        if cell != previous {
            cells.push(cell);
        }
        if cell != previous
            && let Some(port) = input
                .defs
                .loc_ids()
                .filter(|id| input.defs.loc(*id).is_port() || input.defs.loc(*id).is_site())
                .filter(|id| only_port.is_none_or(|dest| dest == *id))
                .filter(|id| crate::legend_ships::mechanics::port_allowed(input.defs, input.fleet, *id))
                .filter(|id| {
                    input
                        .defs
                        .geography
                        .places
                        .authored
                        .locations
                        .get(&input.defs.loc(*id).key)
                        .and_then(|l| l.realm.as_ref())
                        .is_none_or(|key| passes.contains(key))
                })
                .find(|id| input.defs.loc(*id).cell == cell && input.defs.nav.grid.check_port(period, *id).is_ok())
        {
            return (last, Some(StopKind::Port), Some(port));
        }
    }
    (last, None, None)
}

/// 纯函数：相同输入逐位相同。weather 只查询给定日期的确定性天气，不消费随机流。
/// 每分钟都有轨迹点；同一分钟的操舵保持输入顺序。抵港后本日的后续操舵不再执行。
pub fn integrate_course(input: CourseInput<'_>, weather: impl FnMut(Cell) -> Option<DayWeather>) -> Course {
    integrate_with_pilot(input, &[], None, &std::collections::BTreeSet::new(), weather)
}

pub(crate) fn integrate_with_pilot(
    input: CourseInput<'_>,
    pilots: &[super::autopilot::PilotOrder],
    known: Option<&crate::explore::Exploration>,
    passes: &std::collections::BTreeSet<String>,
    mut weather: impl FnMut(Cell) -> Option<DayWeather>,
) -> Course {
    let mut result = Course {
        voyage: input.start.clone(),
        points: vec![],
        stops: vec![],
        arrival: None,
        cells: vec![],
        contacts: vec![],
        realms: vec![],
        pilot_modes: vec![],
    };
    let mut orders: Vec<_> =
        input.steers.iter().enumerate().map(|(i, s)| (s.minute, 2 * i + 1, Some(s), None)).collect();
    orders.extend(pilots.iter().map(|p| (p.minute, 2 * p.after_steers, None, Some(p))));
    orders.sort_by_key(|(minute, seq, _, _)| (*minute, *seq));
    let from = input.from.min(MINUTES_PER_DAY);
    let until = input.until.min(MINUTES_PER_DAY).max(from);
    let mut order = 0;
    let mut storm = false;
    let supplies_stop_days = input.defs.rules.autopilot.supplies_stop_days;
    let supply_alert = input.mods.supply_alert.map_or(supplies_stop_days, u16::from);
    let supplies_low = supplies_stop_days > 0
        && supply_alert > 0
        && input
            .fleet
            .supplies_days(input.defs)
            .is_some_and(|days| days < i64::from(supplies_stop_days.max(supply_alert)));
    let mut helm = super::autopilot::Helm::new(&input, known, passes);
    result.cells.push(SweptCell { cell: input.start.pos.cell(), minute: from });
    result.points.push(CoursePoint { pos: result.voyage.pos, minute: from });
    for hour in from / 60..24 {
        for minute in (hour * 60).max(from)..((hour + 1) * 60).min(until) {
            while order < orders.len() && orders[order].0 <= minute {
                let (at, _, steer, pilot) = orders[order];
                if result.arrival.is_none() && at >= from {
                    if let Some(steer) = steer {
                        if steer.sail.is_none()
                            && let Some(motion) = result
                                .voyage
                                .pilot
                                .as_ref()
                                .and_then(|p| p.motion())
                                .filter(|m| m.mode == super::autopilot::PilotMode::Creep)
                        {
                            result.voyage.sail = motion.sail;
                        }
                        if let Some(h) = steer.heading {
                            result.voyage.heading = h;
                        }
                        if let Some(s) = steer.sail {
                            result.voyage.sail = s;
                            result.voyage.reefed = false;
                        }
                        result.voyage.autopilot = None;
                        result.voyage.pilot = None;
                    }
                    if let Some(pilot) = pilot {
                        result.voyage.autopilot = Some(pilot.dest);
                        result.voyage.pilot = Some(pilot.pilot.clone());
                        result.voyage.sail = Sail::Full;
                    }
                }
                order += 1;
            }
            if result.arrival.is_none() {
                note_supplies_stop(&mut result, minute, supplies_low);
                let w = weather(result.voyage.pos.cell());
                let now_storm = w.is_some_and(|w| w.sky == Sky::Storm);
                if now_storm && !storm {
                    result.stops.push(CourseStop { minute, kind: StopKind::Storm, loc: None });
                }
                storm = now_storm;
                // H02 常设命令：进风暴自动收到半帆，出了风暴放回满帆（只放回自己收的那一次）
                if input.mods.auto_reef {
                    if now_storm && result.voyage.sail == Sail::Full {
                        result.voyage.sail = Sail::Half;
                        result.voyage.reefed = true;
                    } else if !now_storm && result.voyage.reefed {
                        result.voyage.sail = Sail::Full;
                        result.voyage.reefed = false;
                    }
                }
                let piloting = result.voyage.pilot.is_some();
                let steer = helm.steer(&mut result.voyage, w, minute);
                if piloting {
                    end_pilot(&mut result, minute, &steer);
                }
                let (target, velocity) = match steer {
                    Steer::Toward { target, velocity } => (Some(target), velocity),
                    Steer::Done | Steer::Blocked => (None, None),
                };
                // 领航试走时已经按同样的参数算过这一分钟的速度，不必再算一遍
                let velocity = velocity.unwrap_or_else(|| velocity_at(&input, &result.voyage, w, minute));
                let (delta, rest) = minute_step(result.voyage.remainder, velocity, result.voyage.pos, target);
                result.voyage.remainder = rest;
                let mut crossed = Vec::new();
                let (pos, stop, arrival) = sweep(
                    &input,
                    result.voyage.pos,
                    delta,
                    SweepAccess {
                        known: if piloting { known } else { None },
                        only_port: if piloting { result.voyage.autopilot } else { None },
                        passes,
                    },
                    &mut crossed,
                    &mut result.realms,
                );
                result.cells.extend(crossed.into_iter().map(|cell| SweptCell { cell, minute: minute + 1 }));
                result.voyage.pos = pos;
                let next_storm = weather(pos.cell()).is_some_and(|w| w.sky == Sky::Storm);
                if next_storm && !storm {
                    result.stops.push(CourseStop { minute: minute + 1, kind: StopKind::Storm, loc: None });
                }
                storm = next_storm;
                if let Some(kind) = stop {
                    result.stops.push(CourseStop { minute: minute + 1, kind, loc: arrival });
                    result.voyage.sail = Sail::Furled;
                    result.voyage.remainder = [0; 2];
                    result.voyage.autopilot = None;
                    result.voyage.pilot = None;
                    result.arrival = arrival;
                }
            }
            result.points.push(CoursePoint { pos: result.voyage.pos, minute: minute + 1 });
        }
    }

    // 当前分钟的操舵立即影响读模型，但这个分钟还没有额外移动一步。
    while order < orders.len() && orders[order].0 <= until {
        let (at, _, steer, pilot) = orders[order];
        if result.arrival.is_none() && at >= from {
            if let Some(steer) = steer {
                if steer.sail.is_none()
                    && let Some(motion) = result
                        .voyage
                        .pilot
                        .as_ref()
                        .and_then(|p| p.motion())
                        .filter(|m| m.mode == super::autopilot::PilotMode::Creep)
                {
                    result.voyage.sail = motion.sail;
                }
                if let Some(h) = steer.heading {
                    result.voyage.heading = h;
                }
                if let Some(s) = steer.sail {
                    result.voyage.sail = s;
                    result.voyage.reefed = false;
                }
                result.voyage.autopilot = None;
                result.voyage.pilot = None;
            }
            if let Some(pilot) = pilot {
                result.voyage.autopilot = Some(pilot.dest);
                result.voyage.pilot = Some(pilot.pilot.clone());
                result.voyage.sail = Sail::Full;
            }
        }
        order += 1;
    }
    if result.arrival.is_none() && result.voyage.pilot.is_some() {
        note_supplies_stop(&mut result, until, supplies_low);
        let w = weather(result.voyage.pos.cell());
        let steer = helm.steer(&mut result.voyage, w, until);
        end_pilot(&mut result, until, &steer);
    }
    result.pilot_modes = helm.mode_entries;
    result
}

/// 提醒记忆与航迹一起投影、落实，查询本身不改真实状态。
fn note_supplies_stop(result: &mut Course, minute: u16, low: bool) {
    if low
        && let Some(pilot) = result.voyage.pilot.as_mut()
        && !pilot.supplies_stopped
    {
        pilot.supplies_stopped = true;
        result.stops.push(CourseStop { minute, kind: StopKind::SuppliesLow, loc: None });
    }
}

/// 领航结束：路径走完（抵达目的港，或停在已知海域的边缘），或被细海岸堵住了去路。
/// 两种都收帆、清余数、撤掉领航；没有抵港的记一个靠岸停船（`StopKind::Land`）。还在走的不动。
fn end_pilot(result: &mut Course, minute: u16, steer: &Steer) {
    let arrival = match steer {
        Steer::Toward { .. } => return,
        Steer::Done => result.voyage.pilot.as_ref().filter(|p| !p.edge).and(result.voyage.autopilot),
        Steer::Blocked => None,
    };
    result.voyage.pilot = None;
    result.voyage.autopilot = None;
    result.voyage.sail = Sail::Furled;
    result.voyage.remainder = [0; 2];
    result.arrival = arrival;
    result.stops.push(CourseStop {
        minute,
        kind: if arrival.is_some() { StopKind::Port } else { StopKind::Land },
        loc: arrival,
    });
}

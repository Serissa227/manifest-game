//! 已知海域中的 A*；固定邻居与堆的次序，相同距离按行优先决定。
use super::course::SweepAccess;
use super::fine_pilot::{Aim, FineWindow};
use super::steering_cache::SteeringCache;
use super::{ManualVoyage, Sail, SubCell};
use crate::{Cell, CommandError, FleetId, LocId, OwnerId, Reason, World};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pilot {
    pub path: Vec<Cell>,
    pub step: usize,
    pub edge: bool,
    /// H10b：缺失时保留旧的逐格领航。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<super::line_pilot::PilotLine>,
    /// H10g：选舵的记忆随领航保存；缺失时从当前分钟开始选定。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub helm_hold: Option<PilotHold>,
    /// H10h：模式记忆随领航存读；旧档缺失时按帆行。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<Box<PilotMotion>>,
    /// 本程已因粮水不足提醒过；换目的地或抵港时随旧计划清掉。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub supplies_stopped: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotOrder {
    pub minute: u16,
    /// 同分钟操舵之后插入；保持命令日志次序。
    pub after_steers: usize,
    pub dest: LocId,
    pub pilot: Pilot,
}

/// 多个目的地共用一次分配；每条航路只重置实际访问过的格子，堆次序与单次 A* 相同。
struct PathScratch {
    costs: Vec<i64>,
    parents: Vec<usize>,
    touched: Vec<usize>,
    heap: BinaryHeap<Reverse<(i64, i64, usize)>>,
}

impl PathScratch {
    fn new(cells: usize) -> Self {
        Self {
            costs: vec![i64::MAX; cells],
            parents: vec![usize::MAX; cells],
            touched: Vec::new(),
            heap: BinaryHeap::new(),
        }
    }

    fn reset(&mut self) {
        for index in self.touched.drain(..) {
            self.costs[index] = i64::MAX;
            self.parents[index] = usize::MAX;
        }
        self.heap.clear();
    }
}

impl Pilot {
    pub fn mode(&self) -> PilotMode {
        self.motion().map_or(PilotMode::Sail, |m| m.mode)
    }

    pub fn motion(&self) -> Option<PilotMotion> {
        self.motion.as_deref().copied()
    }

    pub(crate) fn valid(&self, world: &World) -> bool {
        !self.path.is_empty()
            && self.step < self.path.len()
            && self
                .path
                .iter()
                .all(|c| world.defs.map.is_sea_in_bounds(*c) && world.state.explore.is_revealed(world.defs.map.idx(*c)))
            && self.path.windows(2).all(|p| (0..8).any(|d| world.defs.map.topology().neighbor(p[0], d) == Some(p[1])))
            && self.line.as_ref().is_none_or(|line| line.valid(self, world))
    }

    pub(crate) fn valid_destination(&self, world: &World, dest: LocId) -> bool {
        self.valid(world)
            && world.location_visible(dest)
            && world
                .defs
                .locations
                .get(dest.idx())
                .is_some_and(|l| (l.is_port() || l.is_site()) && (self.edge || self.path.last() == Some(&l.cell)))
    }
}

impl World {
    pub fn known_sea_path(&self, start: Cell, dest: LocId, edge: bool) -> Result<Pilot, CommandError> {
        self.known_sea_path_with(start, dest, edge, &mut PathScratch::new(self.defs.map.terrain.len()))
    }

    /// 批量查询与逐个查询的路径、顺序和错误一致；航行面板无需为每个港口重建整图工作区。
    pub fn known_sea_paths(&self, start: Cell, dests: &[LocId], edge: bool) -> Vec<Result<Pilot, CommandError>> {
        let mut scratch = PathScratch::new(self.defs.map.terrain.len());
        dests.iter().map(|dest| self.known_sea_path_with(start, *dest, edge, &mut scratch)).collect()
    }

    fn known_sea_path_with(
        &self,
        start: Cell,
        dest: LocId,
        edge: bool,
        scratch: &mut PathScratch,
    ) -> Result<Pilot, CommandError> {
        scratch.reset();
        let target = self
            .defs
            .locations
            .get(dest.idx())
            .filter(|l| l.is_port() || l.is_site())
            .filter(|_| self.location_visible(dest))
            .ok_or_else(|| Reason::new("navigation.unknown_dest", "目的地不可见。").rule())?;
        let map = &self.defs.map;
        let grid = &self.defs.nav.grid;
        let period = grid.period_on(self.day());
        let goal = target.cell;
        let allowed = |c: Cell| {
            map.is_sea_in_bounds(c)
                && self.state.explore.is_revealed(map.idx(c))
                && grid.check_cell(period, c).is_ok()
                && self.realm_cell_allowed(OwnerId::Player, c)
        };
        let no_path = || Reason::new("navigation.unknown_route", "已知海域内没有通路。").rule();
        if !allowed(start)
            || !self.location_open(dest)
            || !self.port_is_open(dest)
            || grid.check_port(period, dest).is_err()
        {
            return Err(no_path());
        }
        let PathScratch { costs, parents, touched, heap } = scratch;
        let s = map.idx(start);
        let mut best = s;
        let heuristic = |c| map.topology().octile_heuristic(c, goal);
        costs[s] = 0;
        touched.push(s);
        heap.push(Reverse((heuristic(start), 0, s)));
        while let Some(Reverse((_, cost, cur))) = heap.pop() {
            if costs[cur] != cost {
                continue;
            }
            let cell = map.cell_of(cur);
            if (map.topology().squared_distance(cell, goal), cost, cur)
                < (map.topology().squared_distance(map.cell_of(best), goal), costs[best], best)
            {
                best = cur;
            }
            if cell == goal {
                best = cur;
                break;
            }
            for dir in 0..8 {
                let Some(next) = map.topology().neighbor(cell, dir).filter(|c| allowed(*c)) else { continue };
                if dir % 2 == 1 && (!allowed(Cell::new(next.x, cell.y)) || !allowed(Cell::new(cell.x, next.y))) {
                    continue;
                }
                let n = map.idx(next);
                let candidate = cost + if dir % 2 == 0 { 10_000 } else { 14_142 };
                if candidate < costs[n] {
                    if costs[n] == i64::MAX {
                        touched.push(n);
                    }
                    costs[n] = candidate;
                    parents[n] = cur;
                    heap.push(Reverse((candidate + heuristic(next), candidate, n)));
                }
            }
        }
        let at_edge = map.cell_of(best) != goal;
        if at_edge && !edge {
            return Err(no_path());
        }
        let mut path = vec![map.cell_of(best)];
        let mut cur = best;
        while cur != s {
            cur = parents[cur];
            path.push(map.cell_of(cur));
        }
        path.reverse();
        Ok(Pilot {
            step: usize::from(path.len() > 1),
            path,
            edge: at_edge,
            line: None,
            helm_hold: None,
            motion: None,
            supplies_stopped: false,
        })
    }
}

pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    dest: LocId,
    minute: u16,
    edge: bool,
    route: Option<super::routing::RoutePref>,
) -> Result<super::orders::NavigationPlan, CommandError> {
    let f = super::orders::check_fleet(world, owner, fleet, minute)?;
    let departure = if f.docked_at().is_some() {
        super::orders::check_depart(world, owner, fleet, minute, 0)?;
        true
    } else {
        super::orders::check_steer(world, owner, fleet, super::Steering { minute, heading: Some(0), sail: None })?;
        false
    };
    let current = (!departure).then(|| world.manual_course(f, &[], minute).voyage);
    let origin = current.as_ref().map_or_else(|| SubCell::center(f.cell(&world.defs)), |v| v.pos);
    let start = origin.cell();
    // H07：偏好由内核校验；按距离时就是原来的 `known_sea_path`
    let pref = world.resolve_route_pref(f, route)?;
    let mut pilot = world.planned_sea_path(f, start, dest, edge, pref)?;
    pilot.supplies_stopped = current
        .as_ref()
        .filter(|v| v.autopilot == Some(dest))
        .and_then(|v| v.pilot.as_ref())
        .is_some_and(|p| p.supplies_stopped);
    pilot.line = world.straighten(f, origin, &pilot, pref);
    if let Some(line) = &pilot.line {
        pilot.step = line.corners[0] as usize;
    }
    world.check_port_access(f, dest)?;
    let after_steers = world.state.navigation.pending.get(&fleet).map_or(0, |p| p.steers.len());
    Ok(super::orders::NavigationPlan::Autopilot {
        fleet,
        departure,
        order: PilotOrder { minute, after_steers, dest, pilot },
    })
}

/// 领航这一分钟的去向。
pub(super) enum Steer {
    /// 没有领航，或者领航的路径走完了。
    Done,
    /// 朝这个点走（这一分钟会越过它时正好停在它上面）。`velocity` 是选舵时已经算好的这一分钟的速度
    /// （有细海岸时试走过才有），积分器直接用，不再算一遍。
    Toward { target: SubCell, velocity: Option<[i64; 2]> },
    /// 细海岸把去路堵死了（窗口里绕不过去，或者能走的舵都会撞岸）：领航停下。
    Blocked,
}

/// 一个舵的排位：偏离目标方向越小越好，同样偏离时取朝目标更快的，再取度数小的。朝不了目标的舵没有排位。
type Rank = (i128, Reverse<i128>, u16);
pub(super) fn rank(heading: usize, [vx, vy]: [i64; 2], dx: i64, dy: i64) -> Option<Rank> {
    let dot = i128::from(vx) * i128::from(dx) + i128::from(vy) * i128::from(dy);
    if dot <= 0 {
        return None;
    }
    let side = (i128::from(vx) * i128::from(dy) - i128::from(vy) * i128::from(dx)).abs();
    Some((side * 1_000_000 / dot, Reverse(dot), heading as u16))
}

/// 朝不了目标的舵（与目标方向夹角不小于 90°）的退路次序：夹角越小越先试——这些舵的余弦不大于零，
/// 夹角越小余弦的平方越小，所以按 `点积² / 速度²` 从小到大；同样的取度数小的。
/// 只在能朝目标走的舵这一分钟全都会撞岸时用（抢风时唯一能前进的一舷正对着岸）。
type Backup = (i128, u16);
fn backup(heading: usize, [vx, vy]: [i64; 2], dx: i64, dy: i64) -> Option<Backup> {
    let dot = i128::from(vx) * i128::from(dx) + i128::from(vy) * i128::from(dy);
    let speed = i128::from(vx).pow(2) + i128::from(vy).pow(2);
    (dot <= 0 && speed > 0).then(|| (dot * dot * 1_000_000 / speed, heading as u16))
}

/// 积分器里的舵手：考虑当前风流，选最接近目标方向的可行速度；有细海岸时还要绕开细层的陆。
///
/// 选舵记忆在 Pilot 中，随积分结果落实；缓存只存输入的纯函数，中途落实后继续积分仍用同一份记忆。
pub(super) struct Helm<'a, 'defs> {
    input: &'a super::course::CourseInput<'defs>,
    cache: SteeringCache<'a, 'defs>,
    known: Option<&'a crate::explore::Exploration>,
    passes: &'a std::collections::BTreeSet<String>,
    /// “所在粗格 → 下一粗格”这个窗口里的细格；换了粗格才重建。
    window: Option<FineWindow>,
    /// 排位表与退路表的工作区（只在首选的舵撞岸时用）。
    ranked: Vec<Rank>,
    backups: Vec<Backup>,
    leg: Option<super::line_pilot::Leg>,
    pub(super) degraded: u64,
    pub(super) blocked: u64,
    pub(super) shore_avoided: u64,
    pub(super) backup_used: u64,
    pub(super) mode_entries: Vec<(PilotMode, u16)>,
}

impl<'a, 'defs> Helm<'a, 'defs> {
    pub(super) fn new(
        input: &'a super::course::CourseInput<'defs>,
        known: Option<&'a crate::explore::Exploration>,
        passes: &'a std::collections::BTreeSet<String>,
    ) -> Self {
        Self {
            input,
            cache: SteeringCache::new(input),
            known,
            passes,
            window: None,
            ranked: Vec::new(),
            backups: Vec::new(),
            leg: None,
            degraded: 0,
            blocked: 0,
            shore_avoided: 0,
            backup_used: 0,
            mode_entries: Vec::new(),
        }
    }

    pub(super) fn steer(
        &mut self,
        voyage: &mut ManualVoyage,
        weather: Option<crate::weather::DayWeather>,
        minute: u16,
    ) -> Steer {
        if voyage.pilot.as_ref().is_some_and(|p| p.line.is_some()) {
            return self.steer_line(voyage, weather, minute);
        }
        self.steer_grid(voyage, weather, minute)
    }

    fn steer_grid(
        &mut self,
        voyage: &mut ManualVoyage,
        weather: Option<crate::weather::DayWeather>,
        minute: u16,
    ) -> Steer {
        let input = self.input;
        let Some(pilot) = voyage.pilot.as_mut() else { return Steer::Done };
        while pilot.line.is_none()
            && pilot.step < pilot.path.len()
            && voyage.pos == SubCell::center(pilot.path[pilot.step])
        {
            pilot.step += 1;
        }
        let Some(next) = pilot.path.get(pilot.step).copied() else { return Steer::Done };
        let centre = SubCell::center(next);
        let map = &input.defs.map;
        let width = i64::from(map.width) * 256;
        let mut dx = centre.x - voyage.pos.x;
        if map.wrap_x {
            dx = (dx + width / 2).rem_euclid(width) - width / 2;
        }
        let dy = centre.y - voyage.pos.y;
        let origin = pilot.path.get(pilot.step.saturating_sub(1)).copied().map_or(voyage.pos, SubCell::center);
        let end = super::line_pilot::unfolded(width, map.wrap_x, origin, centre);
        let leg = super::line_pilot::Leg::new(origin, end);
        let Some(fine) = input.defs.fine_coast.as_deref() else {
            let target = SubCell { x: voyage.pos.x + dx, y: centre.y };
            let steer = self.toward(voyage, weather, minute, target, leg);
            return if matches!(steer, Steer::Blocked) && input.defs.rules.autopilot.creep_speed > 0 {
                self.wait(voyage, minute, target)
            } else {
                steer
            };
        };

        // ── 有细海岸 ──
        // 1. 去向：直线能到下一格格心就对准格心；被细层的陆挡住就在窗口里找路，对准路上直线看得见的最远一点。
        let access = SweepAccess { known: self.known, only_port: voyage.autopilot, passes: self.passes };
        let cur = voyage.pos.cell();
        if !self.window.as_ref().is_some_and(|w| w.matches(cur, next)) {
            self.window = None;
        }
        let window =
            self.window.get_or_insert_with(|| FineWindow::build(map, fine, cur, next, |c| access.navigable(input, c)));
        let (ax, ay) = match window.aim(voyage.pos) {
            Aim::Open | Aim::Centre => (dx, dy),
            Aim::Via(via) => (via[0], via[1]),
            Aim::Blocked => {
                self.blocked += 1;
                if input.defs.rules.autopilot.creep_speed <= 0 {
                    return Steer::Blocked;
                }
                // 窗口找不到整段通路，仍按同一分钟的碰撞检查试前进、慢行与离岸舵。
                (dx, dy)
            }
        };
        let target = SubCell { x: voyage.pos.x + ax, y: voyage.pos.y + ay };

        let steer = self.toward(voyage, weather, minute, target, leg);
        if matches!(steer, Steer::Blocked) && input.defs.rules.autopilot.creep_speed > 0 {
            self.wait(voyage, minute, target)
        } else {
            steer
        }
    }

    fn toward(
        &mut self,
        voyage: &mut ManualVoyage,
        weather: Option<crate::weather::DayWeather>,
        minute: u16,
        target: SubCell,
        leg: super::line_pilot::Leg,
    ) -> Steer {
        let input = self.input;
        let access = SweepAccess { known: self.known, only_port: voyage.autopilot, passes: self.passes };
        let (ax, ay) = (target.x - voyage.pos.x, target.y - voyage.pos.y);
        // 2. 选舵：排位与没有细图层时相同。
        let before = (voyage.heading, voyage.sail);
        let rules = &input.defs.rules.autopilot;
        let now = u64::from(input.day) * 1440 + u64::from(minute);
        let Some(pilot) = voyage.pilot.as_ref() else { return Steer::Done };
        let step = pilot.step;
        let motion = pilot.motion();
        let mut hold = pilot.helm_hold;
        let resume_sail = motion.map_or(Sail::Full, |m| m.sail);
        // 帆行照旧由领航升满帆；离开慢行的这一分钟恢复进入前的帆位。
        let sail = if rules.creep_speed > 0 && motion.is_some_and(|m| m.mode != PilotMode::Sail) {
            resume_sail
        } else {
            Sail::Full
        };
        voyage.sail = if sail == Sail::Furled { Sail::Full } else { sail };
        let sail = voyage.sail;
        let distance = (i128::from(ax).pow(2) + i128::from(ay).pow(2)) as u128;
        let length = distance.isqrt().max(1) as i128;
        let progress = |v: [i64; 2]| (i128::from(v[0]) * i128::from(ax) + i128::from(v[1]) * i128::from(ay)) / length;
        let vectors = *self.cache.vectors(voyage, weather);
        let ranks = || vectors.iter().enumerate().filter_map(|(h, v)| rank(h, *v, ax, ay));
        // 先在快于慢行的帆舵里按原角度次序选；不能因顺流的慢舵恰好对准目标而漏掉更快的帆舵。
        let fast = |r: Rank| {
            let speed = progress(vectors[usize::from(r.2)]);
            if motion.is_some_and(|m| m.mode == PilotMode::Creep) {
                speed * 100 > i128::from(rules.creep_speed) * (100 + i128::from(rules.switch_gain_pct))
            } else {
                speed >= i128::from(rules.creep_speed)
            }
        };
        let first = ranks().filter(|r| fast(*r)).min().or_else(|| ranks().min());
        let attempt = |voyage: &mut ManualVoyage, heading: u16| {
            voyage.heading = heading;
            let v = super::course::velocity_at(input, voyage, weather, minute);
            (!super::course::minute_blocked(input, voyage, v, target, access)).then_some(v)
        };
        let mut aligned_sail = None;
        if rules.beat_angle_deg > 0
            && let Some(best) = beat_rank(&vectors, ax, ay, rules.creep_speed)
        {
            let heading = aim_heading(ax, ay);
            let water_angle = super::course::angle_between(best.2, heading);
            let selected = first.map_or(vectors[usize::from(best.2)], |r| vectors[usize::from(r.2)]);
            let track_angle = super::course::angle_between(aim_heading(selected[0], selected[1]), heading);
            let current = super::course::current_velocity(input, voyage.pos, weather);
            if water_angle <= rules.beat_angle_deg {
                // 舵向接近目标不代表对地航迹接近；先试真实帆舵抵流，避免帆行和慢行来回抢控制。
                let (_, _, sail_heading) = aligned_velocity(&vectors, voyage.pos, target, current);
                aligned_sail = sail_heading.and_then(|h| {
                    attempt(voyage, h)
                        .filter(|v| {
                            progress(*v) >= i128::from(rules.creep_speed)
                                && super::course::angle_between(aim_heading(v[0], v[1]), heading) <= 1
                        })
                        .map(|v| (h, v))
                });
            }
            let angle = if aligned_sail.is_some() { water_angle } else { water_angle.max(track_angle) };
            let held = motion.is_some_and(|m| now.saturating_sub(m.since) < u64::from(rules.hold_minutes));
            // 进入按原门槛；离开须回到回差内且已有可贴线的帆舵，不能交回仍会横漂的方向。
            let beating = if motion.is_some_and(|m| m.mode == PilotMode::Beat) {
                held || aligned_sail.is_none()
                    || u32::from(angle) * (100 + u32::from(rules.switch_gain_pct))
                        > u32::from(rules.beat_angle_deg) * 100
            } else {
                aligned_sail.is_none() || angle > rules.beat_angle_deg
            };
            if beating {
                let (velocity, net_progress, _) =
                    aligned_velocity(self.cache.beat_vectors(voyage, weather), voyage.pos, target, current);
                let creep = creep_velocity(voyage.pos, target, rules.creep_speed);
                let can_creep =
                    rules.creep_speed > 0 && !super::course::minute_blocked(input, voyage, creep, target, access);
                let keep_creep = motion.filter(|m| m.mode == PilotMode::Creep).is_some_and(|m| {
                    now.saturating_sub(m.since) < u64::from(rules.hold_minutes)
                        || net_progress * 100
                            <= i128::from(rules.creep_speed) * (100 + i128::from(rules.switch_gain_pct))
                });
                if can_creep && (keep_creep || net_progress < i128::from(rules.creep_speed)) {
                    return self.creep(voyage, minute, target, resume_sail, creep);
                }
                if !super::course::minute_blocked(input, voyage, velocity, target, access) {
                    voyage.heading = heading;
                    self.set_mode(voyage, PilotMode::Beat, minute, target, sail);
                    return Steer::Toward { target, velocity: Some(velocity) };
                }
                self.shore_avoided += 1;
            }
        }
        let mut selected = aligned_sail.or_else(|| {
            first.and_then(|r| {
                attempt(voyage, r.2).filter(|v| rank(usize::from(r.2), *v, ax, ay).is_some()).map(|v| (r.2, v))
            })
        });
        if selected.is_none() && first.is_some() {
            self.shore_avoided += 1;
            self.ranked.clear();
            self.ranked.extend(
                vectors.iter().enumerate().filter_map(|(h, v)| rank(h, *v, ax, ay)).filter(|r| Some(*r) != first),
            );
            self.ranked.sort_unstable_by_key(|r| (!fast(*r), *r));
            for &(_, _, heading) in &self.ranked {
                if let Some(v) = attempt(voyage, heading).filter(|v| rank(usize::from(heading), *v, ax, ay).is_some()) {
                    selected = Some((heading, v));
                    break;
                }
            }
        }
        let creep = creep_velocity(voyage.pos, target, rules.creep_speed);
        let can_creep = rules.creep_speed > 0 && !super::course::minute_blocked(input, voyage, creep, target, access);
        let wants_creep = |velocity: Option<[i64; 2]>| {
            let keep = motion.filter(|m| m.mode == PilotMode::Creep).is_some_and(|m| {
                now.saturating_sub(m.since) < u64::from(rules.hold_minutes)
                    || velocity.is_none_or(|v| {
                        progress(v) * 100 <= i128::from(rules.creep_speed) * (100 + i128::from(rules.switch_gain_pct))
                    })
            });
            can_creep && (keep || velocity.is_none_or(|v| progress(v) < i128::from(rules.creep_speed)))
        };
        let wind = weather.map(|w| (u16::from(w.sea.wind_dir) * 45 + 180) % 360);
        let side = |heading| {
            wind.map_or(0, |wind| ((i32::from(heading) - i32::from(wind) + 180).rem_euclid(360) - 180).signum() as i8)
        };
        // 速度 0 保留原来的稳舵与退路保持（经典世界、修复前对照）；开慢行时只保持正向帆舵。
        let challenger =
            if rules.creep_speed > 0 { selected.and_then(|(h, v)| rank(usize::from(h), v, ax, ay)) } else { first };
        let mut retained = None;
        if let Some(challenger) = challenger {
            voyage.heading = before.0;
            if let Some(held) = &mut hold {
                let shifted = held.wind_day != input.day
                    && held
                        .wind_dir
                        .zip(wind)
                        .is_some_and(|(a, b)| super::course::angle_between(a, b) > rules.wind_shift_deg);
                held.wind_day = input.day;
                held.wind_dir = wind;
                held.tack_side = side(before.0);
                let width = i64::from(input.defs.map.width) * 256;
                let wrap = input.defs.map.wrap_x;
                let pos = super::line_pilot::unfolded(width, wrap, held.aim_from, voyage.pos);
                let reached = i128::from(pos.x - held.aim.x) * i128::from(held.aim.x - held.aim_from.x)
                    + i128::from(pos.y - held.aim.y) * i128::from(held.aim.y - held.aim_from.y)
                    >= 0;
                let current_velocity = super::course::velocity_at(input, voyage, weather, minute);
                let current = rank(usize::from(before.0), current_velocity, ax, ay);
                let tack = held.tack_side != 0 && side(challenger.2) != 0 && held.tack_side != side(challenger.2);
                let minimum = if tack { rules.tack_hold_minutes.max(rules.hold_minutes) } else { rules.hold_minutes };
                let score = |r: Rank| (r.1).0 * 1_000_000 / (1_000_000 + r.0);
                let better = current
                    .is_none_or(|c| score(challenger) * 100 > score(c) * (100 + i128::from(rules.switch_gain_pct)));
                let next = SubCell {
                    x: voyage.pos.x
                        + (voyage.remainder[0] + current_velocity[0] * 256).div_euclid(super::course::REMAINDER_SCALE),
                    y: voyage.pos.y
                        + (voyage.remainder[1] + current_velocity[1] * 256).div_euclid(super::course::REMAINDER_SCALE),
                };
                let pos = super::line_pilot::unfolded(width, wrap, leg.a, voyage.pos);
                let next = super::line_pilot::unfolded(width, wrap, pos, next);
                let safe = (rules.creep_speed <= 0 || current.is_some())
                    && (aligned_sail.is_none() || current.is_some_and(|c| c.0 <= challenger.0))
                    && (!can_creep || progress(current_velocity) >= i128::from(rules.creep_speed))
                    && !leg.leaving_corridor(pos, next, rules.corridor)
                    && !super::course::minute_blocked(input, voyage, current_velocity, target, access);
                if held.step == step
                    && !reached
                    && !shifted
                    && safe
                    && (now.saturating_sub(held.since) < u64::from(minimum) || !better)
                {
                    selected = Some((before.0, current_velocity));
                    retained = Some(*held);
                }
            }
        }
        if let Some(chosen) = selected {
            if wants_creep(Some(chosen.1)) {
                return self.creep(voyage, minute, target, resume_sail, creep);
            }
            voyage.heading = chosen.0;
            self.set_mode(voyage, PilotMode::Sail, minute, target, sail);
            if let Some(pilot) = &mut voyage.pilot {
                pilot.helm_hold = Some(retained.unwrap_or(PilotHold {
                    step,
                    since: hold.filter(|_| chosen.0 == before.0).map_or(now, |h| h.since),
                    aim_from: voyage.pos,
                    aim: target,
                    tack_side: side(chosen.0),
                    wind_day: input.day,
                    wind_dir: wind,
                }));
            }
            return Steer::Toward { target, velocity: Some(chosen.1) };
        }
        if wants_creep(None) {
            return self.creep(voyage, minute, target, resume_sail, creep);
        }
        if first.is_none() && rules.creep_speed <= 0 {
            return self.wait(voyage, minute, target);
        }
        // 只有慢行也会撞岸，才离岸走一分钟；启用慢行时不记录退路舵的保持。
        self.backups.clear();
        self.backups.extend(vectors.iter().enumerate().filter_map(|(heading, v)| backup(heading, *v, ax, ay)));
        self.backups.sort_unstable();
        for &(_, heading) in &self.backups {
            if let Some(v) = attempt(voyage, heading) {
                self.backup_used += 1;
                self.set_mode(voyage, PilotMode::Sail, minute, target, sail);
                if let Some(pilot) = &mut voyage.pilot {
                    pilot.helm_hold = (rules.creep_speed <= 0).then_some(PilotHold {
                        step,
                        since: hold.filter(|_| heading == before.0).map_or(now, |h| h.since),
                        aim_from: voyage.pos,
                        aim: target,
                        tack_side: side(heading),
                        wind_day: input.day,
                        wind_dir: wind,
                    });
                }
                return Steer::Toward { target, velocity: Some(v) };
            }
        }
        (voyage.heading, voyage.sail) = before;
        if first.is_none() {
            return self.wait(voyage, minute, target);
        }
        self.blocked += 1;
        Steer::Blocked
    }

    fn creep(
        &mut self,
        voyage: &mut ManualVoyage,
        minute: u16,
        target: SubCell,
        sail: Sail,
        velocity: [i64; 2],
    ) -> Steer {
        let (ax, ay) = (target.x - voyage.pos.x, target.y - voyage.pos.y);
        voyage.heading = aim_heading(ax, ay);
        self.set_mode(voyage, PilotMode::Creep, minute, target, sail);
        voyage.sail = Sail::Furled;
        Steer::Toward { target, velocity: Some(velocity) }
    }

    fn set_mode(&mut self, voyage: &mut ManualVoyage, mode: PilotMode, minute: u16, aim: SubCell, sail: Sail) {
        let Some(pilot) = &mut voyage.pilot else { return };
        let previous = pilot.motion();
        let changed = pilot.mode() != mode;
        let since = previous
            .filter(|m| m.mode == mode)
            .map_or(u64::from(self.input.day) * 1440 + u64::from(minute), |m| m.since);
        let motion = PilotMotion { mode, since, sail, aim };
        if let Some(stored) = pilot.motion.as_deref_mut() {
            *stored = motion;
        } else {
            pilot.motion = Some(Box::new(motion));
        }
        if mode != PilotMode::Sail {
            pilot.helm_hold = None;
        }
        if changed && mode != PilotMode::Sail {
            self.mode_entries.push((mode, minute));
        }
    }

    fn wait(&mut self, voyage: &mut ManualVoyage, minute: u16, target: SubCell) -> Steer {
        let sail = voyage.pilot.as_ref().and_then(|p| p.motion()).map_or(voyage.sail, |m| m.sail);
        self.set_mode(voyage, PilotMode::Wait, minute, target, sail);
        voyage.sail = Sail::Furled;
        Steer::Toward { target, velocity: Some([0; 2]) }
    }
}

impl Helm<'_, '_> {
    fn steer_line(
        &mut self,
        voyage: &mut ManualVoyage,
        weather: Option<crate::weather::DayWeather>,
        minute: u16,
    ) -> Steer {
        let width = i64::from(self.input.defs.map.width) * 256;
        let wrap = self.input.defs.map.wrap_x;
        let Some(pilot) = voyage.pilot.as_mut() else { return Steer::Done };
        super::line_pilot::advance(pilot, voyage.pos, width, wrap);
        let Some(&cell) = pilot.path.get(pilot.step) else { return Steer::Done };
        let prev = super::line_pilot::previous(pilot);
        if pilot.line.as_ref().is_some_and(|l| l.hold.is_some()) {
            return self.steer_grid(voyage, weather, minute);
        }
        let Some(line) = pilot.line.as_ref() else { return Steer::Done };
        let a = prev.map_or(line.origin, |i| SubCell::center(pilot.path[i]));
        let b = super::line_pilot::unfolded(width, wrap, a, SubCell::center(cell));
        if !self.leg.is_some_and(|l| l.a == a && l.b == b) {
            self.leg = Some(super::line_pilot::Leg::new(a, b));
        }
        let Some(leg) = self.leg else { return Steer::Done };
        let lookahead = self.line_lookahead(voyage.pos, leg);
        let access = SweepAccess { known: self.known, only_port: voyage.autopilot, passes: self.passes };
        let Some(pilot) = voyage.pilot.as_ref() else { return Steer::Done };
        let radius = self.line_turn_radius();
        let mut target = super::line_pilot::path_aim(pilot, voyage.pos, width, wrap, lookahead, radius);
        if super::course::line_blocked(self.input, voyage.pos, target, access) {
            self.shore_avoided += 1;
            let visible = (0..lookahead)
                .rev()
                .map(|distance| {
                    super::line_pilot::path_aim(pilot, voyage.pos, width, wrap, distance, radius.min(distance))
                })
                .find(|&aim| aim != voyage.pos && !super::course::line_blocked(self.input, voyage.pos, aim, access));
            if let Some(aim) = visible {
                target = aim;
            } else {
                self.degraded += 1;
                if let Some(pilot) = &mut voyage.pilot {
                    super::line_pilot::degrade(pilot, voyage.pos, width, wrap);
                }
                return self.steer_grid(voyage, weather, minute);
            }
        }
        let steer = self.toward(voyage, weather, minute, target, leg);
        if matches!(steer, Steer::Blocked) {
            // 长段试走失败先回到原相邻路径；只有逐格也失败才交给积分器停船。
            self.degraded += 1;
            self.blocked -= 1;
            if let Some(pilot) = voyage.pilot.as_mut() {
                super::line_pilot::degrade(pilot, voyage.pos, width, wrap);
            }
            self.steer_grid(voyage, weather, minute)
        } else {
            steer
        }
    }
}

/// H10g：领航选定的这一舷及选定时刻；绝对分钟跨日连续，瞄准点只用于判断何时允许重选。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotHold {
    pub step: usize,
    pub since: u64,
    pub aim_from: SubCell,
    pub aim: SubCell,
    pub tack_side: i8,
    pub wind_day: u32,
    pub wind_dir: Option<u16>,
}

impl Helm<'_, '_> {
    fn line_turn_radius(&self) -> i64 {
        let minimum = self.input.defs.rules.autopilot.shore_lookahead_min;
        self.input.defs.fine_coast.as_ref().map_or(minimum, |fine| minimum.min(256 / i64::from(fine.sub())))
    }

    /// 前视随到折点的距离连续收短；有横偏时先捕获计划线，避免小分量被定点取整盖住。
    fn line_lookahead(&self, pos: SubCell, leg: super::line_pilot::Leg) -> i64 {
        let rules = &self.input.defs.rules.autopilot;
        let normal = rules.lookahead;
        let minimum = rules.shore_lookahead_min;
        if minimum == 0 {
            return normal;
        }
        let width = i64::from(self.input.defs.map.width) * 256;
        let pos = super::line_pilot::unfolded(width, self.input.defs.map.wrap_x, leg.a, pos);
        let u = [i128::from(leg.b.x - leg.a.x), i128::from(leg.b.y - leg.a.y)];
        let q = [i128::from(pos.x - leg.a.x), i128::from(pos.y - leg.a.y)];
        let len2 = u[0].pow(2) + u[1].pow(2);
        // 距离只向段内取整；用向上取整的段长作除数，不能让前视圆提前越过折点。
        let root = (len2 as u128).isqrt().max(1) as i128;
        let len = root + i128::from(root * root < len2);
        let dot = q[0] * u[0] + q[1] * u[1];
        let along = (dot / len).max(0) as i64;
        let remaining = ((len2 - dot) / len).max(0) as i64;
        // 折点处只提前一细格转弯；更大的圆会把小转角摊成定点坐标上的长直滑。
        let radius = self.line_turn_radius().max(1);
        let mut lookahead = normal.min(remaining.max(radius)).min(along.max(radius));
        let cross = (q[0] * u[1] - q[1] * u[0]).abs();
        if cross > 0 && along > 0 && remaining > radius {
            let offset = ((cross + len - 1) / len) as i64;
            lookahead = lookahead.min(offset * normal / minimum).max(offset + 1);
        }
        // 留六个定点单位作有效瞄准距离，另留一个单位给落格取整；避免一格量化变成超过 20 度的角跳。
        lookahead.max(7)
    }
}

/// H10h：模式与进入前帆位是领航状态，不另存一套航速规则。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PilotMode {
    #[default]
    Sail,
    Creep,
    Wait,
    Beat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotMotion {
    pub mode: PilotMode,
    pub since: u64,
    pub sail: Sail,
    pub aim: SubCell,
}

/// 朝瞄准点的保底向量；只用于自动领航，不叠加风流与帆行修正。
pub fn creep_velocity(pos: SubCell, aim: SubCell, speed: i64) -> [i64; 2] {
    let delta = [aim.x - pos.x, aim.y - pos.y];
    let length = ((i128::from(delta[0]).pow(2) + i128::from(delta[1]).pow(2)) as u128).isqrt().max(1) as i128;
    delta.map(|d| (i128::from(d) * i128::from(speed) / length) as i64)
}

pub(super) fn aim_heading(dx: i64, dy: i64) -> u16 {
    (0..360).filter_map(|h| rank(h, super::course::direction(h as u16), dx, dy)).min().map_or(0, |r| r.2)
}

pub(super) fn beat_rank(vectors: &[[i64; 2]], dx: i64, dy: i64, floor: i64) -> Option<Rank> {
    let length2 = i128::from(dx).pow(2) + i128::from(dy).pow(2);
    let ranks = || vectors.iter().enumerate().filter_map(|(h, &v)| rank(h, v, dx, dy));
    ranks()
        .filter(|r| floor <= 0 || (r.1).0.pow(2) >= i128::from(floor).pow(2) * length2)
        .min()
        .or_else(|| ranks().min())
}

pub(super) fn beat_candidate(
    pos: SubCell,
    aim: SubCell,
    best: [i64; 2],
    current: [i64; 2],
    efficiency: u16,
) -> ([i64; 2], i128) {
    let delta = [aim.x - pos.x, aim.y - pos.y];
    let length = ((i128::from(delta[0]).pow(2) + i128::from(delta[1]).pow(2)) as u128).isqrt().max(1) as i128;
    let dot = i128::from(best[0] - current[0]) * i128::from(delta[0])
        + i128::from(best[1] - current[1]) * i128::from(delta[1]);
    let speed = dot.max(0) * i128::from(efficiency) / (length * 100);
    (std::array::from_fn(|i| (i128::from(delta[i]) * speed / length) as i64 + current[i]), speed)
}

/// 对地曲线上找横向分量过零处，整数插值后贴回目标射线；无可行交点时取净推进最大的对水方向。
pub(super) fn aligned_velocity(
    vectors: &[[i64; 2]; 360],
    pos: SubCell,
    aim: SubCell,
    current: [i64; 2],
) -> ([i64; 2], i128, Option<u16>) {
    let d = [i128::from(aim.x - pos.x), i128::from(aim.y - pos.y)];
    let len2 = (d[0].pow(2) + d[1].pow(2)).max(1);
    let length = (len2 as u128).isqrt().max(1) as i128;
    let dot = |v: [i64; 2]| i128::from(v[0]) * d[0] + i128::from(v[1]) * d[1];
    let cross = |v: [i64; 2]| i128::from(v[0]) * d[1] - i128::from(v[1]) * d[0];
    let mut chosen = None;
    let mut best_dot = 0;
    for i in 0..360 {
        let a = vectors[i];
        let b = vectors[(i + 1) % 360];
        let (ca, cb) = (cross(a), cross(b));
        let candidate = if ca == 0 {
            Some((i as u16, a))
        } else if (ca < 0 && cb > 0) || (ca > 0 && cb < 0) {
            let den = ca.abs() + cb.abs();
            let h = ((i + usize::from(ca.abs() * 2 >= den)) % 360) as u16;
            Some((
                h,
                std::array::from_fn(|j| ((i128::from(a[j]) * cb.abs() + i128::from(b[j]) * ca.abs()) / den) as i64),
            ))
        } else {
            None
        };
        if let Some((heading, v)) = candidate {
            let progress = dot(v);
            if progress > best_dot {
                best_dot = progress;
                chosen = Some((heading, std::array::from_fn(|j| (d[j] * progress / len2) as i64)));
            }
        }
    }
    let heading = chosen.map(|(h, _)| h);
    let velocity =
        chosen.map_or_else(|| vectors.iter().copied().max_by_key(|&v| dot(v)).unwrap_or(current), |(_, v)| v);
    let progress = dot(velocity) / length;
    // 门槛仍看对水速度；抵横流的那部分也是推进，逆流时另受实际净推进约束。
    let water = [i128::from(velocity[0] - current[0]), i128::from(velocity[1] - current[1])];
    let propulsion = ((water[0].pow(2) + water[1].pow(2)) as u128).isqrt() as i128;
    (velocity, progress.min(propulsion), heading)
}

/// 航行视图重算当分钟的抢风速度，与选舵共用排位和折算；不读上一分钟的舵向。
pub fn beat_velocity(
    input: &super::course::CourseInput<'_>,
    voyage: &ManualVoyage,
    weather: Option<crate::weather::DayWeather>,
) -> [i64; 2] {
    let Some(motion) = voyage.pilot.as_ref().and_then(|p| p.motion()) else { return [0; 2] };
    let mut cache = SteeringCache::new(input);
    let current = super::course::current_velocity(input, voyage.pos, weather);
    aligned_velocity(cache.beat_vectors(voyage, weather), voyage.pos, motion.aim, current).0
}

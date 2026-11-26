//! H10b：已知海域中的整数视线拉直；预算、遍历顺序和退化都只由输入决定。
use super::SubCell;
use super::autopilot::Pilot;
use super::routing::{RoutePref, TimeModel};
use crate::nav::FineKind;
use crate::world::Fleet;
use crate::{Cell, World};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AutopilotRules {
    pub straighten: bool,
    pub max_leg: u16,
    pub clearance: u8,
    pub lookahead: i64,
    pub budget: u64,
    /// H10b2：实际三日天气估时允许比原折线慢的百分比；0 保留旧数据的行为。
    #[serde(skip_serializing_if = "is_zero")]
    pub weather_slack_pct: u16,
    /// 转弯前视半径上限（1/256 格，实取不超过一细格）；0 保留固定前视。横偏捕获还可收短。
    #[serde(skip_serializing_if = "is_zero")]
    pub shore_lookahead_min: i64,
    /// H10g：普通改舵与换舷的最短保持分钟数。
    pub hold_minutes: u16,
    pub tack_hold_minutes: u16,
    pub switch_gain_pct: u16,
    /// 计划线两侧的走廊半宽，单位 1/256 格。
    pub corridor: u16,
    pub wind_shift_deg: u16,
    /// H10h：自动领航的保底速度（万分之一格/天）；经典世界缺省关闭。
    #[serde(skip_serializing_if = "is_zero")]
    pub creep_speed: i64,
    /// 自动领航粮水提醒的剩余完整天数；0 不提醒。
    #[serde(skip_serializing_if = "is_zero")]
    pub supplies_stop_days: u16,
    /// H10i：最佳帆舵偏离瞄准方位超过此角度时，按净推进抢风；0 保留经典世界。
    #[serde(skip_serializing_if = "is_zero")]
    pub beat_angle_deg: u16,
    /// 抢风的对水推进折算百分比。
    #[serde(skip_serializing_if = "is_full_pct")]
    pub beat_efficiency_pct: u16,
}

impl Default for AutopilotRules {
    fn default() -> Self {
        Self {
            straighten: false,
            max_leg: 48,
            clearance: 1,
            lookahead: 256,
            budget: 4_000_000,
            weather_slack_pct: 0,
            shore_lookahead_min: 0,
            hold_minutes: 30,
            tack_hold_minutes: 120,
            switch_gain_pct: 20,
            corridor: 256,
            wind_shift_deg: 30,
            creep_speed: 0,
            supplies_stop_days: 0,
            beat_angle_deg: 0,
            beat_efficiency_pct: 100,
        }
    }
}

impl Leg {
    /// 已在走廊外但朝内回归时可以稳舵；继续向外偏才必须立即重选。
    pub(super) fn leaving_corridor(&self, pos: SubCell, next: SubCell, corridor: u16) -> bool {
        let cross =
            |p: SubCell| (i128::from(p.x - self.a.x) * self.u[1] - i128::from(p.y - self.a.y) * self.u[0]).abs();
        let next_cross = cross(next);
        next_cross > cross(pos) && next_cross * next_cross > i128::from(corridor).pow(2) * self.len2
    }
}

impl AutopilotRules {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.straighten {
            return out;
        }
        if !(2..=128).contains(&self.max_leg) {
            out.push(("max_leg", "必须在 2 到 128 之间"));
        }
        if self.clearance > 4 {
            out.push(("clearance", "必须在 0 到 4 之间"));
        }
        if !(64..=1024).contains(&self.lookahead) {
            out.push(("lookahead", "必须在 64 到 1024 之间"));
        }
        if self.budget < 100_000 {
            out.push(("budget", "不得小于 100000"));
        }
        if self.weather_slack_pct > 100 {
            out.push(("weather_slack_pct", "必须在 0 到 100 之间（0 关闭实际天气护栏）"));
        }
        if self.shore_lookahead_min != 0 && !(16..=self.lookahead).contains(&self.shore_lookahead_min) {
            out.push(("shore_lookahead_min", "必须为 0（关闭）或在 16 到 lookahead 之间"));
        }
        out
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PilotLine {
    /// 原相邻路径里的拐点下标，末项是路径末项。
    pub corners: Vec<u32>,
    pub origin: SubCell,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<u32>,
}

impl PilotLine {
    pub(super) fn valid(&self, pilot: &Pilot, world: &World) -> bool {
        self.corners.last().is_some_and(|&c| c as usize == pilot.path.len() - 1)
            && self.corners.windows(2).all(|p| p[0] < p[1])
            && self.corners.iter().all(|&c| (c as usize) < pilot.path.len())
            && match self.hold {
                Some(c) => self.corners.contains(&c) && pilot.step <= c as usize,
                None => self.corners.contains(&(pilot.step as u32)),
            }
            && self.origin.x >= 0
            && self.origin.y >= 0
            && self.origin.x < i64::from(world.defs.map.width) * 256
            && self.origin.y < i64::from(world.defs.map.height) * 256
    }
}

/// 只供报告量数，不进入世界状态或存档。
#[derive(Clone, Debug, Default)]
pub struct StraightenStats {
    pub coarse_lookups: u64,
    pub fine_lookups: u64,
    pub candidates: u64,
    pub exhausted: bool,
    pub weather_rejections: Vec<WeatherRejection>,
}

/// 只供诊断的被拒候选弦；原路径和存档均不增加字段。
#[derive(Clone, Debug, Serialize)]
pub struct WeatherRejection {
    pub start: usize,
    pub end: usize,
    pub reason: &'static str,
    pub chord_minutes: [i64; 3],
    pub path_minutes: [i64; 3],
}

/// DDA 的进出参数使用同一个分母；过角时额外返回两个零长度侧格。
#[derive(Clone, Copy, Debug)]
pub(crate) struct Span {
    pub x: i64,
    pub y: i64,
    pub enter: i128,
    pub exit: i128,
    pub den: i128,
}

/// 坐标单位为 1/256 个目标格。粗格、细格与航时加权共用此遍历。
pub(crate) fn spans(a: SubCell, b: SubCell, corner_margin: i64) -> Vec<Span> {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let (ax, ay) = (i128::from(dx.abs()), i128::from(dy.abs()));
    let den = (ax.max(1) * ay.max(1)).max(1);
    let (sx, sy) = (dx.signum(), dy.signum());
    let (mut x, mut y) = (a.x.div_euclid(256), a.y.div_euclid(256));
    let (ex, ey) = (b.x.div_euclid(256), b.y.div_euclid(256));
    let mut at = 0;
    let mut out = Vec::new();
    loop {
        let tx = if sx == 0 { i128::MAX } else { i128::from(((x + i64::from(sx > 0)) * 256 - a.x).abs()) * ay.max(1) };
        let ty = if sy == 0 { i128::MAX } else { i128::from(((y + i64::from(sy > 0)) * 256 - a.y).abs()) * ax.max(1) };
        let end = tx.min(ty).min(den);
        out.push(Span { x, y, enter: at, exit: end, den });
        if x == ex && y == ey {
            break;
        }
        // 粗格角附近也查两侧，给逐 1/256 格扫掠的取整留余地。
        if sx != 0 && sy != 0 && (tx - ty).abs() <= i128::from(corner_margin) * ax.max(ay) {
            out.push(Span { x: x + sx, y, enter: end, exit: end, den });
            out.push(Span { x, y: y + sy, enter: end, exit: end, den });
        }
        if tx <= ty {
            x += sx;
        }
        if ty <= tx {
            y += sy;
        }
        at = end;
        if at >= den {
            if (x, y) != (ex, ey) {
                break;
            }
            out.push(Span { x, y, enter: den, exit: den, den });
            break;
        }
    }
    out
}

pub(crate) fn unfolded(world_width: i64, wrap: bool, a: SubCell, b: SubCell) -> SubCell {
    let mut dx = b.x - a.x;
    if wrap {
        dx = (dx + world_width / 2).rem_euclid(world_width) - world_width / 2;
    }
    SubCell { x: a.x + dx, y: b.y }
}

struct Visibility<'a> {
    world: &'a World,
    stats: StraightenStats,
    passes: std::collections::BTreeSet<String>,
    allowed_cache: Vec<u8>,
    open_cache: Vec<u8>,
}

impl Visibility<'_> {
    fn allowed(&mut self, x: i64, y: i64) -> Option<Cell> {
        let w = self.world;
        let c = if x >= 0 && y >= 0 && x < i64::from(w.defs.map.width) && y < i64::from(w.defs.map.height) {
            Cell::new(x as u16, y as u16)
        } else {
            w.defs.map.topology().normalize(x, y)?
        };
        let index = w.defs.map.idx(c);
        if self.allowed_cache[index] == 0 {
            self.stats.coarse_lookups += 1;
            let allowed = w.defs.map.is_sea_in_bounds(c)
                && w.state.explore.is_revealed(index)
                && w.defs.nav.grid.check_cell(w.defs.nav.grid.period_on(w.day()), c).is_ok()
                && w.defs.realms.at(&w.defs, c).is_none_or(|r| self.passes.contains(&r.key));
            self.allowed_cache[index] = if allowed { 1 } else { 2 };
        }
        (self.allowed_cache[index] == 1).then_some(c)
    }

    fn water(&mut self, x: i64, y: i64) -> bool {
        let Some(fine) = self.world.defs.fine_coast.as_ref() else { return false };
        let sub = i64::from(fine.sub());
        let (cx, cy) = (x.div_euclid(sub), y.div_euclid(sub));
        self.water_parts(cx, cy, x - cx * sub, y - cy * sub)
    }

    /// 邻域复用中心格的商与余数；跨边时只调整一小段，不重复做整图坐标除法。
    fn water_parts(&mut self, mut cx: i64, mut cy: i64, mut fx: i64, mut fy: i64) -> bool {
        if self.stats.fine_lookups >= self.world.defs.rules.autopilot.budget {
            self.stats.exhausted = true;
            return false;
        }
        let Some(fine) = self.world.defs.fine_coast.as_ref() else { return false };
        let sub = i64::from(fine.sub());
        while fx < 0 {
            cx -= 1;
            fx += sub;
        }
        while fx >= sub {
            cx += 1;
            fx -= sub;
        }
        while fy < 0 {
            cy -= 1;
            fy += sub;
        }
        while fy >= sub {
            cy += 1;
            fy -= sub;
        }
        let Some(c) = self.allowed(cx, cy) else { return false };
        self.stats.fine_lookups += 1;
        fine.water(c, fx as u16, fy as u16)
    }

    fn clear(&mut self, a: SubCell, b: SubCell, port: Option<Cell>) -> bool {
        let Some(fine) = self.world.defs.fine_coast.as_ref() else { return false };
        let map = &self.world.defs.map;
        let topology = map.topology();
        let sub = i64::from(fine.sub());
        let clearance = i64::from(self.world.defs.rules.autopilot.clearance);
        let coarse = spans(a, b, 2);
        let port_entry = port
            .and_then(|port| coarse.iter().find(|s| s.exit > s.enter && topology.normalize(s.x, s.y) == Some(port)));
        let limit = port_entry.map_or(coarse.first().map_or(1, |s| s.den), |s| s.enter);
        let mut previous_fine: Option<(i64, i64)> = None;
        for s in &coarse {
            if s.enter > limit {
                continue;
            }
            let Some(c) = self.allowed(s.x, s.y) else { return false };
            if port == Some(c) && s.enter == limit {
                continue;
            }
            let index = map.idx(c);
            if self.open_cache[index] == 0 {
                let open = (-1..=1).all(|dy| {
                    (-1..=1).all(|dx| {
                        topology.normalize(s.x + dx, s.y + dy).is_some_and(|n| fine.kind(n) == FineKind::Water)
                    })
                });
                self.open_cache[index] = if open { 1 } else { 2 };
            }
            let open = self.open_cache[index] == 1;
            if open {
                continue;
            }
            let point = |t: i128| SubCell {
                x: ((i128::from(a.x) * s.den + i128::from(b.x - a.x) * t) * i128::from(sub)).div_euclid(s.den) as i64,
                y: ((i128::from(a.y) * s.den + i128::from(b.y - a.y) * t) * i128::from(sub)).div_euclid(s.den) as i64,
            };
            for f in spans(point(s.enter), point(s.exit.min(limit)), 0) {
                let (cx, cy) = (f.x.div_euclid(sub), f.y.div_euclid(sub));
                let (fx, fy) = (f.x - cx * sub, f.y - cy * sub);
                for oy in -clearance..=clearance {
                    for ox in -clearance..=clearance {
                        // 相邻细格的净空方块重叠；上一步已通过的水与通行权不用重查。
                        if previous_fine.is_some_and(|(x, y)| {
                            (f.x + ox - x).abs() <= clearance && (f.y + oy - y).abs() <= clearance
                        }) {
                            continue;
                        }
                        if !self.water_parts(cx, cy, fx + ox, fy + oy) {
                            return false;
                        }
                    }
                }
                previous_fine = Some((f.x, f.y));
            }
        }
        // 进港前截断细查，入口本身仍必须是水（积分器先碰撞，再认靠港）。
        if let Some(s) = port_entry {
            let x =
                ((i128::from(a.x) * s.den + i128::from(b.x - a.x) * limit) * i128::from(sub)).div_euclid(s.den) as i64;
            let y =
                ((i128::from(a.y) * s.den + i128::from(b.y - a.y) * limit) * i128::from(sub)).div_euclid(s.den) as i64;
            if !self.water(x, y) {
                return false;
            }
        }
        true
    }
}

impl World {
    pub fn straighten(&self, fleet: &Fleet, origin: SubCell, pilot: &Pilot, pref: RoutePref) -> Option<PilotLine> {
        self.straighten_measured(fleet, origin, pilot, pref).0
    }

    /// 与正式下令共用算法；报告另外读取计数，不改变领航格式。
    pub fn straighten_measured(
        &self,
        fleet: &Fleet,
        origin: SubCell,
        pilot: &Pilot,
        pref: RoutePref,
    ) -> (Option<PilotLine>, StraightenStats) {
        let rules = &self.defs.rules.autopilot;
        if !rules.straighten
            || fleet.owner != crate::OwnerId::Player
            || self.defs.fine_coast.is_none()
            || pilot.path.len() <= 2
        {
            return (None, StraightenStats::default());
        }
        let mut visibility = Visibility {
            world: self,
            stats: Default::default(),
            passes: self.realm_passes(fleet.owner),
            allowed_cache: vec![0; self.defs.map.terrain.len()],
            open_cache: vec![0; self.defs.map.terrain.len()],
        };
        let mut model = pref.timed().then(|| TimeModel::new(self, fleet, self.day(), pref));
        let mut costs = vec![0i64; pilot.path.len()];
        if let Some(model) = model.as_mut() {
            for i in 1..pilot.path.len() {
                let dir = self.defs.map.topology().dir_between(pilot.path[i - 1], pilot.path[i]);
                costs[i] = costs[i - 1].saturating_add(model.step_cost(pilot.path[i], dir));
            }
        }
        let (mut a, mut start) = (0, origin);
        let mut corners = Vec::new();
        let last = pilot.path.len() - 1;
        let weather_start = super::ManualVoyage::new(origin.cell(), 0);
        let mut weather = (rules.weather_slack_pct > 0).then(|| WeatherModel::new(self, fleet, &weather_start));
        let mut weather_costs = vec![[0i64; 3]; pilot.path.len()];
        if let Some(weather) = weather.as_mut() {
            for i in 1..pilot.path.len() {
                let from = if i == 1 { origin } else { SubCell::center(pilot.path[i - 1]) };
                let to = unfolded(
                    i64::from(self.defs.map.width) * 256,
                    self.defs.map.wrap_x,
                    from,
                    SubCell::center(pilot.path[i]),
                );
                let previous = weather_costs[i - 1];
                weather_costs[i] =
                    std::array::from_fn(|day| previous[day].saturating_add(weather.minutes(from, to, day)));
            }
        }
        loop {
            let mut best = a + 1;
            for j in a + 2..=(a + usize::from(rules.max_leg)).min(last) {
                visibility.stats.candidates += 1;
                let end = unfolded(
                    i64::from(self.defs.map.width) * 256,
                    self.defs.map.wrap_x,
                    start,
                    SubCell::center(pilot.path[j]),
                );
                if !visibility.clear(start, end, (!pilot.edge && j == last).then_some(pilot.path[j])) {
                    break;
                }
                if model.as_mut().is_some_and(|m| m.chord_cost(start, end) > costs[j] - costs[a]) {
                    break;
                }
                best = j;
            }
            // 净空与气候条件先照旧选出最长候选，再从长到短检查实际天气；不改 A* 或其代价。
            if let Some(weather) = weather.as_mut() {
                while best > a + 1 {
                    let end = unfolded(
                        i64::from(self.defs.map.width) * 256,
                        self.defs.map.wrap_x,
                        start,
                        SubCell::center(pilot.path[best]),
                    );
                    let chord_minutes = std::array::from_fn(|day| weather.minutes(start, end, day));
                    let path_minutes = std::array::from_fn(|day| weather_costs[best][day] - weather_costs[a][day]);
                    if (0..3).all(|day| {
                        i128::from(chord_minutes[day]) * 100
                            <= i128::from(path_minutes[day]) * (100 + i128::from(rules.weather_slack_pct))
                    }) {
                        break;
                    }
                    visibility.stats.weather_rejections.push(WeatherRejection {
                        start: a,
                        end: best,
                        reason: "actual_weather",
                        chord_minutes,
                        path_minutes,
                    });
                    best -= 1;
                }
            }
            corners.push(best as u32);
            if best == last {
                break;
            }
            a = best;
            start = SubCell::center(pilot.path[a]);
            if visibility.stats.exhausted {
                corners.extend((a + 1..=last).map(|i| i as u32));
                break;
            }
        }
        (Some(PilotLine { corners, origin, hold: None }), visibility.stats)
    }
}

/// 已缓存的当前段几何量；船的位置与偏移不参与缓存。
#[derive(Clone, Copy)]
pub(super) struct Leg {
    pub a: SubCell,
    pub b: SubCell,
    u: [i128; 2],
    len2: i128,
}

impl Leg {
    pub(super) fn new(a: SubCell, b: SubCell) -> Self {
        let u = [i128::from(b.x - a.x), i128::from(b.y - a.y)];
        let len2 = u[0] * u[0] + u[1] * u[1];
        Self { a, b, u, len2 }
    }
}

/// 中间段在段末投影或角平分线交接；末点与退化段仍精确到格心，走到 hold 再切回拐点表。
pub(super) fn advance(pilot: &mut Pilot, pos: SubCell, width: i64, wrap: bool) {
    while pilot.step < pilot.path.len() {
        let Some(line) = pilot.line.as_ref() else { return };
        let b = unfolded(width, wrap, pos, SubCell::center(pilot.path[pilot.step]));
        let mut reached = pos == b;
        if line.hold.is_none() && pilot.step + 1 < pilot.path.len() {
            let a = previous(pilot).map_or(line.origin, |i| SubCell::center(pilot.path[i]));
            let a = unfolded(width, wrap, b, a);
            let next = line.corners.iter().find(|&&c| c as usize > pilot.step).copied();
            if let Some(next) = next {
                let c = unfolded(width, wrap, b, SubCell::center(pilot.path[next as usize]));
                let u = [i128::from(b.x - a.x), i128::from(b.y - a.y)];
                let v = [i128::from(c.x - b.x), i128::from(c.y - b.y)];
                let q = [i128::from(pos.x - b.x), i128::from(pos.y - b.y)];
                let along = q[0] * u[0] + q[1] * u[1];
                let next_along = q[0] * v[0] + q[1] * v[1];
                let cross = q[0] * u[1] - q[1] * u[0];
                let next_cross = q[0] * v[1] - q[1] * v[0];
                // 切弯时在两段的角平分线交接；不必先撞到格心再转回下一段。
                reached |= along >= 0
                    || (next_along > 0
                        && next_cross.pow(2) * (u[0].pow(2) + u[1].pow(2))
                            < cross.pow(2) * (v[0].pow(2) + v[1].pow(2)));
            }
        }
        if !reached {
            break;
        }
        let Some(line) = pilot.line.as_mut() else { return };
        if let Some(hold) = line.hold {
            if pilot.step < hold as usize {
                pilot.step += 1;
                continue;
            }
            line.hold = None;
        }
        pilot.step =
            line.corners.iter().copied().find(|&c| c as usize > pilot.step).map_or(pilot.path.len(), |c| c as usize);
    }
}

pub(super) fn previous(pilot: &Pilot) -> Option<usize> {
    pilot.line.as_ref()?.corners.iter().copied().take_while(|&c| (c as usize) < pilot.step).last().map(|c| c as usize)
}

pub(super) fn degrade(pilot: &mut Pilot, pos: SubCell, width: i64, wrap: bool) {
    let c = pilot.step;
    let a = previous(pilot).unwrap_or(0);
    let nearest = (a + 1..=c)
        .min_by_key(|&i| {
            let p = unfolded(width, wrap, pos, SubCell::center(pilot.path[i]));
            (i128::from(p.x - pos.x).pow(2) + i128::from(p.y - pos.y).pow(2), i)
        })
        .unwrap_or(c);
    if let Some(line) = pilot.line.as_mut() {
        line.hold = Some(c as u32);
    }
    pilot.step = nearest;
    advance(pilot, pos, width, wrap);
}

/// 瞄准沿计划线向前离开前视圆的交点；折点在圆内时自然前视下一段，交接时不会重置前视距离。
pub(super) fn path_aim(pilot: &Pilot, pos: SubCell, width: i64, wrap: bool, lookahead: i64, radius: i64) -> SubCell {
    let Some(line) = &pilot.line else { return pos };
    let index = line.corners.partition_point(|&i| (i as usize) < pilot.step);
    let point = |index: usize| {
        line.corners.get(index).map(|&i| unfolded(width, wrap, pos, SubCell::center(pilot.path[i as usize])))
    };
    let a = index.checked_sub(1).and_then(point).unwrap_or_else(|| unfolded(width, wrap, pos, line.origin));
    if let Some(b) = point(index) {
        if let Some(c) = point(index + 1)
            && let Some(aim) = corner_aim([a, b, c], pos, radius)
        {
            return aim;
        }
        if index > 0 {
            let before =
                index.checked_sub(2).and_then(point).unwrap_or_else(|| unfolded(width, wrap, pos, line.origin));
            if let Some(aim) = corner_aim([before, a, b], pos, radius) {
                return aim;
            }
        }
    }
    let mut a = previous(pilot).map_or(line.origin, |i| SubCell::center(pilot.path[i]));
    a = unfolded(width, wrap, pos, a);
    for &index in line.corners.iter().filter(|&&i| i as usize >= pilot.step) {
        let b = unfolded(width, wrap, a, SubCell::center(pilot.path[index as usize]));
        let leg = Leg::new(a, b);
        if leg.len2 > 0 {
            let q = [i128::from(pos.x - a.x), i128::from(pos.y - a.y)];
            let dot = q[0] * leg.u[0] + q[1] * leg.u[1];
            let cross = q[0] * leg.u[1] - q[1] * leg.u[0];
            let disc = i128::from(lookahead).pow(2) * leg.len2 - cross.pow(2);
            let along = if disc < 0 { dot.clamp(0, leg.len2) } else { dot + (disc as u128).isqrt() as i128 };
            if along <= leg.len2 {
                let along = along.max(0);
                // 对最近的定点坐标取整，避免短前视时两个分量截断的偏差反复改变方位。
                let offset = |axis: usize| {
                    let n = leg.u[axis] * along;
                    (n.signum() * ((n.abs() + leg.len2 / 2) / leg.len2)) as i64
                };
                return SubCell { x: a.x + offset(0), y: a.y + offset(1) };
            }
        }
        a = b;
    }
    a
}

/// 折点附近按角平分线上的连续里程前视；跨段前后用同一坐标，避免前视圆反复进出锐角。
fn corner_aim([a, b, c]: [SubCell; 3], pos: SubCell, radius: i64) -> Option<SubCell> {
    let q = [i128::from(pos.x - b.x), i128::from(pos.y - b.y)];
    if radius <= 0 {
        return None;
    }
    let u = [i128::from(b.x - a.x), i128::from(b.y - a.y)];
    let v = [i128::from(c.x - b.x), i128::from(c.y - b.y)];
    let length = |d: [i128; 2]| {
        let square = d[0].pow(2) + d[1].pow(2);
        let root = (square as u128).isqrt() as i128;
        root + i128::from(root * root < square)
    };
    let (lu, lv) = (length(u), length(v));
    let den = lu * lv + u[0] * v[0] + u[1] * v[1];
    if den <= 0 {
        return None;
    }
    // 锐角的角平分线坐标变化更快，前视按同一比例伸长，不能把一次计划转弯挤进几次落格。
    let scale = (lu * lv).max(den);
    let reach = i128::from(radius) * scale / den;
    if q[0].pow(2) + q[1].pow(2) > (2 * reach).pow(2) {
        return None;
    }
    let station = (q[0] * (u[0] * lv + v[0] * lu) + q[1] * (u[1] * lv + v[1] * lu)) / den;
    // 局部前视不随当前段的横偏收缩；折点两侧因此使用同一个尺度，岸阻回收另传较小的半径。
    let ahead = station + reach;
    let (d, distance, len) = if ahead < 0 { (u, ahead.max(-lu), lu) } else { (v, ahead.min(lv), lv) };
    let offset = |axis: usize| {
        let n = d[axis] * distance;
        (n.signum() * ((n.abs() + len / 2) / len)) as i64
    };
    Some(SubCell { x: b.x + offset(0), y: b.y + offset(1) })
}

impl World {
    /// H10b：目标使用 1/256 格，沿积分器的速度向量选舵；命令仍写成原有 Steer，回放不依赖界面。
    pub fn steering_toward(
        &self,
        fleet: crate::FleetId,
        target: SubCell,
        minute: u16,
        sail: Option<super::Sail>,
    ) -> Result<super::Steering, crate::CommandError> {
        let f = self.fleet(fleet)?;
        if f.owner != crate::OwnerId::Player {
            return Err(crate::CommandError::NotOwner);
        }
        let map = &self.defs.map;
        if target.y < 0
            || target.y >= i64::from(map.height) * 256
            || target.x < 0
            || target.x >= i64::from(map.width) * 256
        {
            return Err(crate::CommandError::OutOfRange("navigation.target".into()));
        }
        let start = self.preview_course_until(fleet, &[], minute, minute)?.voyage;
        let target = unfolded(i64::from(map.width) * 256, map.wrap_x, start.pos, target);
        let (dx, dy) = (target.x - start.pos.x, target.y - start.pos.y);
        if dx == 0 && dy == 0 {
            return Err(crate::CommandError::InvalidQuantity);
        }
        let input = super::course::CourseInput {
            defs: &self.defs,
            fleet: f,
            start: &start,
            from: minute,
            until: minute,
            steers: &[],
            day: self.day(),
            speed_bonus: self.fleet_speed_bonus(fleet),
            mods: self.voyage_mods(fleet),
        };
        let weather = self.weather_at_pos(start.pos.cell());
        let mut probe = start.clone();
        probe.sail = sail.unwrap_or(start.sail);
        // 收帆时仍可先定舵；用满帆的假想向量确定方向，不改变实际帆态。
        if probe.sail == super::Sail::Furled {
            probe.sail = super::Sail::Full;
        }
        let heading = (0..360u16)
            .filter_map(|h| {
                probe.heading = h;
                let v = super::course::velocity_at(&input, &probe, weather, minute);
                super::autopilot::rank(usize::from(h), v, dx, dy)
            })
            .min()
            .map_or(start.heading, |r| r.2);
        Ok(super::Steering { minute, heading: Some(heading), sail })
    }

    /// 只供 pilot-report：在真实航迹上重放同一个舵手，量退化与 Blocked；不改积分器或存档格式。
    pub fn pilot_course_stats(&self, fleet: &Fleet, start: &super::ManualVoyage, course: &super::Course) -> (u64, u64) {
        let trace = self.pilot_course_trace(fleet, start, course);
        (trace.degraded, trace.blocked)
    }

    /// 只读逐分钟诊断；重放同一个舵手，不把诊断字段写进航迹或存档。
    pub fn pilot_course_trace(&self, fleet: &Fleet, start: &super::ManualVoyage, course: &super::Course) -> PilotTrace {
        use super::autopilot::{Helm, Steer};
        let mut table = crate::weather::DayTable::new(self);
        let input = super::course::CourseInput {
            defs: &self.defs,
            fleet,
            start,
            from: course.points.first().map_or(0, |p| p.minute),
            until: 1440,
            steers: &[],
            day: self.day(),
            speed_bonus: self.fleet_speed_bonus(fleet.id),
            mods: self.voyage_mods(fleet.id),
        };
        let passes = self.realm_passes(fleet.owner);
        let mut helm = Helm::new(&input, Some(&self.state.explore), &passes);
        let mut probe = start.clone();
        let mut minutes = Vec::new();
        for p in &course.points {
            if probe.pilot.is_none() {
                break;
            }
            probe.pos = p.pos;
            let weather = table.at_pos(&self.defs, p.pos.cell());
            let storm = weather.is_some_and(|w| w.sky == crate::weather::Sky::Storm);
            if input.mods.auto_reef {
                if storm && probe.sail == super::Sail::Full {
                    probe.sail = super::Sail::Half;
                    probe.reefed = true;
                } else if !storm && probe.reefed {
                    probe.sail = super::Sail::Full;
                    probe.reefed = false;
                }
            }
            if course.stops.iter().any(|s| s.kind == super::StopKind::Port && s.minute == p.minute) {
                break;
            }
            let avoided = helm.shore_avoided;
            let backup = helm.backup_used;
            let steer = helm.steer(&mut probe, weather, p.minute);
            let Steer::Toward { target, velocity } = steer else {
                break;
            };
            if course
                .stops
                .iter()
                .any(|s| s.minute == p.minute && matches!(s.kind, super::StopKind::Port | super::StopKind::Land))
            {
                break;
            }
            let v = velocity.unwrap_or_else(|| super::course::velocity_at(&input, &probe, weather, p.minute));
            if p.minute < super::course::MINUTES_PER_DAY {
                minutes.push(PilotMinute {
                    minute: p.minute,
                    pos: p.pos,
                    aim: target,
                    step: probe.pilot.as_ref().map_or(0, |p| p.step),
                    heading: probe.heading,
                    sail: probe.sail,
                    weather,
                    velocity: v,
                    current: if probe.pilot.as_ref().is_some_and(|p| p.mode() == super::autopilot::PilotMode::Creep) {
                        [0; 2]
                    } else {
                        super::course::current_velocity(&input, probe.pos, weather)
                    },
                    mode: probe.pilot.as_ref().map_or(super::autopilot::PilotMode::Sail, |p| p.mode()),
                    upwind_limit: super::course::sail_limit_with(&self.defs, fleet, &input.mods),
                    shore_avoided: helm.shore_avoided > avoided,
                    backup_used: helm.backup_used > backup,
                });
            }
            let total = [probe.remainder[0] + v[0] * 256, probe.remainder[1] + v[1] * 256];
            let delta = total.map(|n| n.div_euclid(super::course::REMAINDER_SCALE));
            let remain = [target.x - probe.pos.x, target.y - probe.pos.y];
            let dot = i128::from(delta[0]) * i128::from(remain[0]) + i128::from(delta[1]) * i128::from(remain[1]);
            let distance = i128::from(remain[0]).pow(2) + i128::from(remain[1]).pow(2);
            probe.remainder =
                if dot >= distance { [0; 2] } else { total.map(|n| n.rem_euclid(super::course::REMAINDER_SCALE)) };
        }
        PilotTrace { minutes, degraded: helm.degraded, blocked: helm.blocked }
    }
}

/// 报告用的瞬时舵与风流，全部来自正式积分器；不属于存档格式。
pub struct PilotMinute {
    pub minute: u16,
    pub pos: SubCell,
    pub aim: SubCell,
    pub step: usize,
    pub heading: u16,
    pub sail: super::Sail,
    pub weather: Option<crate::weather::DayWeather>,
    pub velocity: [i64; 2],
    pub current: [i64; 2],
    pub upwind_limit: u16,
    pub shore_avoided: bool,
    pub backup_used: bool,
    pub mode: super::autopilot::PilotMode,
}

pub struct PilotTrace {
    pub minutes: Vec<PilotMinute>,
    pub degraded: u64,
    pub blocked: u64,
}

type WeatherKey = (u16, Option<(u32, u16, crate::weather::Sky, u8, i64, u8, i64)>);

/// 出发日及后两日分别冻结天气作估时，不运行日结或改变船况。向量直接复用正式航速公式，
/// 抢风启用时逐度复用选舵与折算，经典世界仍每 5 度采样；按海格天气、纬度和方向缓存。
pub(super) struct WeatherModel<'a> {
    input: super::course::CourseInput<'a>,
    tables: [crate::weather::DayTable; 3],
    vectors: std::collections::BTreeMap<WeatherKey, Vec<[i64; 2]>>,
    dots: std::collections::BTreeMap<(WeatherKey, i64, i64), Option<i128>>,
}

impl<'a> WeatherModel<'a> {
    pub(super) fn new(world: &'a World, fleet: &'a Fleet, start: &'a super::ManualVoyage) -> Self {
        Self {
            input: super::course::CourseInput {
                defs: &world.defs,
                fleet,
                start,
                from: 0,
                until: 1440,
                steers: &[],
                day: world.day(),
                speed_bonus: world.fleet_speed_bonus(fleet.id),
                mods: world.voyage_mods(fleet.id),
            },
            tables: std::array::from_fn(|day| {
                crate::weather::DayTable::on(world, world.day().saturating_add(day as u32))
            }),
            vectors: Default::default(),
            dots: Default::default(),
        }
    }

    fn minutes(&mut self, a: SubCell, b: SubCell, day: usize) -> i64 {
        self.minutes_with_floor(a, b, day, 0)
    }

    pub(super) fn minutes_with_floor(&mut self, a: SubCell, b: SubCell, day: usize, floor: i64) -> i64 {
        let u = [b.x - a.x, b.y - a.y];
        let len2 = i128::from(u[0]).pow(2) + i128::from(u[1]).pow(2);
        if len2 == 0 {
            return 0;
        }
        // 同方向的不同长度共享排位结果；点积在使用时乘回公因子，估时逐位不变。
        let (mut gx, mut gy) = (u[0].abs(), u[1].abs());
        while gy != 0 {
            (gx, gy) = (gy, gx % gy);
        }
        let unit = [u[0] / gx, u[1] / gx];
        let mut total = 0i128;
        for span in spans(a, b, 0).into_iter().filter(|s| s.exit > s.enter) {
            let Some(cell) = self.input.defs.map.topology().normalize(span.x, span.y) else { return i64::MAX };
            let weather = self.tables[day].at_pos(self.input.defs, cell);
            let key = (
                cell.y,
                weather.map(|w| {
                    (
                        w.day,
                        w.region.0,
                        w.sky,
                        w.sea.wind_dir,
                        w.sea.wind_strength,
                        w.sea.current_dir,
                        w.sea.current_strength,
                    )
                }),
            );
            let dot_key = (key, unit[0], unit[1]);
            let dot = if let Some(dot) = self.dots.get(&dot_key) {
                *dot
            } else {
                let input = &self.input;
                let rules = &input.defs.rules.autopilot;
                let heading_step = if rules.beat_angle_deg > 0 { 1 } else { 5 };
                let vectors = self.vectors.entry(key).or_insert_with(|| {
                    let mut probe = super::ManualVoyage::new(cell, 0);
                    probe.sail = super::Sail::Full;
                    (0..360u16)
                        .step_by(heading_step)
                        .map(|heading| {
                            probe.heading = heading;
                            super::course::velocity(input, &probe, weather)
                        })
                        .collect()
                });
                let chosen = if rules.beat_angle_deg > 0 {
                    super::autopilot::beat_rank(vectors, unit[0], unit[1], rules.creep_speed)
                } else {
                    vectors
                        .iter()
                        .enumerate()
                        .filter_map(|(heading, &v)| super::autopilot::rank(heading * 5, v, unit[0], unit[1]))
                        .min()
                };
                let dot = chosen.and_then(|(_, std::cmp::Reverse(dot), heading)| {
                    let aim_heading = super::autopilot::aim_heading(unit[0], unit[1]);
                    if rules.beat_angle_deg > 0
                        && super::course::angle_between(heading, aim_heading) > rules.beat_angle_deg
                    {
                        let current = super::course::current_velocity(input, SubCell::center(cell), weather);
                        // H10j：估时仍按原来的名义净推进；横流补偿只改变实际领航，不重定义寻路的天气代价。
                        let (v, _) = super::autopilot::beat_candidate(
                            SubCell { x: 0, y: 0 },
                            SubCell { x: unit[0] * 256, y: unit[1] * 256 },
                            vectors[usize::from(heading)],
                            current,
                            rules.beat_efficiency_pct,
                        );
                        let dot = i128::from(v[0]) * i128::from(unit[0]) + i128::from(v[1]) * i128::from(unit[1]);
                        (dot > 0).then_some(dot)
                    } else {
                        Some(dot)
                    }
                });
                self.dots.insert(dot_key, dot);
                dot
            };
            let minutes = dot.map_or_else(
                || 20 * 1440 * ((len2 as u128).isqrt() as i128 + 255) / 256,
                |dot| {
                    let n = len2 * 1440 * i128::from(crate::Fx::SCALE);
                    let d = dot * i128::from(gx) * 256;
                    (n + d - 1) / d
                },
            );
            let minutes = if floor > 0 {
                let n = (len2 as u128).isqrt() as i128 * 1440 * i128::from(crate::Fx::SCALE);
                let d = i128::from(floor) * 256;
                minutes.min((n + d - 1) / d)
            } else {
                minutes
            };
            total += (minutes * (span.exit - span.enter) + span.den - 1) / span.den;
        }
        total.min(i128::from(i64::MAX)) as i64
    }
}

fn is_zero<T: Default + PartialEq>(value: &T) -> bool {
    value == &T::default()
}

fn is_full_pct(value: &u16) -> bool {
    *value == 100
}

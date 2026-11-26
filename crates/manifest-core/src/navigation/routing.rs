//! H07 航线规划（`rules.toml [routing]`，缺省关闭）。
//!
//! - **按用时寻路**：舰队的“领航员”岗位有人时（[`World::routing_tier`]），自动领航的粗格 A* 把代价从“距离”
//!   换成“预计用时”：出发当月各海区的气候平均风与洋流（寰宇是 `navigation.toml` 的 12 个月表）、本舰队的
//!   航速与帆型风角（与手动航行积分器同一套公开部件：[`crate::fleet::step_speed_on`]、顶风死区、洋流漂移、
//!   纬度修正），再按领航舵手的选舵规则（偏离最小的舵、同偏离取更快的）估出每一步要走多少分钟。
//! - **三种偏好**（命令参数，内核校验）：最快；稳妥（当月风暴与海盗的万分点越高，步的代价越重）；
//!   沿岸（离陆地超过 N 格的步代价加重，有沿岸的路就走沿岸的路）。
//! - 没有领航员、或规则关闭：走 [`World::known_sea_path`]（按距离），与加这条规则之前逐字节相同。
//! - **航线纪录**：每对港口记最短航时（分钟）；首航与破纪录给少量名声，写一条日志。
//!
//! 只改粗格寻路的代价：路径仍是相邻粗格的序列，细海岸照旧只在“所在粗格 → 下一粗格”的窗口里绕岸。
//! 全部整数运算；不读系统时间、不做 IO；查询不改世界状态。

use super::autopilot::Pilot;
use crate::defs::{SeasonWeather, StaticData};
use crate::log::{LogEvent, LogKind};
use crate::mates::{MateRole, RoleTarget};
use crate::nav::{DIRS, Terrain};
use crate::weather::{DayWeather, Sky};
use crate::world::Fleet;
use crate::{Cell, CommandError, FleetId, Fx, LocId, OwnerId, Reason, RegionId, World};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};

/// 领航员岗位在 `captain.toml` 里的键。
pub const NAVIGATOR_ROLE: &str = "navigator";
/// 估航速时取样的舵：每 5° 一个（领航舵手在 360 个整度里选，取样只让估计略保守）。
const HEADING_STEP: u16 = 5;
/// 一步里没有一个舵能朝目标走（逆风又逆流）时按这么多分钟算：实际的天气每天在变，舵手收帆等风。
const STALL_MINUTES: i64 = 20 * 1440;
/// 一天的分钟数（与积分器一致）。
const DAY_MINUTES: i64 = super::course::MINUTES_PER_DAY as i64;

/// 航线规划的规则（`rules.toml [routing]`）。缺省关闭：没有这一节的世界（经典世界、测试夹具）
/// 自动领航只按距离寻路，存档里也不多出字段。数值的来历见 `docs/BALANCE.md`（H07）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RoutingRules {
    pub enabled: bool,
    /// “沿岸”的离岸格数 N：与最近的陆格（八方向的切比雪夫距离）不超过 N 格算沿岸
    pub coast_cells: u16,
    /// “沿岸”偏好下，离岸超过 N 格的一步的代价按这个百分比算（100 = 不加重）
    pub offshore_pct: i64,
    /// “稳妥”偏好下，当月风暴与海盗的万分点之和每 100 点，步的代价加这么多百分点
    pub risk_pct_per_100bp: i64,
    /// 航线预览里提示“风暴季”的门槛：海区当月的风暴万分点不低于它
    pub storm_warn_bp: i64,
    /// 航线预览里提示“海盗出没”的门槛：海区当月的海盗万分点不低于它
    pub pirate_warn_bp: i64,
    /// 首航一对港口给的名声
    pub first_fame: i64,
    /// 打破一对港口的航时纪录给的名声
    pub record_fame: i64,
    /// 航时短于这么多天的航程照记纪录，但不给名声（近港之间来回刷不出名声）
    pub record_min_days: u32,
}

impl Default for RoutingRules {
    fn default() -> Self {
        Self {
            enabled: false,
            coast_cells: 3,
            offshore_pct: 2_000,
            risk_pct_per_100bp: 40,
            storm_warn_bp: 1_000,
            pirate_warn_bp: 300,
            first_fame: 1,
            record_fame: 2,
            record_min_days: 3,
        }
    }
}

impl RoutingRules {
    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(1..=12).contains(&self.coast_cells) {
            out.push(("coast_cells", "必须在 1 到 12 之间"));
        }
        if !(100..=100_000).contains(&self.offshore_pct) {
            out.push(("offshore_pct", "必须在 100 到 100000 之间（100 表示不加重）"));
        }
        if !(0..=1_000).contains(&self.risk_pct_per_100bp) {
            out.push(("risk_pct_per_100bp", "必须在 0 到 1000 之间"));
        }
        if self.storm_warn_bp <= 0 || self.pirate_warn_bp <= 0 {
            out.push(("storm_warn_bp", "风暴与海盗的提示门槛必须为正"));
        }
        if !(0..=50).contains(&self.first_fame) || !(0..=50).contains(&self.record_fame) {
            out.push(("first_fame", "首航与破纪录的名声必须在 0 到 50 之间"));
        }
        out
    }
}

/// 寻路偏好（`Command::Autopilot` 的 `route` 参数）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutePref {
    /// 按距离（老办法；没有领航员时只有这一种）
    #[default]
    Distance,
    /// 按预计用时，最快
    Fastest,
    /// 按预计用时，避开当月风暴多、海盗多的海区
    Safe,
    /// 按预计用时，尽量离岸不超过 N 格
    Coastal,
}

impl RoutePref {
    pub const ALL: [RoutePref; 4] = [RoutePref::Distance, RoutePref::Fastest, RoutePref::Safe, RoutePref::Coastal];

    pub fn key(self) -> &'static str {
        match self {
            RoutePref::Distance => "distance",
            RoutePref::Fastest => "fastest",
            RoutePref::Safe => "safe",
            RoutePref::Coastal => "coastal",
        }
    }

    pub fn timed(self) -> bool {
        self != RoutePref::Distance
    }
}

/// 舰队的寻路档位。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoutingTier {
    /// 只能按距离
    Distance,
    /// 能按预计用时（三种偏好）
    Timed,
}

/// 一次出港：从哪个港口、哪天哪一分钟。到港时据此算航时。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteDeparture {
    pub from: LocId,
    pub day: u32,
    pub minute: u16,
}

/// 一对港口（有向）的最短航时纪录。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteRecord {
    pub from: LocId,
    pub to: LocId,
    /// 航时（分钟，从出港的那一分钟到靠港的那一分钟）
    pub minutes: u32,
    /// 立下纪录的日子
    pub day: u32,
}

impl RouteRecord {
    /// 航时按整天向上取整（显示用）。
    pub fn days(&self) -> u32 {
        self.minutes.div_ceil(DAY_MINUTES as u32).max(1)
    }
}

/// 航线规划的存档状态：规则关闭时为空，不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoutingState {
    /// 正在海上的玩家舰队是从哪里、什么时候出港的
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub departures: BTreeMap<FleetId, RouteDeparture>,
    /// 各对港口的纪录，按（出发港，目的港）排序
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub records: Vec<RouteRecord>,
}

impl RoutingState {
    pub fn is_empty(&self) -> bool {
        self.departures.is_empty() && self.records.is_empty()
    }

    pub fn record(&self, from: LocId, to: LocId) -> Option<&RouteRecord> {
        self.records.binary_search_by_key(&(from, to), |r| (r.from, r.to)).ok().map(|i| &self.records[i])
    }
}

/// 航线预览的风险提示种类。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HazardKind {
    /// 途经海区当月风暴多
    Storm,
    /// 途经海区当月海盗多
    Pirate,
    /// 航程中途经的海区或目的港会封冻
    Frozen,
}

/// 一条风险提示。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RouteHazard {
    pub kind: HazardKind,
    /// 第几段航程（从 0 起）
    pub leg: usize,
    /// 导航周期（寰宇是月份 0–11；只有四季的世界是季节 0–3）
    pub period: usize,
    pub region: Option<RegionId>,
    /// 封冻的目的港
    pub port: Option<LocId>,
    /// 风暴或海盗的万分点（封冻为 0）
    pub bp: i64,
}

/// 多站行程中的一段。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteLeg {
    pub dest: LocId,
    pub path: Vec<Cell>,
    /// 只能开到已知海域的边缘（目的地不在已知海域里连得上的地方）
    pub edge: bool,
    /// 与航行视图共用当前天气与慢行保底的估时（分钟）。
    pub minutes: i64,
    /// 途经的海区（按经过的先后，去重）
    pub regions: Vec<RegionId>,
    /// 这段的出发港（第一段在海上出发时为 None）
    pub from: Option<LocId>,
    /// H10b：原路径中的拐点下标；关闭拉直时为空。
    pub corners: Vec<u32>,
}

/// 航线预览：多站行程、预计航时、粮水与风险。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoutePlan {
    pub tier: RoutingTier,
    pub pref: RoutePref,
    pub legs: Vec<RouteLeg>,
    /// 第几站寻路失败与原因（之前的各段照常给出）
    pub failed: Option<(usize, CommandError)>,
    pub minutes: i64,
    pub days: i64,
    /// 全程所需的粮、水
    pub required: [i64; 2],
    /// 现有的粮、水
    pub have: [i64; 2],
    pub hazards: Vec<RouteHazard>,
}

fn no_navigator() -> CommandError {
    Reason::new("navigation.no_navigator", "舰队没有领航员，只能按距离规划航线。").rule()
}

/// 某海区某导航周期的气候平均天气：有导航规则（寰宇）时取 12 个月表，否则取海区的四季。
pub fn period_weather(defs: &StaticData, region: RegionId, period: usize) -> Option<SeasonWeather> {
    match defs.nav.grid.rules() {
        Some(rules) => rules.weather(&defs.regions, region, period),
        None => defs.regions.get(region.idx()).map(|r| r.seasons[period % 4]),
    }
}

impl World {
    /// 舰队的寻路档位：规则打开、且这支舰队的“领航员”岗位有人时可以按用时寻路。
    /// 只看岗位有没有人（不看能力高低）；以后别的钩子（`PositionFix` 等）接在这里。
    pub fn routing_tier(&self, fleet: &Fleet) -> RoutingTier {
        if !self.defs.rules.routing.enabled || fleet.owner != OwnerId::Player {
            return RoutingTier::Distance;
        }
        let Some(role) = self.defs.captain.roles.iter().position(|r| r.key == NAVIGATOR_ROLE) else {
            return RoutingTier::Distance;
        };
        let post = MateRole::Assigned { role: role as u16, target: RoleTarget::Fleet(fleet.id) };
        if self.state.mates.values().any(|m| m.owner == Some(fleet.owner) && m.role == post) {
            RoutingTier::Timed
        } else {
            RoutingTier::Distance
        }
    }

    /// 这支舰队能用的偏好（按 [`RoutePref::ALL`] 的顺序）。
    pub fn route_prefs(&self, fleet: &Fleet) -> Vec<RoutePref> {
        match self.routing_tier(fleet) {
            RoutingTier::Distance => vec![RoutePref::Distance],
            RoutingTier::Timed => RoutePref::ALL.to_vec(),
        }
    }

    /// 命令里的偏好落到实处：没写时有领航员取“最快”、没有取“按距离”；写了用不了的偏好是规则错误。
    pub fn resolve_route_pref(&self, fleet: &Fleet, requested: Option<RoutePref>) -> Result<RoutePref, CommandError> {
        match (self.routing_tier(fleet), requested) {
            (RoutingTier::Timed, None) => Ok(RoutePref::Fastest),
            (RoutingTier::Timed, Some(pref)) => Ok(pref),
            (RoutingTier::Distance, None | Some(RoutePref::Distance)) => Ok(RoutePref::Distance),
            (RoutingTier::Distance, Some(_)) => Err(no_navigator()),
        }
    }

    /// 自动领航的粗格路径：按距离时就是 [`World::known_sea_path`]（老代码路径），否则按预计用时。
    pub fn planned_sea_path(
        &self,
        fleet: &Fleet,
        start: Cell,
        dest: LocId,
        edge: bool,
        pref: RoutePref,
    ) -> Result<Pilot, CommandError> {
        if !pref.timed() {
            return self.known_sea_path(start, dest, edge);
        }
        let mut model = TimeModel::new(self, fleet, self.day(), pref);
        self.timed_sea_path(&mut model, start, dest, edge)
    }

    /// 按出发月份的气候估一条粗格路径的航时（分钟）。与偏好无关（不含稳妥、沿岸的加重），各偏好可比。
    pub fn route_minutes(&self, fleet: &Fleet, path: &[Cell]) -> i64 {
        let mut model = TimeModel::new(self, fleet, self.day(), RoutePref::Fastest);
        model.path_minutes(path)
    }

    /// 航线预览：从舰队现在的位置依次驶往各站。`requested` 为 None 时按命令的缺省（见 [`World::resolve_route_pref`]）。
    /// 用的就是自动领航会用的路径（同一份寻路），只读，不改世界状态。
    pub fn plan_route(
        &self,
        fleet: FleetId,
        stops: &[LocId],
        requested: Option<RoutePref>,
    ) -> Result<RoutePlan, CommandError> {
        let f = self.fleet(fleet)?;
        if f.owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let tier = self.routing_tier(f);
        let pref = self.resolve_route_pref(f, requested)?;
        let mut model = TimeModel::new(self, f, self.day(), pref);
        let mut legs = Vec::new();
        let mut failed = None;
        let mut start = f.cell(&self.defs);
        let mut from = f.docked_at();
        let mut origin = match &f.location {
            crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { manual }) => manual.pos,
            _ => super::SubCell::center(start),
        };
        for (i, &dest) in stops.iter().enumerate() {
            let pilot = if pref.timed() {
                self.timed_sea_path(&mut model, start, dest, true)
            } else {
                self.known_sea_path(start, dest, true)
            }
            .and_then(|pilot| self.check_port_access(f, dest).map(|()| pilot));
            let pilot = match pilot {
                Ok(p) => p,
                Err(e) => {
                    failed = Some((i, e));
                    break;
                }
            };
            let minutes = self.navigation_path_minutes_from(fleet, origin, &pilot.path);
            let mut regions: Vec<RegionId> = Vec::new();
            for c in &pilot.path {
                if let Some(r) = self.defs.map.region_of(*c)
                    && regions.last() != Some(&r)
                    && !regions.contains(&r)
                {
                    regions.push(r);
                }
            }
            let end = pilot.path.last().copied().unwrap_or(start);
            let edge = pilot.edge;
            let corners = self.straighten(f, origin, &pilot, pref).map_or_else(Vec::new, |l| l.corners);
            legs.push(RouteLeg { dest, path: pilot.path, edge, minutes, regions, from, corners });
            origin = super::SubCell::center(end);
            if edge {
                // 到不了这一站：后面的站从已知海域的边缘接着算没有意义
                break;
            }
            start = end;
            from = Some(dest);
        }
        let minutes: i64 = legs.iter().map(|l| l.minutes).sum();
        let days = if legs.is_empty() { 0 } else { super::temporal::eta_days(minutes) };
        let required = f.supplies_required(&self.defs, days.max(if legs.is_empty() { 0 } else { 1 }));
        let hazards = self.route_hazards(&legs);
        Ok(RoutePlan { tier, pref, legs, failed, minutes, days, required, have: [f.food, f.water], hazards })
    }

    /// 各段的当季风险：出发那天所在的月（季）里风暴多、海盗多的途经海区；航程覆盖的各月里会封冻的途经海区与目的港。
    fn route_hazards(&self, legs: &[RouteLeg]) -> Vec<RouteHazard> {
        let grid = &self.defs.nav.grid;
        let rules = &self.defs.rules.routing;
        let mut out = Vec::new();
        let mut elapsed = 0i64;
        for (i, leg) in legs.iter().enumerate() {
            let start_day = self.day().saturating_add((elapsed / DAY_MINUTES) as u32);
            let end_day = self.day().saturating_add(((elapsed + leg.minutes) / DAY_MINUTES) as u32);
            let period = grid.period_on(start_day);
            for &region in &leg.regions {
                let Some(w) = period_weather(&self.defs, region, period) else { continue };
                if w.storm_bp >= rules.storm_warn_bp {
                    let kind = HazardKind::Storm;
                    out.push(RouteHazard { kind, leg: i, period, region: Some(region), port: None, bp: w.storm_bp });
                }
                let pirate = self.route_pirate_bp(region, &w);
                if pirate >= rules.pirate_warn_bp {
                    let kind = HazardKind::Pirate;
                    out.push(RouteHazard { kind, leg: i, period, region: Some(region), port: None, bp: pirate });
                }
            }
            // 航程覆盖的各个周期（按天走一遍，换周期才看一次）
            let mut seen = Vec::new();
            let mut day = start_day;
            loop {
                let p = grid.period_on(day);
                if !seen.contains(&p) {
                    seen.push(p);
                    if let Some(nav) = grid.rules() {
                        for &region in &leg.regions {
                            if nav.region_frozen(region, p) {
                                let kind = HazardKind::Frozen;
                                out.push(RouteHazard {
                                    kind,
                                    leg: i,
                                    period: p,
                                    region: Some(region),
                                    port: None,
                                    bp: 0,
                                });
                            }
                        }
                        if !leg.edge && nav.port_frozen(leg.dest, p) {
                            let kind = HazardKind::Frozen;
                            out.push(RouteHazard {
                                kind,
                                leg: i,
                                period: p,
                                region: None,
                                port: Some(leg.dest),
                                bp: 0,
                            });
                        }
                    }
                }
                if day >= end_day {
                    break;
                }
                day += 1;
            }
            elapsed += leg.minutes;
        }
        out.sort();
        out.dedup();
        out
    }

    fn timed_sea_path(
        &self,
        model: &mut TimeModel,
        start: Cell,
        dest: LocId,
        edge: bool,
    ) -> Result<Pilot, CommandError> {
        // 目的地与可走的格：与 `known_sea_path_with` 同一套条件
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
        let topology = map.topology();
        let n = map.terrain.len();
        let mut costs = vec![i64::MAX; n];
        let mut parents = vec![usize::MAX; n];
        let mut heap: BinaryHeap<Reverse<(i64, i64, usize)>> = BinaryHeap::new();
        let s = map.idx(start);
        let mut best = s;
        let vmax = model.vmax;
        // 可采纳的启发：八方向距离 ÷ 全图当月可能的最大速度
        let heuristic = |c: Cell| topology.distance(c, goal).0.saturating_mul(DAY_MINUTES) / vmax;
        costs[s] = 0;
        heap.push(Reverse((heuristic(start), 0, s)));
        while let Some(Reverse((_, cost, cur))) = heap.pop() {
            if costs[cur] != cost {
                continue;
            }
            let cell = map.cell_of(cur);
            if (topology.squared_distance(cell, goal), cost, cur)
                < (topology.squared_distance(map.cell_of(best), goal), costs[best], best)
            {
                best = cur;
            }
            if cell == goal {
                best = cur;
                break;
            }
            for dir in 0..8u8 {
                let Some(next) = topology.neighbor(cell, dir).filter(|c| allowed(*c)) else { continue };
                if dir % 2 == 1 && (!allowed(Cell::new(next.x, cell.y)) || !allowed(Cell::new(cell.x, next.y))) {
                    continue;
                }
                let n = map.idx(next);
                let candidate = cost.saturating_add(model.step_cost(next, dir));
                if candidate < costs[n] {
                    costs[n] = candidate;
                    parents[n] = cur;
                    heap.push(Reverse((candidate.saturating_add(heuristic(next)), candidate, n)));
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

    /// 海区的海盗风险（万分点）：月表里的 `pirate_bp` 与眼下这个海区每天出海盗的概率（[`World::pirate_spawn_bp`]，
    /// 含事件、战争与海军的修正）取较大者。寰宇的月表里海盗一律是 0（`regions.toml` 注明不按纬度编造），所以实际起作用的是后者。
    pub fn route_pirate_bp(&self, region: RegionId, w: &SeasonWeather) -> i64 {
        let live = if region.idx() < self.defs.regions.len() { self.pirate_spawn_bp(region) } else { 0 };
        w.pirate_bp.max(live).max(0)
    }

    /// 出港时记下出发港与时刻（规则打开、玩家的舰队、在港时）。
    pub(crate) fn note_route_departure(&mut self, fleet: FleetId, minute: u16) {
        if !self.defs.rules.routing.enabled {
            return;
        }
        let Some(f) = self.state.fleets.get(&fleet) else { return };
        let Some(from) = f.docked_at().filter(|_| f.owner == OwnerId::Player) else { return };
        let day = self.day();
        self.state.routing.departures.insert(fleet, RouteDeparture { from, day, minute });
    }

    /// 靠港时按出发记录算航时、更新纪录；首航与破纪录给名声并写日志。返回更新后的纪录（没更新为 None）。
    pub(crate) fn note_route_arrival(&mut self, fleet: FleetId, dest: LocId, minute: u16) -> Option<RouteRecord> {
        if !self.defs.rules.routing.enabled {
            return None;
        }
        let departure = self.state.routing.departures.remove(&fleet)?;
        let owner = self.state.fleets.get(&fleet).map(|f| f.owner)?;
        let day = self.day();
        let elapsed = i64::from(day.saturating_sub(departure.day)) * DAY_MINUTES + i64::from(minute)
            - i64::from(departure.minute);
        let minutes = elapsed.clamp(0, i64::from(u32::MAX)) as u32;
        if let Some(trip) = self.state.voyage_log.trips.get_mut(&fleet) {
            trip.minutes = Some(minutes);
        }
        if departure.from == dest || owner != OwnerId::Player {
            return None;
        }
        let record = RouteRecord { from: departure.from, to: dest, minutes, day };
        let rules = &self.defs.rules.routing;
        let records = &mut self.state.routing.records;
        let (previous, fame) = match records.binary_search_by_key(&(record.from, record.to), |r| (r.from, r.to)) {
            Ok(i) if records[i].minutes <= minutes => return None,
            Ok(i) => (Some(std::mem::replace(&mut records[i], record)), rules.record_fame),
            Err(i) => {
                records.insert(i, record);
                (None, rules.first_fame)
            }
        };
        let fame = if minutes >= rules.record_min_days.saturating_mul(DAY_MINUTES as u32) { fame.max(0) } else { 0 };
        if let Some(agent) = self.state.agents.get_mut(&OwnerId::Player) {
            agent.fame += fame;
        }
        let (origin, loc, days) = (record.from, record.to, record.days());
        let kind = match previous {
            None => LogKind::RouteFirst { fleet, owner, origin, loc, days, fame },
            Some(p) => LogKind::RouteRecord { fleet, owner, origin, loc, days, previous: p.days(), fame },
        };
        self.push_log(LogEvent { day, kind });
        Some(record)
    }
}

/// 按出发月份气候的步时模型。各海区的航速只算一次；（海区，行）的八方向步时用到时才算。
pub(crate) struct TimeModel<'a> {
    defs: &'a StaticData,
    pref: RoutePref,
    coast_cells: i64,
    offshore_pct: i64,
    risk_pct: i64,
    /// 按海区序号；最后一格是“不属于任何海区”（没有风也没有流）
    weather: Vec<Option<SeasonWeather>>,
    /// 各海区的风险（万分点）：当月风暴 + 海盗（[`World::route_pirate_bp`]），稳妥偏好用
    risk: Vec<i64>,
    /// 各海区、八个风角下不计洋流的航速（万分之一格/天，已乘舰长等加成）
    speeds: Vec<[i64; 8]>,
    limit: u16,
    /// 取样的舵与它们的单位向量
    headings: Vec<(u16, [i64; 2])>,
    /// （海区，行）× 八方向的步时（分钟）；-1 表示还没算
    steps: Vec<i64>,
    /// 沿岸偏好：每格 0 = 没算、1 = 沿岸、2 = 离岸
    coast: Vec<u8>,
    /// 全图当月可能的最大速度（万分之一格/天），启发函数用
    vmax: i64,
    /// H10b：各候选弦复用静态的（海区，行）速度向量，目标方向仍逐条计算。
    chord_vectors: BTreeMap<(usize, u16), Vec<[i64; 2]>>,
    chord_dots: BTreeMap<(usize, u16, i64, i64), Option<i128>>,
}

impl<'a> TimeModel<'a> {
    pub(crate) fn new(world: &'a World, fleet: &Fleet, day: u32, pref: RoutePref) -> Self {
        let defs: &'a StaticData = &world.defs;
        let period = defs.nav.grid.period_on(day);
        let bonus = Fx::ONE + world.fleet_speed_bonus(fleet.id);
        let slots = defs.regions.len() + 1;
        let mut weather = Vec::with_capacity(slots);
        let mut risk = Vec::with_capacity(slots);
        let mut speeds = Vec::with_capacity(slots);
        let mut vmax = 1i64;
        for slot in 0..slots {
            let w = (slot < defs.regions.len()).then(|| period_weather(defs, RegionId(slot as u16), period)).flatten();
            // 与积分器一样：风角航速用“不计洋流”的天气（洋流另作向量叠加），晴天（不计雾与暴风雨的减速）
            let still = w.map(|sea| DayWeather {
                region: RegionId(slot as u16),
                day,
                sky: Sky::Clear,
                sea: SeasonWeather { current_strength: 0, ..sea },
                storm_hit_e8: 0,
            });
            let row: [i64; 8] =
                std::array::from_fn(|d| crate::fleet::step_speed_on(defs, fleet, d as u8, still.as_ref()).mul(bonus).0);
            let drift = w.map_or(0, |w| 5_000 * w.current_strength.clamp(0, 3));
            vmax = vmax.max(row.iter().copied().max().unwrap_or(0).saturating_add(drift));
            risk.push(w.map_or(0, |w| w.storm_bp.max(0) + world.route_pirate_bp(RegionId(slot as u16), &w)));
            weather.push(w);
            speeds.push(row);
        }
        let headings = (0..360).step_by(usize::from(HEADING_STEP)).map(|h| (h, super::course::direction(h))).collect();
        let rules = &defs.rules.routing;
        Self {
            defs,
            pref,
            coast_cells: i64::from(rules.coast_cells),
            offshore_pct: rules.offshore_pct.max(100),
            risk_pct: rules.risk_pct_per_100bp.max(0),
            weather,
            risk,
            speeds,
            limit: super::course::sail_limit(defs, fleet),
            headings,
            steps: vec![-1; slots * usize::from(defs.map.height) * 8],
            coast: if pref == RoutePref::Coastal { vec![0; defs.map.terrain.len()] } else { Vec::new() },
            vmax,
            chord_vectors: BTreeMap::new(),
            chord_dots: BTreeMap::new(),
        }
    }

    fn slot(&self, cell: Cell) -> usize {
        self.defs.map.region_of(cell).map_or(self.defs.regions.len(), |r| r.idx().min(self.defs.regions.len()))
    }

    /// 走进 `to` 这一步（方向 `dir`）的估计分钟数，不含偏好的加重。
    fn base_step(&mut self, to: Cell, dir: u8) -> i64 {
        let slot = self.slot(to);
        let base = (slot * usize::from(self.defs.map.height) + usize::from(to.y)) * 8;
        let dir = usize::from(dir % 8);
        if self.defs.rules.autopilot.straighten {
            // 拉直的原路径只需实际经过的方向；其余方向留到真正需要时，数值仍用同一公式。
            if self.steps[base + dir] < 0 {
                let value = Self::step_minutes(self.cached_vectors(slot, to.y), dir);
                self.steps[base + dir] = value;
            }
        } else if self.steps[base] < 0 {
            let row = self.row_steps(slot, to.y);
            self.steps[base..base + 8].copy_from_slice(&row);
        }
        self.steps[base + dir]
    }

    /// 某海区某一行的八方向步时：每个取样舵按积分器的算法算出速度向量（风角航速插值、顶风死区、洋流漂移、
    /// 纬度修正），再像领航舵手那样挑偏离目标方向最小的舵（同偏离取朝目标更快的），用它朝目标的分量算时间。
    fn row_steps(&self, slot: usize, row: u16) -> [i64; 8] {
        let vectors = self.row_vectors(slot, row);
        std::array::from_fn(|dir| Self::step_minutes(&vectors, dir))
    }

    fn step_minutes(vectors: &[[i64; 2]], dir: usize) -> i64 {
        let (dx, dy) = DIRS[dir];
        let (dx, dy) = (i128::from(dx), i128::from(dy));
        let best = Self::best_dot(vectors, [dx, dy]);
        match best {
            // 位移的平方 × 一天的分钟 × 万分之一 ÷ 朝目标的分量，向上取整
            Some(dot) => {
                let len2 = dx * dx + dy * dy;
                let num = len2 * i128::from(DAY_MINUTES) * i128::from(Fx::SCALE);
                ((num + dot - 1) / dot).min(i128::from(STALL_MINUTES)) as i64
            }
            None => STALL_MINUTES,
        }
    }

    /// 精确比较原来的“侧偏商，再取最大点积”。多数候选只需检查当前商桶的边界，避免逐舵做 i128 除法。
    fn best_dot(vectors: &[[i64; 2]], u: [i128; 2]) -> Option<i128> {
        let mut best: Option<(i128, i128)> = None;
        for &[vx, vy] in vectors {
            let dot = i128::from(vx) * u[0] + i128::from(vy) * u[1];
            if dot <= 0 {
                continue;
            }
            let scaled = (i128::from(vx) * u[1] - i128::from(vy) * u[0]).abs() * 1_000_000;
            if let Some((bucket, old_dot)) = best
                && let Some(lower) = bucket.checked_mul(dot)
                && scaled >= lower
            {
                // 上界溢出表示它大于所有可表示的 scaled；下界溢出则落到下面的原整除式。
                let same_bucket =
                    bucket.checked_add(1).and_then(|n| n.checked_mul(dot)).is_none_or(|upper| scaled < upper);
                if same_bucket && dot > old_dot {
                    best = Some((bucket, dot));
                }
                continue;
            }
            let bucket = scaled / dot;
            if best.is_none_or(|(old_bucket, old_dot)| (bucket, Reverse(dot)) < (old_bucket, Reverse(old_dot))) {
                best = Some((bucket, dot));
            }
        }
        best.map(|(_, dot)| dot)
    }

    fn cached_vectors(&mut self, slot: usize, row: u16) -> &[[i64; 2]] {
        let key = (slot, row);
        let missing = !self.chord_vectors.contains_key(&key);
        if missing {
            let vectors = self.row_vectors(slot, row);
            self.chord_vectors.insert(key, vectors);
        }
        &self.chord_vectors[&key]
    }

    fn row_vectors(&self, slot: usize, row: u16) -> Vec<[i64; 2]> {
        let w = self.weather[slot];
        let speeds = &self.speeds[slot];
        let wind_from = w.map(|w| (u16::from(w.wind_dir) * 45 + 180) % 360);
        let projection = self.defs.nav.grid.rules().and_then(|r| r.projection.as_ref()).filter(|p| p.lat_scale);
        let cos = projection.map(|p| p.row_cos(row).0.max(100));
        self.headings
            .iter()
            .map(|&(h, [sx, sy])| {
                let irons = w.is_some_and(|w| w.wind_strength > 0)
                    && wind_from.is_some_and(|from| super::course::angle_between(h, from) < self.limit);
                let speed = if irons {
                    0
                } else {
                    let a = speeds[usize::from(h / 45)];
                    let b = speeds[usize::from((h / 45 + 1) % 8)];
                    a + (b - a) * i64::from(h % 45) / 45
                };
                let mut v = [speed * sx / Fx::SCALE, speed * sy / Fx::SCALE];
                if let Some(w) = w {
                    let drift = 5_000 * w.current_strength.clamp(0, 3);
                    let [cx, cy] = super::course::direction(u16::from(w.current_dir) * 45);
                    v[0] += drift * cx / Fx::SCALE;
                    v[1] += drift * cy / Fx::SCALE;
                }
                if let Some(cos) = cos {
                    v[0] = (i128::from(v[0]) * i128::from(cos) / i128::from(Fx::SCALE)) as i64;
                    v[1] = (i128::from(v[1]) * i128::from(cos).pow(2) / i128::from(Fx::SCALE).pow(2)) as i64;
                }
                v
            })
            .collect()
    }

    /// 离最近的陆格是否不超过 N 格（八方向的切比雪夫距离；图外按陆算）。
    pub(crate) fn coastal(&mut self, c: Cell) -> bool {
        let map = &self.defs.map;
        let i = map.idx(c);
        if self.coast[i] == 0 {
            let topology = map.topology();
            let n = self.coast_cells;
            let near = (-n..=n).any(|dy| {
                (-n..=n).any(|dx| match topology.normalize(i64::from(c.x) + dx, i64::from(c.y) + dy) {
                    Some(o) => map.terrain(o) == Terrain::Land,
                    None => i64::from(c.y) + dy >= 0 && i64::from(c.y) + dy < i64::from(map.height),
                })
            });
            self.coast[i] = if near { 1 } else { 2 };
        }
        self.coast[i] == 1
    }

    /// A* 用的步代价：估计分钟数，再按偏好加重。
    pub(crate) fn step_cost(&mut self, to: Cell, dir: u8) -> i64 {
        let base = self.base_step(to, dir);
        match self.pref {
            RoutePref::Distance | RoutePref::Fastest => base,
            RoutePref::Safe => {
                let risk = self.risk[self.slot(to)];
                let pct = 100 + risk.saturating_mul(self.risk_pct) / 100;
                base.saturating_mul(pct) / 100
            }
            RoutePref::Coastal => {
                if self.coastal(to) {
                    base
                } else {
                    base.saturating_mul(self.offshore_pct) / 100
                }
            }
        }
    }

    /// 一条路径的估计航时（分钟，不含偏好的加重）。
    pub(crate) fn path_minutes(&mut self, path: &[Cell]) -> i64 {
        let topology = self.defs.map.topology();
        path.windows(2).map(|p| self.base_step(p[1], topology.dir_between(p[0], p[1]))).sum()
    }
}

/// 一天的航迹里靠港的那一分钟（没有靠港停船时取当天最后一分钟）。
pub(crate) fn arrival_minute(stops: &[super::course::CourseStop]) -> u16 {
    stops
        .iter()
        .rev()
        .find(|s| s.kind == super::course::StopKind::Port)
        .map_or(super::course::MINUTES_PER_DAY - 1, |s| s.minute)
}

impl TimeModel<'_> {
    /// 任意整数方向的整段航时；各格的 DDA 长度用最大余数法凑满千分之一。
    pub(crate) fn chord_cost(&mut self, a: super::SubCell, b: super::SubCell) -> i64 {
        let u = [i128::from(b.x - a.x), i128::from(b.y - a.y)];
        let len2 = u[0] * u[0] + u[1] * u[1];
        if len2 == 0 {
            return 0;
        }
        let (mut gx, mut gy) = (u[0].abs(), u[1].abs());
        while gy != 0 {
            let rest = gx % gy;
            gx = gy;
            gy = rest;
        }
        let scale = gx.max(1);
        let unit = [u[0] / scale, u[1] / scale];
        let cells = super::line_pilot::spans(a, b, 0);
        let mut shares: Vec<_> = cells
            .iter()
            .enumerate()
            .filter(|(_, s)| s.exit > s.enter)
            .map(|(i, s)| {
                let n = (s.exit - s.enter) * 1000;
                (i, n / s.den, n % s.den)
            })
            .collect();
        let left = 1000 - shares.iter().map(|s| s.1).sum::<i128>();
        let mut order: Vec<_> = (0..shares.len()).collect();
        order.sort_by_key(|&i| (Reverse(shares[i].2), shares[i].0));
        for &i in order.iter().take(left.max(0) as usize) {
            shares[i].1 += 1;
        }
        let mut rows = BTreeMap::new();
        let mut total = 0i128;
        for (i, weight, _) in shares {
            if weight == 0 {
                continue;
            }
            let s = cells[i];
            let Some(c) = self.defs.map.topology().normalize(s.x, s.y) else { return i64::MAX };
            let slot = self.slot(c);
            let base = *rows.entry((slot, c.y)).or_insert_with(|| {
                let key = (slot, c.y, unit[0] as i64, unit[1] as i64);
                let chosen = match self.chord_dots.get(&key).copied() {
                    Some(dot) => dot,
                    None => {
                        let best = Self::best_dot(self.cached_vectors(slot, c.y), unit);
                        self.chord_dots.insert(key, best);
                        best
                    }
                };
                let best = chosen.map(|dot| (0, Reverse(dot * scale)));
                let cap = i128::from(STALL_MINUTES) * ((len2 as u128).isqrt() as i128 + 255) / 256;
                best.map_or(cap, |(_, Reverse(dot))| {
                    let num = len2 * i128::from(DAY_MINUTES) * i128::from(Fx::SCALE);
                    let den = dot * 256;
                    ((num + den - 1) / den).min(cap)
                })
                .min(i128::from(i64::MAX)) as i64
            });
            let cost = match self.pref {
                RoutePref::Distance | RoutePref::Fastest => base,
                RoutePref::Safe => base.saturating_mul(100 + self.risk[slot].saturating_mul(self.risk_pct) / 100) / 100,
                RoutePref::Coastal => {
                    if self.coastal(c) {
                        base
                    } else {
                        base.saturating_mul(self.offshore_pct) / 100
                    }
                }
            };
            total += i128::from(cost) * weight;
        }
        ((total + 999) / 1000).min(i128::from(i64::MAX)) as i64
    }
}

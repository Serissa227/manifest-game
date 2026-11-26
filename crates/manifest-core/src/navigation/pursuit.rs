//! H03 海盗按分钟追击（`rules.toml [pursuit]`，VOYAGE-PLAN §4.2）。
//!
//! 只对“正在追玩家手动航行舰队”的海盗按分钟移动，其余海盗照旧按天游弋与追商船：
//!
//! - 追击从日初的状态（[`PirateChase`]，存在 `BattleState::chases` 里）出发，逐分钟对着玩家航迹上的位置走；
//!   没在追的海盗若在某一分钟看见玩家（切比雪夫距离 ≤ 视野，玩家在雾里时视野只剩 `fog_sight` 格），从那一分钟起开追。
//! - 航速用海盗自己的船型与它所在格当天的风（位置天况）算，与玩家同一套风角表；顶风死区里没有速度，
//!   每分钟在 72 个航向（5° 一档）里取“朝目标的分量”最大的那个——于是会自己抢风换舷，也就追不上往上风跑的纵帆船。
//! - 距离 ≤ `contact`（1/256 格，缺省 0.3 格）算追上：当天日结时与玩家遭遇（进入待决的海战）。
//! - 连续 `give_up_minutes` 分钟（缺省一整天）看不见玩家就放弃。看不见时朝最后看见的位置走。
//!
//! 一天里的追击是日初状态与当天航迹的纯函数：预览、时钟暂停与日结算的是同一个结果，不消费随机流。

use super::SubCell;
use super::course::{CoursePoint, angle_between, direction};
use crate::fixed::Fx;
use crate::ids::{Cell, FleetId};
use crate::weather::{DayTable, Sky};
use crate::weather_cells::sub_dx;
use crate::world::{Fleet, World};
use crate::{OwnerId, StaticData};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 按分钟追击的规则（`rules.toml [pursuit]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PursuitRules {
    pub enabled: bool,
    /// 追上的距离（1/256 格）
    pub contact: i64,
    /// 连续看不见多少分钟就放弃
    pub give_up_minutes: u16,
    /// 玩家在雾里时海盗的视野（格）
    pub fog_sight: i64,
    /// 日初离玩家多远（格）以内的海盗才参与按分钟的追击（性能；须大于视野加一天能走的路）
    pub search: i64,
}

impl Default for PursuitRules {
    fn default() -> Self {
        Self { enabled: false, contact: 77, give_up_minutes: 1440, fog_sight: 3, search: 24 }
    }
}

impl PursuitRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(1..=1024).contains(&self.contact) {
            out.push(("contact", "须在 1–1024 之间（1/256 格）"));
        }
        if self.give_up_minutes == 0 {
            out.push(("give_up_minutes", "必须至少为 1"));
        }
        if !(0..=64).contains(&self.fog_sight) {
            out.push(("fog_sight", "须在 0–64 之间"));
        }
        if !(1..=128).contains(&self.search) {
            out.push(("search", "须在 1–128 之间"));
        }
        out
    }
}

/// 一支海盗正在追的目标（日初状态，随存档；没有追击时不写）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PirateChase {
    pub fleet: FleetId,
    /// 海盗的精确位置（1/256 格）
    pub pos: SubCell,
    /// 最后一次看见目标的位置
    pub seen: SubCell,
    /// 已连续看不见的分钟数
    pub unseen: u16,
}

/// 一支海盗一天的追击结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PursuitTrack {
    pub pirate: u32,
    pub fleet: FleetId,
    /// 第 i 项是第 i 分钟（自 6:00 起）的海盗位置；长度与玩家航迹相同
    pub points: Vec<SubCell>,
    /// 从哪一分钟起在追（日初就在追为 0）
    pub from: u16,
    /// 追上的那一分钟
    pub contact: Option<u16>,
    /// 当天结束时的追击状态（None = 放弃了）
    pub end: Option<PirateChase>,
}

/// 日结时记下的当天追击（`move_fleets` 写，`battle_day` 用完即清）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PursuitOutcome {
    pub pirate: u32,
    pub fleet: FleetId,
    pub contact: Option<u16>,
    pub cell: Cell,
    pub end: Option<PirateChase>,
}

/// 海盗朝某方向的航速（格 / 天），45° 采样之间线性插值，与玩家的积分器同一写法。
fn speed_toward(speeds: &[Fx; 8], heading: u16) -> i64 {
    let h = heading % 360;
    let a = speeds[usize::from(h / 45)].0;
    let b = speeds[usize::from((h / 45 + 1) % 8)].0;
    a + (b - a) * i64::from(h % 45) / 45
}

impl World {
    /// 海盗对这支舰队的基础视野（格）：规则视野按秘术、血脉的“雾”减免（与按天追击同一公式，雾里的加成另计）。
    fn pursuit_sight(&self, fleet: FleetId, fog: bool, night: bool) -> i64 {
        let rules = &self.defs.rules;
        let hide = self.arcana_bonus(fleet, "fog")
            + if fog { self.legend_fog_hiding(fleet) } else { 0 }
            + if self.flagship(OwnerId::Player) == Some(fleet) { self.lineage_power("fog", 720) } else { 0 }
            + if night { self.legend_night_hiding(fleet) } else { 0 };
        let mut sight = rules.pirates.sight * (100 - hide.min(50)) / 100;
        // H06：结伴时海盗看你的视野打折
        if self.convoy_active(fleet) {
            sight = sight * rules.hail.convoy_sight_pct / 100;
        }
        if fog { sight.min(rules.pursuit.fog_sight) } else { sight }
    }

    /// 这支玩家舰队今天被哪些海盗按分钟追（`points` 为当天从 0 分钟起的整段航迹）。
    /// `taken` 里的海盗已被别的玩家舰队占了。开关关闭、不是玩家舰队时为空。
    pub fn pursuit_tracks(&self, fleet: &Fleet, points: &[CoursePoint], taken: &BTreeSet<u32>) -> Vec<PursuitTrack> {
        let defs = &self.defs;
        let rules = &defs.rules.pursuit;
        if !rules.enabled || fleet.owner != OwnerId::Player || points.is_empty() || !defs.manual_navigation {
            return Vec::new();
        }
        let topology = defs.map.topology();
        let start = points[0].pos.cell();
        let mut today = DayTable::new(self);
        let candidates: Vec<_> = self
            .state
            .battles
            .pirates
            .values()
            .filter(|p| !p.engaged && !taken.contains(&p.id) && !self.pirate_truce(p.id, fleet.id))
            .filter(|p| match self.state.battles.chases.get(&p.id) {
                Some(c) => c.fleet == fleet.id,
                None => topology.chebyshev(p.cell, start) <= rules.search,
            })
            .cloned()
            .collect();
        let sights = [
            [self.pursuit_sight(fleet.id, false, false), self.pursuit_sight(fleet.id, true, false)],
            [self.pursuit_sight(fleet.id, false, true), self.pursuit_sight(fleet.id, true, true)],
        ];
        // 玩家每分钟所在格是不是雾（同一格只问一次）
        let mut fog_at: BTreeMap<Cell, bool> = BTreeMap::new();
        let mut fogs = Vec::with_capacity(points.len());
        for p in points {
            let c = p.pos.cell();
            let f = *fog_at.entry(c).or_insert_with(|| today.at_pos(defs, c).is_some_and(|w| w.sky == Sky::Fog));
            fogs.push(f);
        }
        let mut out = Vec::new();
        for pirate in candidates {
            let mut chase = self.state.battles.chases.get(&pirate.id).copied();
            let mut pos = chase.map_or(SubCell::center(pirate.cell), |c| c.pos);
            let mut from = if chase.is_some() { Some(0u16) } else { None };
            let limit =
                pirate.ships.iter().map(|s| crate::legend_ships::mechanics::ship_limit(defs, s)).max().unwrap_or(67);
            let mut remainder = [0i64; 2];
            let mut speeds_cell: Option<(Cell, [Fx; 8], u16, i64)> = None;
            let mut track = Vec::with_capacity(points.len());
            track.push(pos);
            let mut contact = None;
            for (m, point) in points.iter().enumerate().skip(1) {
                let target = points[m - 1].pos;
                if contact.is_some() {
                    pos = point.pos;
                    track.push(pos);
                    continue;
                }
                let night = !(360..1080).contains(&((360 + m) % 1440));
                let sight = sights[usize::from(night)][usize::from(fogs[m - 1])] * SubCell::SCALE;
                let dx = sub_dx(defs, pos.x, target.x);
                let dy = target.y - pos.y;
                let visible = dx.abs().max(dy.abs()) <= sight;
                match &mut chase {
                    None if visible => {
                        chase = Some(PirateChase { fleet: fleet.id, pos, seen: target, unseen: 0 });
                        from = Some((m - 1) as u16);
                    }
                    None => {}
                    Some(c) if visible => {
                        c.seen = target;
                        c.unseen = 0;
                    }
                    Some(c) => {
                        c.unseen = c.unseen.saturating_add(1);
                        if c.unseen >= rules.give_up_minutes {
                            chase = None;
                        }
                    }
                }
                if let Some(c) = &chase {
                    let cell = pos.cell();
                    if speeds_cell.is_none_or(|(at, ..)| at != cell) {
                        let w = today.at_pos(defs, cell);
                        let speeds = std::array::from_fn(|d| {
                            crate::fleet::pirate_speed_on(defs, &pirate.ships, pirate.crew, d as u8, w.as_ref())
                        });
                        let wind_from = w.map_or(0, |w| (u16::from(w.sea.wind_dir) * 45 + 180) % 360);
                        let force = w.map_or(0, |w| w.sea.wind_strength);
                        speeds_cell = Some((cell, speeds, wind_from, force));
                    }
                    let Some((_, speeds, wind_from, force)) = speeds_cell else { continue };
                    let gx = sub_dx(defs, pos.x, c.seen.x);
                    let gy = c.seen.y - pos.y;
                    // 72 个航向里取朝目标分量最大的（顶风死区里没有速度）
                    let mut best: Option<(i128, [i64; 2])> = None;
                    for h in (0..360u16).step_by(5) {
                        if force > 0 && angle_between(h, wind_from) < limit {
                            continue;
                        }
                        let s = speed_toward(&speeds, h);
                        let [ux, uy] = direction(h);
                        let v = [s * ux / Fx::SCALE, s * uy / Fx::SCALE];
                        let score = i128::from(v[0]) * i128::from(gx) + i128::from(v[1]) * i128::from(gy);
                        if best.is_none_or(|(b, _)| score > b) {
                            best = Some((score, v));
                        }
                    }
                    if let Some((score, mut v)) = best.filter(|(s, _)| *s > 0) {
                        let _ = score;
                        if let Some(p) =
                            defs.nav.grid.rules().and_then(|r| r.projection.as_ref()).filter(|p| p.lat_scale)
                        {
                            let cos = p.row_cos(cell.y).0.max(100);
                            v[0] = (i128::from(v[0]) * i128::from(cos) / i128::from(Fx::SCALE)) as i64;
                            v[1] = (i128::from(v[1]) * i128::from(cos).pow(2) / i128::from(Fx::SCALE).pow(2)) as i64;
                        }
                        let mut delta = [0i64; 2];
                        for axis in 0..2 {
                            let total = remainder[axis] + v[axis] * SubCell::SCALE;
                            delta[axis] = total.div_euclid(super::course::REMAINDER_SCALE);
                            remainder[axis] = total.rem_euclid(super::course::REMAINDER_SCALE);
                        }
                        // 不追过头：一步就到最后看见的位置时停在那里
                        if delta[0].abs() >= gx.abs() && delta[1].abs() >= gy.abs() {
                            delta = [gx, gy];
                        }
                        let next = normalize(defs, SubCell { x: pos.x + delta[0], y: pos.y + delta[1] });
                        if let Some(next) = next.filter(|n| defs.map.is_sea_in_bounds(n.cell())) {
                            pos = next;
                        }
                    }
                }
                track.push(pos);
                if chase.is_some() {
                    let ex = sub_dx(defs, pos.x, point.pos.x);
                    let ey = point.pos.y - pos.y;
                    if ex * ex + ey * ey <= rules.contact * rules.contact {
                        contact = Some(m as u16);
                    }
                }
            }
            let Some(from) = from else { continue };
            let end = chase.map(|mut c| {
                c.pos = pos;
                c
            });
            out.push(PursuitTrack { pirate: pirate.id, fleet: fleet.id, points: track, from, contact, end });
        }
        out
    }
}

fn normalize(defs: &StaticData, p: SubCell) -> Option<SubCell> {
    let width = i64::from(defs.map.width) * SubCell::SCALE;
    let height = i64::from(defs.map.height) * SubCell::SCALE;
    if width == 0 || p.y < 0 || p.y >= height {
        return None;
    }
    let x = if defs.map.wrap_x { p.x.rem_euclid(width) } else { p.x };
    (x >= 0 && x < width).then_some(SubCell { x, y: p.y })
}

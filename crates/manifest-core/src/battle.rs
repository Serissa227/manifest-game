//! 海盗与海战。
//!
//! - 海盗是 NPC 舰队：按海区的海盗活跃度（随季节、事件与战争局势变化）出现，在本海区游弋，
//!   发现商船就追击，接近到一格内即发生遭遇。
//! - 遭遇后：商会舰队立即自动结算；玩家舰队进入待决状态，由玩家选择自动结算或战术海战，
//!   未作选择时次日自动结算。交战中的舰队不能移动。
//! - 自动结算：按舰船、火力、船员、舰长能力、风向计算，带随机性；航速占优的商船可能直接脱离。
//! - 战术海战：六角格回合制。风向影响移动（逆风一步耗两点行动力）；侧舷炮击（只能攻击左右舷方向、
//!   射程内的目标）；接舷白刃战（相邻时比拼船员，胜者俘获对方船只）；撤退。
//!
//! 全部随机数由（种子, 日期, 领域, 参数）派生，战术海战的每个操作都是命令，结果可确定性重放。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::fleet::new_ship;
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::nav::Terrain;
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::world::{FleetLocation, Ship, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 一支海盗舰队。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PirateFleet {
    pub id: u32,
    pub region: RegionId,
    pub cell: Cell,
    pub ships: Vec<Ship>,
    pub crew: i64,
    /// 离开本海区的日期
    pub until: u32,
    /// 正在交战
    pub engaged: bool,
}

/// 战斗结果（从商船一方看）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BattleResult {
    /// 击退或歼灭海盗
    Won,
    /// 战败：被劫掠或全军覆没
    Lost,
    /// 凭航速脱离
    Evaded,
    /// 战术海战中撤退成功
    Retreated,
    /// 回合用尽，海盗撤离
    Withdrew,
}

/// 结算方式。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BattleMode {
    Auto,
    Tactical,
}

/// 等待玩家决定的遭遇。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingBattle {
    pub id: BattleId,
    pub fleet: FleetId,
    pub pirate: u32,
    pub day: u32,
}

/// 战术海战中单位的状态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnitStatus {
    Active,
    Sunk,
    Captured,
}

/// 战术海战中的一艘船。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Unit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend: Option<crate::legend_ships::mechanics::CombatTraits>,
    pub id: u8,
    /// 是否属于玩家
    pub player: bool,
    /// 在所属舰队中的船只下标
    pub ship: usize,
    pub kind: ShipTypeId,
    /// 六角格轴坐标
    pub q: i64,
    pub r: i64,
    /// 船头朝向 0–5（0 东、1 东北、2 西北、3 西、4 西南、5 东南）
    pub facing: u8,
    pub hp: i64,
    pub max_hp: i64,
    pub crew: i64,
    pub guns: i64,
    /// 每回合行动力
    pub mp: i64,
    pub mp_left: i64,
    pub fired: bool,
    pub boarded: bool,
    pub status: UnitStatus,
}

/// 战术海战的战报条目（界面按字符串表显示）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalEvent {
    Fire { from: u8, to: u8, damage: i64 },
    Sunk { unit: u8 },
    Board { from: u8, to: u8, captured: bool },
    RetreatFailed,
    Retreated,
    PiratesWithdraw,
}

/// 一场战术海战。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TacticalBattle {
    pub id: BattleId,
    pub fleet: FleetId,
    pub pirate: u32,
    pub started: u32,
    pub turn: u32,
    /// 风的去向（六角方向）
    pub wind: u8,
    pub radius: i64,
    pub units: Vec<Unit>,
    pub log: Vec<(u32, TacticalEvent)>,
}

/// 玩家在战术海战中的操作。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalOrder {
    Move { unit: u8, q: i64, r: i64 },
    Turn { unit: u8, facing: u8 },
    Fire { unit: u8, target: u8 },
    Board { unit: u8, target: u8 },
    Retreat,
    EndTurn,
}

/// 战斗记录。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleRecord {
    pub id: BattleId,
    pub day: u32,
    pub fleet: FleetId,
    pub owner: OwnerId,
    pub mode: BattleMode,
    pub result: BattleResult,
    pub cargo_lost: i64,
    pub cash_lost: Money,
    pub ships_lost: i64,
    pub captured: i64,
}

/// 海盗与海战的全部状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BattleState {
    pub pirates: BTreeMap<u32, PirateFleet>,
    pub next_pirate: u32,
    pub pending: BTreeMap<BattleId, PendingBattle>,
    pub tactical: BTreeMap<BattleId, TacticalBattle>,
    pub next_battle: u32,
    pub records: Vec<BattleRecord>,
    /// 累计统计：按结果计数（玩家与商会合计）
    #[serde(default)]
    pub totals: BTreeMap<String, u32>,
    /// 累计出现的海盗舰队数
    #[serde(default)]
    pub pirates_spawned: u32,
    /// H03：按分钟追玩家的海盗（海盗编号 → 追击状态）；开关关闭时永远为空、不写进存档
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub chases: BTreeMap<u32, crate::navigation::pursuit::PirateChase>,
    /// H03：当天按分钟追击的结果（日结内 `move_fleets` 写、`battle_day` 用完即清，存档里总是空的）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pursued: Vec<crate::navigation::pursuit::PursuitOutcome>,
}

/// 保留的战斗记录条数。
const RECORDS_KEPT: usize = 200;
/// 战报保留条数。
const TACTICAL_LOG_KEPT: usize = 60;
/// 每门炮每次齐射的基础伤害。
const GUN_DAMAGE: i64 = 2;
/// 战术海战开始后若干天仍未结束，按海盗撤离处理。
const TACTICAL_DAYS: u32 = 3;

// ───────────────────────────── 六角格 ─────────────────────────────

/// 六个方向的轴坐标位移：0 东、1 东北、2 西北、3 西、4 西南、5 东南。
pub const HEX_DIRS: [(i64, i64); 6] = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)];
/// 八方向风（0 北，顺时针）对应的六角方向。
const WIND_TO_HEX: [u8; 8] = [1, 1, 0, 5, 5, 4, 3, 2];

pub fn hex_distance(a: (i64, i64), b: (i64, i64)) -> i64 {
    let dq = a.0 - b.0;
    let dr = a.1 - b.1;
    (dq.abs() + dr.abs() + (dq + dr).abs()) / 2
}

fn on_board(q: i64, r: i64, radius: i64) -> bool {
    hex_distance((q, r), (0, 0)) <= radius
}

/// 从 a 看 b 最接近的六角方向（立方坐标点积最大者）。
pub fn hex_dir_to(a: (i64, i64), b: (i64, i64)) -> u8 {
    let (dq, dr) = (b.0 - a.0, b.1 - a.1);
    let v = (dq, -dq - dr, dr);
    let mut best = (0u8, i64::MIN);
    for (i, (hq, hr)) in HEX_DIRS.iter().enumerate() {
        let d = (*hq, -hq - hr, *hr);
        let dot = v.0 * d.0 + v.1 * d.1 + v.2 * d.2;
        if dot > best.1 {
            best = (i as u8, dot);
        }
    }
    best.0
}

/// 两个六角方向之差（0–3）。
fn hex_diff(a: u8, b: u8) -> u8 {
    let d = (a as i64 - b as i64).rem_euclid(6) as u8;
    d.min(6 - d)
}

/// 朝某方向走一步的行动力消耗：逆风两点，其余一点。
fn step_cost(dir: u8, wind: u8) -> i64 {
    if dir == (wind + 3) % 6 { 2 } else { 1 }
}

impl TacticalBattle {
    fn unit(&self, id: u8) -> Option<&Unit> {
        self.units.iter().find(|u| u.id == id)
    }

    fn active(&self, player: bool) -> impl Iterator<Item = &Unit> {
        self.units.iter().filter(move |u| u.player == player && u.status == UnitStatus::Active)
    }

    fn occupied(&self, q: i64, r: i64, except: u8) -> bool {
        self.units.iter().any(|u| u.id != except && u.status == UnitStatus::Active && u.q == q && u.r == r)
    }

    /// 某单位在剩余行动力内可到达的格子：（坐标 → (消耗, 最后一步的方向)）。
    pub fn reachable(&self, id: u8) -> BTreeMap<(i64, i64), (i64, u8)> {
        let mut out: BTreeMap<(i64, i64), (i64, u8)> = BTreeMap::new();
        let Some(u) = self.unit(id) else { return out };
        if u.status != UnitStatus::Active {
            return out;
        }
        let mut frontier: Vec<((i64, i64), i64, u8)> = vec![((u.q, u.r), 0, u.facing)];
        let mut best: BTreeMap<(i64, i64), i64> = BTreeMap::new();
        best.insert((u.q, u.r), 0);
        while let Some(i) = (0..frontier.len()).min_by_key(|i| (frontier[*i].1, frontier[*i].0)) {
            let (pos, cost, _) = frontier.swap_remove(i);
            for (d, (dq, dr)) in HEX_DIRS.iter().enumerate() {
                let next = (pos.0 + dq, pos.1 + dr);
                if !on_board(next.0, next.1, self.radius) || self.occupied(next.0, next.1, id) {
                    continue;
                }
                let c = cost + step_cost(d as u8, self.wind);
                if c > u.mp_left || best.get(&next).is_some_and(|b| *b <= c) {
                    continue;
                }
                best.insert(next, c);
                out.insert(next, (c, d as u8));
                frontier.push((next, c, d as u8));
            }
        }
        out
    }

    /// 某单位能否用侧舷炮攻击目标。
    pub fn can_fire(&self, id: u8, target: u8, range: i64) -> bool {
        let (Some(a), Some(b)) = (self.unit(id), self.unit(target)) else { return false };
        if a.status != UnitStatus::Active || b.status != UnitStatus::Active || a.player == b.player || a.fired {
            return false;
        }
        if a.guns <= 0 {
            return false;
        }
        let d = hex_distance((a.q, a.r), (b.q, b.r));
        if d == 0 || d > range {
            return false;
        }
        let rel = hex_diff(a.facing, hex_dir_to((a.q, a.r), (b.q, b.r)));
        rel == 1 || rel == 2
    }

    /// 某单位能否接舷目标。
    pub fn can_board(&self, id: u8, target: u8) -> bool {
        let (Some(a), Some(b)) = (self.unit(id), self.unit(target)) else { return false };
        a.status == UnitStatus::Active
            && b.status == UnitStatus::Active
            && a.player != b.player
            && !a.boarded
            && a.crew > 0
            && hex_distance((a.q, a.r), (b.q, b.r)) == 1
    }

    fn push_log(&mut self, e: TacticalEvent) {
        self.log.push((self.turn, e));
        if self.log.len() > TACTICAL_LOG_KEPT {
            let excess = self.log.len() - TACTICAL_LOG_KEPT;
            self.log.drain(0..excess);
        }
    }

    fn unit_mut(&mut self, id: u8) -> Option<&mut Unit> {
        self.units.iter_mut().find(|u| u.id == id)
    }

    /// 炮击：随机 60–140%，每远一格衰减 10%（最低 50%）；装甲最后计算。
    fn fire(&mut self, id: u8, target: u8, mult: Fx, rng: &mut Rng) {
        let Some(a) = self.unit(id).cloned() else { return };
        let Some(b) = self.unit(target).cloned() else { return };
        let dist = hex_distance((a.q, a.r), (b.q, b.r));
        let base = a.guns * GUN_DAMAGE * rng.range(60, 140) / 100;
        let falloff = (100 - 10 * (dist - 1)).max(50);
        let damage =
            mul_div(mult.apply(base * falloff / 100).max(1), 100 - b.legend.as_ref().map_or(0, |t| t.armor), 100)
                .max(1);
        let sunk = self.hit(target, damage, damage / 4);
        if let Some(u) = self.unit_mut(id) {
            u.fired = true;
        }
        self.push_log(TacticalEvent::Fire { from: id, to: target, damage });
        if sunk {
            self.push_log(TacticalEvent::Sunk { unit: target });
        }
    }

    /// 中弹：扣耐久与船员；耐久归零即沉没。
    fn hit(&mut self, target: u8, damage: i64, crew_loss: i64) -> bool {
        let Some(t) = self.unit_mut(target) else { return false };
        t.hp -= damage;
        t.crew = (t.crew - crew_loss).max(0);
        if t.hp <= 0 {
            t.hp = 0;
            t.crew = 0;
            t.status = UnitStatus::Sunk;
            true
        } else {
            false
        }
    }

    /// 接舷：比拼船员 × 战斗倍数 × 随机 80–120%，胜者俘获对方船只。
    fn board(&mut self, id: u8, target: u8, att_mult: Fx, def_mult: Fx, rng: &mut Rng) {
        let Some(a) = self.unit(id).cloned() else { return };
        let Some(b) = self.unit(target).cloned() else { return };
        if let Some(t) = a.legend.as_ref().filter(|t| !t.ram_used && t.ram > 0) {
            let damage = mul_div(a.max_hp, t.ram, 100).max(1).min((b.hp - 1).max(0));
            if let Some(target) = self.unit_mut(target) {
                target.hp -= damage;
                target.crew = (target.crew - damage / 4).max(0);
            }
            if let Some(t) = self.unit_mut(id).and_then(|u| u.legend.as_mut()) {
                t.ram_used = true;
            }
        }
        let b = self.unit(target).cloned().unwrap_or(b);
        let att =
            mul_div(att_mult.apply(a.crew * rng.range(80, 120)), 100 + a.legend.as_ref().map_or(0, |t| t.bridge), 100);
        let def = def_mult.apply(b.crew * rng.range(80, 120));
        let captured = att > def;
        if captured {
            if let Some(u) = self.unit_mut(id) {
                u.crew = (u.crew - b.crew / 3).max(1);
                u.boarded = true;
            }
            if let Some(t) = self.unit_mut(target) {
                t.crew = 0;
                t.status = UnitStatus::Captured;
            }
        } else {
            if let Some(u) = self.unit_mut(id) {
                u.crew = (u.crew - u.crew / 4).max(0);
                u.boarded = true;
            }
            if let Some(t) = self.unit_mut(target) {
                t.crew = (t.crew - a.crew / 6).max(1);
            }
        }
        self.push_log(TacticalEvent::Board { from: id, to: target, captured });
    }

    fn move_to(&mut self, id: u8, q: i64, r: i64) -> bool {
        let Some((cost, dir)) = self.reachable(id).get(&(q, r)).copied() else { return false };
        if let Some(u) = self.unit_mut(id) {
            u.q = q;
            u.r = r;
            u.facing = dir;
            u.mp_left -= cost;
        }
        true
    }

    /// 海盗一方的回合（确定性规则）。
    fn pirate_turn(&mut self, range: i64, pirate_mult: Fx, player_mult: Fx, rng: &mut Rng) {
        let ids: Vec<u8> = self.active(false).map(|u| u.id).collect();
        for id in ids {
            if self.active(true).next().is_none() {
                return;
            }
            let Some(me) = self.unit(id).cloned() else { continue };
            if me.status != UnitStatus::Active {
                continue;
            }
            // 1. 相邻且船员占优：接舷
            let board_target = self
                .active(true)
                .filter(|p| hex_distance((me.q, me.r), (p.q, p.r)) == 1 && me.crew * 10 >= p.crew * 11)
                .min_by_key(|p| (p.crew, p.id))
                .map(|p| p.id);
            if let Some(t) = board_target
                && self.can_board(id, t)
            {
                self.board(id, t, pirate_mult, player_mult, rng);
                continue;
            }
            // 2. 能开火就开火
            if let Some(t) = self.best_target(id, range) {
                self.fire(id, t, pirate_mult, rng);
                continue;
            }
            // 3. 向最近的玩家船移动，优先抢占能侧舷开火的位置
            let Some(target) =
                self.active(true).min_by_key(|p| (hex_distance((me.q, me.r), (p.q, p.r)), p.id)).map(|p| (p.q, p.r))
            else {
                continue;
            };
            let reach = self.reachable(id);
            let mut best: Option<((i64, i64), i64)> = None;
            for (pos, (_, dir)) in &reach {
                let d = hex_distance(*pos, target);
                let rel = hex_diff(*dir, hex_dir_to(*pos, target));
                let broadside = d <= range && d > 0 && (rel == 1 || rel == 2);
                let score = if broadside { 1_000 - d } else { -d * 10 };
                if best.is_none_or(|(_, s)| score > s) {
                    best = Some((*pos, score));
                }
            }
            if let Some((pos, _)) = best {
                self.move_to(id, pos.0, pos.1);
            }
            if let Some(t) = self.best_target(id, range) {
                self.fire(id, t, pirate_mult, rng);
            }
        }
    }

    /// 可攻击的目标中耐久最低者。
    fn best_target(&self, id: u8, range: i64) -> Option<u8> {
        let me = self.unit(id)?;
        self.units
            .iter()
            .filter(|t| t.player != me.player && self.can_fire(id, t.id, range))
            .min_by_key(|t| (t.hp, t.id))
            .map(|t| t.id)
    }

    fn new_turn(&mut self) {
        self.turn += 1;
        for u in self.units.iter_mut() {
            u.mp_left = u.mp;
            u.fired = false;
            u.boarded = false;
        }
    }

    /// 已分出胜负时返回结果。
    fn decided(&self) -> Option<BattleResult> {
        if self.active(false).next().is_none() {
            Some(BattleResult::Won)
        } else if self.active(true).next().is_none() {
            Some(BattleResult::Lost)
        } else {
            None
        }
    }
}

/// 舰队的火力与船员强度。
fn power(ships: &[Ship], crew: i64) -> i64 {
    let guns: i64 = ships.iter().map(|s| mul_div(s.guns, s.durability.max(0), s.max_durability.max(1))).sum();
    guns * 10 + crew * 2
}

/// 每回合行动力：2 + 航速 / 3。
fn movement_points(defs: &crate::defs::StaticData, kind: ShipTypeId) -> i64 {
    2 + defs.ship(kind).speed.raw() / (3 * Fx::SCALE)
}

impl World {
    /// 舰队是否处于交战中（待决或战术海战）。
    pub fn fleet_in_battle(&self, fleet: FleetId) -> bool {
        let b = &self.state.battles;
        b.pending.values().any(|p| p.fleet == fleet) || b.tactical.values().any(|t| t.fleet == fleet)
    }

    fn next_battle_id(&mut self) -> BattleId {
        let id = BattleId(self.state.battles.next_battle);
        self.state.battles.next_battle += 1;
        id
    }

    fn record_battle(&mut self, rec: BattleRecord) {
        let day = self.state.day;
        self.push_log(LogEvent {
            day,
            kind: LogKind::NavalBattle {
                fleet: rec.fleet,
                owner: rec.owner,
                result: rec.result,
                cargo_lost: rec.cargo_lost,
                cash_lost: rec.cash_lost,
                captured: rec.captured,
            },
        });
        *self.state.battles.totals.entry(format!("{:?}", rec.result)).or_insert(0) += 1;
        let records = &mut self.state.battles.records;
        records.push(rec);
        if records.len() > RECORDS_KEPT {
            let excess = records.len() - RECORDS_KEPT;
            records.drain(0..excess);
        }
    }

    /// 某海区当前每天出现海盗的概率（万分之一）。
    pub fn pirate_spawn_bp(&self, region: RegionId) -> i64 {
        let defs = &self.defs;
        let season = self.season().index();
        let base = defs.region(region).seasons[season].pirate_bp;
        let war = self.state.relations.iter().any(|r| r.status == crate::diplomacy::DiploStatus::War);
        let war_mult = if war { Fx::from_pct(150) } else { Fx::ONE };
        defs.rules
            .pirates
            .spawn_scale
            .mul(self.pirate_mult(region))
            .mul(war_mult)
            .mul(self.navy_pirate_mult(region))
            .apply(base)
    }

    /// tick 第 5 步之后：过期交战自动结算，海盗出现、游弋、离开，发现遭遇。
    pub(crate) fn battle_day(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        // 1. 玩家未作选择的遭遇：次日自动结算；拖延过久的战术海战按海盗撤离处理
        let stale: Vec<BattleId> = self.state.battles.pending.values().filter(|p| p.day < day).map(|p| p.id).collect();
        for id in stale {
            self.resolve_pending_auto(id)?;
        }
        let stale: Vec<BattleId> =
            self.state.battles.tactical.values().filter(|t| t.started + TACTICAL_DAYS <= day).map(|t| t.id).collect();
        for id in stale {
            self.finish_tactical(id, BattleResult::Withdrew)?;
        }
        self.pirates_spawn_and_leave();
        let caught = self.pirates_move();
        self.encounters(&caught)?;
        self.state.battles.pursued.clear();
        Ok(())
    }

    /// H03：玩家手动航行的舰队改由按分钟追击处理（开关打开时），按天的追击与一格遭遇不再看它们。
    fn minute_pursued(&self, fleet: FleetId) -> bool {
        self.defs.rules.pursuit.enabled
            && self.state.fleets.get(&fleet).is_some_and(|f| {
                f.owner == OwnerId::Player
                    && matches!(f.location, FleetLocation::AtSea(crate::world::Voyage::Manual { .. }))
            })
    }

    fn pirates_spawn_and_leave(&mut self) {
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let rules = defs.rules.pirates.clone();
        self.state.battles.pirates.retain(|_, p| p.engaged || p.until > day);
        let alive: Vec<u32> = self.state.battles.pirates.keys().copied().collect();
        self.state.battles.chases.retain(|id, _| alive.contains(id));
        if rules.ships.is_empty() {
            return;
        }
        let ports: Vec<Cell> = defs.port_ids().map(|l| defs.loc(l).cell).collect();
        // 独有船型不会被海盗使用（数据校验也保证 pirates.ships 中没有独有船型）
        let kinds: Vec<ShipTypeId> = rules.ships.iter().copied().filter(|k| !defs.ship(*k).unique).collect();
        if kinds.is_empty() {
            return;
        }
        for (ri, region) in defs.regions.iter().enumerate() {
            let rid = RegionId::from_idx(ri);
            let count = self.state.battles.pirates.values().filter(|p| p.region == rid).count();
            if count >= rules.max_per_region {
                continue;
            }
            let mut rng = Rng::derive(seed, day, Domain::Pirates, ri as u64, 0);
            if !rng.chance_bp(self.pirate_spawn_bp(rid)) {
                continue;
            }
            let (x0, y0, x1, y1) = region.rect;
            let topology = defs.map.topology();
            let x_end = if x0 > x1 { i64::from(x1) + i64::from(topology.width) } else { i64::from(x1) };
            let mut spot = None;
            for _ in 0..30 {
                let x = rng.range(i64::from(x0), x_end);
                let y = rng.range(i64::from(y0), i64::from(y1));
                let Some(c) = topology.normalize(x, y) else { continue };
                let near_port = ports.iter().any(|p| topology.chebyshev(*p, c) <= 3);
                if defs.map.is_sea(c) && defs.map.region_of(c) == Some(rid) && !near_port {
                    spot = Some(c);
                    break;
                }
            }
            let Some(cell) = spot else { continue };
            let n = rng.range(rules.fleet_size.0, rules.fleet_size.1);
            let mut ships = Vec::new();
            let mut crew = 0;
            for _ in 0..n {
                let kind = kinds[rng.below(kinds.len() as u64) as usize];
                ships.push(new_ship(&defs, kind));
                crew += rules.crew_ratio.apply(defs.ship(kind).crew_max).max(1);
            }
            let id = self.state.battles.next_pirate;
            self.state.battles.next_pirate += 1;
            self.state.battles.pirates_spawned += 1;
            let until = day + rng.range(rules.lifetime.0 as i64, rules.lifetime.1 as i64) as u32;
            self.state
                .battles
                .pirates
                .insert(id, PirateFleet { id, region: rid, cell, ships, crew, until, engaged: false });
        }
    }

    /// 读档修正（EXPANSION §10.2）：所在格已不是海的海盗舰队移到最近的海格（优先本海区的海格，
    /// 本海区已没有海格时取任意海区的最近海格并改属该海区）。按编号顺序处理，结果确定。返回被修正的海盗舰队。
    pub(crate) fn relocate_stranded_pirates(&mut self) -> Vec<u32> {
        let defs = self.defs.clone();
        let map = &defs.map;
        let mut moved = Vec::new();
        for (id, p) in self.state.battles.pirates.iter_mut() {
            if map.is_sea_in_bounds(p.cell) {
                continue;
            }
            let home = p.region.0;
            let spot = map
                .nearest_cell(p.cell, |i| map.terrain[i] != Terrain::Land && map.region[i] == home)
                .or_else(|| map.nearest_cell(p.cell, |i| map.terrain[i] != Terrain::Land));
            let Some(cell) = spot else { continue };
            p.cell = cell;
            if let Some(r) = map.region_of(cell) {
                p.region = r;
            }
            moved.push(*id);
        }
        moved
    }

    /// 在海上、未交战的商船（按编号排序）：（编号, 所在格）。
    fn merchant_targets(&self) -> Vec<(FleetId, Cell)> {
        self.state
            .fleets
            .values()
            .filter(|f| {
                matches!(f.location, FleetLocation::AtSea(_))
                    && !self.fleet_in_battle(f.id)
                    && !self.is_training_fleet(f.id)
            })
            .map(|f| (f.id, f.cell(&self.defs)))
            .collect()
    }

    /// 海盗移动；返回当天按分钟追上了玩家的（海盗, 舰队）。
    fn pirates_move(&mut self) -> Vec<(u32, FleetId)> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let rules = defs.rules.pirates.clone();
        let targets: Vec<_> = self.merchant_targets().into_iter().filter(|(f, _)| !self.minute_pursued(*f)).collect();
        let topology = self.defs.map.topology();
        let cheb = |a: Cell, b: Cell| topology.chebyshev(a, b);
        // H03：当天按分钟追过的海盗落到追击结束时的位置，不再按天移动
        let pursued = std::mem::take(&mut self.state.battles.pursued);
        let caught: Vec<(u32, FleetId)> =
            pursued.iter().filter(|o| o.contact.is_some()).map(|o| (o.pirate, o.fleet)).collect();
        for o in &pursued {
            // H06：一直在追、这一天放弃了（没追上）——甩掉了，给少量名声
            if self.defs.rules.hail.enabled
                && o.end.is_none()
                && o.contact.is_none()
                && self.state.battles.chases.contains_key(&o.pirate)
            {
                let fame = self.defs.rules.hail.escape_fame;
                if let Some(a) = self.state.agents.get_mut(&OwnerId::Player) {
                    a.fame += fame;
                }
                let day = self.state.day;
                self.push_log(LogEvent { day, kind: LogKind::ShookOff { fleet: o.fleet, owner: OwnerId::Player } });
            }
            if let Some(p) = self.state.battles.pirates.get_mut(&o.pirate) {
                p.cell = o.cell;
                if let Some(r) = defs.map.region_of(o.cell) {
                    p.region = r;
                }
            }
            match o.end {
                Some(c)
                    if self
                        .state
                        .fleets
                        .get(&o.fleet)
                        .is_some_and(|f| matches!(f.location, FleetLocation::AtSea(_))) =>
                {
                    self.state.battles.chases.insert(o.pirate, c);
                }
                _ => {
                    self.state.battles.chases.remove(&o.pirate);
                }
            }
        }
        // 追的舰队已经靠港、覆没或不再手动航行：放弃
        let stale: Vec<u32> = self
            .state
            .battles
            .chases
            .iter()
            .filter(|(_, c)| !self.minute_pursued(c.fleet))
            .map(|(id, _)| *id)
            .collect();
        for id in stale {
            self.state.battles.chases.remove(&id);
        }
        let ids: Vec<u32> = self.state.battles.pirates.keys().copied().collect();
        for id in ids {
            let Some(p) = self.state.battles.pirates.get(&id).cloned() else { continue };
            if p.engaged || pursued.iter().any(|o| o.pirate == id) || self.state.battles.chases.contains_key(&id) {
                continue;
            }
            let chase = targets
                .iter()
                .filter(|(f, c)| {
                    if defs.rules.ships.s02_enabled && self.pirate_truce(id, *f) {
                        return false;
                    }
                    cheb(*c, p.cell)
                        <= rules.sight
                            * (100
                                - ((self.arcana_bonus(*f, "fog")
                                    + if self.weather_at(*c).is_some_and(|w| w.sky == crate::weather::Sky::Fog) {
                                        self.legend_fog_hiding(*f)
                                    } else {
                                        0
                                    })
                                    + if self.flagship(OwnerId::Player) == Some(*f) {
                                        self.lineage_power("fog", 720)
                                    } else {
                                        0
                                    }
                                    + self.legend_night_hiding(*f) / 2)
                                    .min(50))
                            / 100
                })
                .min_by_key(|(f, c)| (cheb(*c, p.cell), f.0))
                .map(|(_, c)| *c);
            let mut cell = p.cell;
            match chase {
                Some(target) => {
                    for _ in 0..rules.speed {
                        if cheb(cell, target) <= 1 {
                            break;
                        }
                        let next = (0..8)
                            .filter_map(|dir| topology.neighbor(cell, dir))
                            .filter(|c| defs.map.is_sea(*c))
                            .min_by_key(|c| cheb(*c, target));
                        match next {
                            Some(n) if cheb(n, target) < cheb(cell, target) => cell = n,
                            _ => break,
                        }
                    }
                }
                None => {
                    let mut rng = Rng::derive(seed, day, Domain::Pirates, 1_000 + id as u64, 0);
                    if let Some(c) = topology.neighbor(cell, rng.below(8) as u8)
                        && defs.map.is_sea(c)
                        && defs.map.region_of(c) == Some(p.region)
                    {
                        cell = c;
                    }
                }
            }
            if let Some(pm) = self.state.battles.pirates.get_mut(&id) {
                pm.cell = cell;
            }
        }
        caught
    }

    /// 海盗与一格内的商船遭遇：商会立即自动结算，玩家进入待决。
    fn encounters(&mut self, caught: &[(u32, FleetId)]) -> Result<(), CoreError> {
        let day = self.state.day;
        let topology = self.defs.map.topology();
        let cheb = |a: Cell, b: Cell| topology.chebyshev(a, b);
        let ids: Vec<u32> = self.state.battles.pirates.keys().copied().collect();
        // H03：玩家手动航行的舰队只在按分钟追击“追上”时遭遇
        for pid in ids {
            let Some(p) = self.state.battles.pirates.get(&pid).cloned() else { continue };
            if p.engaged {
                continue;
            }
            let Some((fid, _)) = self
                .merchant_targets()
                .into_iter()
                .filter(|(f, c)| {
                    if self.defs.rules.ships.s02_enabled && self.pirate_truce(pid, *f) {
                        return false;
                    }
                    if self.minute_pursued(*f) { caught.contains(&(pid, *f)) } else { cheb(*c, p.cell) <= 1 }
                })
                .min_by_key(|(f, c)| (cheb(*c, p.cell), f.0))
            else {
                continue;
            };
            let owner = self.fleet(fid)?.owner;
            if owner == OwnerId::Player {
                if self.legend_deters(fid, pid) {
                    continue;
                }
                let id = self.next_battle_id();
                self.state.battles.pending.insert(id, PendingBattle { id, fleet: fid, pirate: pid, day });
                if let Some(pm) = self.state.battles.pirates.get_mut(&pid) {
                    pm.engaged = true;
                }
                self.pacing_note(crate::pacing::BeatSource::Battle.weight());
            } else {
                let id = self.next_battle_id();
                self.auto_battle(id, fid, pid)?;
            }
        }
        Ok(())
    }

    fn resolve_pending_auto(&mut self, id: BattleId) -> Result<(), CoreError> {
        let Some(p) = self.state.battles.pending.remove(&id) else { return Ok(()) };
        if !self.state.fleets.contains_key(&p.fleet) || !self.state.battles.pirates.contains_key(&p.pirate) {
            if let Some(pm) = self.state.battles.pirates.get_mut(&p.pirate) {
                pm.engaged = false;
            }
            return Ok(());
        }
        self.auto_battle(id, p.fleet, p.pirate)
    }

    /// 迎风一方的加成：海盗顺风追击时海盗 +10%，商船顶风迎击时商船 +10%。风向用商船所在海区当天的风。
    fn wind_edge(&self, pirate: Cell, fleet: Cell) -> (Fx, Fx) {
        let Some(w) = self.weather_at(fleet) else { return (Fx::ONE, Fx::ONE) };
        if pirate == fleet {
            return (Fx::ONE, Fx::ONE);
        }
        let heading = self.defs.map.dir_between(pirate, fleet);
        let diff = crate::nav::angle_diff(heading, w.wind_dir());
        if diff <= 1 {
            (Fx::ONE, Fx::from_pct(110))
        } else if diff >= 3 {
            (Fx::from_pct(110), Fx::ONE)
        } else {
            (Fx::ONE, Fx::ONE)
        }
    }

    /// 自动结算。
    fn auto_battle(&mut self, id: BattleId, fid: FleetId, pid: u32) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let rules = defs.rules.battle.clone();
        let Some(pirate) = self.state.battles.pirates.get(&pid).cloned() else { return Ok(()) };
        let fleet = self.fleet(fid)?.clone();
        let owner = fleet.owner;
        let ships = fleet.ships.clone();
        let mut rng = Rng::derive(self.state.seed, day, Domain::Combat, id.0 as u64, pid as u64);
        let fcell = fleet.cell(&defs);

        // 脱离：商船最慢的船比海盗最慢的船快时，按速度差有机会脱离
        let slowest =
            |ships: &[Ship]| ships.iter().map(|s| defs.ship(s.kind).speed + s.speed_bonus).min().unwrap_or(Fx::ONE);
        let sm = slowest(&ships).mul(Fx::ONE + self.fleet_speed_bonus(fid));
        let sp = slowest(&pirate.ships);
        if sm > sp {
            let edge = Fx::ratio(sm.raw() - sp.raw(), sp.raw().max(1)).min(rules.evade_max);
            if rng.chance_bp(edge.raw()) {
                if let Some(pm) = self.state.battles.pirates.get_mut(&pid) {
                    pm.engaged = false;
                }
                self.record_battle(BattleRecord {
                    id,
                    day,
                    fleet: fid,
                    owner,
                    mode: BattleMode::Auto,
                    result: BattleResult::Evaded,
                    cargo_lost: 0,
                    cash_lost: 0,
                    ships_lost: 0,
                    captured: 0,
                });
                return Ok(());
            }
        }

        let (fm_wind, pm_wind) = self.wind_edge(pirate.cell, fcell);
        let morale = Fx::ratio(50 + fleet.morale.clamp(0, 100), 150);
        // H01 `melee` / `duel`：接舷的船员项加成（开关关闭时为 0，船员项不变）
        let boarding = self.post_boarding_bonus(fid);
        let crew_term = crate::seafaring::posts::boarding_crew(fleet.crew, boarding);
        let pm = self.fleet_combat_mult(fid).mul(morale).mul(fm_wind).apply(power(&ships, crew_term)).max(1);
        let extra = ships
            .iter()
            .map(|s| {
                let ghost = crate::legend_ships::mechanics::ghost_crew(&defs, s) * 2;
                let ram = if crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ram) {
                    mul_div(s.max_durability, defs.rules.ships.ram_pct, 100)
                } else {
                    0
                };
                let bridge = if crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::BoardingBridge) {
                    mul_div(
                        crate::legend_ships::crew_min(&defs, s) + ghost / 2,
                        defs.rules.ships.bridge_boarding_pct,
                        100,
                    ) * 2
                } else {
                    0
                };
                ghost + ram + bridge
            })
            .sum::<i64>();
        let pm = pm.saturating_add(extra);
        let pp = pm_wind.apply(power(&pirate.ships, pirate.crew)).max(1);
        let win_bp = mul_div(pm, 10_000, pm + pp);
        let won = rng.chance_bp(win_bp);

        if won {
            self.salvage_after(fid, &format!("battle:{}", id.0))?;
        }
        // 双方损伤
        let (dmg_lo, dmg_hi) = if won { (3, 12) } else { (8, 25) };
        let ships_before = fleet.ships.len() as i64;
        {
            let f = self.fleet_mut(fid)?;
            for s in f.ships.iter_mut() {
                let pct = rng.range(dmg_lo, dmg_hi);
                s.durability -= mul_div(
                    mul_div(s.max_durability, pct, 100),
                    100 - crate::legend_ships::mechanics::armor(&defs, s),
                    100,
                );
            }
            let (clo, chi) = if won { (3, 10) } else { (8, 20) };
            let dead = mul_div(f.crew, rng.range(clo, chi), 100);
            f.crew = (f.crew - dead).max(0);
        }
        let (mut cargo_lost, mut cash_lost) = (0, 0);
        if won {
            self.state.battles.pirates.remove(&pid);
            if matches!(fleet.location, FleetLocation::AtSea(_))
                && let Some(port) = self.fleet_port(&fleet)
            {
                // 港口的归属可能随时间线变动（A7 的动态归属）
                let faction = self.location_faction(port);
                self.adjust_reputation(owner, faction, rules.reputation_win);
            }
        } else {
            let cargo_total = self.fleet(fid)?.cargo_total();
            if cargo_total > 0 {
                cargo_lost = self.lose_cargo_fraction(fid, &mut rng, rules.cargo_loss_pct.0, rules.cargo_loss_pct.1)?;
            } else {
                let cash = self.agent(owner)?.cash;
                cash_lost = mul_div(cash.max(0), rng.range(rules.tribute_pct.0, rules.tribute_pct.1), 100);
                if cash_lost > 0 {
                    self.book_external(
                        owner,
                        Flow::Tribute,
                        Sector::Hinterland,
                        JournalEntry::new(day, Memo::Tribute, CashClass::Operating)
                            .dr(Account::Losses, cash_lost)
                            .cr(Account::Cash, cash_lost),
                    )?;
                }
            }
            // 得手的海盗带着战利品离开
            self.state.battles.pirates.remove(&pid);
        }
        self.abandon_unmanned_ships(fid)?;
        self.sink_wrecked_ships(fid)?;
        let ships_after = self.state.fleets.get(&fid).map(|f| f.ships.len() as i64).unwrap_or(0);
        if self.state.fleets.get(&fid).is_some_and(|f| crate::legend_ships::mechanics::fleet_unmanned(&defs, f)) {
            self.destroy_fleet(fid)?;
        }
        self.record_battle(BattleRecord {
            id,
            day,
            fleet: fid,
            owner,
            mode: BattleMode::Auto,
            result: if won { BattleResult::Won } else { BattleResult::Lost },
            cargo_lost,
            cash_lost,
            ships_lost: ships_before - ships_after,
            captured: 0,
        });
        Ok(())
    }

    /// 由待决遭遇开始战术海战。
    fn start_tactical(&mut self, id: BattleId) -> Result<(), CoreError> {
        let Some(p) = self.state.battles.pending.remove(&id) else { return Ok(()) };
        let defs = self.defs.clone();
        let fleet = self.fleet(p.fleet)?.clone();
        let Some(pirate) = self.state.battles.pirates.get(&p.pirate).cloned() else { return Ok(()) };
        let radius = defs.rules.battle.tactical_radius;
        let fcell = fleet.cell(&defs);
        // 战场的风：商船所在海区当天的风
        let wind = self.weather_at(fcell).map(|w| WIND_TO_HEX[w.wind_dir() as usize % 8]).unwrap_or(0);
        let captain_mp = i64::from(self.captain_of(p.fleet).is_some_and(|m| m.navigation >= 60));
        let mut units = Vec::new();
        // 船员按各船最少船员的比例分到各船
        let split = |ships: &[Ship], crew: i64| -> Vec<i64> {
            let mins: Vec<i64> = ships
                .iter()
                .map(|s| {
                    if crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ghost) {
                        0
                    } else {
                        crate::legend_ships::crew_min(&defs, s).max(1)
                    }
                })
                .collect();
            let total: i64 = mins.iter().sum::<i64>().max(1);
            let mut out: Vec<i64> = mins.iter().map(|m| mul_div(crew, *m, total)).collect();
            let rest = crew - out.iter().sum::<i64>();
            if let Some(index) = mins.iter().position(|m| *m > 0) {
                out[index] += rest;
            }
            for (i, s) in ships.iter().enumerate() {
                if crate::legend_ships::has(&defs, s, crate::legend_ships::Trait::Ghost) {
                    out[i] = crate::legend_ships::mechanics::ghost_crew(&defs, s);
                }
            }
            out
        };
        // 双方各排成一列：玩家在西侧 q = −(R−1)，海盗在东侧 q = R−1（中心对称），相邻排列不重叠
        let column = |n: usize| -> Vec<i64> { (0..n as i64).map(|i| (radius - 1) / 2 - n as i64 / 2 + i).collect() };
        let fcrew = split(&fleet.ships, fleet.crew);
        for (i, (s, r)) in fleet.ships.iter().zip(column(fleet.ships.len())).enumerate() {
            let mp = movement_points(&defs, s.kind) + captain_mp;
            units.push(Unit {
                legend: crate::legend_ships::mechanics::combat(&defs, s),
                id: units.len() as u8,
                player: true,
                ship: i,
                kind: s.kind,
                q: -(radius - 1),
                r,
                facing: 0,
                hp: s.durability,
                max_hp: s.max_durability,
                crew: fcrew[i],
                guns: s.guns,
                mp,
                mp_left: mp,
                fired: false,
                boarded: false,
                status: UnitStatus::Active,
            });
        }
        let pcrew = split(&pirate.ships, pirate.crew);
        for (i, (s, r)) in pirate.ships.iter().zip(column(pirate.ships.len())).enumerate() {
            let mp = movement_points(&defs, s.kind);
            units.push(Unit {
                legend: None,
                id: units.len() as u8,
                player: false,
                ship: i,
                kind: s.kind,
                q: radius - 1,
                r: -r,
                facing: 3,
                hp: s.durability,
                max_hp: s.max_durability,
                crew: pcrew[i],
                guns: s.guns,
                mp,
                mp_left: mp,
                fired: false,
                boarded: false,
                status: UnitStatus::Active,
            });
        }
        let t = TacticalBattle {
            id,
            fleet: p.fleet,
            pirate: p.pirate,
            started: self.state.day,
            turn: 1,
            wind,
            radius,
            units,
            log: Vec::new(),
        };
        self.state.battles.tactical.insert(id, t);
        Ok(())
    }

    /// 执行玩家的战术操作。
    fn tactical_order(&mut self, id: BattleId, order: TacticalOrder) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let max_turns = defs.rules.battle.max_turns;
        let Some(mut t) = self.state.battles.tactical.remove(&id) else { return Ok(()) };
        let range = defs.rules.battle.gun_range;
        let player_mult = self.fleet_combat_mult(t.fleet);
        // H01 `melee` / `duel`：只加在接舷（攻与守）上，炮击不变
        let boarding = self.post_boarding_bonus(t.fleet);
        let player_board = if boarding == 0 { player_mult } else { player_mult.mul(Fx::from_pct(100 + boarding)) };
        let pirate_mult = Fx::ONE;
        let seq = t.log.len() as u64;
        let mut rng =
            Rng::derive(self.state.seed, self.state.day, Domain::Combat, id.0 as u64, ((t.turn as u64) << 16) | seq);
        let mut result = None;
        match order {
            TacticalOrder::Move { unit, q, r } => {
                t.move_to(unit, q, r);
            }
            TacticalOrder::Turn { unit, facing } => {
                if let Some(u) = t.unit_mut(unit)
                    && u.mp_left >= 1
                {
                    u.facing = facing % 6;
                    u.mp_left -= 1;
                }
            }
            TacticalOrder::Fire { unit, target } => {
                t.fire(unit, target, player_mult, &mut rng);
            }
            TacticalOrder::Board { unit, target } => {
                t.board(unit, target, player_board, pirate_mult, &mut rng);
            }
            TacticalOrder::Retreat => {
                let avg = |player: bool| {
                    let v: Vec<i64> = t.active(player).map(|u| u.mp).collect();
                    v.iter().sum::<i64>() * 100 / (v.len() as i64).max(1)
                };
                let min_gap = t
                    .active(true)
                    .flat_map(|a| t.active(false).map(move |b| hex_distance((a.q, a.r), (b.q, b.r))))
                    .min()
                    .unwrap_or(99);
                let bp =
                    (3_000 + 10 * (avg(true) - avg(false)) + if min_gap >= 3 { 2_000 } else { 0 }).clamp(1_000, 9_000);
                if rng.chance_bp(bp) {
                    t.push_log(TacticalEvent::Retreated);
                    result = Some(BattleResult::Retreated);
                } else {
                    t.push_log(TacticalEvent::RetreatFailed);
                    t.pirate_turn(range, pirate_mult, player_board, &mut rng);
                    t.new_turn();
                }
            }
            TacticalOrder::EndTurn => {
                t.pirate_turn(range, pirate_mult, player_board, &mut rng);
                t.new_turn();
                if t.turn > max_turns && t.decided().is_none() {
                    t.push_log(TacticalEvent::PiratesWithdraw);
                    result = Some(BattleResult::Withdrew);
                }
            }
        }
        let result = result.or_else(|| t.decided());
        self.state.battles.tactical.insert(id, t);
        if let Some(r) = result {
            self.finish_tactical(id, r)?;
        }
        Ok(())
    }

    /// 结束战术海战，把结果写回舰队与海盗。
    fn finish_tactical(&mut self, id: BattleId, result: BattleResult) -> Result<(), CoreError> {
        let Some(t) = self.state.battles.tactical.remove(&id) else { return Ok(()) };
        let defs = self.defs.clone();
        let day = self.state.day;
        let Some(fleet) = self.state.fleets.get(&t.fleet).cloned() else {
            self.state.battles.pirates.remove(&t.pirate);
            return Ok(());
        };
        let owner = fleet.owner;
        let ships_before = fleet.ships.len() as i64;
        if result == BattleResult::Won {
            self.salvage_after(t.fleet, &format!("battle:{}", id.0))?;
        }
        // 玩家船只：耐久写回，被击沉或被俘的船耐久归零后由沉船处理核销
        {
            let f = self.fleet_mut(t.fleet)?;
            let mut crew = 0;
            for u in t.units.iter().filter(|u| u.player) {
                if let Some(s) = f.ships.get_mut(u.ship) {
                    s.durability = if u.status == UnitStatus::Active { u.hp.max(1) } else { 0 };
                }
                if u.status == UnitStatus::Active && u.legend.as_ref().is_none_or(|t| !t.ghost) {
                    crew += u.crew;
                }
            }
            f.crew = crew;
        }
        // 俘获的海盗船编入舰队（有空位时），按转售价入账
        let mut captured = 0;
        for u in t.units.iter().filter(|u| !u.player && u.status == UnitStatus::Captured) {
            if self.fleet(t.fleet)?.ships.len() >= crate::world::MAX_SHIPS_PER_FLEET {
                break;
            }
            let mut ship = new_ship(&defs, u.kind);
            ship.durability = u.hp.max(1).min(ship.max_durability);
            let value = self.ship_resale(&ship);
            ship.book_value = value;
            self.fleet_mut(t.fleet)?.ships.push(ship);
            if value > 0 {
                self.book_internal(
                    owner,
                    JournalEntry::new(day, Memo::Other, CashClass::Investing)
                        .dr(Account::Ships, value)
                        .cr(Account::AssetGains, value),
                )?;
            }
            captured += 1;
        }
        // 海盗：被全歼则消失；否则残部撤离
        let survivors: Vec<&Unit> = t.units.iter().filter(|u| !u.player && u.status == UnitStatus::Active).collect();
        if survivors.is_empty() || result == BattleResult::Won {
            self.state.battles.pirates.remove(&t.pirate);
        } else if let Some(p) = self.state.battles.pirates.get_mut(&t.pirate) {
            let mut ships = Vec::new();
            let mut crew = 0;
            for u in survivors {
                if let Some(s) = p.ships.get(u.ship) {
                    let mut s = s.clone();
                    s.durability = u.hp.max(1);
                    ships.push(s);
                    crew += u.crew;
                }
            }
            p.ships = ships;
            p.crew = crew.max(1);
            p.engaged = false;
            p.until = p.until.min(day + 3);
        }
        if result == BattleResult::Won
            && matches!(fleet.location, FleetLocation::AtSea(_))
            && let Some(port) = self.fleet_port(&fleet)
        {
            let faction = self.location_faction(port);
            self.adjust_reputation(owner, faction, defs.rules.battle.reputation_win);
        }
        self.abandon_unmanned_ships(t.fleet)?;
        self.sink_wrecked_ships(t.fleet)?;
        if self.state.fleets.get(&t.fleet).is_some_and(|f| crate::legend_ships::mechanics::fleet_unmanned(&defs, f)) {
            self.destroy_fleet(t.fleet)?;
        }
        let ships_after = self.state.fleets.get(&t.fleet).map(|f| f.ships.len() as i64).unwrap_or(0);
        self.record_battle(BattleRecord {
            id,
            day,
            fleet: t.fleet,
            owner,
            mode: BattleMode::Tactical,
            result,
            cargo_lost: 0,
            cash_lost: 0,
            ships_lost: (ships_before + captured - ships_after).max(0),
            captured,
        });
        Ok(())
    }
}

/// 战斗命令的预检结果。
pub(crate) enum BattlePlan {
    Auto(BattleId),
    Tactical(BattleId),
    Order(BattleId, TacticalOrder),
}

pub(crate) fn check_engage(
    world: &World,
    owner: OwnerId,
    id: BattleId,
    tactical: bool,
) -> Result<BattlePlan, CommandError> {
    let p = world.state.battles.pending.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    let f = world.state.fleets.get(&p.fleet).ok_or_else(|| CommandError::NotFound(format!("{:?}", p.fleet)))?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    Ok(if tactical { BattlePlan::Tactical(id) } else { BattlePlan::Auto(id) })
}

pub(crate) fn check_order(
    world: &World,
    owner: OwnerId,
    id: BattleId,
    order: TacticalOrder,
) -> Result<BattlePlan, CommandError> {
    let t = world.state.battles.tactical.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    let f = world.state.fleets.get(&t.fleet).ok_or_else(|| CommandError::NotFound(format!("{:?}", t.fleet)))?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    let range = world.defs.rules.battle.gun_range;
    let own_unit = |u: u8| t.units.iter().any(|x| x.id == u && x.player && x.status == UnitStatus::Active);
    let ok = match order {
        TacticalOrder::Move { unit, q, r } => own_unit(unit) && t.reachable(unit).contains_key(&(q, r)),
        TacticalOrder::Turn { unit, facing } => {
            own_unit(unit) && facing < 6 && t.units.iter().any(|x| x.id == unit && x.mp_left >= 1)
        }
        TacticalOrder::Fire { unit, target } => own_unit(unit) && t.can_fire(unit, target, range),
        TacticalOrder::Board { unit, target } => own_unit(unit) && t.can_board(unit, target),
        TacticalOrder::Retreat | TacticalOrder::EndTurn => true,
    };
    if !ok {
        return Err(crate::error::Reason::new("battle.invalid_order", "该操作在当前战局下无效").rule());
    }
    Ok(BattlePlan::Order(id, order))
}

pub(crate) fn exec(world: &mut World, plan: BattlePlan) -> Result<(), CoreError> {
    match plan {
        BattlePlan::Auto(id) => world.resolve_pending_auto(id),
        BattlePlan::Tactical(id) => world.start_tactical(id),
        BattlePlan::Order(id, order) => world.tactical_order(id, order),
    }
}

#[cfg(test)]
mod legend_tests;

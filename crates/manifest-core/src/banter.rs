//! H08 甲板闲话（`rules.toml [banter]` 与数据分片 `voyage/banter.toml`，VOYAGE-PLAN §9）。
//!
//! 航海士对当下的反应：每天日结时看旗舰队（手动航行、在海上）这一天发生了什么，命中一个**触发键**就从数据里挑一句，
//! 第二天在航行视图角上冒出来（非模态、几秒后淡掉）。偶尔附一个可选的小互动（`Command::BanterReply`：好感 +1 左右）。
//!
//! - 触发键（按优先级）：`shook_off`（甩掉了海盗）、`storm_ahead`（望见风暴团）、`fog_ahead`（望见雾团）、`sighting`（碰上海上所见）、
//!   `becalmed`（无风或顶风走不动）、`new_region`（头一回进这片海区）、`convoy`（正在结伴）、`near_port`（离看见过的港口 4 格以内、
//!   已出海 3 天以上）、`long_voyage`（出海 30 天起，每 15 天一回）。
//!   依赖 H02 船员状态的 `no_fresh`、`fatigue`、`short_rations`、`grumbling` 只在数据与校验里认，**还没有接线**（见交接文档）。
//! - 说话人：数据里每句写 `mate`（有名有姓的同伴，雇着才说）或 `role`（按岗位：谁在这个岗位上谁说）或都不写（船上的老水手）。
//!   同一个触发键，有雇着的同伴的专属句时先用专属句，没有就退回岗位句，再退回老水手。数据允许某个同伴还没有句子。
//! - 频率：每天至多一句；命中后再掷一次 `chance_bp`；同一个触发键 `trigger_cooldown` 天内不再触发；同一句 `line_cooldown` 天内不重复。
//! - 随机数 `Rng::derive(种子, 日期, Domain::Banter, …)`，不存随机数状态。开关关闭时什么也不做，状态里没有这一节。

use crate::OwnerId;
use crate::error::{CommandError, Reason};
use crate::ids::{FleetId, MateId};
use crate::mates::MateRole;
use crate::rng::{Domain, Rng};
use crate::world::{FleetLocation, Voyage, World, WorldState};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 已接线的触发键（按优先级）。
pub const TRIGGERS: [&str; 9] = [
    "shook_off",
    "storm_ahead",
    "fog_ahead",
    "sighting",
    "becalmed",
    "new_region",
    "convoy",
    "near_port",
    "long_voyage",
];
/// 数据里认、但要等 H02 合入才接线的触发键。
pub const RESERVED_TRIGGERS: [&str; 4] = ["no_fresh", "fatigue", "short_rations", "grumbling"];

/// 可选的小互动。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BanterReply {
    /// 按钮上的字
    pub label: String,
    /// 按下以后说话人回的一句
    pub answer: String,
    /// 好感（或忠诚）加多少
    pub affinity: i64,
}

/// 一句闲话（数据分片的一条）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BanterDef {
    pub key: String,
    pub trigger: String,
    /// 有名有姓的同伴（航海士的键）
    pub mate: Option<String>,
    /// 按岗位（`captain.toml` 的岗位键）
    pub role: Option<String>,
    pub text: String,
    pub reply: Option<BanterReply>,
}

/// 甲板闲话的规则（`rules.toml [banter]`）与数据表。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BanterRules {
    pub enabled: bool,
    /// 命中触发以后真的说一句的概率（万分比）
    pub chance_bp: i64,
    /// 同一个触发键几天内不再触发
    pub trigger_cooldown: u32,
    /// 同一句几天内不重复
    pub line_cooldown: u32,
    /// 出海多少天起算“出海很久”，之后每隔多少天再说一回
    pub long_voyage_days: u32,
    pub long_voyage_every: u32,
    /// “快到港了”：离看见过的港口几格以内、出海至少几天
    pub near_port_cells: i64,
    pub near_port_days: u32,
    #[serde(skip)]
    pub defs: Vec<BanterDef>,
}

impl Default for BanterRules {
    fn default() -> Self {
        Self {
            enabled: false,
            chance_bp: 6_000,
            trigger_cooldown: 3,
            line_cooldown: 60,
            long_voyage_days: 30,
            long_voyage_every: 15,
            near_port_cells: 4,
            near_port_days: 3,
            defs: Vec::new(),
        }
    }
}

impl BanterRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(0..=10_000).contains(&self.chance_bp) {
            out.push(("chance_bp", "须在 0–10000 之间"));
        }
        if self.long_voyage_every == 0 || !(0..=32).contains(&self.near_port_cells) {
            out.push(("long_voyage_every", "间隔至少 1 天、港口距离 0–32 格"));
        }
        out
    }
}

/// 今天这一句（第二天在航行视图上冒出来）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BanterLine {
    /// 说出这句的日结日（界面在下一天显示）
    pub day: u32,
    pub fleet: FleetId,
    pub key: String,
    /// 说话的航海士（老水手为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mate: Option<MateId>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replied: bool,
}

/// 甲板闲话的状态。开关关闭时总是空的、不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BanterState {
    /// 每一句最近说出的日子
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub lines: BTreeMap<String, u32>,
    /// 每个触发键最近触发的日子
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub triggers: BTreeMap<String, u32>,
    /// 去过的海区（“头一回进这片海区”用）
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub regions: BTreeSet<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<BanterLine>,
}

impl BanterState {
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty() && self.triggers.is_empty() && self.regions.is_empty() && self.current.is_none()
    }
}

impl World {
    /// 这一天旗舰队命中的触发键（按优先级）。
    fn banter_triggers(&mut self, fleet: FleetId) -> Vec<&'static str> {
        let rules = self.defs.rules.banter.clone();
        let day = self.state.day;
        let Some(f) = self.state.fleets.get(&fleet).cloned() else { return Vec::new() };
        let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location else { return Vec::new() };
        let logs: Vec<&crate::log::LogKind> =
            self.state.log.iter().rev().take_while(|e| e.day >= day).map(|e| &e.kind).collect();
        use crate::log::LogKind as L;
        let mut out = Vec::new();
        if logs.iter().any(|k| matches!(k, L::ShookOff { fleet: x, .. } if *x == fleet)) {
            out.push("shook_off");
        }
        if logs.iter().any(|k| matches!(k, L::StormSighted { fleet: x, .. } if *x == fleet)) {
            out.push("storm_ahead");
        }
        if logs.iter().any(|k| matches!(k, L::FogSighted { fleet: x, .. } if *x == fleet)) {
            out.push("fog_ahead");
        }
        if self.state.sightings.active.iter().any(|s| s.fleet == fleet && s.touched)
            || self.state.sightings.last.as_ref().is_some_and(|l| l.fleet == fleet && l.day == day)
        {
            out.push("sighting");
        }
        // H02 的四个触发（船况规则关着时都不出）：断鲜 ≥ 30 天、疲劳过线、口粮不是足额、这一趟出过怨言
        if self.wear_applies(fleet) {
            let w = self.fleet_wear(fleet);
            if w.fresh_days >= 30 {
                out.push("no_fresh");
            }
            if w.fatigue >= self.defs.rules.voyage_wear.tired {
                out.push("fatigue");
            }
            if w.orders.rations != crate::seafaring::Rations::Full {
                out.push("short_rations");
            }
            if w.crisis.grumbled {
                out.push("grumbling");
            }
        }
        let cell = f.cell(&self.defs);
        let weather = self.weather_at_pos(cell);
        let wind_from = weather.map(|w| (u16::from(w.sea.wind_dir) * 45 + 180) % 360);
        let irons = wind_from.is_some_and(|from| {
            crate::navigation::course::angle_between(manual.heading, from)
                < crate::navigation::course::sail_limit(&self.defs, &f)
        });
        if manual.sail != crate::navigation::Sail::Furled
            && (weather.is_some_and(|w| w.sea.wind_strength == 0) || irons)
        {
            out.push("becalmed");
        }
        if let Some(r) = self.defs.map.region_of(cell) {
            let seen = &mut self.state.banter.regions;
            let first = seen.is_empty();
            if seen.insert(r.0) && !first {
                out.push("new_region");
            }
        }
        if self.convoy_active(fleet) {
            out.push("convoy");
        }
        let topology = self.defs.map.topology();
        if f.days_at_sea >= rules.near_port_days
            && self.visible_locations().any(|l| {
                self.defs.loc(l).is_port() && topology.chebyshev(self.defs.loc(l).cell, cell) <= rules.near_port_cells
            })
        {
            out.push("near_port");
        }
        if f.days_at_sea >= rules.long_voyage_days
            && (f.days_at_sea - rules.long_voyage_days).is_multiple_of(rules.long_voyage_every.max(1))
        {
            out.push("long_voyage");
        }
        out
    }

    /// 玩家雇着的航海士：（航海士, 键, 所在岗位的键）。
    fn banter_crew(&self) -> Vec<(MateId, String, Option<String>)> {
        let roles = &self.defs.captain.roles;
        self.state
            .mates
            .iter()
            .filter(|(_, m)| m.owner == Some(OwnerId::Player))
            .filter_map(|(id, m)| {
                let key = self.defs.mates.get(id.idx())?.key.clone();
                let role = match m.role {
                    MateRole::Captain(_) => Some("captain".to_owned()),
                    MateRole::Accountant => Some("accountant".to_owned()),
                    MateRole::Trader => Some("trader".to_owned()),
                    MateRole::Assigned { role, .. } => roles.get(usize::from(role)).map(|r| r.key.clone()),
                    _ => None,
                };
                Some((*id, key, role))
            })
            .collect()
    }

    /// 日结：给旗舰队挑今天的一句（开关关闭、旗舰队不在海上时什么也不做）。
    pub(crate) fn banter_day(&mut self) {
        let rules = self.defs.rules.banter.clone();
        if !rules.enabled || rules.defs.is_empty() {
            return;
        }
        let day = self.state.day;
        let Some(fleet) = self.flagship(OwnerId::Player) else { return };
        let triggers = self.banter_triggers(fleet);
        let crew = self.banter_crew();
        let mut rng = Rng::derive(self.state.seed, day, Domain::Banter, u64::from(fleet.0), 0);
        if triggers.is_empty() || !rng.chance_bp(rules.chance_bp) {
            return;
        }
        let st = &self.state.banter;
        for trigger in triggers {
            if st.triggers.get(trigger).is_some_and(|d| d + rules.trigger_cooldown > day) {
                continue;
            }
            let fresh =
                |d: &crate::banter::BanterDef| st.lines.get(&d.key).is_none_or(|x| x + rules.line_cooldown <= day);
            let pool: Vec<&BanterDef> = rules.defs.iter().filter(|d| d.trigger == trigger && fresh(d)).collect();
            // 专属句（雇着的同伴）→ 岗位句（有人在这个岗位上）→ 老水手
            let named: Vec<(&BanterDef, Option<MateId>)> = pool
                .iter()
                .filter_map(|d| {
                    let key = d.mate.as_ref()?;
                    crew.iter().find(|(_, k, _)| k == key).map(|(id, _, _)| (*d, Some(*id)))
                })
                .collect();
            let by_role: Vec<(&BanterDef, Option<MateId>)> = pool
                .iter()
                .filter(|d| d.mate.is_none())
                .filter_map(|d| match &d.role {
                    Some(role) => {
                        crew.iter().find(|(_, _, r)| r.as_ref() == Some(role)).map(|(id, _, _)| (*d, Some(*id)))
                    }
                    None => None,
                })
                .collect();
            let anyone: Vec<(&BanterDef, Option<MateId>)> =
                pool.iter().filter(|d| d.mate.is_none() && d.role.is_none()).map(|d| (*d, None)).collect();
            let choice = [named, by_role, anyone].into_iter().find(|c| !c.is_empty());
            let Some(choice) = choice else { continue };
            let (def, mate) = choice[rng.below(choice.len() as u64) as usize];
            let key = def.key.clone();
            let st = &mut self.state.banter;
            st.lines.insert(key.clone(), day);
            st.triggers.insert(trigger.to_owned(), day);
            st.lines.retain(|_, d| *d + rules.line_cooldown > day);
            st.current = Some(BanterLine { day, fleet, key, mate, replied: false });
            return;
        }
    }
}

/// 命令校验：回应今天这一句的小互动（只能一次）。返回结算后的世界状态。
pub(crate) fn check_reply(world: &World, owner: OwnerId) -> Result<Box<WorldState>, CommandError> {
    let rules = &world.defs.rules.banter;
    if !rules.enabled || owner != OwnerId::Player {
        return Err(Reason::new("banter.disabled", "这个世界没有甲板闲话").rule());
    }
    let line = world.state.banter.current.clone().ok_or_else(|| Reason::new("banter.none", "眼下没人说话").rule())?;
    if line.replied || line.day + 1 < world.state.day {
        return Err(Reason::new("banter.done", "这句话已经过去了").rule());
    }
    let def =
        rules.defs.iter().find(|d| d.key == line.key).ok_or_else(|| Reason::new("banter.def", "没有这句话").rule())?;
    let reply = def.reply.as_ref().ok_or_else(|| Reason::new("banter.reply", "这句话不用回应").rule())?;
    let mut w = world.clone();
    if let Some(id) = line.mate {
        let key = w.defs.mates.get(id.idx()).map(|m| m.key.clone()).unwrap_or_default();
        if w.change_affinity(&key, reply.affinity).is_err()
            && let Some(m) = w.state.mates.get_mut(&id)
        {
            // 不是人物表里的人：加忠诚
            m.loyalty = (m.loyalty + reply.affinity).clamp(0, 100);
        }
    }
    if let Some(c) = w.state.banter.current.as_mut() {
        c.replied = true;
    }
    Ok(Box::new(w.state))
}

/// 校验数据里的触发键（已接线的与留给 H02 的都认）。
pub fn known_trigger(t: &str) -> bool {
    TRIGGERS.contains(&t) || RESERVED_TRIGGERS.contains(&t)
}

#[cfg(test)]
#[path = "banter_tests.rs"]
mod tests;

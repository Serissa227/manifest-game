//! H01 岗位与装备在海上的效果（`rules.toml [voyage_posts]`，规格见 `docs/VOYAGE-PLAN.md` §2）。
//!
//! 读取点的写法照 [`crate::mates`] 里的 `FlagshipSpeed`：同一舰队的在岗航海士与旗舰上的主角取较高者
//! （[`World::staffed_hook`]），再与所有者级岗位（会计等）取较高者。
//!
//! 钩子的“值”：比例类钩子在属性与物品里一律以基点记（100 = 1%），这里先折成百分点；
//! `upwind`（度）、`morale`（天）、`position_fix` 与 `steering_precision`（0–100 左右的点数）按原数；
//! `fog_sailing` 的物品效果只有 0 / 1，按“1 = 抵消 100%”折算。
//!
//! 开关关闭、或舰队不属于玩家时，所有效果都是中性值（乘 100%、加 0），调用处不改变原有的计算与随机数消耗。

use crate::captain::AttrHook;
use crate::mates::RoleTarget;
use crate::{FleetId, OwnerId, World};
use serde::{Deserialize, Serialize};

/// `rules.toml [voyage_posts]`：各钩子的上限。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PostsRules {
    pub enabled: bool,
    /// 顶风死区最多收窄几度
    pub upwind_max: i64,
    /// 雾天降速最多抵消百分之几
    pub fog_max: i64,
    /// 暴风雨的船体损伤与落水货最多减免百分之几
    pub storm_max: i64,
    /// 疾病发生概率最多减免百分之几
    pub disease_max: i64,
    /// 疾病死亡比例最多减免百分之几
    pub healing_max: i64,
    /// 粮水日耗最多节省百分之几
    pub supply_max: i64,
    /// “航行超过若干天后士气每天 −1”的起点最多推迟几天
    pub morale_max: i64,
    /// 触礁、搁浅的损伤最多减免百分之几
    pub steering_max: i64,
    /// 看见港口与地标的距离最多加长百分之几
    pub position_max: i64,
    /// 看见别的舰队：每多少个百分点的 `intel_detection` 多看一格
    pub intel_per_cell: i64,
    /// 看见别的舰队最多多看几格（基础视野 6 格 → 最多 10 格）
    pub intel_cells_max: i64,
    /// 多船舰队：航速从最慢船向次慢船靠拢的比例上限（百分之几）
    pub coordination_max: i64,
    /// 接舷战的船员项最多加成百分之几（`melee` + `duel` 的一半）
    pub boarding_max: i64,
}

impl Default for PostsRules {
    fn default() -> Self {
        Self {
            enabled: false,
            upwind_max: 8,
            fog_max: 100,
            storm_max: 60,
            disease_max: 70,
            healing_max: 50,
            supply_max: 30,
            morale_max: 30,
            steering_max: 60,
            position_max: 50,
            intel_per_cell: 5,
            intel_cells_max: 4,
            coordination_max: 50,
            boarding_max: 100,
        }
    }
}

impl PostsRules {
    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        let pct = [
            ("fog_max", self.fog_max),
            ("storm_max", self.storm_max),
            ("disease_max", self.disease_max),
            ("healing_max", self.healing_max),
            ("supply_max", self.supply_max),
            ("steering_max", self.steering_max),
            ("coordination_max", self.coordination_max),
        ];
        for (field, v) in pct {
            if !(0..=100).contains(&v) {
                out.push((field, "必须在 0 到 100 之间"));
            }
        }
        if !(0..=45).contains(&self.upwind_max) {
            out.push(("upwind_max", "必须在 0 到 45 度之间"));
        }
        if !(0..=365).contains(&self.morale_max) {
            out.push(("morale_max", "必须在 0 到 365 天之间"));
        }
        if !(0..=500).contains(&self.position_max) || !(0..=500).contains(&self.boarding_max) {
            out.push(("position_max", "position_max 与 boarding_max 必须在 0 到 500 之间"));
        }
        if self.intel_per_cell < 1 || !(0..=58).contains(&self.intel_cells_max) {
            out.push(("intel_per_cell", "intel_per_cell 至少为 1，intel_cells_max 在 0 到 58 之间"));
        }
        out
    }
}

/// 一支舰队在海上的航速修正与常设命令（积分器与日结共用）。缺省是中性值：航速 ×1、死区不变、雾照常减速、取最慢船。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VoyageMods {
    /// 航速乘数（万分比，10000 = 不变）
    pub speed_bp: i64,
    /// 顶风死区的增减（度；负数收窄）
    pub upwind: i64,
    /// 雾天降速抵消的百分比（0–100）
    pub fog_offset: i64,
    /// 多船舰队航速从最慢船向次慢船靠拢的百分比（0–100）
    pub coordination: i64,
    /// 不干活的人（H02 的病号）：计算人手是否足够时从船员里扣掉
    pub idle_crew: i64,
    /// H02 常设命令：进风暴自动收到半帆、出了风暴放回满帆
    pub auto_reef: bool,
    /// 本舰队的粮水提醒天数；None 表示没有常设命令系统，Some(0) 表示玩家关闭提醒。
    pub supply_alert: Option<u8>,
}

impl VoyageMods {
    pub const NEUTRAL: Self = Self {
        speed_bp: 10_000,
        upwind: 0,
        fog_offset: 0,
        coordination: 0,
        idle_crew: 0,
        auto_reef: false,
        supply_alert: None,
    };

    pub fn is_neutral(&self) -> bool {
        *self == Self::NEUTRAL
    }
}

impl Default for VoyageMods {
    fn default() -> Self {
        Self::NEUTRAL
    }
}

/// 钩子值折成规格里的“值”。
fn spec_value(hook: AttrHook, raw: i64) -> i64 {
    match hook {
        AttrHook::Upwind | AttrHook::Morale | AttrHook::PositionFix | AttrHook::SteeringPrecision => raw,
        AttrHook::FogSailing => raw.saturating_mul(100),
        _ => raw / 100,
    }
    .max(0)
}

/// 规格公式：`(100 − min(cap, 值))%`，以百分数表示保留的部分。
pub fn keep_pct(value: i64, cap: i64) -> i64 {
    100 - value.clamp(0, cap.clamp(0, 100))
}

/// 接舷战里按 `melee` / `duel` 加成后的船员项（自动结算用；加成为 0 时原样）。
pub fn boarding_crew(crew: i64, bonus_pct: i64) -> i64 {
    if bonus_pct <= 0 { crew } else { crate::fixed::mul_div(crew, 100 + bonus_pct, 100) }
}

impl World {
    pub fn posts_enabled(&self) -> bool {
        self.defs.rules.voyage_posts.enabled
    }

    /// 某支玩家舰队在海上的岗位效果（规格里的“值”）；开关关闭或不是玩家的舰队时为 0。
    pub fn post_value(&self, fleet: FleetId, hook: AttrHook) -> i64 {
        if !self.posts_enabled() {
            return 0;
        }
        let Some(f) = self.state.fleets.get(&fleet) else { return 0 };
        if f.owner != OwnerId::Player {
            return 0;
        }
        let staffed = self.staffed_hook(f.owner, hook, RoleTarget::Fleet(fleet));
        let owner = self.role_hook(f.owner, hook, RoleTarget::Owner);
        spec_value(hook, staffed.max(owner))
    }

    fn post_rules(&self) -> &PostsRules {
        &self.defs.rules.voyage_posts
    }

    /// `upwind`：顶风死区收窄的度数。
    pub fn post_upwind(&self, fleet: FleetId) -> i64 {
        self.post_value(fleet, AttrHook::Upwind).min(self.post_rules().upwind_max)
    }
    /// `fog_sailing`：雾天降速抵消的百分比。
    pub fn post_fog_offset(&self, fleet: FleetId) -> i64 {
        self.post_value(fleet, AttrHook::FogSailing).min(self.post_rules().fog_max).clamp(0, 100)
    }
    /// `storm_check`：暴风雨损伤与落水货保留的百分比。
    pub fn post_storm_keep(&self, fleet: FleetId) -> i64 {
        keep_pct(self.post_value(fleet, AttrHook::StormCheck), self.post_rules().storm_max)
    }
    /// `disease_guard`：疾病发生概率保留的百分比。
    pub fn post_disease_keep(&self, fleet: FleetId) -> i64 {
        keep_pct(self.post_value(fleet, AttrHook::DiseaseGuard), self.post_rules().disease_max)
    }
    /// `healing`：疾病死亡比例保留的百分比。
    pub fn post_healing_keep(&self, fleet: FleetId) -> i64 {
        keep_pct(self.post_value(fleet, AttrHook::Healing), self.post_rules().healing_max)
    }
    /// `supply_discount`：粮水日耗保留的百分比。
    pub fn post_supply_keep(&self, fleet: FleetId) -> i64 {
        keep_pct(self.post_value(fleet, AttrHook::SupplyDiscount), self.post_rules().supply_max)
    }
    /// `morale`：士气开始每天下降的起点推迟的天数。
    pub fn post_morale_delay(&self, fleet: FleetId) -> u32 {
        self.post_value(fleet, AttrHook::Morale).clamp(0, self.post_rules().morale_max.max(0)) as u32
    }
    /// `steering_precision`：触礁、搁浅损伤保留的百分比（H04 暗礁、H05 登陆读取）。
    pub fn post_steering_keep(&self, fleet: FleetId) -> i64 {
        keep_pct(self.post_value(fleet, AttrHook::SteeringPrecision), self.post_rules().steering_max)
    }
    /// `position_fix`：看见港口与地标的距离加长的百分比（H07 的寻路档位也读它）。
    pub fn post_position_bonus(&self, fleet: FleetId) -> i64 {
        self.post_value(fleet, AttrHook::PositionFix).min(self.post_rules().position_max)
    }
    /// `intel_detection`：看见别的舰队多看几格。
    pub fn post_intel_cells(&self, fleet: FleetId) -> i64 {
        let r = self.post_rules();
        (self.post_value(fleet, AttrHook::IntelDetection) / r.intel_per_cell.max(1)).min(r.intel_cells_max)
    }
    /// `fleet_coordination`：多船舰队航速从最慢船向次慢船靠拢的百分比。
    pub fn post_coordination(&self, fleet: FleetId) -> i64 {
        self.post_value(fleet, AttrHook::FleetCoordination).min(self.post_rules().coordination_max).clamp(0, 100)
    }
    /// `melee` + `duel` 的一半：接舷战船员项的加成百分比。
    pub fn post_boarding_bonus(&self, fleet: FleetId) -> i64 {
        let melee = self.post_value(fleet, AttrHook::Melee);
        let duel = self.post_value(fleet, AttrHook::Duel);
        melee.saturating_add(duel / 2).min(self.post_rules().boarding_max)
    }

    /// 积分器与日结共用的航速修正；开关都关时是中性值。
    pub fn voyage_mods(&self, fleet: FleetId) -> VoyageMods {
        VoyageMods {
            speed_bp: self.wear_speed_bp(fleet),
            upwind: self.wear_upwind(fleet) - self.post_upwind(fleet),
            fog_offset: self.post_fog_offset(fleet),
            coordination: self.post_coordination(fleet),
            idle_crew: self.wear_idle_crew(fleet),
            auto_reef: self.wear_auto_reef(fleet),
            supply_alert: self.wear_applies(fleet).then(|| self.fleet_wear(fleet).orders.supply_alert),
        }
    }

    /// 看见别的舰队的距离（格）：航行视野加 `intel_detection` 的格数（H03 的航行视图读取）。
    pub fn fleet_sight_cells(&self, fleet: FleetId) -> i64 {
        (self.navigation_sight(fleet) + self.post_intel_cells(fleet)).clamp(0, 64)
    }

    /// 看见港口与地标的距离（格）：航行视野按 `position_fix` 加长。
    pub fn landmark_sight_cells(&self, fleet: FleetId) -> i64 {
        let base = self.navigation_sight(fleet);
        (base + crate::fixed::mul_div(base, self.post_position_bonus(fleet), 100)).clamp(0, 64)
    }
}

#[cfg(test)]
#[path = "posts_hooks_tests.rs"]
mod hooks_tests;
#[cfg(test)]
#[path = "posts_tests.rs"]
mod tests;

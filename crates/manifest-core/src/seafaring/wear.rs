//! H02 船况、口粮与船员状态（`rules.toml [voyage_wear]`，规格见 `docs/VOYAGE-PLAN.md` §3）。
//!
//! 把“每天自动掷骰”换成看得见、管得了的几条状态：船底附着、帆缆、船材、疲劳、断鲜天数与病号，
//! 外加一组常设命令（口粮、节奏、自动项）。只对玩家（含模拟器 bot）的舰队生效；状态放在
//! `WorldState::voyage`（按舰队编号），规则关闭时为空、不写进存档，不升存档版本。
//!
//! 数值都是初值，旧值 / 新值的记录见 `docs/drafts/h02-handoff.md`。百分比一律整数，内部的附着与帆缆按百分之一点记，
//! 免得“每两天 +1”“磨损 ×0.7”这类零头丢掉。

use crate::fixed::mul_div;
use crate::log::{LogEvent, LogKind};
use crate::navigation::Sail;
use crate::rng::{Domain, Rng};
use crate::weather::{Climate, DayWeather, Sky};
use crate::world::{FleetLocation, Voyage};
use crate::{CoreError, FleetId, OwnerId, World};
use serde::{Deserialize, Serialize};

/// 附着、帆缆的内部刻度：100 = 1 点。
pub const POINT: i64 = 100;

/// `rules.toml [voyage_wear]`。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WearRules {
    pub enabled: bool,
    // ── 船底附着（0–100，0 为干净）──
    /// 在海上每天涨几点（温和、干燥海区）
    pub fouling_daily: i64,
    /// 热带海区每天涨几点
    pub fouling_tropical: i64,
    /// 寒带海区每多少天涨 1 点
    pub fouling_cold_every: i64,
    /// 附着满 100 时航速最多慢百分之几
    pub fouling_slow_max: i64,
    // ── 帆缆（0–100，100 为完好）──
    /// 每多少天自然磨损 1 点
    pub rigging_every: i64,
    /// 风力不低于这个值、又满帆时算“大风满帆”
    pub rigging_gale_wind: i64,
    /// 大风满帆每天磨损几点
    pub rigging_gale: i64,
    /// 暴风雨里满帆 / 半帆 / 收帆每天磨损几点
    pub rigging_storm: [i64; 3],
    /// 帆缆为 0 时航速只剩百分之几（100 时不减）
    pub rigging_floor: i64,
    // ── 船材 ──
    /// 每艘船最多带几份船材
    pub timber_per_ship: i64,
    /// 港口补给页买一份船材的价钱
    pub timber_price: i64,
    // ── 海上修理（自动）──
    /// 帆缆低于这个值时每天花 1 份船材修 `repair_rigging` 点
    pub repair_rigging_below: i64,
    pub repair_rigging: i64,
    /// 船体低于百分之几时每天花 1 份船材修 `repair_hull` 个百分点（水手长 storm_check 每 10 点再 +1），只修到这个线
    pub repair_hull_below: i64,
    pub repair_hull: i64,
    /// 船体低于百分之几时进水，每天再掉 `leak` 个百分点
    pub leak_below: i64,
    pub leak: i64,
    // ── 载重 ──
    /// 货物（不含粮水）超过容量的百分之几开始减速
    pub load_free: i64,
    /// 每超出几个百分点慢 1%
    pub load_step: i64,
    /// 最多慢百分之几
    pub load_slow_max: i64,
    // ── 疲劳（0–100）──
    pub fatigue_short_crew: i64,
    pub fatigue_storm: i64,
    pub fatigue_hard: i64,
    pub fatigue_easy: i64,
    pub fatigue_anchor: i64,
    pub fatigue_port: i64,
    /// 疲劳不低于这个值：航速 −`tired_slow`%，每天 `accident_bp` 万分之几出事故
    pub tired: i64,
    pub tired_slow: i64,
    pub accident_bp: i64,
    /// 疲劳不低于这个值：航速 −`exhausted_slow`%，士气每天 −`exhausted_morale`
    pub exhausted: i64,
    pub exhausted_slow: i64,
    pub exhausted_morale: i64,
    // ── 鲜食与坏血病 ──
    /// 断鲜超过这么多天开始发病（船医的 healing 每 10 点再加 `scurvy_healing_days` 天）
    pub scurvy_after: i64,
    pub scurvy_healing_days: i64,
    /// 每天新添病号占船员的百分比（足额或减额 / 半额口粮）
    pub scurvy_rate: [i64; 2],
    /// 病号每天死亡的百分比（受 healing 减免）
    pub sick_death: i64,
    /// 吃到鲜食（或在港）后每天康复的百分比
    pub sick_recover: i64,
    /// 抗坏血病的货（商品 key）：货舱里有时每天按“船员 ÷ 50”吃掉，断鲜天数不涨
    pub antiscorbutic: Vec<String>,
    // ── 口粮与节奏 ──
    /// 减额 / 半额口粮吃掉的百分比
    pub ration_pct: [i64; 2],
    /// 减额 / 半额口粮每天掉的士气
    pub ration_morale: [i64; 2],
    /// 从容 / 赶路的航速增减（百分点）
    pub pace_speed: [i64; 2],
    /// 从容 / 赶路的帆缆磨损倍率（百分比）
    pub pace_rigging: [i64; 2],
    // ── 船坞刮船底 ──
    /// 费用为船价的万分之几
    pub scrape_bp: i64,
    // ── 改装的联动（改装 key，百分比；舰队按各船平均）──
    /// 附着涨幅
    pub refit_fouling: Vec<(String, i64)>,
    /// 进水损失
    pub refit_leak: Vec<(String, i64)>,
    /// 帆缆磨损
    pub refit_rigging: Vec<(String, i64)>,
    // ── 哗变分阶段 ──
    /// 怨言：士气低于这个值，每次出海一次
    pub grumble_below: i64,
    /// 怠工：士气低于这个值开始，回到 `slowdown_until` 以上才结束；期间航速 −`slowdown_slow`%
    pub slowdown_below: i64,
    pub slowdown_until: i64,
    pub slowdown_slow: i64,
    /// 哗变：士气低于这个值连续 `mutiny_days` 天
    pub mutiny_below: i64,
    pub mutiny_days: u32,
    /// 答应“改去最近的港”之后，多少天内要靠港，否则士气 −`promise_morale`
    pub promise_days: u32,
    pub promise_morale: i64,
    /// 三个阶段的奇遇（`stories/` 里 `forced = true` 的条目；每阶段几套说法，按日子轮换）
    pub grumble_events: Vec<String>,
    pub slowdown_events: Vec<String>,
    pub mutiny_events: Vec<String>,
}

impl Default for WearRules {
    fn default() -> Self {
        Self {
            enabled: false,
            fouling_daily: 1,
            fouling_tropical: 2,
            fouling_cold_every: 2,
            fouling_slow_max: 15,
            rigging_every: 10,
            rigging_gale_wind: 8,
            rigging_gale: 2,
            rigging_storm: [10, 4, 1],
            rigging_floor: 70,
            timber_per_ship: 20,
            timber_price: 15,
            repair_rigging_below: 70,
            repair_rigging: 5,
            repair_hull_below: 70,
            repair_hull: 2,
            leak_below: 30,
            leak: 1,
            load_free: 60,
            load_step: 4,
            load_slow_max: 10,
            fatigue_short_crew: 2,
            fatigue_storm: 3,
            fatigue_hard: 4,
            fatigue_easy: 3,
            fatigue_anchor: 5,
            fatigue_port: 20,
            tired: 60,
            tired_slow: 5,
            accident_bp: 300,
            exhausted: 85,
            exhausted_slow: 12,
            exhausted_morale: 2,
            scurvy_after: 45,
            scurvy_healing_days: 5,
            scurvy_rate: [2, 3],
            sick_death: 5,
            sick_recover: 20,
            antiscorbutic: Vec::new(),
            ration_pct: [75, 50],
            ration_morale: [1, 3],
            pace_speed: [-10, 8],
            pace_rigging: [50, 200],
            scrape_bp: 50,
            refit_fouling: Vec::new(),
            refit_leak: Vec::new(),
            refit_rigging: Vec::new(),
            grumble_below: 30,
            slowdown_below: 15,
            slowdown_until: 20,
            slowdown_slow: 20,
            mutiny_below: 8,
            mutiny_days: 3,
            promise_days: 12,
            promise_morale: 10,
            grumble_events: Vec::new(),
            slowdown_events: Vec::new(),
            mutiny_events: Vec::new(),
        }
    }
}

impl WearRules {
    /// 列在情绪阶段里的奇遇（不参与每天的随机）。
    pub fn is_crisis_event(&self, key: &str) -> bool {
        [&self.grumble_events, &self.slowdown_events, &self.mutiny_events].iter().any(|l| l.iter().any(|k| k == key))
    }

    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。商品、改装与奇遇的 key 由数据层另查。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        let pct = |v: i64| (0..=100).contains(&v);
        if !pct(self.fouling_slow_max) || !pct(self.rigging_floor) || !pct(self.load_free) || !pct(self.load_slow_max) {
            out.push((
                "fouling_slow_max",
                "fouling_slow_max、rigging_floor、load_free、load_slow_max 必须在 0 到 100 之间",
            ));
        }
        if self.fouling_cold_every < 1 || self.rigging_every < 1 || self.load_step < 1 {
            out.push(("fouling_cold_every", "fouling_cold_every、rigging_every、load_step 必须至少为 1"));
        }
        if !(0..=100).contains(&self.tired) || self.exhausted < self.tired || self.exhausted > 100 {
            out.push(("tired", "要求 0 ≤ tired ≤ exhausted ≤ 100"));
        }
        if self.slowdown_until < self.slowdown_below || self.mutiny_below > self.slowdown_below {
            out.push(("slowdown_until", "要求 mutiny_below ≤ slowdown_below ≤ slowdown_until"));
        }
        if self.ration_pct.iter().any(|p| !(1..=100).contains(p)) {
            out.push(("ration_pct", "口粮的百分比必须在 1 到 100 之间"));
        }
        if self.timber_per_ship < 0 || self.timber_price < 0 || self.scrape_bp < 0 {
            out.push(("timber_per_ship", "船材上限、价钱与刮船底的费率不能为负"));
        }
        if [&self.refit_fouling, &self.refit_leak, &self.refit_rigging]
            .iter()
            .any(|list| list.iter().any(|(_, p)| !(0..=100).contains(p)))
        {
            out.push(("refit_fouling", "改装的倍率必须在 0 到 100 之间"));
        }
        out
    }
}

/// 口粮。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rations {
    #[default]
    Full,
    Reduced,
    Half,
}

/// 节奏。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pace {
    Easy,
    #[default]
    Normal,
    Hard,
}

fn yes() -> bool {
    true
}
fn is_true(v: &bool) -> bool {
    *v
}
fn default_alert() -> u8 {
    7
}
fn is_default_alert(v: &u8) -> bool {
    *v == 7
}

/// 常设命令：设一次、一直生效。缺省（足额、正常、自动全开）就是 bot 的策略。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StandingOrders {
    #[serde(default)]
    pub rations: Rations,
    #[serde(default)]
    pub pace: Pace,
    /// 进风暴自动收到半帆、出风暴放回满帆
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub auto_reef: bool,
    /// 自动海上修理
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub auto_repair: bool,
    /// 粮水低于几天时提醒并暂停（0 = 不提醒）
    #[serde(default = "default_alert", skip_serializing_if = "is_default_alert")]
    pub supply_alert: u8,
}

impl Default for StandingOrders {
    fn default() -> Self {
        Self { rations: Rations::Full, pace: Pace::Normal, auto_reef: true, auto_repair: true, supply_alert: 7 }
    }
}

/// 船员情绪的阶段（哗变分阶段）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Crisis {
    /// 这一趟已经出过“怨言”
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub grumbled: bool,
    /// 正在怠工
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub slowdown: bool,
    /// 这一趟已经出过“怠工”的事件
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub slowdown_asked: bool,
    /// 士气连续低于哗变线的天数
    #[serde(default, skip_serializing_if = "is_zero")]
    pub low_days: u32,
    /// 答应了“改去最近的港”：这一天之前要靠港
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promise_until: Option<u32>,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}
fn is_zero_i(v: &i64) -> bool {
    *v == 0
}

/// 一支舰队的船况与船员状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetWear {
    /// 船底附着（百分之一点，0–10000）
    #[serde(default, skip_serializing_if = "is_zero_i")]
    pub fouling: i64,
    /// 帆缆磨损（百分之一点，0–10000；帆缆 = 100 − 磨损）
    #[serde(default, skip_serializing_if = "is_zero_i")]
    pub rigging_wear: i64,
    /// 船材（份）
    #[serde(default, skip_serializing_if = "is_zero_i")]
    pub timber: i64,
    /// 疲劳 0–100
    #[serde(default, skip_serializing_if = "is_zero_i")]
    pub fatigue: i64,
    /// 断鲜天数
    #[serde(default, skip_serializing_if = "is_zero")]
    pub fresh_days: u32,
    /// 病号（人；算在船员里，但不干活）
    #[serde(default, skip_serializing_if = "is_zero_i")]
    pub sick: i64,
    #[serde(default, skip_serializing_if = "is_default_orders")]
    pub orders: StandingOrders,
    #[serde(default, skip_serializing_if = "is_default_crisis")]
    pub crisis: Crisis,
}

fn is_default_orders(o: &StandingOrders) -> bool {
    *o == StandingOrders::default()
}
fn is_default_crisis(c: &Crisis) -> bool {
    *c == Crisis::default()
}

impl FleetWear {
    pub fn is_pristine(&self) -> bool {
        *self == Self::default()
    }
    /// 船底附着（点，0–100）
    pub fn fouling_points(&self) -> i64 {
        self.fouling.clamp(0, 100 * POINT) / POINT
    }
    /// 帆缆（点，0–100，100 为完好）
    pub fn rigging_points(&self) -> i64 {
        100 - (self.rigging_wear.clamp(0, 100 * POINT) + POINT - 1) / POINT
    }
}

/// 海上一天里值得记一笔的事（日志与界面用）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WearEvent {
    /// 疲劳出事故：伤了几个人
    Accident,
    /// 疲劳出事故：船体小损伤
    Mishap,
    /// 进水
    Leak,
    /// 坏血病开始出现病号
    Scurvy,
    /// 病号死去
    SickDied,
    /// 船材用完了，修不了
    NoTimber,
    /// 答应去最近的港却没去
    PromiseBroken,
    /// 镇压失败或让步不成：哗变
    Mutiny,
    /// 怠工开始
    Slowdown,
    /// 怠工结束
    BackToWork,
    /// 答应了船员去最近的港：领航改到那里（n = 港口编号）
    HeadForPort,
}

/// 船员情绪的三个阶段。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Grumble,
    Slowdown,
    Mutiny,
}

/// 常设命令与港口里的几件事（命令 `Command::Voyage` 的内容）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoyageOrder {
    /// 改常设命令
    SetOrders(StandingOrders),
    /// 在港买船材
    BuyTimber { qty: i64 },
    /// 在港刮船底
    Scrape,
    /// 抛货（海上）
    Jettison { good: crate::GoodId, qty: i64 },
    /// 按比例抛货（海上）：从最不值钱的货抛起，抛掉全部货物件数的 `pct`%（向上取整）
    JettisonShare { pct: i64 },
}

impl World {
    pub fn wear_enabled(&self) -> bool {
        self.defs.rules.voyage_wear.enabled
    }

    /// 这支舰队受 H02 管吗（规则开着、是玩家的舰队）。
    pub fn wear_applies(&self, fleet: FleetId) -> bool {
        self.wear_enabled() && self.state.fleets.get(&fleet).is_some_and(|f| f.owner == OwnerId::Player)
    }

    /// 船况（没有记录时是全新的）。
    pub fn fleet_wear(&self, fleet: FleetId) -> FleetWear {
        self.state.voyage.get(&fleet).cloned().unwrap_or_default()
    }

    fn wear_mut(&mut self, fleet: FleetId) -> &mut FleetWear {
        self.state.voyage.entry(fleet).or_default()
    }

    pub(crate) fn wear_store(&mut self, fleet: FleetId, wear: FleetWear) {
        if wear.is_pristine() {
            self.state.voyage.remove(&fleet);
        } else {
            self.state.voyage.insert(fleet, wear);
        }
    }

    /// 舰队按各船平均的改装倍率（百分比；没有这项改装的船按 100）。
    fn refit_pct(&self, fleet: FleetId, list: &[(String, i64)]) -> i64 {
        let Some(f) = self.state.fleets.get(&fleet) else { return 100 };
        if list.is_empty() || f.ships.is_empty() {
            return 100;
        }
        let sum: i64 = f
            .ships
            .iter()
            .map(|s| {
                s.refits
                    .iter()
                    .filter_map(|r| self.defs.refits.get(r.idx()))
                    .filter_map(|d| list.iter().find(|(k, _)| *k == d.key).map(|(_, p)| *p))
                    .min()
                    .unwrap_or(100)
            })
            .sum();
        sum / f.ships.len() as i64
    }

    /// 船材的上限（份）。
    pub fn timber_cap(&self, fleet: FleetId) -> i64 {
        self.state.fleets.get(&fleet).map_or(0, |f| f.ships.len() as i64 * self.defs.rules.voyage_wear.timber_per_ship)
    }

    /// 载重减速的百分点（货物不含粮水）。
    pub fn load_slow_pct(&self, fleet: FleetId) -> i64 {
        let r = &self.defs.rules.voyage_wear;
        let Some(f) = self.state.fleets.get(&fleet) else { return 0 };
        let cap = f.capacity().max(1);
        let load = mul_div(f.cargo_total(), 100, cap);
        ((load - r.load_free).max(0) / r.load_step.max(1)).min(r.load_slow_max)
    }

    /// H02 的航速乘数（万分比）；规则关闭或不是玩家舰队时为 10000。
    pub fn wear_speed_bp(&self, fleet: FleetId) -> i64 {
        if !self.wear_applies(fleet) {
            return 10_000;
        }
        let r = &self.defs.rules.voyage_wear;
        let w = self.fleet_wear(fleet);
        let mut bp = 10_000i64;
        let mut times = |pct: i64| bp = mul_div(bp, pct.max(0), 100);
        times(100 - w.fouling_points() * r.fouling_slow_max / 100);
        times(r.rigging_floor + w.rigging_points() * (100 - r.rigging_floor) / 100);
        if w.fatigue >= r.exhausted {
            times(100 - r.exhausted_slow);
        } else if w.fatigue >= r.tired {
            times(100 - r.tired_slow);
        }
        times(100 - self.load_slow_pct(fleet));
        if w.crisis.slowdown {
            times(100 - r.slowdown_slow);
        }
        match w.orders.pace {
            Pace::Easy => times(100 + r.pace_speed[0]),
            Pace::Hard => times(100 + r.pace_speed[1]),
            Pace::Normal => {}
        }
        bp
    }

    /// 帆缆磨损让顶风死区放宽的度数。
    pub fn wear_upwind(&self, fleet: FleetId) -> i64 {
        if !self.wear_applies(fleet) {
            return 0;
        }
        (100 - self.fleet_wear(fleet).rigging_points()) / 10
    }

    /// 不干活的人（病号）。
    pub fn wear_idle_crew(&self, fleet: FleetId) -> i64 {
        if !self.wear_applies(fleet) {
            return 0;
        }
        self.fleet_wear(fleet).sick.max(0)
    }

    /// 进风暴自动收半帆（常设命令）。
    pub fn wear_auto_reef(&self, fleet: FleetId) -> bool {
        self.wear_applies(fleet) && self.fleet_wear(fleet).orders.auto_reef
    }

    /// 今天粮水日耗吃掉的百分比（口粮档位）。
    pub fn ration_keep(&self, fleet: FleetId) -> i64 {
        if !self.wear_applies(fleet) {
            return 100;
        }
        let r = &self.defs.rules.voyage_wear;
        match self.fleet_wear(fleet).orders.rations {
            Rations::Full => 100,
            Rations::Reduced => r.ration_pct[0],
            Rations::Half => r.ration_pct[1],
        }
    }

    /// 坏血病开始发病的断鲜天数（船医 healing 每 10 点 +5 天）。
    pub fn scurvy_threshold(&self, fleet: FleetId) -> u32 {
        let r = &self.defs.rules.voyage_wear;
        let healing = self.post_value(fleet, crate::captain::AttrHook::Healing);
        (r.scurvy_after + healing / 10 * r.scurvy_healing_days).max(0) as u32
    }

    /// 吃到了新鲜的食物（H04 鱼群、H05 采集狩猎）：断鲜天数回退 `days` 天。规则关着时什么也不做。
    pub(crate) fn wear_fresh_food(&mut self, fleet: FleetId, days: u32) {
        if !self.wear_applies(fleet) {
            return;
        }
        let mut w = self.fleet_wear(fleet);
        w.fresh_days = w.fresh_days.saturating_sub(days);
        self.wear_store(fleet, w);
    }

    /// 在港一天：疲劳大减、断鲜清零、病号康复，船员的情绪阶段从头算。
    pub(crate) fn wear_port_day(&mut self, fleet: FleetId) {
        if !self.wear_applies(fleet) {
            return;
        }
        let r = self.defs.rules.voyage_wear.clone();
        let mut w = self.fleet_wear(fleet);
        w.fatigue = (w.fatigue - r.fatigue_port).max(0);
        w.fresh_days = 0;
        w.sick = (w.sick - ceil_pct(w.sick, r.sick_recover)).max(0);
        w.crisis = Crisis::default();
        self.wear_store(fleet, w);
    }

    /// 海上一天（在 `sea_day` 里补给之后、风暴之前调用）。返回 true 表示舰队因此覆灭。
    pub(crate) fn wear_sea_day(&mut self, fleet: FleetId, weather: Option<&DayWeather>) -> Result<bool, CoreError> {
        if !self.wear_applies(fleet) {
            return Ok(false);
        }
        let defs = self.defs.clone();
        let r = &defs.rules.voyage_wear;
        let day = self.state.day;
        let mut rng = Rng::derive(self.state.seed, day, Domain::Wear, u64::from(fleet.0), 0);
        let (owner, cell, crew, crew_min, days_at_sea, sail, creeping) = {
            let f = self.fleet(fleet)?;
            let sail = match &f.location {
                FleetLocation::AtSea(Voyage::Manual { manual }) => manual.sail,
                _ => Sail::Full,
            };
            let creeping = matches!(&f.location, FleetLocation::AtSea(Voyage::Manual { manual })
                if manual.pilot.as_ref().is_some_and(|p| p.mode() == crate::navigation::autopilot::PilotMode::Creep));
            (f.owner, f.cell(&defs), f.crew, f.crew_min(&defs), f.days_at_sea, sail, creeping)
        };
        let storm = weather.is_some_and(|w| w.sky == Sky::Storm);
        let wind = weather.map_or(0, |w| w.sea.wind_strength);
        let climate = defs.map.region_of(cell).map(|reg| defs.region(reg).climate);
        let mut w = self.fleet_wear(fleet);
        let mut events: Vec<(WearEvent, i64)> = Vec::new();

        // ── 船底附着 ──
        let grow = match climate {
            Some(Climate::Tropical) => r.fouling_tropical * POINT,
            Some(Climate::Cold) => POINT / r.fouling_cold_every.max(1),
            _ => r.fouling_daily * POINT,
        };
        let grow = mul_div(grow, self.refit_pct(fleet, &r.refit_fouling), 100);
        w.fouling = (w.fouling + grow).clamp(0, 100 * POINT);

        // ── 帆缆 ──
        let mut wear = if days_at_sea > 0 && i64::from(days_at_sea) % r.rigging_every.max(1) == 0 { POINT } else { 0 };
        if storm {
            wear += POINT
                * match sail {
                    Sail::Full => r.rigging_storm[0],
                    Sail::Half => r.rigging_storm[1],
                    Sail::Furled => r.rigging_storm[2],
                };
        } else if wind >= r.rigging_gale_wind && sail == Sail::Full {
            wear += POINT * r.rigging_gale;
        }
        let pace_mult = match w.orders.pace {
            Pace::Easy => r.pace_rigging[0],
            Pace::Hard => r.pace_rigging[1],
            Pace::Normal => 100,
        };
        wear = mul_div(mul_div(wear, pace_mult, 100), self.refit_pct(fleet, &r.refit_rigging), 100);
        w.rigging_wear = (w.rigging_wear + wear).clamp(0, 100 * POINT);

        // ── 疲劳 ──
        let working = crew - w.sick;
        let mut delta = 0;
        if working * 2 < crew_min * 3 {
            delta += r.fatigue_short_crew;
        }
        if storm {
            delta += r.fatigue_storm;
        }
        match w.orders.pace {
            Pace::Hard => delta += r.fatigue_hard,
            Pace::Easy => delta -= r.fatigue_easy,
            Pace::Normal => {}
        }
        if sail == Sail::Furled && !creeping {
            delta -= r.fatigue_anchor;
        }
        if delta < 0 && w.orders.rations != Rations::Full {
            // 减额、半额口粮：疲劳恢复减半
            delta /= 2;
        }
        w.fatigue = (w.fatigue + delta).clamp(0, 100);

        // ── 鲜食与坏血病 ──
        // H05 下网：当天捞到的鱼就是鲜食（不再动用船上的抗坏血病食物）
        let fresh_keep =
            defs.rules.ships.s02_enabled && self.fleet_has_legend_trait(fleet, crate::legend_ships::Trait::FreshKeep);
        let ate = self.nets_working(fleet) || (!fresh_keep && self.eat_antiscorbutic(fleet, crew)?);
        // S02 裁决：不断鲜只延缓断鲜，不视作吃到了鲜食；沿用航海日计周期。
        if !ate && (!fresh_keep || days_at_sea.is_multiple_of(defs.rules.ships.fresh_keep_every.max(1))) {
            w.fresh_days = w.fresh_days.saturating_add(1);
        }
        let threshold = self.scurvy_threshold(fleet);
        // 吃到鲜食的日子不添新病号（断鲜天数也不涨）
        if !ate && w.fresh_days > threshold && crew > 0 {
            let rate = if w.orders.rations == Rations::Half { r.scurvy_rate[1] } else { r.scurvy_rate[0] };
            let before = w.sick;
            w.sick = (w.sick + ceil_pct(crew, rate)).min(crew);
            if before == 0 && w.sick > 0 {
                events.push((WearEvent::Scurvy, w.sick));
            }
        }
        let mut dead = 0;
        if w.sick > 0 {
            dead = mul_div(mul_div(w.sick, r.sick_death, 100), self.post_healing_keep(fleet), 100).min(w.sick);
            w.sick -= dead;
            if ate {
                w.sick = (w.sick - ceil_pct(w.sick, r.sick_recover)).max(0);
            }
        }

        // ── 口粮与疲劳对士气 ──
        let mut morale_drop = match w.orders.rations {
            Rations::Full => 0,
            Rations::Reduced => r.ration_morale[0],
            Rations::Half => r.ration_morale[1],
        };
        if w.fatigue >= r.exhausted {
            morale_drop += r.exhausted_morale;
        }

        // ── 疲劳出事故 ──
        let mut injured = 0;
        let mut mishap = None;
        if w.fatigue >= r.tired && rng.chance_bp(r.accident_bp) {
            if rng.below(2) == 0 {
                injured = rng.range(1, 2);
            } else {
                mishap = Some(rng.below(self.fleet(fleet)?.ships.len().max(1) as u64) as usize);
            }
        }

        // ── 船体：进水与海上修理 ──
        let leak_pct = self.refit_pct(fleet, &r.refit_leak);
        let auto_repair = w.orders.auto_repair;
        let storm_bonus = self.post_value(fleet, crate::captain::AttrHook::StormCheck) / 10;
        let mut leaked = false;
        let mut no_timber = false;
        {
            let f = self.fleet_mut(fleet)?;
            f.crew = (f.crew - dead - injured).max(0);
            f.morale = (f.morale - morale_drop).max(0);
            for s in f.ships.iter_mut() {
                if s.durability * 100 < s.max_durability * r.leak_below {
                    s.durability -= mul_div(mul_div(s.max_durability, r.leak, 100), leak_pct, 100).max(1);
                    leaked = true;
                }
            }
            if let Some(i) = mishap
                && let Some(s) = f.ships.get_mut(i)
            {
                s.durability -= mul_div(s.max_durability, 1, 100).max(1);
            }
            if auto_repair {
                if w.rigging_points() < r.repair_rigging_below {
                    if w.timber > 0 {
                        w.timber -= 1;
                        w.rigging_wear = (w.rigging_wear - r.repair_rigging * POINT).max(0);
                    } else {
                        no_timber = true;
                    }
                }
                let worst = f
                    .ships
                    .iter()
                    .enumerate()
                    .filter(|(_, s)| s.durability * 100 < s.max_durability * r.repair_hull_below)
                    .min_by_key(|(_, s)| (s.durability * 10_000 / s.max_durability.max(1), s.durability))
                    .map(|(i, _)| i);
                if let Some(i) = worst {
                    if w.timber > 0 {
                        w.timber -= 1;
                        let s = &mut f.ships[i];
                        let target = mul_div(s.max_durability, r.repair_hull_below, 100);
                        s.durability = (s.durability + mul_div(s.max_durability, r.repair_hull + storm_bonus, 100))
                            .min(target.max(s.durability));
                    } else {
                        no_timber = true;
                    }
                }
            }
        }
        if dead > 0 {
            events.push((WearEvent::SickDied, dead));
        }
        if injured > 0 {
            events.push((WearEvent::Accident, injured));
        }
        if mishap.is_some() {
            events.push((WearEvent::Mishap, 1));
        }
        if leaked {
            events.push((WearEvent::Leak, 1));
        }
        if no_timber && self.state.voyage.get(&fleet).is_none_or(|old| old.timber > 0 || !old.orders.auto_repair) {
            // 只在船材刚用完的那天记一笔
            events.push((WearEvent::NoTimber, 0));
        }

        // ── 船员情绪：怨言 → 怠工 → 哗变 ──
        let morale = self.fleet(fleet)?.morale;
        if let Some(stage) = self.crisis_day(&mut w, morale, &mut events)
            && self.crisis_encounter(fleet, stage)
        {
            match stage {
                Stage::Grumble => w.crisis.grumbled = true,
                Stage::Slowdown => w.crisis.slowdown_asked = true,
                Stage::Mutiny => w.crisis.low_days = 0,
            }
        }
        if events.iter().any(|(e, _)| *e == WearEvent::PromiseBroken) {
            let f = self.fleet_mut(fleet)?;
            f.morale = (f.morale - r.promise_morale).max(0);
        }
        self.wear_store(fleet, w);
        for (event, n) in events {
            self.push_log(LogEvent { day, kind: LogKind::VoyageWear { fleet, owner, event, n } });
        }
        // 进水或事故把船弄沉了才走沉船结算（不在别的日子里顺手裁掉超载的粮水）
        if self.fleet(fleet)?.ships.iter().any(|s| s.durability <= 0) {
            self.sink_wrecked_ships(fleet)?;
        }
        Ok(!self.state.fleets.contains_key(&fleet))
    }

    /// 货舱里有抗坏血病的货时，按“船员 ÷ 50”吃掉（按商品 key 的顺序先吃排在前面的）。返回今天吃到没有。
    fn eat_antiscorbutic(&mut self, fleet: FleetId, crew: i64) -> Result<bool, CoreError> {
        let defs = self.defs.clone();
        let list = &defs.rules.voyage_wear.antiscorbutic;
        if list.is_empty() || crew <= 0 {
            return Ok(false);
        }
        let mut need = crate::fleet::daily_supply_need(&defs, crew);
        let (owner, cargo) = {
            let f = self.fleet(fleet)?;
            (f.owner, f.cargo.clone())
        };
        let mut plan = Vec::new();
        for key in list {
            let Some(good) = defs.find_good(key) else { continue };
            let have = cargo.get(&good).copied().unwrap_or(0);
            let take = have.min(need);
            if take > 0 {
                plan.push((good, take));
                need -= take;
            }
            if need == 0 {
                break;
            }
        }
        if need > 0 {
            // 不够一天的量：留着不吃，断鲜照涨（免得每天啃掉零头）
            return Ok(false);
        }
        let day = self.state.day;
        for (good, qty) in plan {
            self.remove_cargo_with_loss(owner, fleet, good, qty, day)?;
        }
        Ok(true)
    }

    /// 情绪阶段的每日推进；该出事件时返回哪一阶段（事件真出了场，调用处才记下“出过了”）。
    fn crisis_day(&self, w: &mut FleetWear, morale: i64, events: &mut Vec<(WearEvent, i64)>) -> Option<Stage> {
        let r = &self.defs.rules.voyage_wear;
        let day = self.state.day;
        let c = &mut w.crisis;
        if let Some(until) = c.promise_until
            && day > until
        {
            c.promise_until = None;
            events.push((WearEvent::PromiseBroken, r.promise_morale));
        }
        if c.slowdown && morale > r.slowdown_until {
            c.slowdown = false;
            events.push((WearEvent::BackToWork, 0));
        }
        c.low_days = if morale < r.mutiny_below { c.low_days.saturating_add(1) } else { 0 };
        if c.low_days >= r.mutiny_days {
            return Some(Stage::Mutiny);
        }
        if morale < r.slowdown_below && !c.slowdown && c.promise_until.is_none() {
            c.slowdown = true;
            events.push((WearEvent::Slowdown, 0));
        }
        if c.slowdown && !c.slowdown_asked {
            return Some(Stage::Slowdown);
        }
        if morale < r.grumble_below && !c.grumbled {
            return Some(Stage::Grumble);
        }
        None
    }

    /// 情绪阶段的事件走奇遇的管线（`forced` 的条目，不参与每天的随机），也守奇遇的规矩：
    /// 已有别的事在等回应、离上一件奇遇不到 `gap_days`、节奏闸的窗口已满、几套说法都在冷却里时，就等下一天。
    /// 返回事件出了场没有。
    fn crisis_encounter(&mut self, fleet: FleetId, stage: Stage) -> bool {
        let r = &self.defs.rules.voyage_wear;
        let list = match stage {
            Stage::Grumble => &r.grumble_events,
            Stage::Slowdown => &r.slowdown_events,
            Stage::Mutiny => &r.mutiny_events,
        };
        let day = self.state.day;
        let rules = &self.defs.stories.rules;
        if list.is_empty()
            || self.state.story.pending.is_some()
            || self.state.story.encounter_day.is_some_and(|d| day < d.saturating_add(rules.gap_days))
            || (self.pacing_enabled() && !self.pacing_room_for_encounter())
        {
            return false;
        }
        let n = list.len();
        let pick = (0..n).map(|i| &list[(day as usize + i) % n]).find(|key| {
            self.defs.stories.encounter(key).is_some_and(|e| {
                self.state.story.seen.get(*key).is_none_or(|d| !e.once && day >= d.saturating_add(e.cooldown_days))
            })
        });
        let Some(key) = pick.cloned() else { return false };
        let s = &mut self.state.story;
        s.seen.insert(key.clone(), day);
        s.encounter_day = Some(day);
        s.pending = Some(crate::story::StoryPending { day, fleet, source: crate::story::StorySource::Encounter(key) });
        // 与每天随机的奇遇同一口径（日结途中生成，玩家明天早上看到）
        self.pacing_note_seen(crate::pacing::BeatSource::Encounter.weight(), day.saturating_add(1));
        true
    }

    /// 选项留下的故事标记（`voyage_*`）在这里兑现，然后清掉：许诺去最近的港、哗变。
    pub(crate) fn wear_flags(&mut self) -> Result<(), CoreError> {
        if !self.wear_enabled() {
            return Ok(());
        }
        let promise = self.state.story.flags.remove("voyage_promise_port");
        let mutiny = self.state.story.flags.remove("voyage_mutiny");
        let calm = self.state.story.flags.remove("voyage_back_to_work");
        if !(promise || mutiny || calm) {
            return Ok(());
        }
        let Some(fleet) = self.state.story.last.as_ref().map(|l| l.fleet).filter(|f| self.wear_applies(*f)) else {
            return Ok(());
        };
        let r = self.defs.rules.voyage_wear.clone();
        let day = self.state.day;
        let mut w = self.fleet_wear(fleet);
        if promise {
            w.crisis.promise_until = Some(day + r.promise_days);
            w.crisis.slowdown = false;
        }
        let promised_fleet = promise.then_some(fleet);
        if calm {
            w.crisis.slowdown = false;
        }
        self.wear_store(fleet, w);
        if let Some(f) = promised_fleet {
            self.steer_to_nearest_port(f);
        }
        if mutiny {
            // 沿用原来的哗变结算：两成船员出走、两成货物丢失、士气回到 40
            let owner = self.fleet(fleet)?.owner;
            let deserters = {
                let f = self.fleet_mut(fleet)?;
                let d = mul_div(f.crew, 20, 100);
                f.crew -= d;
                f.morale = 40;
                d
            };
            let mut rng = Rng::derive(self.state.seed, day, Domain::Wear, u64::from(fleet.0), 1);
            let lost = self.lose_cargo_fraction(fleet, &mut rng, 20, 20)?;
            self.push_log(LogEvent { day, kind: LogKind::Mutiny { fleet, owner, deserters, cargo_lost: lost } });
            let mut w = self.fleet_wear(fleet);
            w.crisis.slowdown = false;
            w.crisis.low_days = 0;
            self.wear_store(fleet, w);
        }
        Ok(())
    }

    /// 答应了船员“去最近的港”：把领航改到最近的、看得见的港口（有领航就改目的地，没有就开领航；玩家可以再改回去），记一条日志。
    /// 按切比雪夫距离从近到远试前几座，第一座寻得到路的就是；都不行就作罢（士气的期限照旧）。
    fn steer_to_nearest_port(&mut self, fleet: FleetId) {
        let Ok(f) = self.fleet(fleet) else { return };
        if f.docked_at().is_some() || !self.defs.manual_navigation {
            return;
        }
        let (owner, cell) = (f.owner, f.cell(&self.defs));
        let topology = self.defs.map.topology();
        let mut ports: Vec<(i64, crate::LocId)> = self
            .visible_locations()
            .filter(|l| self.defs.loc(*l).is_port())
            .map(|l| (topology.chebyshev(self.defs.loc(l).cell, cell), l))
            .collect();
        ports.sort();
        let minute = self.state.navigation.minute;
        for (_, dest) in ports.into_iter().take(6) {
            let Ok(plan) = crate::navigation::autopilot::check(self, owner, fleet, dest, minute, false, None) else {
                continue;
            };
            if crate::navigation::orders::apply(self, plan).is_ok() {
                let day = self.state.day;
                self.push_log(LogEvent {
                    day,
                    kind: LogKind::VoyageWear { fleet, owner, event: WearEvent::HeadForPort, n: i64::from(dest.0) },
                });
            }
            return;
        }
    }

    /// 删掉已经不存在、或不再是玩家的舰队的记录。
    pub(crate) fn wear_prune(&mut self) {
        if self.state.voyage.is_empty() {
            return;
        }
        let fleets = &self.state.fleets;
        self.state.voyage.retain(|id, _| fleets.get(id).is_some_and(|f| f.owner == OwnerId::Player));
    }
}

/// `v × pct%`，向上取整（v > 0 时至少 1）。
fn ceil_pct(v: i64, pct: i64) -> i64 {
    if v <= 0 || pct <= 0 {
        return 0;
    }
    (v * pct + 99) / 100
}

// ───────────────────────────── 命令 ─────────────────────────────

/// `Command::Voyage` 的预检结果。
pub(crate) enum VoyagePlan {
    Orders { fleet: FleetId, orders: StandingOrders },
    Timber { fleet: FleetId, qty: i64, cost: crate::Money },
    Scrape { fleet: FleetId, cost: crate::Money },
    Jettison { fleet: FleetId, good: crate::GoodId, qty: i64 },
    JettisonMany { fleet: FleetId, lots: Vec<(crate::GoodId, i64)> },
}

impl World {
    /// 刮一次船底的费用：各船船价 × `scrape_bp` 万分之几。
    pub fn scrape_cost(&self, fleet: FleetId) -> crate::Money {
        let bp = self.defs.rules.voyage_wear.scrape_bp;
        self.state.fleets.get(&fleet).map_or(0, |f| {
            f.ships.iter().map(|s| mul_div(self.defs.ship(s.kind).price, bp, 10_000)).sum::<i64>().max(1)
        })
    }
}

pub(crate) fn check_order(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    order: &VoyageOrder,
) -> Result<VoyagePlan, crate::CommandError> {
    use crate::{CommandError, Reason};
    let f = world.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if !world.wear_applies(fleet) {
        return Err(Reason::new("voyage.disabled", "这个世界没有船况与常设命令").rule());
    }
    let r = &world.defs.rules.voyage_wear;
    let need_cash = |cost: crate::Money| -> Result<(), CommandError> {
        let have = world.agent(owner)?.cash;
        if have < cost {
            return Err(CommandError::InsufficientCash { need: cost, have });
        }
        Ok(())
    };
    match order {
        VoyageOrder::SetOrders(o) => {
            if o.supply_alert > 60 {
                return Err(Reason::new("voyage.alert", "粮水提醒最多 60 天").range());
            }
            Ok(VoyagePlan::Orders { fleet, orders: *o })
        }
        VoyageOrder::BuyTimber { qty } => {
            f.docked_at().ok_or(CommandError::NotDocked)?;
            let room = world.timber_cap(fleet) - world.fleet_wear(fleet).timber;
            if *qty <= 0 || *qty > room {
                return Err(Reason::new("voyage.timber_room", format!("船材最多再买 {}", room.max(0)))
                    .arg("max", crate::TextArg::Int(room.max(0)))
                    .range());
            }
            let cost = qty * r.timber_price;
            need_cash(cost)?;
            Ok(VoyagePlan::Timber { fleet, qty: *qty, cost })
        }
        VoyageOrder::Scrape => {
            f.docked_at().ok_or(CommandError::NotDocked)?;
            if world.fleet_wear(fleet).fouling <= 0 {
                return Err(Reason::new("voyage.clean", "船底很干净，不用刮").rule());
            }
            let cost = world.scrape_cost(fleet);
            need_cash(cost)?;
            Ok(VoyagePlan::Scrape { fleet, cost })
        }
        VoyageOrder::Jettison { good, qty } => {
            if f.docked_at().is_some() {
                return Err(Reason::new("voyage.jettison_docked", "在港里卖掉就好，不必抛货").rule());
            }
            let have = f.cargo.get(good).copied().unwrap_or(0);
            if *qty <= 0 || *qty > have {
                return Err(CommandError::InsufficientCargo { have });
            }
            Ok(VoyagePlan::Jettison { fleet, good: *good, qty: *qty })
        }
        VoyageOrder::JettisonShare { pct } => {
            if f.docked_at().is_some() {
                return Err(Reason::new("voyage.jettison_docked", "在港里卖掉就好，不必抛货").rule());
            }
            if !(1..=100).contains(pct) || f.cargo_total() <= 0 {
                return Err(CommandError::InvalidQuantity);
            }
            Ok(VoyagePlan::JettisonMany { fleet, lots: jettison_lots(world, f, *pct) })
        }
    }
}

/// 按比例抛货抛哪些：货物件数的 `pct`%（向上取整），按基准价从低到高（同价按商品编号）抛。
pub fn jettison_lots(world: &World, f: &crate::world::Fleet, pct: i64) -> Vec<(crate::GoodId, i64)> {
    let mut left = (f.cargo_total() * pct.clamp(0, 100) + 99) / 100;
    let mut goods: Vec<(i64, crate::GoodId, i64)> =
        f.cargo.iter().map(|(g, q)| (world.defs.good(*g).base_price, *g, *q)).collect();
    goods.sort();
    let mut out = Vec::new();
    for (_, g, q) in goods {
        if left <= 0 {
            break;
        }
        let take = q.min(left);
        out.push((g, take));
        left -= take;
    }
    out
}

pub(crate) fn apply_order(world: &mut World, owner: OwnerId, plan: VoyagePlan) -> Result<(), CoreError> {
    use crate::ledger::{Account, CashClass, JournalEntry, Memo};
    use crate::treasury::Flow;
    let day = world.state.day;
    match plan {
        VoyagePlan::Orders { fleet, orders } => {
            let mut w = world.fleet_wear(fleet);
            w.orders = orders;
            world.wear_store(fleet, w);
        }
        VoyagePlan::Timber { fleet, qty, cost } => {
            world.book_external(
                owner,
                Flow::Supplies,
                world.fleet_town(fleet),
                JournalEntry::new(day, Memo::Supplies, CashClass::Operating)
                    .dr(Account::Supplies, cost)
                    .cr(Account::Cash, cost),
            )?;
            world.wear_mut(fleet).timber += qty;
        }
        VoyagePlan::Scrape { fleet, cost } => {
            world.book_external(
                owner,
                Flow::Repair,
                world.fleet_town(fleet),
                JournalEntry::new(day, Memo::Repair, CashClass::Operating)
                    .dr(Account::Repairs, cost)
                    .cr(Account::Cash, cost),
            )?;
            let mut w = world.fleet_wear(fleet);
            w.fouling = 0;
            world.wear_store(fleet, w);
        }
        VoyagePlan::Jettison { fleet, good, qty } => {
            world.remove_cargo_with_loss(owner, fleet, good, qty, day)?;
        }
        VoyagePlan::JettisonMany { fleet, lots } => {
            for (good, qty) in lots {
                world.remove_cargo_with_loss(owner, fleet, good, qty, day)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "voyage_script_tests.rs"]
mod script_tests;
#[cfg(test)]
#[path = "wear_tests.rs"]
mod tests;

//! H05 岸与锚地（`rules.toml [shore_tasks]`，规格见 `docs/VOYAGE-PLAN.md` §6）。
//!
//! 把“靠岸”从只找发现物扩成补给与休整的手段：
//!
//! - **岸上差事**（[`ShoreTask`]）：在海上手动航行、离陆地 1 格以内时收帆锚泊，派人上岸——汲水、采集狩猎、伐木、倾船刮底。
//!   可以同时派几件（人手相加不超过能干活的人），各自几天，做完那天交付；全部做完才拔锚。差事期间舰队不能起航（可以召回，
//!   没做完的那件什么也不给）。产出看锚地周围 1 格内的陆格地貌（`biomes.txt`）与两格内有没有河（`fine/rivers.bin` 与 `rivers.toml`）。
//!   采集、伐木每个工作日有一点风险，出事走登陆的那套伤病（[`LandingRisk`]：受伤、染病），不新造效果。
//! - **避风**：收帆锚泊、离陆地 1 格以内、陆地在上风一侧（风从陆上吹过来）时，暴风雨对船体与货物的损伤 ×`shelter_keep`%。
//! - **下网**：常设的开关，半帆或收帆时每天按海区气候给一点粮，当天算吃到了鲜食（断鲜天数不涨）。
//! - **接雨水**：开关打开时自动——雨天、暴风雨天每天 +`rain_tenths`/10 天份的水。
//!
//! 只对玩家（含模拟器 bot）的舰队生效；状态放在 `WorldState::shore`，规则关闭时为空、不写进存档，不升存档版本。
//! 数值都是初值，可贴进 BALANCE 的段落见 `docs/drafts/h05-handoff.md`。粮、水、船材一律整数件。

use crate::fixed::mul_div;
use crate::geo::Biome;
use crate::ids::Cell;
use crate::log::{LogEvent, LogKind};
use crate::nav::Terrain;
use crate::navigation::Sail;
use crate::navigation::landing::LandingRisk;
use crate::rng::{Domain, Rng};
use crate::weather::{Climate, DayWeather, Sky};
use crate::world::{FleetLocation, Voyage};
use crate::{CommandError, CoreError, FleetId, OwnerId, Reason, World};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 一件差事最多几天（存档校验用）。
pub const MAX_SHORE_DAYS: u16 = 30;

/// 岸上差事。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShoreTask {
    /// 汲水：把水补到够 `water_fill_days` 天
    Water,
    /// 采集狩猎：按地貌给粮，断鲜天数清零
    Forage,
    /// 伐木：有林的地貌给船材（H02 船况开着时才有）
    Timber,
    /// 倾船刮底：船底附着清零（H02 船况开着时才有）
    Careen,
}

impl ShoreTask {
    pub const ALL: [ShoreTask; 4] = [ShoreTask::Water, ShoreTask::Forage, ShoreTask::Timber, ShoreTask::Careen];

    pub fn key(self) -> &'static str {
        match self {
            ShoreTask::Water => "water",
            ShoreTask::Forage => "forage",
            ShoreTask::Timber => "timber",
            ShoreTask::Careen => "careen",
        }
    }

    fn index(self) -> usize {
        match self {
            ShoreTask::Water => 0,
            ShoreTask::Forage => 1,
            ShoreTask::Timber => 2,
            ShoreTask::Careen => 3,
        }
    }
}

/// 这件差事此地做不了（或做了没用）的原因；界面把它灰掉并写出来。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShoreBlock {
    /// 不在岸边（离陆地超过 1 格）
    NoCoast,
    /// 这张地图没有地貌数据
    Unknown,
    /// 两格内没有河，岸上又是荒漠或冰原
    NoFreshWater,
    /// 地貌给不了吃的（荒漠、冰原）
    NoForage,
    /// 附近没有林子
    NoForest,
    /// 岸边全是冰原或高崖，找不到能倾船的滩
    NoBeach,
    /// 船况规则没开（没有船材、船底附着这两样）
    NoWear,
    /// 舱里没地方，或已经满了、船底很干净
    Full,
    /// 能干活的人不够
    Hands,
}

/// `rules.toml [shore_tasks]`。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ShoreRules {
    pub enabled: bool,
    /// 汲水：几格内（切比雪夫）有河算“有河”
    pub river_reach: i64,
    /// 汲水要几天：[有河, 没河但地貌有水源]
    pub water_days: [i64; 2],
    /// 汲水把水补到够几天（不超过空舱）
    pub water_fill_days: i64,
    /// 采集狩猎要几天
    pub forage_days: i64,
    /// 采集狩猎每个工作日给几“十分之一天份”的粮，按地貌代码（`biomes.txt` 的单字符）；没列的地貌给 0
    pub forage: BTreeMap<String, i64>,
    /// 伐木要几天
    pub timber_days: i64,
    /// 伐木每艘船每个工作日给几份船材，按地貌代码；没列的地貌给 0
    pub timber: BTreeMap<String, i64>,
    /// 倾船刮底要几天
    pub careen_days: i64,
    /// 倾船刮底：陆格高程不超过这个才算有滩（没有高程数据时不看）
    pub careen_relief_max: i64,
    /// 各差事占能干活的人的百分比：[汲水, 采集狩猎, 伐木, 倾船刮底]
    pub hands_pct: [i64; 4],
    /// 每件差事至少几个人
    pub hands_min: i64,
    /// 采集、伐木每个工作日出事的概率（万分比）；出事走登陆的伤病
    pub risk_bp: i64,
    /// 避风时暴风雨损伤保留的百分比
    pub shelter_keep: i64,
    /// 下网每天给几“十分之一天份”的粮，按海区气候：[温和, 寒冷, 干燥, 热带]（没有海区按温和）
    pub fish: [i64; 4],
    /// 雨天（含暴风雨）每天接几“十分之一天份”的水
    pub rain_tenths: i64,
}

impl Default for ShoreRules {
    fn default() -> Self {
        let table = |rows: &[(&str, i64)]| rows.iter().map(|(k, v)| ((*k).to_string(), *v)).collect();
        Self {
            enabled: false,
            river_reach: 2,
            water_days: [1, 2],
            water_fill_days: 60,
            forage_days: 2,
            // 雨林、阔叶林、稀树草原多；草原、地中海、湿地、针叶林次之；苔原、高山、火山、干草原少；荒漠、冰原没有
            forage: table(&[
                ("J", 30),
                ("F", 25),
                ("S", 25),
                ("G", 20),
                ("M", 20),
                ("W", 20),
                ("B", 20),
                ("X", 15),
                ("K", 10),
                ("T", 10),
                ("A", 10),
                ("V", 10),
            ]),
            timber_days: 3,
            timber: table(&[("B", 3), ("F", 3), ("J", 3), ("M", 2), ("W", 1), ("S", 1), ("X", 2)]),
            careen_days: 5,
            careen_relief_max: 3,
            hands_pct: [10, 20, 25, 60],
            hands_min: 2,
            risk_bp: 300,
            shelter_keep: 30,
            fish: [4, 6, 2, 3],
            rain_tenths: 5,
        }
    }
}

impl ShoreRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        let days_ok = |d: i64| (1..=i64::from(MAX_SHORE_DAYS)).contains(&d);
        if !(0..=8).contains(&self.river_reach) {
            out.push(("river_reach", "须在 0–8 之间"));
        }
        if !self.water_days.iter().all(|d| days_ok(*d))
            || !days_ok(self.forage_days)
            || !days_ok(self.timber_days)
            || !days_ok(self.careen_days)
        {
            out.push(("water_days", "各差事的天数须在 1–30 之间"));
        }
        if !(1..=365).contains(&self.water_fill_days) {
            out.push(("water_fill_days", "须在 1–365 之间"));
        }
        let codes_ok = |t: &BTreeMap<String, i64>| {
            t.iter().all(|(k, v)| {
                let mut c = k.chars();
                *v >= 0 && c.next().is_some_and(|ch| Biome::from_code(ch).is_some()) && c.next().is_none()
            })
        };
        if !codes_ok(&self.forage) || !codes_ok(&self.timber) {
            out.push(("forage", "地貌表的键须是 biomes.txt 的单字符代码，值不能为负"));
        }
        if !self.hands_pct.iter().all(|p| (0..=100).contains(p)) || self.hands_min < 1 {
            out.push(("hands_pct", "人手百分比须在 0–100 之间，每件至少 1 人"));
        }
        if !(0..=10_000).contains(&self.risk_bp) || !(0..=100).contains(&self.shelter_keep) {
            out.push(("risk_bp", "风险须在 0–10000（万分比），避风保留须在 0–100（百分比）"));
        }
        if self.fish.iter().any(|v| *v < 0) || self.rain_tenths < 0 || self.careen_relief_max < 0 {
            out.push(("fish", "渔获、雨水与高程上限不能为负"));
        }
        out
    }

    fn rate(table: &BTreeMap<String, i64>, b: Biome) -> i64 {
        let mut key = [0u8; 4];
        table.get(b.code().encode_utf8(&mut key) as &str).copied().unwrap_or(0)
    }
}

/// 正在做的一件差事。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShoreJob {
    pub task: ShoreTask,
    /// 要几天
    pub days: u16,
    /// 占几个人
    pub hands: i64,
}

/// 一支舰队在锚地的营地：派出去的几件差事，从开始算过了几天。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShoreCamp {
    pub jobs: Vec<ShoreJob>,
    pub elapsed: u16,
}

impl ShoreCamp {
    /// 全部做完要几天。
    pub fn days(&self) -> u16 {
        self.jobs.iter().map(|j| j.days).max().unwrap_or(0)
    }
}

/// `WorldState::shore`。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShoreState {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub camps: BTreeMap<FleetId, ShoreCamp>,
    /// 下了网的舰队
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub nets: BTreeSet<FleetId>,
}

impl ShoreState {
    pub fn is_empty(&self) -> bool {
        self.camps.is_empty() && self.nets.is_empty()
    }
}

/// 锚地周围的情形（地貌、河、滩）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShoreSite {
    /// 离陆地 1 格以内
    pub coast: bool,
    /// 周围 1 格内陆格的地貌（没有地貌数据时为空）
    pub biomes: Vec<Biome>,
    /// 两格内有河
    pub river: bool,
    /// 有能倾船的滩
    pub beach: bool,
}

/// 界面上的一行：这件差事要多少人、几天、预计得多少，做不了的写原因。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShoreOption {
    pub task: ShoreTask,
    pub hands: i64,
    pub days: i64,
    /// 预计所得：水、粮是件数，船材是份数，倾船刮底是清掉的附着点数
    pub gain: i64,
    pub block: Option<ShoreBlock>,
}

/// `Command::Shore` 的内容。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShoreOrder {
    /// 收帆锚泊，派人上岸做这几件差事
    Start { tasks: Vec<ShoreTask> },
    /// 召回岸上的人（没做完的差事什么也不给）
    Recall,
    /// 下网 / 收网
    Nets { on: bool },
}

/// `Command::Shore` 的预检结果。
pub(crate) enum ShorePlan {
    Start { fleet: FleetId, owner: OwnerId, minute: u16, camp: ShoreCamp },
    Recall { fleet: FleetId },
    Nets { fleet: FleetId, on: bool },
}

impl World {
    pub fn shore_enabled(&self) -> bool {
        self.defs.rules.shore_tasks.enabled
    }

    /// 这支舰队受 H05 管吗（规则开着、手动航行的世界、是玩家的舰队）。
    pub fn shore_applies(&self, fleet: FleetId) -> bool {
        self.shore_enabled()
            && self.defs.manual_navigation
            && self.state.fleets.get(&fleet).is_some_and(|f| f.owner == OwnerId::Player)
    }

    /// 某个海格周围的情形。
    pub fn shore_site(&self, cell: Cell) -> ShoreSite {
        let map = &self.defs.map;
        let geo = &self.defs.geography;
        let r = &self.defs.rules.shore_tasks;
        let topo = map.topology();
        let mut site = ShoreSite::default();
        for dir in 0..8u8 {
            let Some(c) = topo.neighbor(cell, dir) else { continue };
            if map.terrain[map.idx(c)] != Terrain::Land {
                continue;
            }
            site.coast = true;
            let biome = geo.biome_at(map, c);
            if let Some(b) = biome
                && !site.biomes.contains(&b)
            {
                site.biomes.push(b);
            }
            let low = geo.relief_at(map, c).is_none_or(|h| i64::from(h) <= r.careen_relief_max);
            if low && biome != Some(Biome::IceSheet) {
                site.beach = true;
            }
        }
        site.biomes.sort_by_key(|b| b.code());
        site.river = site.coast && geo.river_near(map, cell, r.river_reach);
        site
    }

    /// 舰队现在的位置（海上手动航行时）。
    fn shore_cell(&self, fleet: FleetId) -> Option<Cell> {
        let f = self.state.fleets.get(&fleet)?;
        match &f.location {
            FleetLocation::AtSea(Voyage::Manual { manual }) => Some(manual.pos.cell()),
            _ => None,
        }
    }

    /// 能干活的人（扣掉 H02 的病号）。
    pub fn shore_working(&self, fleet: FleetId) -> i64 {
        let crew = self.state.fleets.get(&fleet).map_or(0, |f| f.crew);
        (crew - self.wear_idle_crew(fleet)).max(0)
    }

    fn shore_hands(&self, fleet: FleetId, task: ShoreTask) -> i64 {
        let r = &self.defs.rules.shore_tasks;
        let working = self.shore_working(fleet);
        (working * r.hands_pct[task.index()] / 100).max(r.hands_min)
    }

    /// 某件差事在此地的天数与所得（还没看人手）。
    fn shore_yield(&self, fleet: FleetId, task: ShoreTask, site: &ShoreSite) -> (i64, i64, Option<ShoreBlock>) {
        let r = &self.defs.rules.shore_tasks;
        let defs = &self.defs;
        let Some(f) = self.state.fleets.get(&fleet) else { return (0, 0, Some(ShoreBlock::NoCoast)) };
        if !site.coast {
            let days = match task {
                ShoreTask::Water => r.water_days[0],
                ShoreTask::Forage => r.forage_days,
                ShoreTask::Timber => r.timber_days,
                ShoreTask::Careen => r.careen_days,
            };
            return (days, 0, Some(ShoreBlock::NoCoast));
        }
        let no_biomes = defs.geography.biomes.is_empty();
        let free = f.free_capacity();
        let wear_on = self.wear_applies(fleet);
        let best = |table: &BTreeMap<String, i64>| site.biomes.iter().map(|b| ShoreRules::rate(table, *b)).max();
        match task {
            ShoreTask::Water => {
                let springs = site.biomes.iter().any(|b| !matches!(b, Biome::Desert | Biome::IceSheet));
                let days = if site.river { r.water_days[0] } else { r.water_days[1] };
                if !site.river && !springs {
                    let why = if no_biomes { ShoreBlock::Unknown } else { ShoreBlock::NoFreshWater };
                    return (days, 0, Some(why));
                }
                let target = crate::fleet::supplies_for_days(defs, f.crew, r.water_fill_days);
                let gain = (target - f.water).max(0).min(free);
                (days, gain, (gain <= 0).then_some(ShoreBlock::Full))
            }
            ShoreTask::Forage => {
                let days = r.forage_days;
                let rate = match best(&r.forage) {
                    None => return (days, 0, Some(ShoreBlock::Unknown)),
                    Some(0) => return (days, 0, Some(ShoreBlock::NoForage)),
                    Some(rate) => rate,
                };
                let gain = (crate::fleet::supplies_for_days(defs, f.crew, rate * days) / 10).min(free);
                // 舱满了也能去：吃到鲜食（H02 断鲜天数清零）仍有用
                let useful = gain > 0 || (wear_on && self.fleet_wear(fleet).fresh_days > 0);
                (days, gain, (!useful).then_some(ShoreBlock::Full))
            }
            ShoreTask::Timber => {
                let days = r.timber_days;
                if !wear_on {
                    return (days, 0, Some(ShoreBlock::NoWear));
                }
                let rate = match best(&r.timber) {
                    None => return (days, 0, Some(ShoreBlock::Unknown)),
                    Some(0) => return (days, 0, Some(ShoreBlock::NoForest)),
                    Some(rate) => rate,
                };
                let room = (self.timber_cap(fleet) - self.fleet_wear(fleet).timber).max(0);
                let gain = (rate * days * f.ships.len() as i64).min(room);
                (days, gain, (gain <= 0).then_some(ShoreBlock::Full))
            }
            ShoreTask::Careen => {
                let days = r.careen_days;
                if !wear_on {
                    return (days, 0, Some(ShoreBlock::NoWear));
                }
                if !site.beach {
                    return (days, 0, Some(ShoreBlock::NoBeach));
                }
                let gain = self.fleet_wear(fleet).fouling_points();
                (days, gain, (self.fleet_wear(fleet).fouling <= 0).then_some(ShoreBlock::Full))
            }
        }
    }

    /// 此地能做的差事（四件都列出来，做不了的带原因）。不在海上手动航行时为空。
    pub fn shore_options(&self, fleet: FleetId) -> Vec<ShoreOption> {
        if !self.shore_applies(fleet) {
            return Vec::new();
        }
        let Some(cell) = self.shore_cell(fleet) else { return Vec::new() };
        let site = self.shore_site(cell);
        let working = self.shore_working(fleet);
        ShoreTask::ALL
            .into_iter()
            .map(|task| {
                let (days, gain, mut block) = self.shore_yield(fleet, task, &site);
                let hands = self.shore_hands(fleet, task);
                if block.is_none() && hands > working {
                    block = Some(ShoreBlock::Hands);
                }
                ShoreOption { task, hands, days, gain, block }
            })
            .collect()
    }

    /// 避风：收帆锚泊、离陆地 1 格以内、陆地在上风一侧时，暴风雨损伤保留的百分比；否则 100。
    pub fn shelter_keep(&self, fleet: FleetId, weather: Option<&DayWeather>) -> i64 {
        if !self.shore_applies(fleet) {
            return 100;
        }
        let Some(w) = weather else { return 100 };
        let Some(f) = self.state.fleets.get(&fleet) else { return 100 };
        let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location else { return 100 };
        if manual.sail != Sail::Furled
            || manual.pilot.as_ref().is_some_and(|p| p.mode() == crate::navigation::autopilot::PilotMode::Creep)
        {
            return 100;
        }
        if self.sheltered(manual.pos.cell(), w.sea.wind_dir) { self.defs.rules.shore_tasks.shelter_keep } else { 100 }
    }

    /// 这个海格在 `wind_dir`（风吹向的方向，八方向下标）的风里是不是在陆地的下风：上风一侧（含左右 45°）挨着陆格。
    pub fn sheltered(&self, cell: Cell, wind_dir: u8) -> bool {
        let map = &self.defs.map;
        let topo = map.topology();
        let upwind = (wind_dir % 8 + 4) % 8;
        [upwind, (upwind + 1) % 8, (upwind + 7) % 8]
            .into_iter()
            .any(|dir| topo.neighbor(cell, dir).is_some_and(|c| map.terrain[map.idx(c)] == Terrain::Land))
    }

    /// 今天下网能不能捞到（开关、半帆或收帆、在海上手动航行）。
    pub fn nets_working(&self, fleet: FleetId) -> bool {
        if !self.shore_applies(fleet) || !self.state.shore.nets.contains(&fleet) {
            return false;
        }
        matches!(
            self.state.fleets.get(&fleet).map(|f| &f.location),
            Some(FleetLocation::AtSea(Voyage::Manual { manual })) if manual.sail != Sail::Full
        )
    }

    /// 下网一天的渔获：够全船吃几“十分之一天”（按所在海区的气候）。
    pub fn fish_tenths(&self, fleet: FleetId) -> i64 {
        let r = &self.defs.rules.shore_tasks;
        let Some(f) = self.state.fleets.get(&fleet) else { return 0 };
        let climate = self.defs.map.region_of(f.cell(&self.defs)).map(|reg| self.defs.region(reg).climate);
        match climate {
            Some(Climate::Cold) => r.fish[1],
            Some(Climate::Arid) => r.fish[2],
            Some(Climate::Tropical) => r.fish[3],
            _ => r.fish[0],
        }
    }

    /// 海上一天（`sea_day` 里补给之后）：下网给粮、雨天接水，都按人日折进粮水（不超过空舱）。
    pub(crate) fn shore_sea_day(&mut self, fleet: FleetId, weather: Option<&DayWeather>) -> Result<(), CoreError> {
        if !self.shore_applies(fleet)
            || !matches!(self.fleet(fleet)?.location, FleetLocation::AtSea(Voyage::Manual { .. }))
        {
            return Ok(());
        }
        let fish = if self.nets_working(fleet) { self.fish_tenths(fleet) } else { 0 };
        let rain = if weather.is_some_and(|w| matches!(w.sky, Sky::Rain | Sky::Storm)) {
            self.defs.rules.shore_tasks.rain_tenths
        } else {
            0
        };
        let defs = self.defs.clone();
        let f = self.fleet_mut(fleet)?;
        let crew = f.crew.max(0);
        add_person_days(&defs, f, false, crew * fish / 10);
        add_person_days(&defs, f, true, crew * rain / 10);
        Ok(())
    }

    /// 日结：岸上差事过一天——采集、伐木掷风险，到期的交付，全部做完就拔锚。舰队没了或不在海上了就撤掉。
    pub(crate) fn finish_shore_day(&mut self) {
        if self.state.shore.is_empty() {
            return;
        }
        let gone: Vec<FleetId> = self
            .state
            .shore
            .nets
            .iter()
            .copied()
            .filter(|id| !self.state.fleets.contains_key(id) || !self.shore_enabled())
            .collect();
        for id in gone {
            self.state.shore.nets.remove(&id);
        }
        let camps = std::mem::take(&mut self.state.shore.camps);
        for (id, mut camp) in camps {
            if !self.shore_applies(id) || self.shore_cell(id).is_none() {
                continue;
            }
            camp.elapsed += 1;
            let owner = OwnerId::Player;
            let day = self.day();
            for job in camp.jobs.clone() {
                if job.days < camp.elapsed {
                    continue;
                }
                if matches!(job.task, ShoreTask::Forage | ShoreTask::Timber) {
                    self.shore_mishap(id, owner, job.task);
                }
                if job.days == camp.elapsed {
                    let gain = self.shore_deliver(id, job.task);
                    self.push_log(LogEvent {
                        day,
                        kind: LogKind::ShoreDone { fleet: id, owner, task: job.task, gain },
                    });
                }
            }
            if camp.elapsed < camp.days() && self.state.fleets.contains_key(&id) {
                self.state.shore.camps.insert(id, camp);
            }
        }
    }

    /// 采集、伐木的一个工作日出事：与登陆同一套伤病（受伤 1–2 人、染病士气 −5，船医与体魄照样减免）。
    fn shore_mishap(&mut self, fleet: FleetId, owner: OwnerId, task: ShoreTask) {
        let bp = self.defs.rules.shore_tasks.risk_bp;
        let mut rng = Rng::derive(self.state.seed, self.day(), Domain::Shore, u64::from(fleet.0), task.index() as u64);
        if !rng.chance_bp(bp) {
            return;
        }
        let risk = if rng.below(2) == 0 { LandingRisk::Injury } else { LandingRisk::Disease };
        let keep = self.post_disease_keep(fleet);
        if risk == LandingRisk::Disease && keep < 100 && !rng.chance_bp(keep * 100) {
            return;
        }
        let Some(f) = self.state.fleets.get_mut(&fleet) else { return };
        match risk {
            LandingRisk::Injury => f.crew -= f.crew.saturating_sub(1).clamp(0, 2),
            _ => f.morale = (f.morale - 5).max(0),
        }
        self.push_log(LogEvent { day: self.day(), kind: LogKind::LandingRisk { fleet, owner, risk } });
    }

    /// 一件差事做完：按此刻的地貌与舱位交付，返回所得。
    fn shore_deliver(&mut self, fleet: FleetId, task: ShoreTask) -> i64 {
        let Some(cell) = self.shore_cell(fleet) else { return 0 };
        let site = self.shore_site(cell);
        let (_, gain, block) = self.shore_yield(fleet, task, &site);
        if matches!(block, Some(b) if b != ShoreBlock::Full) {
            return 0;
        }
        match task {
            ShoreTask::Water => {
                if let Some(f) = self.state.fleets.get_mut(&fleet) {
                    f.water += gain;
                }
            }
            ShoreTask::Forage => {
                if let Some(f) = self.state.fleets.get_mut(&fleet) {
                    f.food += gain;
                }
                self.wear_fresh_food(fleet, u32::MAX);
            }
            ShoreTask::Timber => {
                let mut w = self.fleet_wear(fleet);
                w.timber += gain;
                self.wear_store(fleet, w);
            }
            ShoreTask::Careen => {
                let mut w = self.fleet_wear(fleet);
                w.fouling = 0;
                self.wear_store(fleet, w);
            }
        }
        gain
    }

    pub(crate) fn validate_shore_snapshot(&self) -> Result<(), CoreError> {
        let fail = || CoreError::Save("岸上差事的状态无效".into());
        for (id, camp) in &self.state.shore.camps {
            let Some(f) = self.state.fleets.get(id) else { return Err(fail()) };
            let mut seen = BTreeSet::new();
            if f.owner != OwnerId::Player
                || !matches!(f.location, FleetLocation::AtSea(Voyage::Manual { .. }))
                || camp.jobs.is_empty()
                || camp.elapsed >= camp.days()
                || camp
                    .jobs
                    .iter()
                    .any(|j| j.days == 0 || j.days > MAX_SHORE_DAYS || j.hands < 0 || !seen.insert(j.task))
            {
                return Err(fail());
            }
        }
        if self.state.shore.nets.iter().any(|id| !self.state.fleets.contains_key(id)) {
            return Err(fail());
        }
        Ok(())
    }
}

pub(crate) fn check_order(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    order: &ShoreOrder,
) -> Result<ShorePlan, CommandError> {
    let f = world.fleet(fleet)?;
    if owner != OwnerId::Player || f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if !world.shore_applies(fleet) {
        return Err(Reason::new("shore.disabled", "这个世界没有岸上差事").rule());
    }
    match order {
        ShoreOrder::Recall => {
            if !world.state.shore.camps.contains_key(&fleet) {
                return Err(Reason::new("shore.none", "岸上没有人").rule());
            }
            Ok(ShorePlan::Recall { fleet })
        }
        ShoreOrder::Nets { on } => {
            if *on == world.state.shore.nets.contains(&fleet) {
                return Err(Reason::new("shore.nets_same", if *on { "网已经下了" } else { "网已经收了" }).rule());
            }
            Ok(ShorePlan::Nets { fleet, on: *on })
        }
        ShoreOrder::Start { tasks } => {
            if world.state.shore.camps.contains_key(&fleet) {
                return Err(Reason::new("shore.active", "岸上的差事还没做完").rule());
            }
            let minute = world.state.navigation.minute;
            // 与手动航行的命令同一套前提：手动航行、不在登陆、不在交战
            crate::navigation::orders::check_fleet(world, owner, fleet, minute)?;
            let FleetLocation::AtSea(Voyage::Manual { .. }) = &f.location else {
                return Err(Reason::new("shore.at_sea", "在港里直接补给就好；岸上差事要在海上锚泊时派").rule());
            };
            if world.manual_course(f, &[], minute).arrival.is_some() {
                return Err(Reason::new("navigation.arrived", "舰队在这个分钟已经抵达锚地，等待日结靠港").rule());
            }
            let mut wanted: Vec<ShoreTask> = tasks.clone();
            wanted.sort();
            wanted.dedup();
            if wanted.is_empty() || wanted.len() != tasks.len() {
                return Err(Reason::new("shore.tasks", "至少选一件差事，且不能重复").range());
            }
            let options = world.shore_options(fleet);
            let mut jobs = Vec::new();
            let mut hands = 0;
            for task in wanted {
                let Some(o) = options.iter().find(|o| o.task == task) else {
                    return Err(Reason::new("shore.coast", "舰队需要靠近陆地").rule());
                };
                if let Some(block) = o.block {
                    return Err(Reason::new("shore.blocked", format!("{} 此地做不了（{block:?}）", task.key()))
                        .arg("task", crate::TextArg::Text(task.key().into()))
                        .rule());
                }
                hands += o.hands;
                jobs.push(ShoreJob { task, days: o.days.clamp(1, i64::from(MAX_SHORE_DAYS)) as u16, hands: o.hands });
            }
            let working = world.shore_working(fleet);
            if hands > working {
                return Err(Reason::new("shore.hands", format!("要 {hands} 人，能干活的只有 {working} 人"))
                    .arg("need", crate::TextArg::Int(hands))
                    .arg("have", crate::TextArg::Int(working))
                    .rule());
            }
            Ok(ShorePlan::Start { fleet, owner, minute, camp: ShoreCamp { jobs, elapsed: 0 } })
        }
    }
}

pub(crate) fn apply_order(world: &mut World, plan: ShorePlan) -> Result<(), CoreError> {
    match plan {
        ShorePlan::Start { fleet, owner, minute, camp } => {
            // 收帆锚泊（与登陆一样从这个分钟起收帆，领航随之撤掉）
            world.state.navigation.pending.entry(fleet).or_default().steers.push(crate::navigation::Steering {
                minute,
                heading: None,
                sail: Some(Sail::Furled),
            });
            let days = i64::from(camp.days());
            let n = camp.jobs.len() as i64;
            world.state.shore.camps.insert(fleet, camp);
            world.push_log(LogEvent { day: world.day(), kind: LogKind::ShoreStarted { fleet, owner, tasks: n, days } });
        }
        ShorePlan::Recall { fleet } => {
            world.state.shore.camps.remove(&fleet);
        }
        ShorePlan::Nets { fleet, on } => {
            if on {
                world.state.shore.nets.insert(fleet);
            } else {
                world.state.shore.nets.remove(&fleet);
            }
        }
    }
    Ok(())
}

/// 往粮（`water` 为 false）或水里添 `person_days` 人日，返回多占的舱位（件），不超过空舱。
/// 按人日累计的世界（`fractional_supplies`）先补满已经打开的那一格，余下的按格添、零头开一格；
/// 按格取整的世界四舍五入成件。
pub(crate) fn add_person_days(
    defs: &crate::StaticData,
    f: &mut crate::world::Fleet,
    water: bool,
    person_days: i64,
) -> i64 {
    if person_days <= 0 {
        return 0;
    }
    let per = defs.rules.crew_per_supply_unit.max(1);
    let free = f.free_capacity();
    let (stock, used) =
        if water { (&mut f.water, &mut f.supply_remainder.water) } else { (&mut f.food, &mut f.supply_remainder.food) };
    if !defs.rules.fractional_supplies {
        let units = ((person_days + per / 2) / per).min(free);
        *stock += units;
        return units;
    }
    let available = ((*stock).max(0) * per - *used).max(0);
    let after = (available + person_days).min(((*stock).max(0) + free) * per);
    let units = (after + per - 1) / per;
    let added = units - (*stock).max(0);
    *stock = units;
    *used = units * per - after;
    added
}

/// 避风后的损伤：保留 `keep`%（100 时原样返回，经典路径的数值逐位不变）。
pub fn sheltered_damage(damage: i64, keep: i64) -> i64 {
    if keep == 100 { damage } else { mul_div(damage, keep, 100) }
}

#[cfg(test)]
#[path = "shore_tests.rs"]
mod tests;

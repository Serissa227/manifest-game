//! H04 海上所见（`rules.toml [sightings]`，VOYAGE-PLAN §5）：玩家自己决定要不要靠过去的小目标。
//!
//! - **生成**：每天日结时，每支手动航行在海上的玩家舰队掷一次（`daily_bp`，瞭望的 `IntelDetection` 每点再 +`intel_bp`，
//!   封顶 `max_bp`）；中了就在航向前方 ±`cone`°、`distance` 格处放一个，寿命 `lifetime` 天，同一支舰队同时最多 `max_active` 个，
//!   离港口 `port_clear` 格以内不放、落在陆上不放。种类按数据分片 `voyage/sightings.toml` 的权重与出场条件（气候、季节、离岸远近）抽。
//!   随机数一律 `Rng::derive(种子, 日期, Domain::Sightings, …)`，不存随机数状态。
//! - **触发**：舰队的分钟航迹进入 `touch`（1/256 格，缺省半格）以内——航迹上出一个停船点（`StopKind::Sighting`，自动暂停），
//!   落实这段航迹时把它记成“碰上了”。要绕开的三种（海藻带、浮冰、暗礁）碰上就当场结算第一个按钮；其余的等玩家在小卡片上选。
//! - **结算**：`Command::ResolveSighting`，效果沿用故事效果的封闭集合（[`crate::story::apply`]），另加“给物品”
//!   （物品键必须存在，数据加载与命令都校验）与几种海上专用的：朝陆地揭雾、标出最近的港口、满帆才受的损伤。
//! - 不靠近就不触发；过了寿命就消失（碰上了但没选的也一起消失，没有效果）。
//!
//! 开关关闭（经典世界、测试夹具）时什么也不生成，状态里没有这一节，存档逐字节不变。

use crate::calendar::Season;
use crate::captain::AttrHook;
use crate::error::{CommandError, Reason};
use crate::ids::{Cell, FleetId, GoodId};
use crate::navigation::{CourseStop, Sail, StopKind, SubCell};
use crate::rng::{Domain, Rng};
use crate::story::StoryEffect;
use crate::weather::Climate;
use crate::weather_cells::sub_distance2;
use crate::world::{FleetLocation, Voyage, World, WorldState};
use crate::{OwnerId, StaticData};
use serde::{Deserialize, Serialize};

/// 所见的种类。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SightKind {
    /// 漂流货
    Flotsam,
    /// 残骸
    Wreck,
    /// 落难的人
    Castaway,
    /// 鸟群
    Birds,
    /// 鱼群或鲸
    Shoal,
    /// 渔船
    Fishing,
    /// 海藻带（要绕开）
    Weed,
    /// 浮冰（要绕开）
    Ice,
    /// 暗礁（要绕开；半帆、收帆安全）
    Reef,
}

impl SightKind {
    pub const ALL: [SightKind; 9] = [
        SightKind::Flotsam,
        SightKind::Wreck,
        SightKind::Castaway,
        SightKind::Birds,
        SightKind::Shoal,
        SightKind::Fishing,
        SightKind::Weed,
        SightKind::Ice,
        SightKind::Reef,
    ];

    pub fn key(self) -> &'static str {
        match self {
            SightKind::Flotsam => "flotsam",
            SightKind::Wreck => "wreck",
            SightKind::Castaway => "castaway",
            SightKind::Birds => "birds",
            SightKind::Shoal => "shoal",
            SightKind::Fishing => "fishing",
            SightKind::Weed => "weed",
            SightKind::Ice => "ice",
            SightKind::Reef => "reef",
        }
    }

    pub fn from_key(s: &str) -> Option<SightKind> {
        SightKind::ALL.into_iter().find(|k| k.key() == s)
    }

    /// 要绕开的：碰上就当场结算。
    pub fn hazard(self) -> bool {
        matches!(self, SightKind::Weed | SightKind::Ice | SightKind::Reef)
    }
}

/// 离岸远近的条件。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shore {
    /// 离岸 `near_shore` 格以内
    Near,
    /// 离岸 `far_shore` 格以外
    Far,
}

/// 出场条件（都为空时处处可出）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SightWhen {
    pub climates: Vec<Climate>,
    pub seasons: Vec<Season>,
    pub shore: Option<Shore>,
}

/// 一组结果。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SightEffects {
    pub cash: i64,
    pub morale: i64,
    /// 救起的水手 [少, 多]
    pub crew: Option<[i64; 2]>,
    /// 粮水天数
    pub supplies: i64,
    /// 吃到鲜鱼：断鲜天数回退这么多天（H02 船况开着时才有用）
    pub fresh: i64,
    /// 当地常见货的件数 [少, 多]
    pub goods: Option<[i64; 2]>,
    /// 物品键（加载时已校验存在）
    pub item: Option<String>,
    /// 每艘船损失最大耐久的百分比
    pub damage: i64,
    /// 满帆时才受的损伤百分比
    pub damage_full_sail: i64,
    pub rumor: bool,
    /// 揭开所在海区的海图
    pub chart: bool,
    /// 朝最近的未探明陆地揭开的迷雾半径（格）
    pub land: i64,
    /// 标出最近的还没望见过的港口
    pub port: bool,
}

/// 小概率另得。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SightLucky {
    /// 万分比
    pub chance_bp: i64,
    pub result: String,
    pub effects: SightEffects,
}

/// 小卡片上的一个按钮。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SightOption {
    pub label: String,
    pub result: String,
    /// 暗礁：没有满帆时换成这句
    pub safe: Option<String>,
    pub effects: SightEffects,
    pub lucky: Option<SightLucky>,
}

/// 一种所见（数据分片 `voyage/sightings.toml` 的一条）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SightingDef {
    pub key: String,
    pub kind: SightKind,
    pub weight: i64,
    pub title: String,
    pub text: String,
    pub when: SightWhen,
    pub options: Vec<SightOption>,
}

/// 海上所见的规则（`rules.toml [sightings]`）与数据表。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SightingRules {
    pub enabled: bool,
    /// 每支舰队每天生成的概率（万分比）
    pub daily_bp: i64,
    /// 瞭望（IntelDetection）每点再加的概率（万分比）
    pub intel_bp: i64,
    /// 概率上限（万分比）
    pub max_bp: i64,
    /// 放在前方多远（格，含两端）
    pub distance: [i64; 2],
    /// 偏离航向的最大角度（度）
    pub cone: i64,
    /// 寿命（天）
    pub lifetime: u32,
    /// 同一支舰队同时最多几个
    pub max_active: usize,
    /// 离港口几格以内不放（切比雪夫距离）
    pub port_clear: i64,
    /// 多近算碰上（1/256 格）
    pub touch: i64,
    /// 离岸几格以内算“近岸”
    pub near_shore: i64,
    /// 离岸几格以外算“远海”
    pub far_shore: i64,
    /// 数据表（加载器从 `sightings.toml` 填，不在 rules.toml 里写）
    #[serde(skip)]
    pub defs: Vec<SightingDef>,
}

impl Default for SightingRules {
    fn default() -> Self {
        Self {
            enabled: false,
            daily_bp: 2_200,
            intel_bp: 100,
            max_bp: 3_500,
            distance: [2, 5],
            cone: 60,
            lifetime: 3,
            max_active: 3,
            port_clear: 3,
            touch: 128,
            near_shore: 4,
            far_shore: 8,
            defs: Vec::new(),
        }
    }
}

impl SightingRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(0..=10_000).contains(&self.daily_bp) || !(0..=10_000).contains(&self.max_bp) || self.intel_bp < 0 {
            out.push(("daily_bp", "概率须在 0–10000（万分比）之间"));
        }
        if !(self.distance[0] >= 1 && self.distance[0] <= self.distance[1] && self.distance[1] <= 32) {
            out.push(("distance", "须为 [小, 大]，1 ≤ 小 ≤ 大 ≤ 32"));
        }
        if !(0..=180).contains(&self.cone) {
            out.push(("cone", "须在 0–180 之间"));
        }
        if self.lifetime == 0 || self.max_active == 0 {
            out.push(("lifetime", "寿命与同时个数都至少为 1"));
        }
        if !(1..=2_048).contains(&self.touch) {
            out.push(("touch", "须在 1–2048 之间（1/256 格）"));
        }
        if self.near_shore < 0 || self.far_shore < self.near_shore || self.far_shore > 32 {
            out.push(("far_shore", "须 0 ≤ near_shore ≤ far_shore ≤ 32"));
        }
        out
    }

    pub fn def(&self, key: &str) -> Option<&SightingDef> {
        self.defs.iter().find(|d| d.key == key)
    }
}

/// 海上的一个所见。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sighting {
    pub id: u32,
    /// 数据表里的键
    pub def: String,
    pub fleet: FleetId,
    pub pos: SubCell,
    /// 最后一天（含）
    pub until: u32,
    /// 碰上了：等玩家在小卡片上选（要绕开的三种已当场结算）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub touched: bool,
    /// 要绕开的三种：当场结算时是不是满帆（卡片上的话不同）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub full_sail: bool,
}

/// 刚结算的一个所见（小卡片上显示结果用）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SightingResult {
    pub id: u32,
    pub def: String,
    pub fleet: FleetId,
    pub day: u32,
    pub choice: usize,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub lucky: bool,
    /// 暗礁：没有满帆，安全
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub safe: bool,
}

/// 海上所见的状态。开关关闭时总是空的、不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SightingState {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub active: Vec<Sighting>,
    #[serde(default)]
    pub next: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<SightingResult>,
}

impl SightingState {
    pub fn is_empty(&self) -> bool {
        self.active.is_empty() && self.next == 0 && self.last.is_none()
    }
}

/// 随机子键。
const K_SPAWN: u64 = 0;
const K_LUCKY: u64 = 1;
const K_AMOUNT: u64 = 2;

fn climate_of(defs: &StaticData, cell: Cell) -> Option<Climate> {
    defs.map.region_of(cell).and_then(|r| defs.regions.get(r.idx())).map(|r| r.climate)
}

fn season_of(defs: &StaticData, cell: Cell, day: u32) -> Season {
    match (defs.nav.grid.rules(), defs.map.region_of(cell)) {
        (Some(nav), Some(r)) if nav.regions.get(r.idx()).is_some_and(|x| !x.weather.is_empty() || x.south) => {
            nav.season_on(r, day)
        }
        _ => defs.calendar.season_of(day),
    }
}

/// 离最近的陆地多少格（切比雪夫距离；`limit` 格以内没有陆地时为 None）。
fn shore_distance(defs: &StaticData, cell: Cell, limit: i64) -> Option<i64> {
    let topology = defs.map.topology();
    (0..=limit).find(|r| {
        (-r..=*r).any(|dy| {
            (-r..=*r).any(|dx| {
                (dx.abs() == *r || dy.abs() == *r)
                    && topology
                        .normalize(i64::from(cell.x) + dx, i64::from(cell.y) + dy)
                        .is_some_and(|c| !defs.map.is_sea(c))
            })
        })
    })
}

/// 某格某天这一种所见合不合条件。
pub fn eligible(defs: &StaticData, def: &SightingDef, cell: Cell, day: u32) -> bool {
    let w = &def.when;
    if !w.climates.is_empty() && !climate_of(defs, cell).is_some_and(|c| w.climates.contains(&c)) {
        return false;
    }
    if !w.seasons.is_empty() && !w.seasons.contains(&season_of(defs, cell, day)) {
        return false;
    }
    let rules = &defs.rules.sightings;
    match w.shore {
        None => true,
        Some(Shore::Near) => shore_distance(defs, cell, rules.near_shore).is_some(),
        Some(Shore::Far) => shore_distance(defs, cell, rules.far_shore).is_none(),
    }
}

impl World {
    /// 这支舰队今天生成所见的概率（万分比）。
    pub fn sighting_chance_bp(&self, fleet: FleetId) -> i64 {
        let rules = &self.defs.rules.sightings;
        let owner = self.fleet(fleet).map_or(OwnerId::Player, |f| f.owner);
        let intel = self.attr_hook(owner, AttrHook::IntelDetection).max(0);
        (rules.daily_bp + intel * rules.intel_bp).min(rules.max_bp)
    }

    /// 日结：过期的消失，再给每支手动航行在海上的玩家舰队掷一次。开关关闭时什么也不做。
    pub(crate) fn sightings_day(&mut self) {
        let rules = self.defs.rules.sightings.clone();
        if !rules.enabled || rules.defs.is_empty() {
            return;
        }
        let day = self.state.day;
        let seed = self.state.seed;
        let alive: Vec<FleetId> = self
            .state
            .fleets
            .values()
            .filter(|f| f.owner == OwnerId::Player && matches!(f.location, FleetLocation::AtSea(Voyage::Manual { .. })))
            .map(|f| f.id)
            .collect();
        self.state.sightings.active.retain(|s| s.until >= day && alive.contains(&s.fleet));
        if self.state.sightings.last.as_ref().is_some_and(|l| l.day < day) {
            self.state.sightings.last = None;
        }
        let defs = self.defs.clone();
        let topology = defs.map.topology();
        let ports: Vec<Cell> = defs.port_ids().map(|l| defs.loc(l).cell).collect();
        for id in alive {
            if self.fleet_in_battle(id)
                || self.state.sightings.active.iter().filter(|s| s.fleet == id).count() >= rules.max_active
            {
                continue;
            }
            let Some(FleetLocation::AtSea(Voyage::Manual { manual })) = self.state.fleets.get(&id).map(|f| &f.location)
            else {
                continue;
            };
            let (pos, heading) = (manual.pos, manual.heading);
            let mut rng = Rng::derive(seed, day, Domain::Sightings, u64::from(id.0), K_SPAWN);
            if !rng.chance_bp(self.sighting_chance_bp(id)) {
                continue;
            }
            let off = rng.range(-rules.cone, rules.cone);
            let dist = rng.range(rules.distance[0] * 256, rules.distance[1] * 256);
            let dir = (i64::from(heading) + off).rem_euclid(360) as u16;
            let [ux, uy] = crate::navigation::course::direction(dir);
            let at = SubCell { x: pos.x + dist * ux / crate::Fx::SCALE, y: pos.y + dist * uy / crate::Fx::SCALE };
            let Some(cell) = topology.normalize(at.x.div_euclid(256), at.y.div_euclid(256)) else { continue };
            if !defs.map.is_sea(cell) || ports.iter().any(|p| topology.chebyshev(*p, cell) <= rules.port_clear) {
                continue;
            }
            let pool: Vec<&SightingDef> = rules.defs.iter().filter(|d| eligible(&defs, d, cell, day)).collect();
            let weights: Vec<i64> = pool.iter().map(|d| d.weight.max(0)).collect();
            let Some(pick) = rng.weighted(&weights) else { continue };
            let s = &mut self.state.sightings;
            let sid = s.next;
            s.next += 1;
            let pos = SubCell { x: i64::from(cell.x) * 256 + at.x.rem_euclid(256), y: at.y };
            s.active.push(Sighting {
                id: sid,
                def: pool[pick].key.clone(),
                fleet: id,
                pos,
                until: day + rules.lifetime - 1,
                touched: false,
                full_sail: false,
            });
        }
    }

    /// 航迹上第一次碰上某个所见的分钟（只看这支舰队的、还没碰过的）。
    pub(crate) fn sighting_stops(&self, fleet: FleetId, points: &[crate::navigation::CoursePoint]) -> Vec<CourseStop> {
        let rules = &self.defs.rules.sightings;
        if !rules.enabled {
            return Vec::new();
        }
        let mut out = Vec::new();
        for s in self.state.sightings.active.iter().filter(|s| s.fleet == fleet && !s.touched) {
            if let Some(p) =
                points.iter().find(|p| sub_distance2(&self.defs, p.pos, s.pos) <= rules.touch * rules.touch)
            {
                out.push(CourseStop { minute: p.minute, kind: StopKind::Sighting, loc: None });
            }
        }
        out
    }

    /// 落实一段航迹时：碰上的所见记下来；要绕开的当场结算（按落实那一刻的帆）。
    pub(crate) fn touch_sightings(&mut self, fleet: FleetId, points: &[crate::navigation::CoursePoint], sail: Sail) {
        let rules = self.defs.rules.sightings.clone();
        if !rules.enabled {
            return;
        }
        let touched: Vec<u32> = self
            .state
            .sightings
            .active
            .iter()
            .filter(|s| s.fleet == fleet && !s.touched)
            .filter(|s| points.iter().any(|p| sub_distance2(&self.defs, p.pos, s.pos) <= rules.touch * rules.touch))
            .map(|s| s.id)
            .collect();
        for id in touched {
            let Some(s) = self.state.sightings.active.iter_mut().find(|s| s.id == id) else { continue };
            s.touched = true;
            s.full_sail = sail == Sail::Full;
            let hazard = rules.def(&s.def).is_some_and(|d| d.kind.hazard());
            if hazard {
                // 要绕开的：当场结算第一个按钮，留在表里等玩家点“知道了”
                let _ = resolve(self, fleet, id, 0, true);
            }
        }
    }
}

/// 结果落到世界上。
fn apply_effects(
    world: &mut World,
    fleet: FleetId,
    sid: u32,
    e: &SightEffects,
    full_sail: bool,
) -> Result<(), CommandError> {
    let day = world.state.day;
    let seed = world.state.seed;
    let mut amount = Rng::derive(seed, day, Domain::Sightings, u64::from(sid), K_AMOUNT);
    let mut story = Vec::new();
    if e.cash != 0 {
        story.push(StoryEffect::Cash(e.cash));
    }
    if e.morale != 0 {
        story.push(StoryEffect::Morale(e.morale));
    }
    if let Some([lo, hi]) = e.crew {
        story.push(StoryEffect::Crew(amount.range(lo, hi.max(lo))));
    }
    if e.supplies != 0 {
        story.push(StoryEffect::Supplies(e.supplies));
    }
    if e.fresh > 0 {
        world.wear_fresh_food(fleet, e.fresh as u32);
    }
    if let Some([lo, hi]) = e.goods
        && let Some(good) = local_good(world, fleet, &mut amount)
    {
        story.push(StoryEffect::Goods(good, amount.range(lo, hi.max(lo))));
    }
    let damage = e.damage + if full_sail { e.damage_full_sail } else { 0 };
    if damage > 0 {
        story.push(StoryEffect::Damage(damage));
    }
    if e.rumor {
        story.push(StoryEffect::Rumor);
    }
    if e.chart
        && let Some(r) = world.fleet(fleet).ok().and_then(|f| world.defs.map.region_of(f.cell(&world.defs)))
    {
        story.push(StoryEffect::Chart(r));
    }
    for effect in &story {
        crate::story::apply(world, Some(fleet), effect)
            .map_err(|e| Reason::new("sighting.apply", e.to_string()).rule())?;
    }
    if let Some(item) = &e.item {
        world.grant_item(OwnerId::Player, item, 1)?;
    }
    if e.land > 0 {
        reveal_toward_land(world, fleet, e.land);
    }
    if e.port {
        mark_nearest_port(world, fleet);
    }
    Ok(())
}

/// 当地常见的货：离舰队最近的港口的市场里，按日产量加权抽一种。
fn local_good(world: &World, fleet: FleetId, rng: &mut Rng) -> Option<GoodId> {
    let f = world.fleet(fleet).ok()?;
    let port = world.fleet_port(f)?;
    let market = &world.defs.loc(port).market;
    let weights: Vec<i64> = market.iter().map(|m| m.supply.max(0)).collect();
    rng.weighted(&weights).map(|i| market[i].good)
}

/// 朝最近的未探明陆地揭开一小片迷雾（舰队 24 格以内；没有就不揭）。
fn reveal_toward_land(world: &mut World, fleet: FleetId, radius: i64) {
    let Ok(f) = world.fleet(fleet) else { return };
    let at = f.cell(&world.defs);
    world.init_exploration();
    let map = &world.defs.map;
    let topology = map.topology();
    let mut best: Option<(i64, Cell)> = None;
    for dy in -24..=24i64 {
        for dx in -24..=24i64 {
            let Some(c) = topology.normalize(i64::from(at.x) + dx, i64::from(at.y) + dy) else { continue };
            if map.is_sea(c) || world.state.explore.is_revealed(map.idx(c)) {
                continue;
            }
            let d = dx * dx + dy * dy;
            if best.is_none_or(|(b, bc)| (d, c) < (b, bc)) {
                best = Some((d, c));
            }
        }
    }
    if let Some((_, cell)) = best {
        world.reveal_around(cell, radius.clamp(1, 8));
        world.record_sighted_locations();
    }
}

/// 在海图上标出最近的还没望见过的港口。
fn mark_nearest_port(world: &mut World, fleet: FleetId) {
    let Ok(f) = world.fleet(fleet) else { return };
    let at = f.cell(&world.defs);
    let topology = world.defs.map.topology();
    let pick = world
        .defs
        .port_ids()
        .filter(|id| !world.location_visible(*id))
        .min_by_key(|id| (topology.squared_distance(at, world.defs.loc(*id).cell), *id));
    if let Some(loc) = pick {
        world.state.explore.sighted.insert(loc);
        world.push_log(crate::log::LogEvent {
            day: world.day(),
            kind: crate::log::LogKind::LocationSighted { loc, owner: OwnerId::Player },
        });
    }
}

/// 结算一个所见（要绕开的在碰上时由内核自己调用，`auto` 为真；玩家的选择走 [`check_resolve`]）。
fn resolve(world: &mut World, fleet: FleetId, id: u32, choice: usize, auto: bool) -> Result<(), CommandError> {
    let defs = world.defs.clone();
    let Some(s) = world.state.sightings.active.iter().find(|s| s.id == id).cloned() else {
        return Err(Reason::new("sighting.missing", "这个所见已经不在了").rule());
    };
    let def = defs.rules.sightings.def(&s.def).ok_or_else(|| Reason::new("sighting.def", "没有这种所见").rule())?;
    let option = def.options.get(choice).ok_or_else(|| Reason::new("sighting.choice", "没有这个选项").range())?;
    let hazard = def.kind.hazard();
    let mut lucky = false;
    if !hazard || auto {
        apply_effects(world, fleet, id, &option.effects, s.full_sail)?;
        if let Some(l) = &option.lucky {
            let mut rng = Rng::derive(world.state.seed, world.state.day, Domain::Sightings, u64::from(id), K_LUCKY);
            if rng.chance_bp(l.chance_bp) {
                lucky = true;
                apply_effects(world, fleet, id, &l.effects, s.full_sail)?;
            }
        }
    }
    let safe = def.kind == SightKind::Reef && !s.full_sail;
    if auto {
        // 要绕开的：结果先记下，卡片留在表里等“知道了”
        world.state.sightings.last =
            Some(SightingResult { id, def: s.def.clone(), fleet, day: world.state.day, choice, lucky, safe });
        return Ok(());
    }
    if !hazard && world.defs.rules.voyage_log.enabled {
        // H08：航海日志开着时，所见的选择记一条日志
        let what = format!("{}：{}", def.title, option.label);
        let day = world.state.day;
        world.push_log(crate::log::LogEvent {
            day,
            kind: crate::log::LogKind::SightingChosen { fleet, owner: OwnerId::Player, what },
        });
    }
    world.state.sightings.active.retain(|x| x.id != id);
    if hazard && world.state.sightings.last.as_ref().is_some_and(|l| l.id == id) {
        // “知道了”：卡片收起，结果也不再显示
        world.state.sightings.last = None;
    }
    if !hazard {
        world.state.sightings.last =
            Some(SightingResult { id, def: s.def.clone(), fleet, day: world.state.day, choice, lucky, safe });
    }
    Ok(())
}

/// 命令校验：玩家的、在场的、碰上了的所见，选项在范围内；物品键存在。返回结算后的世界状态。
pub(crate) fn check_resolve(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    id: u32,
    choice: usize,
) -> Result<Box<WorldState>, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let f = world.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    let rules = &world.defs.rules.sightings;
    if !rules.enabled {
        return Err(Reason::new("sighting.disabled", "这个世界没有海上所见").rule());
    }
    let s = world
        .state
        .sightings
        .active
        .iter()
        .find(|s| s.id == id && s.fleet == fleet)
        .ok_or_else(|| Reason::new("sighting.missing", "这个所见已经不在了").rule())?;
    if !s.touched {
        return Err(Reason::new("sighting.far", "还没靠过去").rule());
    }
    let def = rules.def(&s.def).ok_or_else(|| Reason::new("sighting.def", "没有这种所见").rule())?;
    let option = def.options.get(choice).ok_or_else(|| Reason::new("sighting.choice", "没有这个选项").range())?;
    for item in
        [&option.effects.item, &option.lucky.as_ref().and_then(|l| l.effects.item.clone())].into_iter().flatten()
    {
        if world.defs.items.item(item).is_none() {
            return Err(Reason::new("sighting.item", "物品不存在").rule());
        }
    }
    let mut w = world.clone();
    resolve(&mut w, fleet, id, choice, false)?;
    Ok(Box::new(w.state))
}

#[cfg(test)]
#[path = "sightings_tests.rs"]
mod tests;

//! 把原始 TOML 转换为内核定义，并做完整校验。

use crate::raw::*;
use crate::worlds::EffectiveWorld;
use crate::{DataError, DataIssue};
use manifest_core::defs::*;
use manifest_core::fixed::{Curve, Fx};
use manifest_core::ids::*;
use manifest_core::nav::{MapTopology, NavGrid, NavTable, SeaMap, Terrain};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;
use std::path::Path;

mod arcana;
mod auction;
mod authored_regions;
mod banter;
mod c2;
pub(crate) mod captain;
pub(crate) mod cast;
mod creatures;
pub(crate) mod economy;
pub(crate) mod effects;
mod fine_coast;
mod geo;
mod history;
mod ideas;
mod items;
mod legend_ships;
mod lineages;
pub(crate) mod map_package;
mod navigation;
mod offstage;
mod realms;
mod scenario;
mod sightings;
mod skills;
mod societies;
pub(crate) mod story;
mod story2;
mod upbringing;
mod weather;

#[cfg(test)]
mod fantasy_sources_tests;

/// 问题收集器。
#[derive(Default)]
pub(crate) struct Issues {
    list: Vec<DataIssue>,
}

impl Issues {
    fn push(&mut self, file: &str, item: impl Into<String>, message: impl Into<String>) {
        self.list.push(DataIssue { file: file.to_string(), item: item.into(), message: message.into() });
    }
}

/// 小数转定点数（四舍五入到万分之一）。
fn fx(d: Dec) -> Fx {
    Fx((d.value() * Fx::SCALE as f64).round() as i64)
}

/// 概率转万分点。
fn bp(d: Dec) -> i64 {
    (d.value() * 10_000.0).round() as i64
}

fn read(dir: &EffectiveWorld, rel: &str, issues: &mut Issues) -> Option<String> {
    match dir.read(rel) {
        Ok(text) => Some(text),
        Err(e) => {
            issues.push(rel, "", e.to_string());
            None
        }
    }
}

fn parse<T: DeserializeOwned>(rel: &str, text: &str, issues: &mut Issues) -> Option<T> {
    match toml::from_str::<T>(text) {
        Ok(v) => Some(v),
        Err(e) => {
            issues.push(rel, "", format!("TOML 格式错误：{}", e.to_string().trim()));
            None
        }
    }
}

fn load_file<T: DeserializeOwned>(dir: &EffectiveWorld, rel: &str, issues: &mut Issues) -> Option<T> {
    let text = read(dir, rel, issues)?;
    parse(rel, &text, issues)
}

/// 一组文件各自读取、解析，分给几个线程做（2026-11-03 启动提速：寰宇的养成、故事文件又多又大）。
/// 返回每个文件的结果与它自己的问题，按文件原顺序排好——调用方照原来的顺序逐个合并、逐个记下问题，
/// 得到的定义与问题的先后都与逐个读、逐个解析时相同。
fn per_file<R: Send>(files: &[String], f: impl Fn(&str, &mut Issues) -> R + Sync) -> Vec<(R, Issues)> {
    crate::worlds::par_map(files, |file| {
        let mut local = Issues::default();
        let r = f(file, &mut local);
        (r, local)
    })
}

/// 可选文件：不存在时视为空（取默认值）。
fn load_optional<T: DeserializeOwned + Default>(dir: &EffectiveWorld, rel: &str, issues: &mut Issues) -> Option<T> {
    if !dir.contains(rel) {
        return Some(T::default());
    }
    load_file(dir, rel, issues)
}

/// 检查键：非空、只含小写字母数字下划线、在表内唯一。
fn check_keys<'a>(file: &str, table: &str, keys: impl Iterator<Item = (&'a str, &'a str)>, issues: &mut Issues) {
    let mut seen: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, (key, name)) in keys.enumerate() {
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            issues.push(file, format!("{table}[{i}]"), format!("key “{key}”无效：只能用小写字母、数字与下划线"));
        }
        if name.trim().is_empty() {
            issues.push(file, format!("{table}[{key}]"), "name 不能为空");
        }
        if seen.insert(key, i).is_some() {
            issues.push(file, format!("{table}[{key}]"), "key 重复");
        }
    }
}

fn lookup<T: Copy>(
    map: &BTreeMap<String, T>,
    key: &str,
    file: &str,
    item: &str,
    what: &str,
    issues: &mut Issues,
) -> Option<T> {
    match map.get(key) {
        Some(v) => Some(*v),
        None => {
            issues.push(file, item, format!("引用了不存在的{what}“{key}”"));
            None
        }
    }
}

const DIRS: [&str; 8] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

fn parse_dir(s: &str) -> Option<u8> {
    DIRS.iter().position(|d| *d == s).map(|i| i as u8)
}

fn in_range(v: f64, lo: f64, hi: f64) -> bool {
    v >= lo && v <= hi
}

/// U02：故事选项的掷骰规则；没写 `[story]` 时取缺省（开关关闭）。
fn story_rules(
    raw: Option<manifest_core::story2::dice::StoryRules>,
    issues: &mut Issues,
) -> manifest_core::story2::dice::StoryRules {
    let rules = raw.unwrap_or_default();
    for problem in rules.problems() {
        issues.push("rules.toml", "story", problem);
    }
    rules
}

/// H07：航线规划；没写 `[routing]` 时取缺省（开关关闭）。
fn routing_rules(
    rules: manifest_core::navigation::routing::RoutingRules,
    issues: &mut Issues,
) -> manifest_core::navigation::routing::RoutingRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("routing.{field}"), problem);
    }
    rules
}

/// P11：事件节奏的闸与预算；没写 `[pacing]` 时取缺省（开关关闭）。
fn pacing_rules(rules: manifest_core::defs::PacingRules, issues: &mut Issues) -> manifest_core::defs::PacingRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("pacing.{field}"), problem);
    }
    rules
}

/// H01：岗位与装备在海上的效果；没写 `[voyage_posts]` 时取缺省（开关关闭）。
fn voyage_posts_rules(
    rules: manifest_core::seafaring::PostsRules,
    issues: &mut Issues,
) -> manifest_core::seafaring::PostsRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("voyage_posts.{field}"), problem);
    }
    rules
}

/// H02：船况、口粮与船员状态；没写 `[voyage_wear]` 时取缺省（开关关闭）。商品、改装与奇遇的 key 由测试核对。
fn voyage_wear_rules(
    rules: manifest_core::seafaring::WearRules,
    issues: &mut Issues,
) -> manifest_core::seafaring::WearRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("voyage_wear.{field}"), problem);
    }
    rules
}

/// H05：岸与锚地；没写 `[shore_tasks]` 时取缺省（开关关闭）。
fn shore_rules(
    rules: manifest_core::seafaring::ShoreRules,
    issues: &mut Issues,
) -> manifest_core::seafaring::ShoreRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("shore_tasks.{field}"), problem);
    }
    rules
}

fn convert_rules(r: RulesFile, issues: &mut Issues) -> Rules {
    let f = "rules.toml";
    let m = &r.market;
    let points: Vec<(Fx, Fx)> = m.price_curve.iter().map(|[x, y]| (fx(*x), fx(*y))).collect();
    let curve = Curve::new(points);
    if curve.points.len() < 2 {
        issues.push(f, "market.price_curve", "至少需要两个点");
    } else if !curve.is_non_increasing() {
        issues.push(f, "market.price_curve", "库存比例必须严格递增、价格系数必须单调不增");
    }
    if curve.points.first().map(|p| p.0) != Some(Fx::ZERO) {
        issues.push(f, "market.price_curve", "第一个点的库存比例必须为 0");
    }
    let floor = fx(m.price_floor);
    let cap = fx(m.price_cap);
    if floor <= Fx::ZERO || cap <= floor {
        issues.push(f, "market", "要求 0 < price_floor < price_cap");
    }
    if m.target_stock_days < 1 {
        issues.push(f, "market.target_stock_days", "必须至少为 1");
    }
    if !in_range(m.production_noise.value(), 0.0, 0.5) {
        issues.push(f, "market.production_noise", "必须在 0 到 0.5 之间");
    }
    if !in_range(m.seasonal_popular_chance.value(), 0.0, 0.1) {
        issues.push(f, "market.seasonal_popular_chance", "必须在 0 到 0.1 之间");
    }
    let v = &r.voyage;
    for (name, val) in [
        ("crew_wage", v.crew_wage),
        ("crew_hire_cost", v.crew_hire_cost),
        ("food_price", v.food_price),
        ("water_price", v.water_price),
        ("crew_per_supply_unit", v.crew_per_supply_unit),
        ("repair_cost_per_point", v.repair_cost_per_point),
    ] {
        if val < 0 {
            issues.push(f, format!("voyage.{name}"), "不能为负");
        }
    }
    if v.crew_per_supply_unit < 1 {
        issues.push(f, "voyage.crew_per_supply_unit", "必须至少为 1");
    }
    if !in_range(v.ship_resale.value(), 0.0, 1.0) {
        issues.push(f, "voyage.ship_resale", "必须在 0 到 1 之间");
    }
    let n = &r.npc;
    if !in_range(n.max_stock_share.value(), 0.01, 1.0) {
        issues.push(f, "npc.max_stock_share", "必须在 0.01 到 1 之间");
    }
    if n.max_fleets == 0 {
        issues.push(f, "npc.max_fleets", "必须至少为 1");
    }
    Rules {
        upbringing: r.upbringing,
        attributes: captain::attribute_rules(r.attributes, issues),
        items: items::rules(r.items, issues),
        ships: r.ships.unwrap_or_default(),
        story: story_rules(r.story, issues),
        price_curve: curve,
        price_floor: floor,
        price_cap: cap,
        target_stock_days: m.target_stock_days,
        production_noise_bp: bp(m.production_noise),
        popular_bonus: fx(m.popular_bonus),
        popular_days: m.popular_days,
        seasonal_popular_bp: bp(m.seasonal_popular_chance),
        price_history_days: m.price_history_days.max(1),
        price_history_months: m.price_history_months.max(1),
        crew_wage: v.crew_wage,
        crew_hire_cost: v.crew_hire_cost,
        food_price: v.food_price,
        water_price: v.water_price,
        crew_per_supply_unit: v.crew_per_supply_unit.max(1),
        fractional_supplies: v.fractional_supplies,
        repair_cost_per_point: v.repair_cost_per_point,
        ship_resale: fx(v.ship_resale),
        disease_bp_per_30_days: bp(v.disease_chance_per_30_days),
        starvation_loss: fx(v.starvation_loss),
        starvation_morale: v.starvation_morale,
        morale_decay_after: v.morale_decay_after,
        mutiny_morale: v.mutiny_morale,
        npc: NpcRules {
            min_margin: fx(n.min_margin),
            max_fleets: n.max_fleets,
            expand_cash_multiple: fx(n.expand_cash_multiple),
            supply_margin_days: n.supply_margin_days,
            repair_below: fx(n.repair_below),
            max_stock_share: fx(n.max_stock_share),
            invest_above: n.invest_above,
            invest_share: fx(n.invest_share),
            industry_above: n.industry_above,
            futures_momentum: fx(n.futures_momentum),
            // 由 `economy::commerce` 填写
            v2: CommerceRules::default(),
        },
        insolvency_days: r.credit.insolvency_days.max(1),
        warehouse: WarehouseRules {
            rent_per_100: r.warehouse.rent_per_100,
            price_per_unit: r.warehouse.price_per_unit,
            demurrage_per_100: r.warehouse.demurrage_per_100,
            ally_free_capacity: r.warehouse.ally_free_capacity,
        },
        caravan: CaravanRules {
            guard_wage: r.caravan.guard_wage,
            guard_hire_cost: r.caravan.guard_hire_cost,
            robbery_bp: bp(r.caravan.robbery_chance),
            resale: fx(r.caravan.resale),
        },
        contracts: ContractRules {
            per_faction_per_month: r.contracts.per_faction_per_month,
            reward_factor: fx(r.contracts.reward_factor),
            penalty_share: fx(r.contracts.penalty_share),
            reputation_gain: r.contracts.reputation_gain,
            reputation_loss: r.contracts.reputation_loss,
            deliver_to_market: r.contracts.deliver_to_market,
            v2: {
                for (field, problem) in r.contracts.v2.problems(r.contracts.per_faction_per_month) {
                    issues.push("rules.toml", format!("contracts.v2.{field}"), problem);
                }
                r.contracts.v2.clone()
            },
        },
        invest: InvestRules {
            cost_per_point: r.invest.cost_per_point.max(1),
            min_amount: r.invest.min_amount,
            ally_share: fx(r.invest.ally_share),
            ally_tax: fx(r.invest.ally_tax),
            ally_specialty_discount: fx(r.invest.ally_specialty_discount),
            decay_months: r.invest.decay_months.max(1),
        },
        bank: BankRules {
            deposit_rate: fx(r.bank.deposit_rate),
            loan_base_rate: fx(r.bank.loan_base_rate),
            loan_risk_premium: fx(r.bank.loan_risk_premium),
            max_term_months: r.bank.max_term_months.max(1),
            overdue_penalty: fx(r.bank.overdue_penalty),
        },
        mates: MateRules {
            xp_per_level: r.mates.xp_per_level.max(1),
            level_gain: r.mates.level_gain,
            salary_growth: fx(r.mates.salary_growth),
            max_level: r.mates.max_level.max(1),
            loyalty_paid: r.mates.loyalty_paid,
            loyalty_unpaid: r.mates.loyalty_unpaid,
            leave_below: r.mates.leave_below,
        },
        pirates: PirateRules {
            // 船型在船型表加载后再解析
            ships: Vec::new(),
            spawn_scale: fx(r.pirates.spawn_scale),
            max_per_region: r.pirates.max_per_region,
            lifetime: (r.pirates.lifetime[0], r.pirates.lifetime[1]),
            fleet_size: (r.pirates.fleet_size[0], r.pirates.fleet_size[1]),
            sight: r.pirates.sight,
            speed: r.pirates.speed,
            crew_ratio: fx(r.pirates.crew_ratio),
        },
        battle: BattleRules {
            evade_max: fx(r.battle.evade_max),
            cargo_loss_pct: (r.battle.cargo_loss_pct[0], r.battle.cargo_loss_pct[1]),
            tribute_pct: (r.battle.tribute_pct[0], r.battle.tribute_pct[1]),
            tactical_radius: r.battle.tactical_radius,
            gun_range: r.battle.gun_range,
            max_turns: r.battle.max_turns,
            reputation_win: r.battle.reputation_win,
        },
        explore: ExploreRules {
            sight: r.explore.sight,
            chart_base: r.explore.chart_base,
            chart_per_100_cells: r.explore.chart_per_100_cells,
        },
        diplomacy: DiplomacyRules {
            incident_bp: bp(r.diplomacy.incident_chance),
            tension_below: r.diplomacy.tension_below,
            peace_above: r.diplomacy.peace_above,
            war_below: r.diplomacy.war_below,
            war_min_tension_days: r.diplomacy.war_min_tension_days,
            war_min_days: r.diplomacy.war_min_days,
            truce_days: r.diplomacy.truce_days,
            war_tax: fx(r.diplomacy.war_tax),
            license_reputation: r.diplomacy.license_reputation,
        },
        // 以下三项在商品表加载后由 `convert_expansion_rules` 填写
        world: WorldRules::default(),
        colony: ColonyRules::default(),
        discovery: DiscoveryRules::default(),
        // 由 `weather::convert` 填写
        weather: manifest_core::weather::WeatherRules::default(),
        // 由 `convert_producers` 填写
        producers: manifest_core::defs::ProducerRules::default(),
        // 由 `economy` 填写（口粮商品要在商品表加载之后）
        population: PopulationRules::default(),
        workshops: WorkshopRules::default(),
        provisions: ProvisionRules::default(),
        merchants: MerchantRules::default(),
        // 由 `economy::info` 与 `economy::policies` 填写
        info: InfoRules::default(),
        policies: PolicyRules::default(),
        money: manifest_core::defs::MoneyRules::default(),
        // 由 `economy::open_market` 填写
        open_market: manifest_core::defs::OpenMarketRules::default(),
        pacing: pacing_rules(r.pacing, issues),
        access: access_rules(r.access, issues),
        voyage_posts: voyage_posts_rules(r.voyage_posts, issues),
        voyage_wear: voyage_wear_rules(r.voyage_wear, issues),
        shore_tasks: shore_rules(r.shore_tasks, issues),
        depth_curve: depth_curve(&m.depth_curve, issues),
        weather_cells: {
            for (field, problem) in r.weather_cells.problems() {
                issues.push("rules.toml", format!("weather_cells.{field}"), problem);
            }
            r.weather_cells.clone()
        },
        pursuit: {
            for (field, problem) in r.pursuit.problems() {
                issues.push("rules.toml", format!("pursuit.{field}"), problem);
            }
            r.pursuit.clone()
        },
        sightings: {
            for (field, problem) in r.sightings.problems() {
                issues.push("rules.toml", format!("sightings.{field}"), problem);
            }
            r.sightings.clone()
        },
        hail: {
            for (field, problem) in r.hail.problems() {
                issues.push("rules.toml", format!("hail.{field}"), problem);
            }
            r.hail.clone()
        },
        voyage_log: r.voyage_log.clone(),
        banter: {
            for (field, problem) in r.banter.problems() {
                issues.push("rules.toml", format!("banter.{field}"), problem);
            }
            r.banter.clone()
        },
        routing: routing_rules(r.routing, issues),
        // T02：船系里的船型在船型表加载后再解析（`ShipLine::ids`）
        dividends: {
            for (field, problem) in r.dividends.problems() {
                issues.push("rules.toml", format!("dividends.{field}"), problem);
            }
            r.dividends.clone()
        },
        shipyard_growth: {
            for (field, problem) in r.shipyard_growth.problems() {
                issues.push("rules.toml", format!("shipyard_growth.{field}"), problem);
            }
            r.shipyard_growth.clone()
        },
        npc_invest: {
            for (field, problem) in r.npc_invest.problems() {
                issues.push("rules.toml", format!("npc_invest.{field}"), problem);
            }
            r.npc_invest.clone()
        },
        agency: {
            for (field, problem) in r.agency.problems() {
                issues.push("rules.toml", format!("agency.{field}"), problem);
            }
            r.agency.clone()
        },
        skill_effects: r.skill_effects.clone(),
        development: {
            for (field, problem) in r.development.problems() {
                issues.push("rules.toml", format!("development.{field}"), problem);
            }
            r.development.clone()
        },
        quests: {
            if r.quests.reveal_days > 720 {
                issues.push("rules.toml", "quests.reveal_days", "必须在 0–720 之间");
            }
            r.quests
        },
        trade_books: {
            for (field, problem) in r.trade_books.problems() {
                issues.push("rules.toml", format!("trade_books.{field}"), problem);
            }
            r.trade_books
        },
        autopilot: autopilot_rules(r.autopilot, issues),
        stage_unlocks: {
            for (field, problem) in r.stage_unlocks.problems() {
                issues.push("rules.toml", format!("stage_unlocks.{field}"), problem);
            }
            r.stage_unlocks
        },
        rare: {
            for (field, problem) in r.rare.problems() {
                issues.push("rules.toml", format!("rare.{field}"), problem);
            }
            r.rare
        },
    }
}

/// T01：商馆、货档与商誉；没写 `[access]` 时取缺省（开关关闭）。
fn access_rules(raw: Option<crate::raw::AccessRaw>, issues: &mut Issues) -> manifest_core::defs::AccessRules {
    let Some(r) = raw else { return manifest_core::defs::AccessRules::default() };
    let rules = manifest_core::defs::AccessRules {
        enabled: r.enabled,
        rank_goodwill: r.rank_goodwill,
        house_goodwill: r.house_goodwill,
        house_tax: r.house_tax.into_iter().map(fx).collect(),
        house_storage: r.house_storage,
        house_base: r.house_base,
        house_step: r.house_step,
        ally_house: r.ally_house,
        floor_goods: r.floor_goods,
        trade_rep_base: r.trade_rep_base,
        trade_rep_per: r.trade_rep_per,
        trade_rep_cap: r.trade_rep_cap,
        invest_rep_per: r.invest_rep_per,
        invest_rep_max: r.invest_rep_max,
        company_goodwill: r.company_goodwill,
        grace_days: r.grace_days,
        inland_goodwill: r.inland_goodwill,
    };
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("access.{field}"), problem);
    }
    rules
}

/// T01：市场深度曲线；没写时为 None（一律用线性的发展度系数）。发展度要严格递增、系数单调不减，
/// 第一个点必须落在线性公式上（两段在那里相接，发展度不高于它的港口与没有这条规则时逐值相同）。
fn depth_curve(raw: &Option<Vec<[Dec; 2]>>, issues: &mut Issues) -> Option<Curve> {
    let points: Vec<(Fx, Fx)> = raw.as_ref()?.iter().map(|[x, y]| (fx(*x), fx(*y))).collect();
    let item = "market.depth_curve";
    if points.is_empty() {
        issues.push("rules.toml", item, "至少需要一个点");
        return None;
    }
    if points.windows(2).any(|w| w[0].0 >= w[1].0 || w[0].1 > w[1].1) {
        issues.push("rules.toml", item, "发展度必须严格递增、系数必须单调不减");
    }
    let (x0, y0) = points[0];
    if x0 < Fx::from_int(1) || x0 > Fx::from_int(100) || x0.raw() % Fx::SCALE != 0 {
        issues.push("rules.toml", item, "第一个点的发展度必须是 1 到 100 之间的整数");
    } else if y0 != manifest_core::market::development_factor(x0.trunc()) {
        issues.push("rules.toml", item, "第一个点必须落在 0.6 + 0.008 × 发展度 上（与线性公式相接）");
    }
    Some(Curve::new(points))
}

/// 本地生产者与供给响应（`rules.toml [producers]`，ECONOMY.md 6.3）；缺省两个开关都关，与旧版逐日一致。
fn convert_producers(raw: Option<crate::raw::ProducersRaw>, issues: &mut Issues) -> manifest_core::defs::ProducerRules {
    let f = "rules.toml";
    let Some(r) = raw else { return manifest_core::defs::ProducerRules::default() };
    for (name, v, lo, hi) in [
        ("expect_lambda", r.expect_lambda, 0.01, 1.0),
        ("kappa", r.kappa, 0.0, 1.0),
        ("gap_cap", r.gap_cap, 0.01, 1.0),
        ("min_ratio", r.min_ratio, 0.05, 1.0),
        ("max_ratio", r.max_ratio, 1.0, 10.0),
    ] {
        if !in_range(v.value(), lo, hi) {
            issues.push(f, format!("producers.{name}"), format!("必须在 {lo} 到 {hi} 之间"));
        }
    }
    manifest_core::defs::ProducerRules {
        enabled: r.enabled,
        fractional: r.fractional,
        expect_lambda: fx(r.expect_lambda),
        kappa: fx(r.kappa),
        gap_cap: fx(r.gap_cap),
        min_ratio: fx(r.min_ratio),
        max_ratio: fx(r.max_ratio),
    }
}

/// 扩展规则（世界配置、殖民地、探险发现）的转换与校验；需要商品表。
fn convert_expansion_rules(
    world: Option<WorldRulesRaw>,
    colony: Option<ColonyRulesRaw>,
    discovery: Option<DiscoveryRulesRaw>,
    good_ids: &BTreeMap<String, GoodId>,
    goods: &[GoodDef],
    rules: &mut Rules,
    is: &mut Issues,
) {
    let f = "rules.toml";
    if let Some(w) = world {
        if w.currency.trim().is_empty() || w.era.trim().is_empty() {
            is.push(f, "world", "currency 与 era 不能为空");
        }
        if !(1..=9999).contains(&w.start_year) {
            is.push(f, "world.start_year", "必须在 1 到 9999 之间");
        }
        let legacy = match w.legacy_map_size {
            None => (0, 0),
            Some([lw, lh]) => {
                if !(10..=4000).contains(&lw) || !(10..=4000).contains(&lh) {
                    is.push(f, "world.legacy_map_size", "宽高必须在 10 到 4000 之间");
                    (0, 0)
                } else {
                    (lw as u16, lh as u16)
                }
            }
        };
        rules.world = WorldRules {
            currency: w.currency.trim().to_string(),
            era: w.era.trim().to_string(),
            start_year: w.start_year,
            legacy_map: legacy,
        };
    }
    if let Some(c) = colony {
        let item = "colony";
        let goods_of = |list: &[GoodQty], what: &str, is: &mut Issues| -> Vec<(GoodId, i64)> {
            list.iter()
                .filter_map(|gq| {
                    if gq.qty <= 0 {
                        is.push(f, format!("{item}.{what}"), format!("“{}”的数量必须大于 0", gq.good));
                    }
                    lookup(good_ids, &gq.good, f, &format!("{item}.{what}"), "商品", is).map(|g| (g, gq.qty))
                })
                .collect()
        };
        let found_materials = goods_of(&c.found_materials, "found_materials", is);
        let mut morale_goods = Vec::new();
        for m in &c.morale_goods {
            if m.per_100 <= 0 {
                is.push(f, "colony.morale_goods", format!("“{}”的 per_100 必须大于 0", m.good));
            }
            if let Some(g) = lookup(good_ids, &m.good, f, "colony.morale_goods", "商品", is) {
                morale_goods.push((g, m.per_100));
            }
        }
        if !goods.iter().any(|g| g.category == c.food_category) {
            is.push(f, "colony.food_category", format!("没有类别为“{}”的商品", c.food_category));
        }
        for (name, v) in [
            ("min_settlers", c.min_settlers),
            ("base_capacity", c.base_capacity),
            ("base_housing", c.base_housing),
            ("food_per_100", c.food_per_100),
        ] {
            if v < 1 {
                is.push(f, format!("colony.{name}"), "必须至少为 1");
            }
        }
        for (name, v) in [
            ("found_cost", c.found_cost),
            ("found_fame", c.found_fame),
            ("growth_bp", c.growth_bp),
            ("immigration_per_morale", c.immigration_per_morale),
            ("starve_loss_bp", c.starve_loss_bp),
            ("tax_per_100", c.tax_per_100),
            ("morale_goods_bonus", c.morale_goods_bonus),
            ("starve_morale", c.starve_morale),
            ("raid_morale", c.raid_morale),
            ("disease_bp_per_hazard", c.disease_bp_per_hazard),
        ] {
            if v < 0 {
                is.push(f, format!("colony.{name}"), "不能为负");
            }
        }
        if !in_range(c.found_consume.value(), 0.0, 1.0) {
            is.push(f, "colony.found_consume", "必须在 0 到 1 之间");
        }
        if !in_range(c.raid_scale.value(), 0.0, 10.0) {
            is.push(f, "colony.raid_scale", "必须在 0 到 10 之间");
        }
        if c.growth_bp > 5_000 || c.starve_loss_bp > 5_000 || c.disease_bp_per_hazard > 100 {
            is.push(f, "colony", "growth_bp、starve_loss_bp 不能超过 5000，disease_bp_per_hazard 不能超过 100");
        }
        for (name, v) in [("morale_base", c.morale_base), ("start_morale", c.start_morale)] {
            if !(0..=100).contains(&v) {
                is.push(f, format!("colony.{name}"), "必须在 0 到 100 之间");
            }
        }
        if !(0..=100).contains(&c.max_defense_pct) || !(0..=10_000).contains(&c.claim_chance_bp) {
            is.push(f, "colony", "max_defense_pct 须在 0–100，claim_chance_bp 须在 0–10000");
        }
        if c.claim_start_day > 3_600
            || !(0..=400).contains(&c.claim_reach)
            || c.claim_slot_years > 50
            || !(0..=1_000).contains(&c.claim_decay_pct)
            || c.claim_cooldown_days > 3_600
        {
            is.push(
                f,
                "colony",
                "claim_start_day 与 claim_cooldown_days 须在 0–3600，claim_reach 须在 0–400，claim_slot_years 须在 0–50，claim_decay_pct 须在 0–1000",
            );
        }
        for (name, [lo, hi]) in [
            ("raid_loss_pct", c.raid_loss_pct),
            ("raid_death_pct", c.raid_death_pct),
            ("disease_death_pct", c.disease_death_pct),
        ] {
            if lo < 0 || hi > 100 || lo > hi {
                is.push(f, format!("colony.{name}"), "须在 0–100 之间且下限不大于上限");
            }
        }
        if c.tax_levels.is_empty() || c.tax_levels.len() > 10 {
            is.push(f, "colony.tax_levels", "须有 1 到 10 个档位");
        }
        for [pct, morale] in &c.tax_levels {
            if !(0..=500).contains(pct) || !(-100..=100).contains(morale) {
                is.push(f, "colony.tax_levels", "每档为 [收入百分比 0–500, 士气增减 −100–100]");
            }
        }
        if c.default_tax as usize >= c.tax_levels.len().max(1) {
            is.push(f, "colony.default_tax", "超出税率档位范围");
        }
        if c.max_colonies_per_owner == 0 {
            is.push(f, "colony.max_colonies_per_owner", "必须至少为 1");
        }
        let unloaded: i64 = found_materials.iter().map(|(_, q)| *q).sum();
        if unloaded > c.base_capacity {
            is.push(f, "colony.base_capacity", format!("基础容量 {} 装不下建立物资 {unloaded} 件", c.base_capacity));
        }
        rules.colony = ColonyRules {
            min_settlers: c.min_settlers,
            found_cost: c.found_cost,
            found_materials,
            found_consume: fx(c.found_consume),
            found_fame: c.found_fame,
            base_capacity: c.base_capacity,
            base_housing: c.base_housing,
            food_category: c.food_category.clone(),
            food_per_100: c.food_per_100,
            growth_bp: c.growth_bp,
            immigration_per_morale: c.immigration_per_morale,
            starve_loss_bp: c.starve_loss_bp,
            tax_per_100: c.tax_per_100,
            tax_levels: c.tax_levels.iter().map(|[a, b]| (*a, *b)).collect(),
            default_tax: c.default_tax,
            morale_goods,
            morale_goods_bonus: c.morale_goods_bonus,
            morale_base: c.morale_base,
            start_morale: c.start_morale,
            starve_morale: c.starve_morale,
            raid_morale: c.raid_morale,
            raid_scale: fx(c.raid_scale),
            raid_cooldown_days: c.raid_cooldown_days,
            raid_loss_pct: (c.raid_loss_pct[0], c.raid_loss_pct[1]),
            raid_death_pct: (c.raid_death_pct[0], c.raid_death_pct[1]),
            disease_bp_per_hazard: c.disease_bp_per_hazard,
            disease_death_pct: (c.disease_death_pct[0], c.disease_death_pct[1]),
            claim_chance_bp: c.claim_chance_bp,
            max_claims_per_faction: c.max_claims_per_faction,
            claim_start_day: c.claim_start_day,
            claim_reach: c.claim_reach,
            claim_slot_years: c.claim_slot_years,
            claim_decay_pct: c.claim_decay_pct,
            claim_cooldown_days: c.claim_cooldown_days,
            max_colonies_per_owner: c.max_colonies_per_owner,
            max_defense_pct: c.max_defense_pct,
        };
    }
    if let Some(d) = discovery {
        if d.mate_fame_from_level < 1 || d.mate_fame_per_level < 0 || d.fame_per_immigrant < 0 {
            is.push(
                f,
                "discovery",
                "mate_fame_from_level 至少为 1，mate_fame_per_level 与 fame_per_immigrant 不能为负",
            );
        }
        if !(0..=50).contains(&d.report_reputation) {
            is.push(f, "discovery.report_reputation", "必须在 0 到 50 之间");
        }
        if !(0..=10_000).contains(&d.rumor_min_fame) {
            is.push(f, "discovery.rumor_min_fame", "必须在 0 到 10000 之间");
        }
        rules.discovery = DiscoveryRules {
            mate_fame_from_level: d.mate_fame_from_level,
            mate_fame_per_level: d.mate_fame_per_level,
            report_reputation: d.report_reputation,
            fame_per_immigrant: d.fame_per_immigrant,
            rumor_min_fame: d.rumor_min_fame,
        };
    }
}

/// M5 规则的校验。
fn check_m5_rules(r: &RulesFile, issues: &mut Issues) {
    let f = "rules.toml";
    let m = &r.mates;
    if m.xp_per_level < 1 || m.max_level < 1 || m.max_level > 20 {
        issues.push(f, "mates", "要求 xp_per_level ≥ 1、1 ≤ max_level ≤ 20");
    }
    if !(0..=20).contains(&m.level_gain) || !in_range(m.salary_growth.value(), 0.0, 1.0) {
        issues.push(f, "mates", "level_gain 须在 0–20、salary_growth 须在 0–1 之间");
    }
    if !(0..=100).contains(&m.leave_below) || m.loyalty_paid < 0 || m.loyalty_unpaid < 0 {
        issues.push(f, "mates", "leave_below 须在 0–100，忠诚增减量不能为负");
    }
    let p = &r.pirates;
    if p.ships.is_empty() {
        issues.push(f, "pirates.ships", "至少需要一种海盗船型");
    }
    if !in_range(p.spawn_scale.value(), 0.0, 20.0) {
        issues.push(f, "pirates.spawn_scale", "必须在 0 到 20 之间");
    }
    if p.lifetime[0] == 0 || p.lifetime[0] > p.lifetime[1] || p.fleet_size[0] < 1 || p.fleet_size[0] > p.fleet_size[1] {
        issues.push(f, "pirates", "lifetime、fleet_size 须为正且下限不大于上限");
    }
    if p.fleet_size[1] > 5 || p.max_per_region > 10 || !(1..=20).contains(&p.sight) || !(1..=10).contains(&p.speed) {
        issues.push(f, "pirates", "fleet_size ≤ 5、max_per_region ≤ 10、sight 须在 1–20、speed 须在 1–10");
    }
    if !in_range(p.crew_ratio.value(), 0.1, 1.0) {
        issues.push(f, "pirates.crew_ratio", "必须在 0.1 到 1 之间");
    }
    let b = &r.battle;
    if !in_range(b.evade_max.value(), 0.0, 1.0) {
        issues.push(f, "battle.evade_max", "必须在 0 到 1 之间");
    }
    for (name, [lo, hi]) in [("cargo_loss_pct", b.cargo_loss_pct), ("tribute_pct", b.tribute_pct)] {
        if lo < 0 || hi > 100 || lo > hi {
            issues.push(f, format!("battle.{name}"), "须在 0–100 之间且下限不大于上限");
        }
    }
    if !(3..=10).contains(&b.tactical_radius) || !(1..=6).contains(&b.gun_range) || !(5..=100).contains(&b.max_turns) {
        issues.push(f, "battle", "tactical_radius 须在 3–10、gun_range 须在 1–6、max_turns 须在 5–100");
    }
    let e = &r.explore;
    if !(1..=30).contains(&e.sight) || e.chart_base < 0 || e.chart_per_100_cells < 0 {
        issues.push(f, "explore", "sight 须在 1–30，海图价格不能为负");
    }
}

/// M2 规则的额外校验。
fn check_m2_rules(r: &RulesFile, issues: &mut Issues) {
    let f = "rules.toml";
    for (name, v) in [
        ("warehouse.rent_per_100", r.warehouse.rent_per_100),
        ("warehouse.price_per_unit", r.warehouse.price_per_unit),
        ("warehouse.demurrage_per_100", r.warehouse.demurrage_per_100),
        ("warehouse.ally_free_capacity", r.warehouse.ally_free_capacity),
        ("caravan.guard_wage", r.caravan.guard_wage),
        ("caravan.guard_hire_cost", r.caravan.guard_hire_cost),
        ("invest.min_amount", r.invest.min_amount),
    ] {
        if v < 0 {
            issues.push(f, name, "不能为负");
        }
    }
    for (name, d, lo, hi) in [
        ("caravan.robbery_chance", r.caravan.robbery_chance, 0.0, 0.2),
        ("caravan.resale", r.caravan.resale, 0.0, 1.0),
        ("contracts.reward_factor", r.contracts.reward_factor, 0.0, 5.0),
        ("contracts.penalty_share", r.contracts.penalty_share, 0.0, 5.0),
        ("invest.ally_share", r.invest.ally_share, 0.01, 1.0),
        ("invest.ally_tax", r.invest.ally_tax, 0.0, 1.0),
        ("invest.ally_specialty_discount", r.invest.ally_specialty_discount, 0.0, 0.5),
        ("bank.deposit_rate", r.bank.deposit_rate, 0.0, 0.5),
        ("bank.loan_base_rate", r.bank.loan_base_rate, 0.0, 1.0),
        ("bank.loan_risk_premium", r.bank.loan_risk_premium, 0.0, 1.0),
        ("diplomacy.incident_chance", r.diplomacy.incident_chance, 0.0, 0.1),
        ("diplomacy.war_tax", r.diplomacy.war_tax, 1.0, 5.0),
        ("npc.invest_share", r.npc.invest_share, 0.0, 0.5),
        ("npc.futures_momentum", r.npc.futures_momentum, 0.0, 1.0),
    ] {
        if !in_range(d.value(), lo, hi) {
            issues.push(f, name, format!("必须在 {lo} 到 {hi} 之间"));
        }
    }
    let d = &r.diplomacy;
    if !(d.war_below < d.tension_below && d.tension_below < d.peace_above) {
        issues.push(f, "diplomacy", "要求 war_below < tension_below < peace_above");
    }
}

fn season_array(v: &Option<Vec<Dec>>, file: &str, item: &str, field: &str, issues: &mut Issues) -> [Fx; 4] {
    match v {
        None => [Fx::ONE; 4],
        Some(list) => {
            if list.len() != 4 {
                issues.push(file, item, format!("{field} 必须恰好有 4 个值（春夏秋冬）"));
                return [Fx::ONE; 4];
            }
            let mut out = [Fx::ONE; 4];
            for (i, d) in list.iter().enumerate() {
                if !in_range(d.value(), 0.1, 5.0) {
                    issues.push(file, item, format!("{field} 的值必须在 0.1 到 5 之间"));
                }
                out[i] = fx(*d);
            }
            out
        }
    }
}

/// 解析地图文本。
fn parse_map(text: &str, issues: &mut Issues) -> Option<(u16, u16, Vec<Terrain>)> {
    let f = "world/map.txt";
    let rows: Vec<&str> =
        text.lines().map(|l| l.trim_end_matches('\r')).filter(|l| !l.starts_with("//") && !l.is_empty()).collect();
    if rows.len() < 10 {
        issues.push(f, "", format!("地图至少需要 10 行，实际 {} 行", rows.len()));
        return None;
    }
    let width = rows[0].chars().count();
    if width < 10 {
        issues.push(f, "", "地图至少需要 10 列");
        return None;
    }
    let mut terrain = Vec::with_capacity(width * rows.len());
    let mut ok = true;
    for (y, row) in rows.iter().enumerate() {
        let n = row.chars().count();
        if n != width {
            issues.push(f, format!("第 {} 行", y + 1), format!("宽度 {n} 与第一行的 {width} 不一致"));
            ok = false;
            continue;
        }
        for (x, ch) in row.chars().enumerate() {
            terrain.push(match ch {
                '.' => Terrain::Deep,
                '~' => Terrain::Shallow,
                '#' => Terrain::Land,
                other => {
                    issues.push(f, format!("({x}, {y})"), format!("未知字符“{other}”，只能用 . ~ #"));
                    ok = false;
                    Terrain::Land
                }
            });
        }
    }
    if !ok {
        return None;
    }
    Some((width as u16, rows.len() as u16, terrain))
}

fn convert_weather(w: &WeatherRaw, file: &str, item: &str, issues: &mut Issues) -> SeasonWeather {
    let wind_dir = parse_dir(&w.wind).unwrap_or_else(|| {
        issues.push(file, item, format!("风向“{}”无效，应为 N NE E SE S SW W NW 之一", w.wind));
        0
    });
    let current_dir = parse_dir(&w.current).unwrap_or_else(|| {
        issues.push(file, item, format!("洋流方向“{}”无效", w.current));
        0
    });
    if !(0..=10).contains(&w.wind_strength) {
        issues.push(file, item, "wind_strength 必须在 0 到 10 之间");
    }
    if !(0..=3).contains(&w.current_strength) {
        issues.push(file, item, "current_strength 必须在 0 到 3 之间");
    }
    for (name, d) in [("storm", w.storm), ("pirate", w.pirate)] {
        if !in_range(d.value(), 0.0, 0.05) {
            issues.push(file, item, format!("{name} 概率必须在 0 到 0.05 之间"));
        }
    }
    SeasonWeather {
        wind_dir,
        wind_strength: w.wind_strength,
        current_dir,
        current_strength: w.current_strength,
        storm_bp: bp(w.storm),
        pirate_bp: bp(w.pirate),
    }
}

pub(crate) fn world_error(error: crate::worlds::WorldError) -> DataError {
    match error {
        crate::worlds::WorldError::Data(error) => error,
        error => DataError {
            issues: vec![DataIssue { file: "world.toml".into(), item: String::new(), message: error.to_string() }],
        },
    }
}

pub(crate) fn load(dir: &Path) -> Result<StaticData, DataError> {
    let files = crate::worlds::resolve_world_for_load(dir, "classic").map_err(world_error)?;
    load_effective(&files)
}

pub(crate) fn load_effective(dir: &EffectiveWorld) -> Result<StaticData, DataError> {
    let mut issues = Issues::default();
    let is = &mut issues;

    let mut prepared = c2::prepare(dir, is);
    let rules_raw: Option<RulesFile> = load_file(dir, "rules.toml", is);
    let goods_raw: Option<GoodsFile> = load_file(dir, "goods.toml", is);
    let ships_raw: Option<ShipsFile> = load_file(dir, "ships.toml", is);
    let factions_raw: Option<FactionsFile> = load_file(dir, "factions.toml", is);
    let regions_raw: Option<RegionsFile> = load_file(dir, "world/regions.toml", is);
    let ports_raw: Option<PortsFile> = c2::file(dir, &prepared, "world/ports.toml", is);
    let cities_raw: Option<CitiesFile> = c2::file(dir, &prepared, "world/cities.toml", is);
    let companies_raw: Option<CompaniesFile> = load_file(dir, "companies.toml", is);
    let caravans_raw: Option<CaravansFile> = load_file(dir, "caravans.toml", is);
    let roads_raw: Option<RoadsFile> = c2::file(dir, &prepared, "world/roads.toml", is);
    let recipes_raw: Option<RecipesFile> = load_file(dir, "recipes.toml", is);
    let futures_raw: Option<FuturesFile> = load_file(dir, "futures.toml", is);
    let events_raw: Option<EventsFile> = load_file(dir, "events.toml", is);
    let mates_raw: Option<MatesFile> = load_file(dir, "mates.toml", is);
    let overseas_raw: Option<OverseasFile> = c2::optional_file(dir, &prepared, "world/overseas.toml", is);
    let colony_raw: Option<ColonyFile> = load_optional(dir, "colony.toml", is);
    let discoveries_raw: Option<DiscoveriesFile> = c2::optional_file(dir, &prepared, "world/discoveries.toml", is);
    let workshops_raw: Option<economy::WorkshopsFile> = load_optional(dir, economy::WORKSHOPS, is);
    // 主角身世（可选）：文件不存在时开局不设身世
    let captain_raw: Option<captain::CaptainFile> =
        if dir.contains(captain::FILE) { load_file(dir, captain::FILE, is) } else { None };
    // 组合事件的效果词表与边界
    let composed = effects::load(dir, is);
    let map_text = read(dir, "world/map.txt", is);
    let scenario_files = scenario_files(dir, is);
    // 剧情事件（可选）：推荐角色的故事线与奇遇
    let story_files = story::load(dir, is);

    let (
        Some(rules_raw),
        Some(goods_raw),
        Some(ships_raw),
        Some(factions_raw),
        Some(regions_raw),
        Some(ports_raw),
        Some(cities_raw),
        Some(companies_raw),
        Some(map_text),
    ) = (rules_raw, goods_raw, ships_raw, factions_raw, regions_raw, ports_raw, cities_raw, companies_raw, map_text)
    else {
        return Err(DataError { issues: issues.list });
    };
    let (Some(caravans_raw), Some(roads_raw), Some(recipes_raw), Some(futures_raw), Some(events_raw), Some(mates_raw)) =
        (caravans_raw, roads_raw, recipes_raw, futures_raw, events_raw, mates_raw)
    else {
        return Err(DataError { issues: issues.list });
    };
    let (Some(overseas_raw), Some(colony_raw), Some(discoveries_raw)) = (overseas_raw, colony_raw, discoveries_raw)
    else {
        return Err(DataError { issues: issues.list });
    };

    let mut rules_raw = rules_raw;
    check_m2_rules(&rules_raw, is);
    check_m5_rules(&rules_raw, is);
    let pirate_ship_keys = rules_raw.pirates.ships.clone();
    let (world_rules_raw, colony_rules_raw, discovery_rules_raw) =
        (rules_raw.world.take(), rules_raw.colony.take(), rules_raw.discovery.take());
    let weather_rules_raw = rules_raw.weather.take();
    let producers_raw = rules_raw.producers.take();
    let (population_raw, workshop_rules_raw, provisions_raw) =
        (rules_raw.population.take(), rules_raw.workshops.take(), rules_raw.provisions.take());
    let merchants_raw = rules_raw.merchants.take();
    let info_raw = rules_raw.info.take();
    let policies_raw = rules_raw.policies.take();
    let money_raw = rules_raw.money.take();
    let commerce_raw = rules_raw.npc.v2.take();
    let open_market_raw = rules_raw.market.open.take();
    let mut rules = convert_rules(rules_raw, is);
    rules.producers = convert_producers(producers_raw, is);
    rules.population = economy::population(population_raw, is);
    rules.workshops = economy::workshop_rules(workshop_rules_raw, is);
    rules.merchants = economy::merchants(merchants_raw, is);
    rules.info = economy::info(info_raw, is);
    rules.money = economy::money(money_raw, is);
    rules.npc.v2 = economy::commerce(commerce_raw, rules.npc.max_fleets, is);
    let (weather_rules, latitude_bands) = weather::convert(weather_rules_raw, is);
    rules.weather = weather_rules;

    // ── 商品 ──
    let f = "goods.toml";
    check_keys(f, "goods", goods_raw.goods.iter().map(|g| (g.key.as_str(), g.name.as_str())), is);
    let mut good_ids: BTreeMap<String, GoodId> = BTreeMap::new();
    let mut goods = Vec::new();
    for (i, g) in goods_raw.goods.iter().enumerate() {
        let item = format!("goods[{}]", g.key);
        if g.base_price <= 0 {
            is.push(f, &item, "base_price 必须大于 0");
        }
        if g.tier > 3 {
            is.push(f, &item, "tier 必须在 0 到 3 之间");
        }
        if g.rank > 3 {
            is.push(f, &item, "rank（货档）必须在 0 到 3 之间");
        }
        good_ids.insert(g.key.clone(), GoodId::from_idx(i));
        goods.push(GoodDef {
            key: g.key.clone(),
            name: g.name.clone(),
            category: g.category.clone(),
            tier: g.tier,
            base_price: g.base_price,
            season_demand: season_array(&g.season_demand, f, &item, "season_demand", is),
            season_supply: season_array(&g.season_supply, f, &item, "season_supply", is),
            license: g.license,
            description: g.description.clone(),
            crop: g.crop,
            need: economy::need(&g.need, &item, is),
            group: None,
            rank: g.rank,
            secret: g.secret,
            rumor: g.rumor.clone().unwrap_or_default(),
        });
    }
    if goods.is_empty() {
        is.push(f, "", "至少需要一种商品");
    }
    let group_raw: Vec<(String, Option<String>)> =
        goods_raw.goods.iter().map(|g| (g.key.clone(), g.group.clone())).collect();
    economy::groups(&group_raw, &mut goods, is);
    rules.provisions = economy::provisions(provisions_raw, &good_ids, is);
    rules.open_market = economy::open_market(open_market_raw, is);
    rules.policies = economy::policies(policies_raw, &good_ids, is);
    convert_expansion_rules(world_rules_raw, colony_rules_raw, discovery_rules_raw, &good_ids, &goods, &mut rules, is);

    // ── 船型与改造 ──
    let f = "ships.toml";
    check_keys(f, "ships", ships_raw.ships.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    check_keys(f, "refits", ships_raw.refits.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    let mut ship_ids: BTreeMap<String, ShipTypeId> = BTreeMap::new();
    let mut ships = Vec::new();
    for (i, s) in ships_raw.ships.iter().enumerate() {
        let item = format!("ships[{}]", s.key);
        let sail = match s.sail.as_str() {
            "square" => SailType::Square,
            "lateen" => SailType::Lateen,
            other => {
                is.push(f, &item, format!("sail “{other}”无效，应为 square 或 lateen"));
                SailType::Square
            }
        };
        if !in_range(s.speed.value(), 0.5, 20.0) {
            is.push(f, &item, "speed 必须在 0.5 到 20 之间");
        }
        if s.capacity <= 0 || s.durability <= 0 || s.price <= 0 {
            is.push(f, &item, "capacity、durability、price 必须大于 0");
        }
        if s.crew_min < 1 || s.crew_max < s.crew_min {
            is.push(f, &item, "要求 1 ≤ crew_min ≤ crew_max");
        }
        if s.guns < 0 {
            is.push(f, &item, "guns 不能为负");
        }
        ship_ids.insert(s.key.clone(), ShipTypeId::from_idx(i));
        ships.push(ShipTypeDef {
            key: s.key.clone(),
            name: s.name.clone(),
            sail,
            speed: fx(s.speed),
            capacity: s.capacity,
            durability: s.durability,
            crew_min: s.crew_min,
            crew_max: s.crew_max,
            guns: s.guns,
            price: s.price,
            description: s.description.clone(),
            unique: s.unique,
        });
    }
    let refits: Vec<RefitDef> = ships_raw
        .refits
        .iter()
        .map(|r| {
            if r.price <= 0 {
                is.push(f, format!("refits[{}]", r.key), "price 必须大于 0");
            }
            RefitDef {
                key: r.key.clone(),
                name: r.name.clone(),
                price: r.price,
                capacity: r.capacity,
                durability: r.durability,
                guns: r.guns,
                speed: r.speed.map(fx).unwrap_or(Fx::ZERO),
            }
        })
        .collect();

    for k in &pirate_ship_keys {
        if let Some(id) = lookup(&ship_ids, k, "rules.toml", "pirates.ships", "船型", is) {
            if ships[id.idx()].unique {
                is.push("rules.toml", "pirates.ships", format!("海盗不能使用独有船型“{k}”"));
            }
            rules.pirates.ships.push(id);
        }
    }
    // T02：船厂随发展度放大船的各个船系
    for line in &mut rules.shipyard_growth.lines {
        line.ids.clear();
        for k in &line.ships {
            let item = format!("shipyard_growth.lines[{}]", line.key);
            if let Some(id) = lookup(&ship_ids, k, "rules.toml", &item, "船型", is) {
                if ships[id.idx()].unique {
                    is.push("rules.toml", item, format!("独有船型“{k}”不能进船系"));
                }
                line.ids.push(id);
            }
        }
    }

    // ── 势力 ──
    let f = "factions.toml";
    check_keys(f, "factions", factions_raw.factions.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    let mut faction_ids: BTreeMap<String, FactionId> = BTreeMap::new();
    let mut factions = Vec::new();
    for (i, fr) in factions_raw.factions.iter().enumerate() {
        if !in_range(fr.tax.value(), 0.0, 0.5) {
            is.push(f, format!("factions[{}]", fr.key), "tax 必须在 0 到 0.5 之间");
        }
        if fr.license_price < 0 || fr.marque_price < 0 {
            is.push(f, format!("factions[{}]", fr.key), "许可证价格不能为负");
        }
        if let Some(style) = &fr.style
            && !FACTION_STYLES.contains(&style.as_str())
            && !dir.manifest.art.styles.contains(style)
        {
            is.push(
                f,
                format!("factions[{}]", fr.key),
                format!("style “{style}”无效，应为 {} 之一", FACTION_STYLES.join(" / ")),
            );
        }
        if let Some(color) = &fr.color {
            let ok = color.len() == 7 && color.starts_with('#') && color.chars().skip(1).all(|c| c.is_ascii_hexdigit());
            if !ok {
                is.push(f, format!("factions[{}]", fr.key), format!("color “{color}”无效，应为 #rrggbb"));
            }
        }
        faction_ids.insert(fr.key.clone(), FactionId::from_idx(i));
        factions.push(FactionDef {
            key: fr.key.clone(),
            name: fr.name.clone(),
            tax: fx(fr.tax),
            license_price: fr.license_price,
            marque_price: fr.marque_price,
            style: fr.style.clone(),
            color: fr.color.as_ref().map(|c| c.to_ascii_lowercase()),
        });
    }
    let mut relations: Vec<RelationDef> = Vec::new();
    for r in &factions_raw.relations {
        let item = format!("relations[{}-{}]", r.a, r.b);
        let (Some(a), Some(b)) =
            (lookup(&faction_ids, &r.a, f, &item, "势力", is), lookup(&faction_ids, &r.b, f, &item, "势力", is))
        else {
            continue;
        };
        if a == b {
            is.push(f, &item, "关系的两端不能是同一势力");
        }
        if !(-100..=100).contains(&r.value) {
            is.push(f, &item, "value 必须在 −100 到 100 之间");
        }
        if relations.iter().any(|x| (x.a == a && x.b == b) || (x.a == b && x.b == a)) {
            is.push(f, &item, "同一对势力的关系重复");
        }
        relations.push(RelationDef { a, b, value: r.value });
    }

    // ── 地图与海区 ──
    let Some((width, height, terrain)) = parse_map(&map_text, is) else {
        return Err(DataError { issues: issues.list });
    };
    let wrap_x = dir.map.as_ref().is_some_and(|m| m.wrap_x);
    let topology = MapTopology::new(width, height, wrap_x);
    let f = "world/regions.toml";
    check_keys(f, "regions", regions_raw.regions.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    let mut regions = Vec::new();
    for r in &regions_raw.regions {
        let item = format!("regions[{}]", r.key);
        let [x0, y0, x1, y1] = r.rect;
        if x0 < 0
            || y0 < 0
            || x1 < 0
            || x0 >= width as i64
            || x1 >= width as i64
            || y1 >= height as i64
            || (x0 > x1 && !wrap_x)
            || y0 > y1
        {
            is.push(f, &item, format!("rect {:?} 超出地图范围（{width} × {height}）或顺序颠倒", r.rect));
        }
        let seasons = [
            convert_weather(&r.spring, f, &format!("{item}.spring"), is),
            convert_weather(&r.summer, f, &format!("{item}.summer"), is),
            convert_weather(&r.autumn, f, &format!("{item}.autumn"), is),
            convert_weather(&r.winter, f, &format!("{item}.winter"), is),
        ];
        let clamp = |v: i64, max: u16| v.clamp(0, max as i64 - 1) as u16;
        let rect = (clamp(x0, width), clamp(y0, height), clamp(x1, width), clamp(y1, height));
        let center_y = (rect.1 as i64 + rect.3 as i64) / 2;
        let climate = weather::region_climate(r.climate.as_deref(), center_y, latitude_bands, f, &item, is);
        regions.push(RegionDef { key: r.key.clone(), name: r.name.clone(), rect, seasons, climate });
    }
    // 逐格海区：seas.txt 标注的格按标记，其余海格按矩形（取第一个包含它的海区）
    let marks = geo::region_marks(&regions_raw.regions, is);
    let seas = geo::load_seas(dir, width, height, &terrain, &marks, is);
    let mut region_of = vec![u16::MAX; terrain.len()];
    let mut uncovered = Vec::new();
    for y in 0..height {
        for x in 0..width {
            let i = y as usize * width as usize + x as usize;
            if terrain[i] == Terrain::Land {
                continue;
            }
            if let Some(ri) = seas.as_ref().and_then(|s| s[i]) {
                region_of[i] = ri;
                continue;
            }
            match regions.iter().position(|r| topology.rect_contains(r.rect, Cell::new(x, y))) {
                Some(ri) => region_of[i] = ri as u16,
                None => uncovered.push((x, y)),
            }
        }
    }
    // 有 seas.txt 时，海区的范围（海盗出没、海图揭开、名称位置）改为它实际所含海格的外接矩形；
    // 没写 climate 的海区按收紧后的范围重新推断气候（纬度取实际海面的中心，而不是回退矩形的中心）
    if seas.is_some() {
        fit_region_rects(&mut regions, &region_of, width, wrap_x);
        for (reg, raw) in regions.iter_mut().zip(&regions_raw.regions) {
            if raw.climate.is_none() {
                let center_y = (reg.rect.1 as i64 + reg.rect.3 as i64) / 2;
                reg.climate = weather::region_climate(None, center_y, latitude_bands, f, "", is);
            }
        }
    }
    if !uncovered.is_empty() {
        is.push(
            f,
            "",
            format!("有 {} 个海格不属于任何海区，例如 {:?}", uncovered.len(), &uncovered[..uncovered.len().min(3)]),
        );
    }
    let map = SeaMap { width, height, wrap_x, terrain, region: region_of };
    // 高程与植被图层（可选；只存储并下发，不参与航行）
    if let Some(expected) = &dir.map
        && (map.width != expected.width || map.height != expected.height)
    {
        is.push("map.toml", "", "地图尺寸与 map.txt 不一致");
    }
    // 细海岸（可选；玩家手动航行的碰撞与领航用，见 convert/fine_coast.rs）
    let fine_coast = fine_coast::load(dir, &map, is);
    let relief = geo::load_relief(dir, &map, is);
    let biomes = geo::load_biomes(dir, &map, is);
    let rivers = geo::load_rivers(dir, &map, is);
    // H05：细河流流经的粗格（汲水看两格内有没有河；没有细图层时为空）
    let fine_rivers = fine_coast::load_rivers(dir, &map, is);

    // ── 港口、城市、海外港口与殖民点（按此顺序编号，保证旧存档中的地点下标不变）──
    let mut loc_ids: BTreeMap<String, LocId> = BTreeMap::new();
    let mut locations = Vec::new();
    let all_locs: Vec<(&str, &LocationRaw, LocKind)> = ports_raw
        .ports
        .iter()
        .map(|p| ("world/ports.toml", p, LocKind::Port))
        .chain(cities_raw.cities.iter().map(|c| ("world/cities.toml", c, LocKind::City)))
        .chain(overseas_raw.ports.iter().map(|p| ("world/overseas.toml", p, LocKind::Port)))
        .collect();
    check_keys(
        "world/ports.toml",
        "locations",
        all_locs
            .iter()
            .map(|(_, l, _)| (l.key.as_str(), l.name.as_str()))
            .chain(overseas_raw.sites.iter().map(|s| (s.key.as_str(), s.name.as_str()))),
        is,
    );
    for (i, (file, l, kind)) in all_locs.iter().enumerate() {
        let table = if *kind == LocKind::Port { "ports" } else { "cities" };
        let item = format!("{table}[{}]", l.key);
        let [x, y] = l.pos;
        let cell = if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
            is.push(file, &item, format!("pos {:?} 超出地图范围", l.pos));
            Cell::new(0, 0)
        } else {
            Cell::new(x as u16, y as u16)
        };
        match kind {
            LocKind::Port => {
                if !map.is_sea(cell) {
                    is.push(file, &item, format!("港口位置 {:?} 必须是海格", l.pos));
                } else if !map.touches_land(cell) {
                    is.push(file, &item, format!("港口位置 {:?} 必须与陆地相邻", l.pos));
                }
            }
            LocKind::City => {
                if map.is_sea(cell) {
                    is.push(file, &item, format!("城市位置 {:?} 必须是陆格", l.pos));
                }
                if !l.shipyard.is_empty() {
                    is.push(file, &item, "内陆城市不能有船厂");
                }
            }
            LocKind::Site => {}
        }
        let faction = lookup(&faction_ids, &l.faction, file, &item, "势力", is).unwrap_or(FactionId(0));
        let dev_max = if rules.development.enabled { rules.development.max } else { 100 };
        if !(1..=dev_max).contains(&l.development) {
            is.push(file, &item, format!("development 必须在 1 到 {dev_max} 之间"));
        }
        let shipyard: Vec<ShipTypeId> =
            l.shipyard.iter().filter_map(|s| lookup(&ship_ids, s, file, &item, "船型", is)).collect();
        for s in &shipyard {
            if ships[s.idx()].unique {
                is.push(file, &item, format!("船厂不能出售独有船型“{}”", ships[s.idx()].key));
            }
        }
        let mut market = Vec::new();
        let mut seen = Vec::new();
        for m in &l.market {
            let Some(good) = lookup(&good_ids, &m.good, file, &item, "商品", is) else { continue };
            if seen.contains(&good) {
                is.push(file, &item, format!("市场中商品“{}”重复", m.good));
                continue;
            }
            seen.push(good);
            if (!prepared.enabled && (m.supply < 1 || m.demand < 1))
                || m.supply < 0
                || m.demand < 0
                || (m.supply == 0 && m.demand == 0)
            {
                is.push(file, &item, format!("商品“{}”的 supply 与 demand 必须至少为 1", m.good));
                continue;
            }
            if !prepared.enabled && (m.supply * 10 < m.demand * 3 || m.supply > m.demand * 3) {
                is.push(
                    file,
                    &item,
                    format!("商品“{}”的 supply / demand = {}/{} 超出 0.3–3.0 范围", m.good, m.supply, m.demand),
                );
            }
            market.push(MarketDef { good, supply: m.supply, demand: m.demand, specialty: m.supply > m.demand });
        }
        // 开放市场：特产以外也出售的商品，必须在市场清单里
        let mut sells: Vec<GoodId> = Vec::new();
        for k in &l.sells {
            let Some(good) = lookup(&good_ids, k, file, &item, "商品", is) else { continue };
            if !market.iter().any(|m| m.good == good) {
                is.push(file, &item, format!("sells 里的商品“{k}”必须在 market 清单里"));
            } else if !sells.contains(&good) {
                sells.push(good);
            }
        }
        loc_ids.insert(l.key.clone(), LocId::from_idx(i));
        if l.size.is_some_and(|s| !(1..=5).contains(&s)) {
            is.push(f, &l.key, "size 必须在 1–5 之间");
        }
        locations.push(LocationDef {
            shop: l.shop || l.facilities.iter().any(|f| f == "shop"),
            culture: l.culture.clone(),
            size: l.size.unwrap_or_else(|| {
                // E02 的寰宇城市原来全为 50（规模 3）；新尺度不改变物品店规模。
                if rules.development.enabled && *kind == LocKind::City {
                    3
                } else {
                    ((l.development - 1) / 20 + 1).clamp(1, 5) as u8
                }
            }),
            key: l.key.clone(),
            name: l.name.clone(),
            hemisphere: l.hemisphere,
            kind: *kind,
            cell,
            faction,
            development: l.development,
            shipyard,
            market,
            founded: l.founded,
            lore: l.lore.clone(),
            site: None,
            workshops: Vec::new(),
            sells,
            unlocks: Vec::new(),
        });
    }
    if !locations.iter().any(|l| l.is_port()) {
        is.push("world/ports.toml", "", "至少需要一个港口");
    }
    // 殖民点：与陆地相邻的海格锚地
    let f = "world/overseas.toml";
    for s in &overseas_raw.sites {
        let item = format!("sites[{}]", s.key);
        let [x, y] = s.pos;
        let cell = if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
            is.push(f, &item, format!("pos {:?} 超出地图范围", s.pos));
            Cell::new(0, 0)
        } else {
            Cell::new(x as u16, y as u16)
        };
        if !map.is_sea(cell) {
            is.push(f, &item, format!("殖民点位置 {:?} 必须是海格", s.pos));
        } else if !map.touches_land(cell) {
            is.push(f, &item, format!("殖民点位置 {:?} 必须与陆地相邻", s.pos));
        }
        if let Some(other) = locations.iter().find(|l| l.cell == cell) {
            is.push(f, &item, format!("殖民点位置 {:?} 与地点“{}”重合", s.pos, other.key));
        }
        let terrain = SiteTerrain::parse(&s.terrain).unwrap_or_else(|| {
            let all: Vec<&str> = SiteTerrain::ALL.iter().map(|t| t.key()).collect();
            is.push(f, &item, format!("terrain “{}”无效，应为 {} 之一", s.terrain, all.join(" / ")));
            SiteTerrain::Forest
        });
        for (name, v) in [("fertility", s.fertility), ("hazard", s.hazard)] {
            if !(1..=100).contains(&v) {
                is.push(f, &item, format!("{name} 必须在 1 到 100 之间"));
            }
        }
        let mut resources: Vec<(GoodId, i64)> = Vec::new();
        for r in &s.resources {
            let Some(g) = lookup(&good_ids, &r.good, f, &item, "商品", is) else { continue };
            if resources.iter().any(|(x, _)| *x == g) {
                is.push(f, &item, format!("资源“{}”重复", r.good));
                continue;
            }
            if !(1..=100).contains(&r.richness) {
                is.push(f, &item, format!("资源“{}”的 richness 必须在 1 到 100 之间", r.good));
            }
            resources.push((g, r.richness));
        }
        loc_ids.insert(s.key.clone(), LocId::from_idx(locations.len()));
        locations.push(LocationDef {
            shop: false,
            culture: String::new(),
            size: 1,
            key: s.key.clone(),
            name: s.name.clone(),
            hemisphere: s.hemisphere,
            kind: LocKind::Site,
            cell,
            faction: FactionId(0),
            development: 1,
            shipyard: Vec::new(),
            market: Vec::new(),
            founded: None,
            lore: s.lore.clone(),
            site: Some(SiteDef { terrain, fertility: s.fertility, hazard: s.hazard, resources }),
            workshops: Vec::new(),
            sells: Vec::new(),
            unlocks: Vec::new(),
        });
    }
    let port_ids: BTreeMap<String, LocId> =
        loc_ids.iter().filter(|(_, id)| locations[id.idx()].is_port()).map(|(k, v)| (k.clone(), *v)).collect();

    // ── 驮畜 ──
    let f = "caravans.toml";
    check_keys(f, "animals", caravans_raw.animals.iter().map(|a| (a.key.as_str(), a.name.as_str())), is);
    let animals: Vec<AnimalDef> = caravans_raw
        .animals
        .iter()
        .map(|a| {
            let item = format!("animals[{}]", a.key);
            if a.capacity <= 0 || a.price <= 0 || a.upkeep < 0 {
                is.push(f, &item, "capacity、price 必须大于 0，upkeep 不能为负");
            }
            if !in_range(a.speed.value(), 0.5, 50.0) || !in_range(a.desert.value(), 0.1, 3.0) {
                is.push(f, &item, "speed 必须在 0.5–50 之间，desert 必须在 0.1–3 之间");
            }
            AnimalDef {
                key: a.key.clone(),
                name: a.name.clone(),
                capacity: a.capacity,
                speed: fx(a.speed),
                price: a.price,
                upkeep: a.upkeep,
                desert: fx(a.desert),
            }
        })
        .collect();

    // ── 道路 ──
    let f = "world/roads.toml";
    let mut roads: Vec<RoadDef> = Vec::new();
    for r in &roads_raw.roads {
        let key = format!("{}_{}", r.from, r.to);
        let item = format!("roads[{key}]");
        let (Some(from), Some(to)) =
            (lookup(&loc_ids, &r.from, f, &item, "地点", is), lookup(&loc_ids, &r.to, f, &item, "地点", is))
        else {
            continue;
        };
        if from == to {
            is.push(f, &item, "道路两端不能是同一地点");
        }
        if locations[from.idx()].is_site() || locations[to.idx()].is_site() {
            is.push(f, &item, "道路不能连接殖民点");
        }
        if roads.iter().any(|x| (x.from == from && x.to == to) || (x.from == to && x.to == from)) {
            is.push(f, &item, "道路重复");
        }
        let terrain = match r.terrain.as_str() {
            "plain" => RoadTerrain::Plain,
            "hill" => RoadTerrain::Hill,
            "forest" => RoadTerrain::Forest,
            "mountain" => RoadTerrain::Mountain,
            "desert" => RoadTerrain::Desert,
            other => {
                is.push(f, &item, format!("terrain “{other}”无效，应为 plain / hill / forest / mountain / desert"));
                RoadTerrain::Plain
            }
        };
        if !in_range(r.security.value(), 0.0, 1.0) || !in_range(r.toll.value(), 0.0, 0.3) {
            is.push(f, &item, "security 必须在 0–1 之间，toll 必须在 0–0.3 之间");
        }
        let faction = lookup(&faction_ids, &r.faction, f, &item, "势力", is).unwrap_or(FactionId(0));
        let length = match r.length {
            Some(d) => fx(d),
            None => {
                let (a, b) = (locations[from.idx()].cell, locations[to.idx()].cell);
                let dx = map.topology().dx(a.x, b.x) as f64;
                let dy = a.y as f64 - b.y as f64;
                fx(Dec::Float((dx * dx + dy * dy).sqrt() * 1.2))
            }
        };
        if length <= Fx::ZERO {
            is.push(f, &item, "length 必须大于 0");
        }
        roads.push(RoadDef { key, from, to, length, terrain, security: fx(r.security), faction, toll: fx(r.toll) });
    }
    if prepared.enabled {
        for (road, key) in roads.iter_mut().zip(&prepared.road_keys) {
            road.key.clone_from(key);
        }
    }
    for (i, l) in locations.iter().enumerate() {
        if l.kind == LocKind::City && !roads.iter().any(|r| r.from.idx() == i || r.to.idx() == i) {
            is.push(f, "", format!("内陆城市“{}”没有道路连接", l.key));
        }
    }

    // ── 产业与配方 ──
    let f = "recipes.toml";
    check_keys(f, "industries", recipes_raw.industries.iter().map(|a| (a.key.as_str(), a.name.as_str())), is);
    check_keys(f, "recipes", recipes_raw.recipes.iter().map(|a| (a.key.as_str(), a.name.as_str())), is);
    let mut industry_ids: BTreeMap<String, IndustryTypeId> = BTreeMap::new();
    let industry_types: Vec<IndustryTypeDef> = recipes_raw
        .industries
        .iter()
        .enumerate()
        .map(|(i, t)| {
            if t.build_cost <= 0 || t.workers < 0 || t.wage < 0 || t.maintenance < 0 || t.manager_salary < 0 {
                is.push(f, format!("industries[{}]", t.key), "费用与人数不能为负，build_cost 必须大于 0");
            }
            industry_ids.insert(t.key.clone(), IndustryTypeId::from_idx(i));
            IndustryTypeDef {
                key: t.key.clone(),
                name: t.name.clone(),
                build_cost: t.build_cost,
                workers: t.workers,
                wage: t.wage,
                maintenance: t.maintenance,
                manager_salary: t.manager_salary,
            }
        })
        .collect();
    let mut recipes: Vec<RecipeDef> = Vec::new();
    for r in &recipes_raw.recipes {
        let item = format!("recipes[{}]", r.key);
        let industry = lookup(&industry_ids, &r.industry, f, &item, "产业类型", is).unwrap_or(IndustryTypeId(0));
        let conv = |list: &Vec<GoodQty>, what: &str, is: &mut Issues| -> Vec<(GoodId, i64)> {
            list.iter()
                .filter_map(|gq| {
                    if gq.qty <= 0 {
                        is.push(f, &item, format!("{what}中“{}”的数量必须大于 0", gq.good));
                    }
                    lookup(&good_ids, &gq.good, f, &item, "商品", is).map(|g| (g, gq.qty))
                })
                .collect()
        };
        let inputs = conv(&r.inputs, "投入", is);
        let outputs = conv(&r.outputs, "产出", is);
        if outputs.is_empty() {
            is.push(f, &item, "至少需要一种产出");
        }
        recipes.push(RecipeDef { key: r.key.clone(), name: r.name.clone(), industry, inputs, outputs });
    }
    // 投入产出（Hawkins–Simon 条件）与城镇工坊（ECONOMY.md 6.5）
    economy::check_leontief(&recipes, goods.len(), is);
    {
        let recipe_ids: BTreeMap<String, RecipeId> =
            recipes.iter().enumerate().map(|(i, r)| (r.key.clone(), RecipeId::from_idx(i))).collect();
        let loc_ids: BTreeMap<String, LocId> =
            locations.iter().enumerate().map(|(i, l)| (l.key.clone(), LocId::from_idx(i))).collect();
        economy::workshops(workshops_raw.unwrap_or_default(), &loc_ids, &recipe_ids, &recipes, &mut locations, is);
    }

    // ── 期货 ──
    let f = "futures.toml";
    check_keys(f, "exchanges", futures_raw.exchanges.iter().map(|a| (a.key.as_str(), a.name.as_str())), is);
    let mut exchange_ids: BTreeMap<String, ExchangeId> = BTreeMap::new();
    let mut exchanges: Vec<ExchangeDef> = Vec::new();
    for (i, e) in futures_raw.exchanges.iter().enumerate() {
        let item = format!("exchanges[{}]", e.key);
        let port = lookup(&port_ids, &e.port, f, &item, "港口", is).unwrap_or(LocId(0));
        if !(e.maintenance_margin.value() > 0.0 && e.maintenance_margin.value() < e.initial_margin.value())
            || e.initial_margin.value() > 1.0
        {
            is.push(f, &item, "要求 0 < maintenance_margin < initial_margin ≤ 1");
        }
        if !in_range(e.spread.value(), 0.0, 0.2)
            || !in_range(e.carry_per_month.value(), 0.0, 0.2)
            || !in_range(e.impact_per_lot.value(), 0.0, 0.05)
        {
            is.push(f, &item, "spread、carry_per_month 必须在 0–0.2 之间，impact_per_lot 必须在 0–0.05 之间");
        }
        if e.position_limit < 1 || e.house_capital < 0 || e.penalty.value() < 1.0 {
            is.push(f, &item, "position_limit 至少为 1，house_capital 不能为负，penalty 不能小于 1");
        }
        exchange_ids.insert(e.key.clone(), ExchangeId::from_idx(i));
        exchanges.push(ExchangeDef {
            key: e.key.clone(),
            name: e.name.clone(),
            port,
            initial_margin: fx(e.initial_margin),
            maintenance_margin: fx(e.maintenance_margin),
            spread: fx(e.spread),
            carry_per_month: fx(e.carry_per_month),
            impact_per_lot: fx(e.impact_per_lot),
            position_limit: e.position_limit,
            penalty: fx(e.penalty),
            house_capital: e.house_capital,
        });
    }
    let mut futures_specs: Vec<FuturesSpecDef> = Vec::new();
    for s in &futures_raw.contracts {
        let key = format!("{}_{}", s.exchange, s.good);
        let item = format!("contracts[{key}]");
        let (Some(exchange), Some(good)) = (
            lookup(&exchange_ids, &s.exchange, f, &item, "交易所", is),
            lookup(&good_ids, &s.good, f, &item, "商品", is),
        ) else {
            continue;
        };
        let delivery = match &s.delivery {
            Some(p) => lookup(&port_ids, p, f, &item, "港口", is).unwrap_or(LocId(0)),
            None => exchanges[exchange.idx()].port,
        };
        if !locations[delivery.idx()].market.iter().any(|m| m.good == good) {
            is.push(f, &item, format!("交割港“{}”的市场不交易“{}”", locations[delivery.idx()].key, s.good));
        }
        if s.lot < 1 || s.tick < 1 {
            is.push(f, &item, "lot 与 tick 必须至少为 1");
        }
        if futures_specs.iter().any(|x| x.key == key) {
            is.push(f, &item, "合约规格重复");
        }
        futures_specs.push(FuturesSpecDef { key, exchange, good, lot: s.lot, delivery, tick: s.tick });
    }

    // ── 事件类型 ──
    let f = "events.toml";
    check_keys(f, "events", events_raw.events.iter().map(|e| (e.key.as_str(), e.name.as_str())), is);
    let mut events: Vec<EventTypeDef> = Vec::new();
    for e in &events_raw.events {
        let item = format!("events[{}]", e.key);
        let effect = match e.effect.as_str() {
            "good_supply" => EffectKind::GoodSupply,
            "good_demand" => EffectKind::GoodDemand,
            "supply_shift" => EffectKind::SupplyShift,
            "demand_shift" => EffectKind::DemandShift,
            "location_supply" => EffectKind::LocationSupply,
            "location_demand" => EffectKind::LocationDemand,
            "popularity" => EffectKind::Popularity,
            "region_storm" => EffectKind::RegionStorm,
            "region_pirates" => EffectKind::RegionPirates,
            "relation_shift" => EffectKind::RelationShift,
            "faction_tax" => EffectKind::FactionTax,
            "development" => EffectKind::Development,
            "interest_shift" => EffectKind::InterestShift,
            "industry_efficiency" => EffectKind::IndustryEfficiency,
            other => {
                is.push(f, &item, format!("effect “{other}”不在内核实现的效果集合中"));
                continue;
            }
        };
        let requires = match e.requires.as_str() {
            "none" => EventRequire::None,
            "tension" => EventRequire::Tension,
            "tension_or_war" => EventRequire::TensionOrWar,
            other => {
                is.push(f, &item, format!("requires “{other}”无效，应为 none / tension / tension_or_war"));
                EventRequire::None
            }
        };
        if requires != EventRequire::None && !effect.needs_faction_b() {
            is.push(f, &item, "只有势力关系类事件可以设置 requires");
        }
        if e.cooldown_days == 0 || e.max_per_year == 0 {
            is.push(f, &item, "cooldown_days 与 max_per_year 必须大于 0");
        }
        let mult = e.mult.map(|[lo, hi]| (fx(lo), fx(hi)));
        let range_ok = |need: bool, present: bool, name: &str, is: &mut Issues| {
            if need && !present {
                is.push(f, &item, format!("该效果需要 {name} 范围"));
            }
            if !need && present {
                is.push(f, &item, format!("该效果不使用 {name}"));
            }
        };
        range_ok(effect.needs_mult(), mult.is_some(), "mult", is);
        range_ok(effect.needs_days(), e.days.is_some(), "days", is);
        range_ok(effect.needs_delta(), e.delta.is_some(), "delta", is);
        if let Some((lo, hi)) = mult
            && (lo > hi || lo < Fx::from_pct(10) || hi > Fx::from_int(5))
        {
            is.push(f, &item, "mult 必须满足 0.1 ≤ 下限 ≤ 上限 ≤ 5");
        }
        if let Some([lo, hi]) = e.days
            && (lo > hi || lo == 0 || hi > 720)
        {
            is.push(f, &item, "days 必须满足 1 ≤ 下限 ≤ 上限 ≤ 720");
        }
        if let Some([lo, hi]) = e.delta
            && (lo > hi || lo < -100 || hi > 100)
        {
            is.push(f, &item, "delta 必须满足 −100 ≤ 下限 ≤ 上限 ≤ 100");
        }
        if !e.goods.is_empty() && !effect.needs_good() {
            is.push(f, &item, "该效果不使用 goods");
        }
        let goods: Vec<GoodId> = e.goods.iter().filter_map(|g| lookup(&good_ids, g, f, &item, "商品", is)).collect();
        if e.port_only && !effect.needs_loc() {
            is.push(f, &item, "该效果不使用地点，不能设置 port_only");
        }
        // 限定的地点、海区与势力（S01）：只有用得上的效果可以写；每一项都要查得到、而且真的可能被选中。
        if !e.locs.is_empty() && !effect.needs_loc() {
            is.push(f, &item, "该效果不使用地点，不能设置 locs");
        }
        if !e.regions.is_empty() && !effect.needs_region() {
            is.push(f, &item, "该效果不使用海区，不能设置 regions");
        }
        if !e.factions.is_empty() && !effect.needs_faction_a() {
            is.push(f, &item, "该效果不使用势力，不能设置 factions");
        }
        let locs: Vec<LocId> = e.locs.iter().filter_map(|l| lookup(&loc_ids, l, f, &item, "地点", is)).collect();
        for l in &locs {
            let def = &locations[l.idx()];
            if def.is_site() {
                is.push(f, &item, format!("locs 里的“{}”是殖民点，市场类事件不适用", def.key));
            } else if e.port_only && !def.is_port() {
                is.push(f, &item, format!("locs 里的“{}”不是港口，与 port_only 矛盾", def.key));
            }
        }
        // 带商品的效果：每一种商品都要在限定的地点里至少一处有市场，否则这种商品永远选不出地点。
        if effect.needs_loc() && effect.needs_good() && !locs.is_empty() {
            for g in &goods {
                if !locs.iter().any(|l| locations[l.idx()].market.iter().any(|m| m.good == *g)) {
                    let key = good_ids.iter().find(|(_, id)| *id == g).map_or("?", |(k, _)| k.as_str());
                    is.push(f, &item, format!("locs 里没有一处交易“{key}”，这种商品永远选不出地点"));
                }
            }
        }
        let event_regions: Vec<RegionId> = e
            .regions
            .iter()
            .filter_map(|r| match regions.iter().position(|x| x.key == *r) {
                Some(i) => Some(RegionId::from_idx(i)),
                None => {
                    is.push(f, &item, format!("引用了不存在的海区“{r}”"));
                    None
                }
            })
            .collect();
        let factions: Vec<FactionId> =
            e.factions.iter().filter_map(|x| lookup(&faction_ids, x, f, &item, "势力", is)).collect();
        if effect.needs_faction_b() && !factions.is_empty() && factions.len() < 2 {
            is.push(f, &item, "两个势力的效果限定 factions 时至少要写两个势力");
        }
        if locs.iter().collect::<std::collections::BTreeSet<_>>().len() != locs.len()
            || event_regions.iter().collect::<std::collections::BTreeSet<_>>().len() != event_regions.len()
            || factions.iter().collect::<std::collections::BTreeSet<_>>().len() != factions.len()
        {
            is.push(f, &item, "locs / regions / factions 里有重复的条目");
        }
        events.push(EventTypeDef {
            key: e.key.clone(),
            name: e.name.clone(),
            description: e.description.clone(),
            effect,
            cooldown_days: e.cooldown_days,
            max_per_year: e.max_per_year,
            requires,
            goods,
            mult,
            days: e.days.map(|[a, b]| (a, b)),
            delta: e.delta.map(|[a, b]| (a, b)),
            port_only: e.port_only,
            locs,
            regions: event_regions,
            factions,
        });
    }

    // ── 商会 ──
    let f = "companies.toml";
    check_keys(f, "companies", companies_raw.companies.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    let mut companies = Vec::new();
    for c in &companies_raw.companies {
        let item = format!("companies[{}]", c.key);
        let home = lookup(&port_ids, &c.home, f, &item, "港口", is).unwrap_or(LocId(0));
        let ships_c: Vec<ShipTypeId> =
            c.ships.iter().filter_map(|s| lookup(&ship_ids, s, f, &item, "船型", is)).collect();
        if ships_c.is_empty() || ships_c.len() > 5 {
            is.push(f, &item, "ships 必须有 1 到 5 艘");
        }
        for s in &ships_c {
            if ships[s.idx()].unique {
                is.push(f, &item, format!("商会不能使用独有船型“{}”", ships[s.idx()].key));
            }
        }
        let preferred: Vec<GoodId> =
            c.preferred.iter().filter_map(|g| lookup(&good_ids, g, f, &item, "商品", is)).collect();
        if !in_range(c.risk.value(), 0.1, 0.9) {
            is.push(f, &item, "risk 必须在 0.1 到 0.9 之间");
        }
        if c.cash < 0 {
            is.push(f, &item, "cash 不能为负");
        }
        let forecast = match c.forecast.as_deref() {
            None => ForecastMethod::Naive,
            Some(k) => ForecastMethod::from_key(k).unwrap_or_else(|| {
                is.push(f, &item, format!("forecast “{k}”无效，应为 naive、trend 或 revert"));
                ForecastMethod::Naive
            }),
        };
        let reaction = match c.reaction.as_deref() {
            None => Reaction::Neutral,
            Some(k) => Reaction::from_key(k).unwrap_or_else(|| {
                is.push(f, &item, format!("reaction “{k}”无效，应为 neutral、follow 或 avoid"));
                Reaction::Neutral
            }),
        };
        companies.push(CompanyDef {
            key: c.key.clone(),
            name: c.name.clone(),
            home,
            cash: c.cash,
            ships: ships_c,
            preferred,
            risk: fx(c.risk),
            forecast,
            reaction,
            persona: c.persona.trim().to_string(),
        });
    }

    // ── 航海士 ──
    let f = "mates.toml";
    check_keys(f, "mates", mates_raw.mates.iter().map(|m| (m.key.as_str(), m.name.as_str())), is);
    let mut mate_ids: BTreeMap<String, MateId> = BTreeMap::new();
    let mut mates = Vec::new();
    for (i, m) in mates_raw.mates.iter().enumerate() {
        let item = format!("mates[{}]", m.key);
        let home = lookup(&port_ids, &m.home, f, &item, "港口", is).unwrap_or(LocId(0));
        for (name, v) in
            [("navigation", m.navigation), ("trade", m.trade), ("combat", m.combat), ("management", m.management)]
        {
            if !(1..=100).contains(&v) {
                is.push(f, &item, format!("{name} 必须在 1 到 100 之间"));
            }
        }
        if !(1..=rules.mates.max_level).contains(&m.level) {
            is.push(f, &item, format!("level 必须在 1 到 {} 之间", rules.mates.max_level));
        }
        if m.salary < 0 || m.hire_cost < 0 {
            is.push(f, &item, "salary、hire_cost 不能为负");
        }
        if !(0..=100).contains(&m.loyalty) {
            is.push(f, &item, "loyalty 必须在 0 到 100 之间");
        }
        if m.bio.trim().is_empty() {
            is.push(f, &item, "bio 不能为空");
        }
        for (j, k) in m.methods.iter().enumerate() {
            if !manifest_core::mates::GENIUS_METHODS.contains(&k.as_str()) {
                is.push(
                    f,
                    &item,
                    format!(
                        "methods 里的“{k}”不是算学奇才的方法（{}）",
                        manifest_core::mates::GENIUS_METHODS.join("、")
                    ),
                );
            }
            if m.methods[..j].contains(k) {
                is.push(f, &item, format!("methods 里的“{k}”重复"));
            }
        }
        mate_ids.insert(m.key.clone(), MateId::from_idx(i));
        mates.push(MateDef {
            abilities: m.abilities.clone(),
            key: m.key.clone(),
            name: m.name.clone(),
            bio: m.bio.clone(),
            home,
            navigation: m.navigation,
            trade: m.trade,
            combat: m.combat,
            management: m.management,
            level: m.level,
            salary: m.salary,
            hire_cost: m.hire_cost,
            loyalty: m.loyalty,
            hidden: m.hidden,
            methods: m.methods.clone(),
        });
    }

    // ── 剧本 ──
    let mut scenarios = Vec::new();
    let (protagonist_defs, template_defs) = scenario::identities(dir, is);
    let authoring_upbringing = upbringing::authoring_only(dir);
    // 故事线与推荐角色等故事线、主角身世转换好之后再接上（见下方 story::link_scenarios）
    let mut scenario_links = Vec::new();
    for (rel, info, text) in scenario_files {
        let Some(s) = parse::<ScenarioRaw>(&rel, &text, is) else { continue };
        let upbringing = info.upbringing && !authoring_upbringing;
        scenario_links.push(story::ScenarioLink { file: rel.clone(), story: s.story.clone(), hero: s.hero });
        let item = format!("scenario[{}]", s.key);
        let start = lookup(&port_ids, &s.start, &rel, &item, "港口", is).unwrap_or(LocId(0));
        let ships_s: Vec<ShipTypeId> =
            s.ships.iter().filter_map(|k| lookup(&ship_ids, k, &rel, &item, "船型", is)).collect();
        if (!upbringing && ships_s.is_empty()) || ships_s.len() > 5 {
            is.push(&rel, &item, "ships 必须有 1 到 5 艘");
        }
        for k in &ships_s {
            if ships[k.idx()].unique {
                is.push(&rel, &item, format!("开局舰队不能有独有船型“{}”", ships[k.idx()].key));
            }
        }
        if upbringing && (!ships_s.is_empty() || s.crew != 0 || !s.cargo.is_empty() || s.food != 0 || s.water != 0) {
            is.push(&rel, &item, "养成开局不能带船、船员、货物或舰队补给");
        }
        let crew_min: i64 = ships_s.iter().map(|k| ships[k.idx()].crew_min).sum();
        let crew_max: i64 = ships_s.iter().map(|k| ships[k.idx()].crew_max).sum();
        if s.crew < crew_min || s.crew > crew_max {
            is.push(&rel, &item, format!("crew 必须在 {crew_min} 到 {crew_max} 之间"));
        }
        if s.cash < 0 {
            is.push(&rel, &item, "cash 不能为负");
        }
        // 开局货物与粮水：商品存在、数量为正、同一商品不重复，货物与粮水合计不超过舰队舱位
        let mut cargo: Vec<(GoodId, i64)> = Vec::new();
        for gq in &s.cargo {
            if gq.qty <= 0 {
                is.push(&rel, &item, format!("cargo 中“{}”的数量必须大于 0", gq.good));
            }
            if let Some(g) = lookup(&good_ids, &gq.good, &rel, &item, "商品", is) {
                if cargo.iter().any(|(k, _)| *k == g) {
                    is.push(&rel, &item, format!("cargo 中商品“{}”重复", gq.good));
                }
                cargo.push((g, gq.qty));
            }
        }
        if s.food < 0 || s.water < 0 {
            is.push(&rel, &item, "food、water 不能为负");
        }
        let hold: i64 = ships_s.iter().map(|k| ships[k.idx()].capacity).sum();
        let loaded: i64 = s.cargo.iter().map(|gq| gq.qty.max(0)).sum::<i64>() + s.food.max(0) + s.water.max(0);
        if loaded > hold {
            is.push(&rel, &item, format!("开局货物与粮水共 {loaded} 件，超过舰队舱位 {hold}"));
        }
        let scenario_mates: Vec<MateId> =
            s.mates.iter().filter_map(|k| lookup(&mate_ids, k, &rel, &item, "航海士", is)).collect();
        for m in &scenario_mates {
            if mates[m.idx()].hidden {
                is.push(&rel, &item, format!("开局不能带隐藏的航海士“{}”", mates[m.idx()].key));
            }
        }
        let mut reputation = Vec::new();
        for (k, v) in &s.reputation {
            if let Some(fid) = lookup(&faction_ids, k, &rel, &item, "势力", is) {
                if !(-100..=100).contains(v) {
                    is.push(&rel, &item, format!("reputation.{k} 必须在 −100 到 100 之间"));
                }
                reputation.push((fid, *v));
            }
        }
        let kind = match s.goal.kind.as_str() {
            "net_worth" if s.goal.target > 0 => GoalKind::NetWorth(s.goal.target),
            "ally_ports" if (1..=100).contains(&s.goal.target) => GoalKind::AllyPorts(s.goal.target as u32),
            "colonies" if (1..=20).contains(&s.goal.target) && s.goal.population >= 1 => {
                GoalKind::Colonies { count: s.goal.target as u32, population: s.goal.population }
            }
            "sandbox" => GoalKind::Sandbox,
            "story" => GoalKind::Story,
            other => {
                is.push(
                    &rel,
                    &item,
                    format!(
                        "goal.kind “{other}”无效或 target 不合理：应为 net_worth（target > 0）、ally_ports（1–100）、colonies（target 1–20，population ≥ 1）、sandbox 或 story（走完剧本挂的故事线）"
                    ),
                );
                GoalKind::Sandbox
            }
        };
        if s.goal.population != 0 && !matches!(kind, GoalKind::Colonies { .. }) {
            is.push(&rel, &item, "只有 colonies 目标使用 goal.population");
        }
        if s.goal.years.is_some_and(|y| !(1..=100).contains(&y)) {
            is.push(&rel, &item, "goal.years 必须在 1 到 100 之间");
        }
        let start_date = info.start_date.unwrap_or([rules.world.start_year as u32, 1, 1]);
        let control_date = info.control_date.unwrap_or(start_date);
        scenario::day_of(dir, rules.world.start_year, start_date, &rel, is);
        let control_day = scenario::day_of(dir, rules.world.start_year, control_date, &rel, is);
        let goal = Goal {
            kind,
            deadline: s
                .goal
                .years
                .map(|y| control_day.saturating_add(y.saturating_mul(dir.manifest.calendar.year_days()))),
        };
        scenarios.push(ScenarioDef {
            key: s.key,
            name: s.name,
            description: s.description,
            start,
            start_loc: start,
            start_date,
            control_date,
            protagonist_defs: protagonist_defs.iter().filter(|p| info.protagonists.contains(&p.key)).cloned().collect(),
            template_defs: template_defs.iter().filter(|t| info.custom.templates.contains(&t.key)).cloned().collect(),
            protagonists: info.protagonists,
            templates: info.custom.templates,
            upbringing,
            timeline: info.timeline,
            cash: s.cash,
            ships: ships_s,
            crew: s.crew,
            mates: scenario_mates,
            reputation,
            goal,
            max_reorganizations: s.max_reorganizations,
            cargo,
            food: s.food,
            water: s.water,
            recommended: s.recommended,
            story: None,
            hero: None,
        });
    }
    check_keys("scenarios/", "scenarios", scenarios.iter().map(|s| (s.key.as_str(), s.name.as_str())), is);
    if scenarios.is_empty() {
        is.push("scenarios/", "", "至少需要一个开局剧本");
    }

    // ── 殖民地建筑 ──
    let colony_buildings = convert_buildings(&colony_raw, &good_ids, is);

    // ── 发现物 ──
    let f = "world/discoveries.toml";
    check_keys(f, "discoveries", discoveries_raw.discoveries.iter().map(|d| (d.key.as_str(), d.name.as_str())), is);
    let mut discoveries: Vec<DiscoveryDef> = Vec::new();
    for d in &discoveries_raw.discoveries {
        let item = format!("discoveries[{}]", d.key);
        let [x, y] = d.pos;
        let cell = if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
            is.push(f, &item, format!("pos {:?} 超出地图范围（{width} × {height}）", d.pos));
            Cell::new(0, 0)
        } else {
            Cell::new(x as u16, y as u16)
        };
        let kind = DiscoveryKind::parse(&d.kind).unwrap_or_else(|| {
            let all: Vec<&str> = DiscoveryKind::ALL.iter().map(|k| k.key()).collect();
            is.push(f, &item, format!("kind “{}”无效，应为 {} 之一", d.kind, all.join(" / ")));
            DiscoveryKind::Landmark
        });
        if !(0..=1_000).contains(&d.fame) || !(0..=10_000_000).contains(&d.value) {
            is.push(f, &item, "fame 须在 0–1000，value 须在 0–10000000 之间");
        }
        discoveries.push(DiscoveryDef {
            key: d.key.clone(),
            name: d.name.clone(),
            cell,
            kind,
            fame: d.fame,
            value: d.value,
            lore: d.lore.clone(),
        });
    }

    let region_ids: BTreeMap<String, RegionId> =
        regions.iter().enumerate().map(|(i, r)| (r.key.clone(), RegionId::from_idx(i))).collect();
    let captain_defs = captain::convert(
        captain_raw,
        &captain::Tables {
            rules: &rules.attributes,
            calendar: &dir.manifest.calendar,
            good_ids: &good_ids,
            goods: &goods,
            region_ids: &region_ids,
        },
        is,
    );
    for m in &mates {
        for (key, value) in &m.abilities {
            if !captain_defs.abilities.iter().any(|a| a.key == *key) {
                is.push("mates.toml", format!("mates[{}].abilities.{key}", m.key), "未知能力");
            }
            if ["navigation", "trade", "combat", "management"].contains(&key.as_str()) {
                is.push(
                    "mates.toml",
                    format!("mates[{}].abilities.{key}", m.key),
                    "经典四能力使用原字段，不能重复声明",
                );
            }
            if !(0..=100).contains(value) {
                is.push("mates.toml", format!("mates[{}].abilities.{key}", m.key), "能力须在 0–100 之间");
            }
        }
    }
    // ── 地标与奇观（可选；discovery 引用发现物）──
    let discovery_ids: BTreeMap<String, DiscoveryId> =
        discoveries.iter().enumerate().map(|(i, d)| (d.key.clone(), DiscoveryId::from_idx(i))).collect();
    let mut landmarks = geo::load_landmarks(dir, &map, &discovery_ids, is);
    c2::link_landmarks(&prepared, &mut landmarks, &discovery_ids, is);
    // ── 剧情事件：故事线与奇遇（引用港口、海区、商品、势力、航海士与发现物），再接上带主角的剧本 ──
    let port_cultures: std::collections::BTreeSet<String> =
        locations.iter().filter(|l| l.is_port()).map(|l| l.culture.clone()).collect();
    let story_tables = story::Tables {
        captain: &captain_defs,
        port_ids: &port_ids,
        region_ids: &region_ids,
        good_ids: &good_ids,
        goods: &goods,
        faction_ids: &faction_ids,
        mate_ids: &mate_ids,
        mates: &mates,
        discovery_ids: &discovery_ids,
        cultures: &port_cultures,
    };
    let story_defs = story::convert(story_files, &story_tables, is);
    story::link_scenarios(
        &mut scenarios,
        scenario_links,
        &story_defs,
        &captain_defs,
        &dir.manifest.calendar,
        &rules.attributes,
        is,
    );
    let mut places = offstage::load(dir, &locations.iter().map(|l| l.key.clone()).collect::<Vec<_>>(), is);
    places.authored = std::mem::take(&mut prepared.authored);
    // 海区创作源里给界面的内容字段（音乐分区）：挂在作者补充数据上，海区定义与航线不受影响
    places.authored.regions = authored_regions::load(dir, &regions, is);
    let mut geography = manifest_core::geo::Geography { relief, biomes, rivers, landmarks, places, fine_rivers };
    let item_defs = items::load(dir, &captain_defs, &regions, &rules.items, is);
    let auction_defs = auction::load(dir, &item_defs, &locations, &mates, is);
    // H04：海上所见的数据表挂在规则上（物品键要在物品表加载之后才能校验）
    rules.sightings.defs = sightings::load(dir, &item_defs, is);
    if rules.sightings.enabled && rules.sightings.defs.is_empty() {
        is.push("rules.toml", "sightings", "打开了海上所见，却没有登记 sightings.toml 或表是空的");
    }
    let mut cast_defs = cast::load(dir, &locations, &mut geography.places, &faction_ids, is);
    // H08：甲板闲话的数据表（同伴键要在航海士表或人物表里——人物表里的同伴在后面才并进航海士表）
    rules.banter.defs = banter::load(dir, &mates, &cast_defs, &captain_defs, is);
    if rules.banter.enabled && rules.banter.defs.is_empty() {
        is.push("rules.toml", "banter", "打开了甲板闲话，却没有登记 banter.toml 或表是空的");
    }
    let mut story2_defs = story2::load(dir, &cast_defs, &locations, is);
    story2_defs.pending_flags = cast::pending_flags(dir, is);
    story2_defs.skills.extend(
        item_defs.items.iter().filter_map(|i| i.read.as_ref()).flat_map(|r| r.skills.iter().map(|s| s.skill.clone())),
    );
    let mut skill_files = dir.files_in("skills");
    if dir.contains("skills.toml") {
        skill_files.push("skills.toml".into());
    }
    for file in skill_files {
        if let Some(text) = read(dir, &file, is)
            && let Some(table) = parse::<toml::Table>(&file, &text, is)
            && let Some(skills) = table.get("skills").and_then(|v| v.as_array())
        {
            for skill in skills {
                let Some(key) = skill.get("key").and_then(|v| v.as_str()) else {
                    continue;
                };
                story2_defs.skills.insert(key.into());
                if let Some(kind) = skill.get("kind").and_then(|v| v.as_str()) {
                    story2_defs.skill_kinds.insert(key.into(), kind.into());
                }
                // K01：效果进静态数据（生效与否看 rules.toml [skill_effects]）
                if let Some(effects) = skills::load(&file, key, skill, is) {
                    story2_defs.skill_effects.insert(key.into(), effects);
                }
                story2_defs.skill_labels.push(manifest_core::story2::SkillLabel {
                    key: key.into(),
                    name: skill.get("name").and_then(|v| v.as_str()).unwrap_or(key).into(),
                    description: skill.get("description").and_then(|v| v.as_str()).unwrap_or_default().into(),
                    source: file.clone(),
                });
            }
        }
    }
    let upbringing_defs = upbringing::load(dir, is);
    story2_defs.tracks.extend(upbringing_defs.tracks.iter().cloned());
    cast::link_tracks(dir, &mut cast_defs, &story2_defs, &geography.places.authored.pending_ties, is);
    cast::link_mates(&cast_defs, &locations, &mut mates, is);

    if !issues.list.is_empty() {
        return Err(DataError { issues: issues.list });
    }

    // ── 航线表（所有港口必须互相可达；殖民点须与港口连通，但不进预计算航线表） ──
    let port_cells: Vec<(LocId, Cell)> =
        locations.iter().enumerate().filter(|(_, l)| l.is_port()).map(|(i, l)| (LocId::from_idx(i), l.cell)).collect();
    let nav = navigation::load(dir, &map, &regions, &locations, &port_cells)?;
    if let Some(&(_, first)) = port_cells.first() {
        let reach = nav.grid.reachable_from(first);
        for l in locations.iter().filter(|l| l.is_site()) {
            if !reach.get(map.idx(l.cell)).copied().unwrap_or(false) {
                issues.push(
                    "world/overseas.toml",
                    format!("sites[{}]", l.key),
                    format!("殖民点 {:?} 与港口之间没有航线", (l.cell.x, l.cell.y)),
                );
            }
        }
    }
    for &(a, _) in &port_cells {
        for &(b, _) in &port_cells {
            if a != b
                && (0..nav.grid.period_count()).all(|period| nav.compressed_path(period, a, b).is_none())
                && (0..nav.grid.period_count())
                    .any(|period| nav.grid.check_port(period, a).is_ok() && nav.grid.check_port(period, b).is_ok())
            {
                issues.push(
                    "world/map.txt",
                    "",
                    format!("港口“{}”与“{}”之间没有航线", locations[a.idx()].key, locations[b.idx()].key),
                );
            }
        }
    }
    if !issues.list.is_empty() {
        return Err(DataError { issues: issues.list });
    }

    let keys = IdTables {
        goods: goods.iter().map(|g| g.key.clone()).collect(),
        locations: locations.iter().map(|g| g.key.clone()).collect(),
        ships: ships.iter().map(|g| g.key.clone()).collect(),
        regions: regions.iter().map(|g| g.key.clone()).collect(),
        factions: factions.iter().map(|g| g.key.clone()).collect(),
        companies: companies.iter().map(|g| g.key.clone()).collect(),
        animals: animals.iter().map(|g| g.key.clone()).collect(),
        roads: roads.iter().map(|g| g.key.clone()).collect(),
        industry_types: industry_types.iter().map(|g| g.key.clone()).collect(),
        recipes: recipes.iter().map(|g| g.key.clone()).collect(),
        exchanges: exchanges.iter().map(|g| g.key.clone()).collect(),
        futures_specs: futures_specs.iter().map(|g| g.key.clone()).collect(),
        events: events.iter().map(|g| g.key.clone()).collect(),
        mates: mates.iter().map(|g| g.key.clone()).collect(),
        colony_buildings: colony_buildings.iter().map(|g| g.key.clone()).collect(),
        discoveries: discoveries.iter().map(|g| g.key.clone()).collect(),
        attributes: captain_defs.attributes.iter().map(|g| g.key.clone()).collect(),
        scenarios: scenarios.iter().map(|g| g.key.clone()).collect(),
        refits: refits.iter().map(|g| g.key.clone()).collect(),
        roles: captain_defs.roles.iter().map(|g| g.key.clone()).collect(),
    };
    // 只数作者清单里的产地；后面的开放市场补给不得成为产地。
    let mut good_sources = vec![0u16; goods.len()];
    for loc in locations.iter().filter(|l| !l.is_site()) {
        let sources: std::collections::BTreeSet<_> =
            loc.market.iter().filter(|m| m.supply > 0).map(|m| m.good).collect();
        for good in sources {
            good_sources[good.idx()] = good_sources[good.idx()].saturating_add(1);
        }
    }
    let mut defs = StaticData {
        meta: DataMeta { hash: dir.hash(false).map_err(world_error)?, keys },
        world_key: dir.manifest.key.clone(),
        world_name: dir.manifest.name.clone(),
        map_key: dir.manifest.map.clone(),
        calendar: dir.manifest.calendar.clone(),
        rules,
        map,
        fine_coast,
        regions,
        goods,
        locations,
        ships,
        refits,
        factions,
        relations,
        companies,
        scenarios,
        animals,
        roads,
        industry_types,
        recipes,
        exchanges,
        futures_specs,
        events,
        mates,
        colony_buildings,
        discoveries,
        geography,
        nav,
        composed: composed.unwrap_or_default(),
        captain: captain_defs,
        stories: story_defs,
        items: item_defs,
        auctions: auction_defs,
        cast: cast_defs,
        story2: story2_defs,
        manual_navigation: dir.manifest.modules.get("navigation").and_then(toml::Value::as_str) == Some("manual"),
        navigation: {
            let mut rules = dir.manifest.navigation.clone();
            if let Some(hide) = dir.manifest.modules.get("hide_unknown_ports").and_then(toml::Value::as_bool) {
                rules.hide_unknown_ports = hide;
            }
            rules
        },
        history: history::load(dir, &mut issues),
        ideas: ideas::load(dir, &mut issues),
        societies: societies::load(dir, &mut issues),
        legend_ships: legend_ships::load(dir, &mut issues),
        realms: realms::load(dir, &mut issues),
        lineages: lineages::load(dir, &mut issues),
        creatures: creatures::load(dir, &mut issues),
        arcana: arcana::load(dir, &mut issues),
        upbringing: upbringing_defs,
        guide: guide::load(dir, &mut issues),
        loc_order: Default::default(),
        good_sources,
        trade_dist: Vec::new(),
        rare_source: Vec::new(),
    };
    // 开放市场：清单里的进口条目按贸易距离补背景到货（rules.toml 打开时；要用到航线，所以放在组装之后）
    link_foreign_lines(&mut defs.rules.shipyard_growth);
    link_stage_markets(&mut defs, &all_locs, &mut issues);
    manifest_core::open_market::apply_listed_import_inflow(&mut defs);
    defs.trade_dist = manifest_core::open_market::trade_distances(&defs)
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|d| d.map_or(u16::MAX, |d| d.trunc().clamp(0, i64::from(u16::MAX) - 1) as u16))
                .collect()
        })
        .collect();
    defs.upbringing.act_index = manifest_core::upbringing::act::build_index(&defs);
    // 这几项内核校验互不相干（寰宇的故事图与养成各要约半秒）：分线程同时做，问题照原先后排（2026-11-03 启动提速）。
    // U03 的可达检查（auto 轨道起始章、旗标来源、无入口轨道）只查可玩与草稿世界：隐藏世界，
    // 以及标了 scaffold 的测试脚手架世界（testbed 和继承它的夹具世界，即使测试临时改成可见；
    // 剧情线与旗标由测试代码直接开、直接设）不查。
    let skip_reach = dir.manifest.hidden || dir.manifest.scaffold;
    let story_errors = std::thread::scope(|scope| {
        let graph = scope.spawn(|| manifest_core::story2::graph::validate_world(&defs));
        let upbringing = scope.spawn(|| manifest_core::upbringing::validation::validate(&defs));
        let reach = scope.spawn(|| {
            if skip_reach {
                Vec::new()
            } else {
                manifest_core::story2::graph::validate_reachability(&defs).into_iter().collect::<Vec<_>>()
            }
        });
        let mut errors: Vec<_> = manifest_core::story2::validation::validate(&defs).into_iter().collect();
        errors.extend(graph.join().unwrap_or_else(|e| std::panic::resume_unwind(e)));
        errors.extend(upbringing.join().unwrap_or_else(|e| std::panic::resume_unwind(e)));
        errors.extend(reach.join().unwrap_or_else(|e| std::panic::resume_unwind(e)));
        errors
    });
    for error in story_errors {
        issues.push("stories", "tracks", error);
    }
    for error in manifest_core::history::validation::validate(&defs)
        .into_iter()
        .chain(manifest_core::ideas::validation::validate(&defs))
        .chain(manifest_core::societies::validation::validate(&defs))
        .chain(manifest_core::legend_ships::validation::validate(&defs))
        .chain(manifest_core::realms::validation::validate(&defs))
        .chain(manifest_core::lineages::validation::validate(&defs))
        .chain(manifest_core::creatures::validation::validate(&defs))
        .chain(manifest_core::arcana::validation::validate(&defs))
    {
        issues.push("history", "events", error);
    }
    // K01：技能效果的数值范围、逐级阈值（要在养成的技能等级表读入之后查）
    for error in manifest_core::skills::problems(&defs) {
        issues.push("skills.toml", "effects", error);
    }
    if !issues.list.is_empty() {
        return Err(DataError { issues: issues.list });
    }
    Ok(defs)
}

/// 把各海区的矩形改为它实际所含海格的外接矩形（没有海格的海区保持原矩形）。
fn fit_region_rects(regions: &mut [RegionDef], region_of: &[u16], width: u16, wrap_x: bool) {
    let mut bounds: Vec<Option<(u16, u16, u16, u16)>> = vec![None; regions.len()];
    for (i, &r) in region_of.iter().enumerate() {
        let Some(b) = bounds.get_mut(r as usize) else { continue };
        let (x, y) = ((i % width as usize) as u16, (i / width as usize) as u16);
        *b = Some(match *b {
            None => (x, y, x, y),
            Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
        });
    }
    let mut columns = vec![std::collections::BTreeSet::new(); regions.len()];
    if wrap_x {
        for (i, &r) in region_of.iter().enumerate() {
            if let Some(xs) = columns.get_mut(r as usize) {
                xs.insert((i % width as usize) as u16);
            }
        }
    }
    for ((r, b), xs) in regions.iter_mut().zip(bounds).zip(columns) {
        if let Some(mut rect) = b {
            // 去掉最大的空白经度间隔；平局优先保留普通外接矩形。
            if wrap_x {
                let xs: Vec<_> = xs.into_iter().collect();
                let mut gap = u32::from(width) - u32::from(rect.2) + u32::from(rect.0);
                for pair in xs.windows(2) {
                    let candidate = u32::from(pair[1] - pair[0]);
                    if candidate > gap {
                        gap = candidate;
                        rect.0 = pair[1];
                        rect.2 = pair[0];
                    }
                }
            }
            r.rect = rect;
        }
    }
}

/// 殖民地建筑的转换与校验。
fn convert_buildings(raw: &ColonyFile, good_ids: &BTreeMap<String, GoodId>, is: &mut Issues) -> Vec<ColonyBuildingDef> {
    let f = "colony.toml";
    check_keys(f, "buildings", raw.buildings.iter().map(|b| (b.key.as_str(), b.name.as_str())), is);
    let mut out = Vec::new();
    for b in &raw.buildings {
        let item = format!("buildings[{}]", b.key);
        let kind = BuildingKind::parse(&b.kind).unwrap_or_else(|| {
            let all: Vec<&str> = BuildingKind::ALL.iter().map(|k| k.key()).collect();
            is.push(f, &item, format!("kind “{}”无效，应为 {} 之一", b.kind, all.join(" / ")));
            BuildingKind::Storage
        });
        let conv = |list: &[GoodQty], what: &str, is: &mut Issues| -> Vec<(GoodId, i64)> {
            list.iter()
                .filter_map(|gq| {
                    if gq.qty <= 0 {
                        is.push(f, &item, format!("{what}中“{}”的数量必须大于 0", gq.good));
                    }
                    lookup(good_ids, &gq.good, f, &item, "商品", is).map(|g| (g, gq.qty))
                })
                .collect()
        };
        let materials = conv(&b.materials, "materials", is);
        let inputs = conv(&b.inputs, "inputs", is);
        let outputs = conv(&b.outputs, "outputs", is);
        let goods: Vec<GoodId> = b.goods.iter().filter_map(|g| lookup(good_ids, g, f, &item, "商品", is)).collect();
        if b.cost < 0 || b.workers < 0 || b.upkeep < 0 {
            is.push(f, &item, "cost、workers、upkeep 不能为负");
        }
        if b.build_days == 0 || b.build_days > 720 {
            is.push(f, &item, "build_days 必须在 1 到 720 之间");
        }
        if !(1..=10).contains(&b.max_level) {
            is.push(f, &item, "max_level 必须在 1 到 10 之间");
        }
        let raw_kind = matches!(kind, BuildingKind::Food | BuildingKind::Extract);
        if raw_kind && (b.goods.is_empty() || b.output <= 0) {
            is.push(f, &item, "粮食与采集类建筑需要 goods 与大于 0 的 output");
        }
        if !raw_kind && (!b.goods.is_empty() || b.output != 0) {
            is.push(f, &item, "只有粮食与采集类建筑使用 goods 与 output");
        }
        let process = kind == BuildingKind::Process;
        if process && (b.inputs.is_empty() || b.outputs.is_empty()) {
            is.push(f, &item, "加工类建筑需要 inputs 与 outputs");
        }
        if !process && (!b.inputs.is_empty() || !b.outputs.is_empty()) {
            is.push(f, &item, "只有加工类建筑使用 inputs 与 outputs");
        }
        for (field, value, owner_kind) in [
            ("capacity", b.capacity, BuildingKind::Storage),
            ("defense", b.defense, BuildingKind::Defense),
            ("morale", b.morale, BuildingKind::Morale),
            ("housing", b.housing, BuildingKind::Housing),
        ] {
            if kind == owner_kind && value <= 0 {
                is.push(f, &item, format!("该类建筑的 {field} 必须大于 0"));
            }
            if kind != owner_kind && value != 0 {
                is.push(f, &item, format!("只有 {} 类建筑使用 {field}", owner_kind.key()));
            }
        }
        if b.defense > 100 || b.morale > 100 {
            is.push(f, &item, "defense、morale 每级不能超过 100");
        }
        out.push(ColonyBuildingDef {
            key: b.key.clone(),
            name: b.name.clone(),
            kind,
            cost: b.cost,
            materials,
            build_days: b.build_days,
            workers: b.workers,
            upkeep: b.upkeep,
            max_level: b.max_level,
            goods,
            output: b.output,
            inputs,
            outputs,
            capacity: b.capacity,
            defense: b.defense,
            morale: b.morale,
            housing: b.housing,
            description: b.description.clone(),
        });
    }
    out
}

/// 多线程构建航线表（不经缓存）。
pub fn build_nav_parallel(map: &SeaMap, regions: &[RegionDef], loc_count: usize, ports: &[(LocId, Cell)]) -> NavTable {
    let grid = NavGrid::new(map, regions);
    let jobs = NavTable::jobs(ports);
    let threads =
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 16).min(jobs.len().max(1));
    let chunk = jobs.len().div_ceil(threads).max(1);
    let rows: Vec<Vec<Option<manifest_core::nav::Path>>> = std::thread::scope(|s| {
        let handles: Vec<_> = jobs
            .chunks(chunk)
            .map(|part| {
                let grid = &grid;
                s.spawn(move || part.iter().map(|j| NavTable::run_job(grid, ports, j)).collect::<Vec<_>>())
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| match h.join() {
                Ok(rows) => rows,
                Err(e) => std::panic::resume_unwind(e),
            })
            .collect()
    });
    NavTable::assemble(grid, loc_count, ports, &jobs, rows)
}

/// 日期与选项保留给内核，资产字段继续交由旧结构校验。
fn scenario_files(dir: &EffectiveWorld, issues: &mut Issues) -> Vec<(String, crate::worlds::ScenarioInfo, String)> {
    let mut result = Vec::new();
    for rel in dir.files_in("scenarios") {
        match dir.scenario_file(&rel) {
            Ok((info, text)) => result.push((rel, info, text)),
            Err(e) => issues.push(&rel, "", e.to_string()),
        }
    }
    result
}

/// 经典缓存也使用有效文件集合，不扫描其他世界或地图。
pub(crate) fn hash_dir(dir: &Path) -> String {
    crate::worlds::resolve_world_for_load(dir, "classic").and_then(|w| w.hash(false)).unwrap_or_default()
}

pub(crate) fn hash_all(dir: &Path) -> String {
    crate::worlds::resolve_world_for_load(dir, "classic").and_then(|w| w.hash(true)).unwrap_or_default()
}

mod guide;

fn autopilot_rules(
    rules: manifest_core::navigation::line_pilot::AutopilotRules,
    issues: &mut Issues,
) -> manifest_core::navigation::line_pilot::AutopilotRules {
    for (field, problem) in rules.problems() {
        issues.push("rules.toml", format!("autopilot.{field}"), problem);
    }
    rules
}

/// E03：交叉引用在地点、发现物和怪异都读完后解析；产地必须在补背景到货前确定。
fn link_stage_markets(defs: &mut StaticData, rows: &[(&str, &LocationRaw, LocKind)], issues: &mut Issues) {
    let good_ids: BTreeMap<_, _> =
        defs.goods.iter().enumerate().map(|(i, g)| (g.key.clone(), GoodId::from_idx(i))).collect();
    let discovery_ids: BTreeMap<_, _> =
        defs.discoveries.iter().enumerate().map(|(i, d)| (d.key.clone(), DiscoveryId::from_idx(i))).collect();
    let loc_ids: BTreeMap<_, _> =
        defs.locations.iter().enumerate().map(|(i, l)| (l.key.clone(), LocId::from_idx(i))).collect();
    for (i, (file, row, _)) in rows.iter().enumerate() {
        let mut unlocks = Vec::new();
        for m in &row.market {
            let item = format!("locations[{}].market[{}]", row.key, m.good);
            let Some(&good) = good_ids.get(&m.good) else { continue };
            let conditional = m.unlock_stage.is_some()
                || m.unlock_discovery.is_some()
                || m.unlock_creature.is_some()
                || m.unlock_visited.is_some();
            if conditional && m.supply <= 0 {
                issues.push(file, &item, "开放条件只许写在 supply > 0 的条目上");
            }
            if m.limit.is_some_and(|n| n <= 0 || !defs.good(good).secret || m.supply <= 0) {
                issues.push(file, &item, "limit 必须为正数且只许写在隐秘货的产地条目上");
            }
            if !conditional {
                continue;
            }
            if m.unlock_stage.is_some_and(|stage| !(1..=6).contains(&stage)) {
                issues.push(file, &item, "unlock_stage 必须在 1–6 之间");
            }
            let discovery =
                m.unlock_discovery.as_ref().and_then(|key| lookup(&discovery_ids, key, file, &item, "发现物", issues));
            let creature = m.unlock_creature.as_ref().and_then(|key| {
                if defs.creatures.creature(key).is_some() {
                    Some(key.clone())
                } else {
                    issues.push(file, &item, format!("怪异“{key}”不存在"));
                    None
                }
            });
            let visited = m.unlock_visited.as_ref().and_then(|key| {
                let loc = lookup(&loc_ids, key, file, &item, "港口", issues)?;
                let hidden =
                    defs.geography.places.authored.locations.get(key).is_some_and(|l| l.hidden || l.realm.is_some());
                if !defs.loc(loc).is_port() || !hidden {
                    issues.push(file, &item, "unlock_visited 必须指向带 realm 或 hidden = true 的港口");
                }
                Some(loc)
            });
            unlocks.push(MarketUnlockDef { good, stage: m.unlock_stage, discovery, creature, visited, limit: m.limit });
        }
        defs.locations[i].unlocks = unlocks;
    }
    defs.rare_source = vec![None; defs.goods.len()];
    for (i, good) in defs.goods.iter().enumerate() {
        let item = format!("goods[{}]", good.key);
        if good.rumor.chars().count() > 40 {
            issues.push("goods.toml", &item, "rumor 不得超过 40 字");
        }
        if !good.secret {
            continue;
        }
        if good.license || good.need == Some(NeedTier::Essential) {
            issues.push("goods.toml", &item, "隐秘货不能是许可证货或必需品");
        }
        let id = GoodId::from_idx(i);
        let sources: Vec<_> = defs
            .locations
            .iter()
            .enumerate()
            .filter(|(_, l)| l.market.iter().any(|m| m.good == id && m.supply > 0))
            .collect();
        if sources.len() != 1 {
            issues.push("goods.toml", &item, "隐秘货必须恰好有一处 supply > 0 的产地");
            continue;
        }
        let (li, source) = sources[0];
        if !source.unlocks.iter().any(|u| u.good == id) {
            issues.push("goods.toml", &item, "隐秘货的唯一产地必须带至少一个 unlock_* 条件");
        }
        defs.rare_source[i] = Some(LocId::from_idx(li));
    }
}

/// 外来船系按规则表序号缓存，不依赖运行时集合的迭代顺序。
fn link_foreign_lines(rules: &mut manifest_core::house::ShipyardGrowthRules) {
    let keys: Vec<_> = rules.lines.iter().map(|line| line.key.clone()).collect();
    for line in &mut rules.lines {
        line.foreign_ids =
            keys.iter().enumerate().filter(|(_, key)| line.foreign.contains(key)).map(|(i, _)| i).collect();
    }
}

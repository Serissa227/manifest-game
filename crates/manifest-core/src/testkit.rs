//! 内核单元测试与性质测试使用的小型世界（不读文件，全部在代码中构造）。

use crate::defs::*;
use crate::fixed::{Curve, Fx};
use crate::ids::*;
use crate::nav::{NavTable, SeaMap, Terrain};
use crate::weather::Climate;
use std::sync::Arc;

/// 默认规则参数（与 data/rules.toml 的初始值一致）。
pub fn default_rules() -> Rules {
    let pts = [
        (0, 50_000),
        (1_000, 40_000),
        (2_500, 28_000),
        (5_000, 17_500),
        (7_500, 13_000),
        (10_000, 10_000),
        (12_500, 8_200),
        (15_000, 7_000),
        (20_000, 5_200),
        (30_000, 3_600),
        (40_000, 2_800),
        (60_000, 2_000),
    ];
    Rules {
        quests: Default::default(),
        upbringing: Default::default(),
        attributes: crate::captain::AttributeRules::default(),
        items: crate::items::ItemsRules::default(),
        story: crate::story2::dice::StoryRules::default(),
        ships: Default::default(),
        price_curve: Curve::new(pts.iter().map(|(x, y)| (Fx(*x), Fx(*y))).collect()),
        price_floor: Fx::from_pct(20),
        price_cap: Fx::from_int(5),
        target_stock_days: 30,
        production_noise_bp: 1_000,
        popular_bonus: Fx::from_pct(50),
        popular_days: 30,
        seasonal_popular_bp: 40,
        price_history_days: 60,
        price_history_months: 36,
        crew_wage: 2,
        crew_hire_cost: 30,
        food_price: 3,
        water_price: 1,
        crew_per_supply_unit: 20,
        fractional_supplies: false,
        repair_cost_per_point: 20,
        ship_resale: Fx::from_pct(50),
        disease_bp_per_30_days: 20,
        starvation_loss: Fx::from_pct(3),
        starvation_morale: 5,
        morale_decay_after: 25,
        mutiny_morale: 15,
        npc: NpcRules {
            min_margin: Fx::from_pct(8),
            max_fleets: 4,
            expand_cash_multiple: Fx::from_int(3),
            supply_margin_days: 5,
            repair_below: Fx::from_pct(70),
            max_stock_share: Fx::from_pct(40),
            invest_above: 400_000,
            invest_share: Fx::from_pct(5),
            industry_above: 150_000,
            futures_momentum: Fx::from_pct(8),
            v2: CommerceRules::default(),
        },
        insolvency_days: 30,
        warehouse: WarehouseRules {
            rent_per_100: 5,
            price_per_unit: 40,
            demurrage_per_100: 20,
            ally_free_capacity: 200,
        },
        caravan: CaravanRules { guard_wage: 3, guard_hire_cost: 40, robbery_bp: 80, resale: Fx::from_pct(50) },
        contracts: ContractRules {
            per_faction_per_month: 2,
            reward_factor: Fx::from_pct(40),
            penalty_share: Fx::from_pct(50),
            reputation_gain: 5,
            reputation_loss: 10,
            deliver_to_market: false,
            v2: Default::default(),
        },
        invest: InvestRules {
            cost_per_point: 5_000,
            min_amount: 1_000,
            ally_share: Fx::from_pct(40),
            ally_tax: Fx::from_pct(50),
            ally_specialty_discount: Fx::from_pct(5),
            decay_months: 1,
        },
        bank: BankRules {
            deposit_rate: Fx::from_pct(3),
            loan_base_rate: Fx::from_pct(8),
            loan_risk_premium: Fx::from_pct(12),
            max_term_months: 24,
            overdue_penalty: Fx::from_pct(50),
        },
        diplomacy: DiplomacyRules {
            incident_bp: 50,
            tension_below: -30,
            peace_above: -10,
            war_below: -70,
            war_min_tension_days: 60,
            war_min_days: 180,
            truce_days: 180,
            war_tax: Fx::from_pct(150),
            license_reputation: 10,
        },
        mates: MateRules {
            xp_per_level: 30,
            level_gain: 2,
            salary_growth: Fx::from_pct(10),
            max_level: 10,
            loyalty_paid: 2,
            loyalty_unpaid: 10,
            leave_below: 20,
        },
        pirates: PirateRules {
            ships: vec![ShipTypeId(0)],
            spawn_scale: Fx::from_int(20),
            max_per_region: 2,
            lifetime: (20, 40),
            fleet_size: (1, 2),
            sight: 6,
            speed: 2,
            crew_ratio: Fx::from_pct(80),
        },
        battle: BattleRules {
            evade_max: Fx::from_pct(30),
            cargo_loss_pct: (20, 50),
            tribute_pct: (2, 6),
            tactical_radius: 5,
            gun_range: 3,
            max_turns: 30,
            reputation_win: 2,
        },
        explore: ExploreRules { sight: 5, chart_base: 300, chart_per_100_cells: 50 },
        world: WorldRules::default(),
        colony: ColonyRules {
            min_settlers: 10,
            found_cost: 3_000,
            // 建立物资：40 件粮食（grain 为 0 号商品）
            found_materials: vec![(GoodId(0), 40)],
            found_consume: Fx::from_pct(50),
            found_fame: 10,
            base_capacity: 400,
            base_housing: 60,
            food_category: "粮食".into(),
            food_per_100: 10,
            growth_bp: 300,
            immigration_per_morale: 2,
            starve_loss_bp: 200,
            tax_per_100: 200,
            tax_levels: vec![(0, 10), (50, 5), (100, 0), (150, -10), (200, -20)],
            default_tax: 1,
            // 布（1 号商品）每百人每月 3 件
            morale_goods: vec![(GoodId(1), 3)],
            morale_goods_bonus: 15,
            morale_base: 45,
            start_morale: 60,
            starve_morale: 25,
            raid_morale: 15,
            raid_scale: Fx::from_pct(10),
            raid_cooldown_days: 60,
            raid_loss_pct: (10, 30),
            raid_death_pct: (2, 8),
            disease_bp_per_hazard: 8,
            disease_death_pct: (2, 6),
            claim_chance_bp: 1_500,
            max_claims_per_faction: 2,
            // 小型世界不限开局保护期、距离、年代与冷却，只看概率与上限
            claim_start_day: 0,
            claim_reach: 0,
            claim_slot_years: 0,
            claim_decay_pct: 0,
            claim_cooldown_days: 0,
            max_colonies_per_owner: 3,
            max_defense_pct: 80,
        },
        discovery: DiscoveryRules::default(),
        weather: crate::weather::WeatherRules::default(),
        // 小型世界默认不开本地生产者：原有测试的结果与 E3 之前一致（E3 的测试另行打开）
        producers: ProducerRules::default(),
        // 第八批 E4 的规则缺省都关（与 E3 逐日一致）；各测试按需打开
        population: PopulationRules::default(),
        workshops: WorkshopRules::default(),
        provisions: ProvisionRules::default(),
        merchants: MerchantRules::default(),
        info: InfoRules::default(),
        policies: PolicyRules::default(),
        money: crate::defs::MoneyRules::default(),
        // 开放市场缺省关（原有测试照旧：清单以外的商品不能买卖）；开放市场的测试另行打开
        open_market: OpenMarketRules::default(),
        // 事件节奏的闸缺省关；闸的测试另行打开
        pacing: crate::defs::PacingRules::default(),
        access: crate::defs::AccessRules::default(),
        voyage_posts: crate::seafaring::PostsRules::default(),
        voyage_wear: crate::seafaring::WearRules::default(),
        shore_tasks: crate::seafaring::ShoreRules::default(),
        weather_cells: Default::default(),
        pursuit: Default::default(),
        sightings: Default::default(),
        hail: Default::default(),
        voyage_log: Default::default(),
        banter: Default::default(),
        depth_curve: None,
        routing: Default::default(),
        // T02 的三张规则表缺省都关；各自的测试另行打开
        dividends: Default::default(),
        shipyard_growth: Default::default(),
        npc_invest: Default::default(),
        agency: Default::default(),
        skill_effects: Default::default(),
        development: Default::default(),
        trade_books: Default::default(),
        autopilot: Default::default(),
        stage_unlocks: Default::default(),
        rare: Default::default(),
    }
}

fn weather(wind_dir: u8, storm_bp: i64, pirate_bp: i64) -> SeasonWeather {
    SeasonWeather { wind_dir, wind_strength: 5, current_dir: 2, current_strength: 1, storm_bp, pirate_bp }
}

fn good(key: &str, base: i64, tier: u8) -> GoodDef {
    GoodDef {
        key: key.into(),
        name: key.into(),
        category: "测试".into(),
        tier,
        base_price: base,
        season_demand: [Fx::ONE; 4],
        season_supply: [Fx::ONE; 4],
        license: false,
        description: String::new(),
        crop: false,
        need: None,
        group: None,
        rank: 0,
        secret: false,
        rumor: String::new(),
    }
}

fn market(good: u16, supply: i64, demand: i64) -> MarketDef {
    MarketDef { good: GoodId(good), supply, demand, specialty: supply > demand }
}

/// 构造一个 40×24 的小世界：中央一座岛，三个港口，四种商品，两种船，两家商会。
pub fn tiny_defs() -> Arc<StaticData> {
    let (w, h) = (40u16, 24u16);
    let n = w as usize * h as usize;
    let mut terrain = vec![Terrain::Deep; n];
    let mut region = vec![0u16; n];
    for y in 0..h {
        for x in 0..w {
            let i = y as usize * w as usize + x as usize;
            if (15..25).contains(&x) && (8..16).contains(&y) {
                terrain[i] = Terrain::Land;
                region[i] = u16::MAX;
            } else {
                region[i] = if x < 20 { 0 } else { 1 };
            }
        }
    }
    let map = SeaMap { width: w, height: h, wrap_x: false, terrain, region };
    let regions = vec![
        RegionDef {
            key: "west".into(),
            name: "西海".into(),
            rect: (0, 0, 19, 23),
            seasons: [weather(2, 30, 20); 4],
            climate: Climate::Temperate,
        },
        RegionDef {
            key: "east".into(),
            name: "东海".into(),
            rect: (20, 0, 39, 23),
            seasons: [weather(6, 50, 40); 4],
            climate: Climate::Temperate,
        },
    ];
    let mut iron = good("iron", 45, 1);
    iron.license = true;
    let mut grain = good("grain", 12, 0);
    grain.category = "粮食".into();
    let goods = vec![grain, good("cloth", 80, 1), good("spice", 120, 0), iron];
    let ports = [(Cell::new(14, 10), "alpha"), (Cell::new(25, 12), "beta"), (Cell::new(20, 16), "gamma")];
    let markets = [
        vec![market(0, 40, 20), market(1, 6, 12), market(2, 3, 8), market(3, 10, 10)],
        vec![market(0, 15, 30), market(1, 14, 7), market(2, 12, 4), market(3, 6, 12)],
        vec![market(0, 25, 25), market(1, 8, 10), market(2, 5, 6), market(3, 14, 7)],
    ];
    let mut locations: Vec<LocationDef> = ports
        .iter()
        .zip(markets)
        .enumerate()
        .map(|(i, ((cell, key), market))| LocationDef {
            shop: false,
            culture: String::new(),
            size: 3,
            hemisphere: Default::default(),
            key: (*key).into(),
            name: (*key).into(),
            kind: LocKind::Port,
            cell: *cell,
            faction: FactionId(if i == 1 { 1 } else { 0 }),
            development: 50,
            shipyard: vec![ShipTypeId(0), ShipTypeId(1)],
            market,
            founded: Some(1400 + i as i64 * 20),
            lore: String::new(),
            site: None,
            workshops: Vec::new(),
            sells: Vec::new(),
            unlocks: Vec::new(),
        })
        .collect();
    // 岛上的内陆城市，道路连接 alpha 与 beta
    locations.push(LocationDef {
        shop: false,
        culture: String::new(),
        size: 3,
        hemisphere: Default::default(),
        key: "delta".into(),
        name: "delta".into(),
        kind: LocKind::City,
        cell: Cell::new(20, 12),
        faction: FactionId(0),
        development: 50,
        shipyard: Vec::new(),
        market: vec![market(0, 10, 30), market(1, 20, 6), market(2, 3, 9), market(3, 8, 8)],
        founded: None,
        lore: String::new(),
        site: None,
        workshops: Vec::new(),
        sells: Vec::new(),
        unlocks: Vec::new(),
    });
    // 岛北岸的可殖民地点（排在城市之后），产香料
    locations.push(LocationDef {
        shop: false,
        culture: String::new(),
        size: 3,
        hemisphere: Default::default(),
        key: "sigma".into(),
        name: "sigma".into(),
        kind: LocKind::Site,
        cell: Cell::new(19, 7),
        faction: FactionId(0),
        development: 1,
        shipyard: Vec::new(),
        market: Vec::new(),
        founded: None,
        lore: "测试用殖民点".into(),
        site: Some(SiteDef {
            terrain: SiteTerrain::Forest,
            fertility: 80,
            hazard: 30,
            resources: vec![(GoodId(2), 70), (GoodId(0), 50)],
        }),
        workshops: Vec::new(),
        sells: Vec::new(),
        unlocks: Vec::new(),
    });
    let ships = vec![
        ShipTypeDef {
            key: "sloop".into(),
            name: "sloop".into(),
            sail: SailType::Lateen,
            speed: Fx::from_int(6),
            capacity: 120,
            durability: 60,
            crew_min: 8,
            crew_max: 24,
            guns: 4,
            price: 6_000,
            description: String::new(),
            unique: false,
        },
        ShipTypeDef {
            key: "hauler".into(),
            name: "hauler".into(),
            sail: SailType::Square,
            speed: Fx::from_int(5),
            capacity: 300,
            durability: 100,
            crew_min: 16,
            crew_max: 40,
            guns: 8,
            price: 15_000,
            description: String::new(),
            unique: false,
        },
    ];
    let refits = vec![RefitDef {
        key: "hold".into(),
        name: "hold".into(),
        price: 2_000,
        capacity: 30,
        durability: 0,
        guns: 0,
        speed: Fx::ZERO,
    }];
    let factions = vec![
        FactionDef {
            key: "crown".into(),
            name: "crown".into(),
            tax: Fx::from_pct(5),
            license_price: 5_000,
            marque_price: 8_000,
            style: Some("mediterranean".into()),
            color: Some("#c0392b".into()),
        },
        FactionDef {
            key: "league".into(),
            name: "league".into(),
            tax: Fx::from_pct(6),
            license_price: 5_000,
            marque_price: 8_000,
            style: None,
            color: None,
        },
    ];
    let relations = vec![RelationDef { a: FactionId(0), b: FactionId(1), value: -20 }];
    let animals = vec![AnimalDef {
        key: "mule".into(),
        name: "mule".into(),
        capacity: 5,
        speed: Fx::from_int(8),
        price: 300,
        upkeep: 2,
        desert: Fx::ONE,
    }];
    let road = |key: &str, from: u16, to: u16| RoadDef {
        key: key.into(),
        from: LocId(from),
        to: LocId(to),
        length: Fx::from_int(8),
        terrain: RoadTerrain::Hill,
        security: Fx::from_pct(70),
        faction: FactionId(0),
        toll: Fx::from_pct(2),
    };
    let roads = vec![road("alpha_delta", 0, 3), road("delta_beta", 3, 1)];
    let industry_types = vec![IndustryTypeDef {
        key: "farm".into(),
        name: "farm".into(),
        build_cost: 10_000,
        workers: 5,
        wage: 2,
        maintenance: 5,
        manager_salary: 10,
    }];
    let recipes = vec![
        RecipeDef {
            key: "grow".into(),
            name: "grow".into(),
            industry: IndustryTypeId(0),
            inputs: vec![],
            outputs: vec![(GoodId(0), 8)],
        },
        RecipeDef {
            key: "weave".into(),
            name: "weave".into(),
            industry: IndustryTypeId(0),
            inputs: vec![(GoodId(0), 6)],
            outputs: vec![(GoodId(1), 1)],
        },
    ];
    let exchanges = vec![ExchangeDef {
        key: "alpha_ex".into(),
        name: "alpha_ex".into(),
        port: LocId(0),
        initial_margin: Fx::from_pct(15),
        maintenance_margin: Fx::from_pct(10),
        spread: Fx::from_pct(2),
        carry_per_month: Fx::from_pct(1),
        impact_per_lot: Fx::from_bp(20),
        position_limit: 50,
        penalty: Fx::from_pct(120),
        house_capital: 500_000,
    }];
    let futures_specs = vec![
        FuturesSpecDef {
            key: "grain_f".into(),
            exchange: ExchangeId(0),
            good: GoodId(0),
            lot: 20,
            delivery: LocId(0),
            tick: 1,
        },
        FuturesSpecDef {
            key: "cloth_f".into(),
            exchange: ExchangeId(0),
            good: GoodId(1),
            lot: 5,
            delivery: LocId(0),
            tick: 1,
        },
    ];
    let companies = vec![
        CompanyDef {
            key: "gull".into(),
            name: "gull".into(),
            home: LocId(0),
            cash: 30_000,
            ships: vec![ShipTypeId(1)],
            preferred: vec![GoodId(2)],
            risk: Fx::from_pct(60),
            forecast: ForecastMethod::Naive,
            reaction: Reaction::Neutral,
            persona: String::new(),
        },
        CompanyDef {
            key: "anchor".into(),
            name: "anchor".into(),
            home: LocId(1),
            cash: 25_000,
            ships: vec![ShipTypeId(0)],
            preferred: vec![GoodId(1)],
            risk: Fx::from_pct(50),
            forecast: ForecastMethod::Naive,
            reaction: Reaction::Neutral,
            persona: String::new(),
        },
    ];
    let scenarios = vec![ScenarioDef {
        key: "test".into(),
        name: "test".into(),
        description: String::new(),
        start: LocId(0),
        start_loc: LocId(0),
        start_date: [1502, 1, 1],
        control_date: [1502, 1, 1],
        protagonists: Vec::new(),
        templates: Vec::new(),
        upbringing: false,
        timeline: None,
        protagonist_defs: Vec::new(),
        template_defs: Vec::new(),
        cash: 60_000,
        ships: vec![ShipTypeId(0)],
        crew: 12,
        mates: vec![MateId(0)],
        reputation: vec![(FactionId(0), 5)],
        goal: Goal { kind: GoalKind::NetWorth(1_000_000), deadline: Some(3_600) },
        max_reorganizations: 3,
        cargo: Vec::new(),
        food: 0,
        water: 0,
        recommended: false,
        story: None,
        hero: None,
    }];
    let mate = |key: &str, home: u16, nav: i64, trade: i64, combat: i64, mgmt: i64| MateDef {
        abilities: std::collections::BTreeMap::new(),
        key: key.into(),
        name: key.into(),
        bio: "测试用航海士".into(),
        home: LocId(home),
        navigation: nav,
        trade,
        combat,
        management: mgmt,
        level: 1,
        salary: 300,
        hire_cost: 800,
        loyalty: 60,
        hidden: false,
        methods: Vec::new(),
    };
    let mates = vec![
        mate("navigator", 0, 70, 20, 40, 20),
        mate("trader", 0, 20, 70, 10, 40),
        mate("fighter", 1, 40, 10, 80, 20),
        mate("steward", 1, 20, 30, 10, 75),
    ];
    let ev = |key: &str, effect: EffectKind| EventTypeDef {
        key: key.into(),
        name: key.into(),
        description: String::new(),
        effect,
        cooldown_days: 30,
        max_per_year: 3,
        requires: EventRequire::None,
        goods: Vec::new(),
        mult: None,
        days: None,
        delta: None,
        port_only: false,
        locs: Vec::new(),
        regions: Vec::new(),
        factions: Vec::new(),
    };
    let events = vec![
        EventTypeDef {
            mult: Some((Fx::from_pct(120), Fx::from_pct(160))),
            days: Some((20, 60)),
            ..ev("harvest", EffectKind::GoodSupply)
        },
        EventTypeDef {
            mult: Some((Fx::from_pct(150), Fx::from_int(3))),
            days: Some((20, 60)),
            ..ev("storms", EffectKind::RegionStorm)
        },
        EventTypeDef { delta: Some((-30, -5)), ..ev("incident", EffectKind::RelationShift) },
        EventTypeDef {
            delta: Some((-40, -20)),
            requires: EventRequire::Tension,
            ..ev("war_talk", EffectKind::RelationShift)
        },
        EventTypeDef {
            mult: Some((Fx::from_pct(110), Fx::from_pct(140))),
            days: Some((10, 30)),
            port_only: true,
            ..ev("festival", EffectKind::LocationDemand)
        },
    ];
    let colony_buildings = tiny_colony_buildings();
    let discoveries = vec![
        DiscoveryDef {
            key: "old_wreck".into(),
            name: "old_wreck".into(),
            cell: Cell::new(13, 16),
            kind: DiscoveryKind::Wreck,
            fame: 30,
            value: 2_000,
            lore: String::new(),
        },
        DiscoveryDef {
            key: "sky_arch".into(),
            name: "sky_arch".into(),
            cell: Cell::new(35, 3),
            kind: DiscoveryKind::Landmark,
            fame: 20,
            value: 1_000,
            lore: String::new(),
        },
    ];
    let port_cells: Vec<(LocId, Cell)> =
        locations.iter().enumerate().filter(|(_, l)| l.is_port()).map(|(i, l)| (LocId::from_idx(i), l.cell)).collect();
    let nav = NavTable::build(&map, &regions, locations.len(), &port_cells);
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
        attributes: Vec::new(),
        roles: Vec::new(),
        scenarios: scenarios.iter().map(|g| g.key.clone()).collect(),
        refits: refits.iter().map(|g| g.key.clone()).collect(),
    };
    Arc::new(StaticData {
        guide: Default::default(),
        world_key: "classic".into(),
        world_name: "经典海域".into(),
        map_key: "classic".into(),
        calendar: crate::calendar::Calendar::default(),
        meta: DataMeta { hash: "testkit".into(), keys },
        loc_order: Default::default(),
        rules: default_rules(),
        map,
        fine_coast: None,
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
        geography: Default::default(),
        nav: Arc::new(nav),
        composed: composed_rules(),
        captain: crate::captain::CaptainDefs::default(),
        stories: crate::story::StoryDefs::default(),
        items: crate::items::ItemsDefs::default(),
        auctions: crate::auction::AuctionDefs::default(),
        cast: crate::cast::CastDefs::default(),
        story2: Default::default(),
        manual_navigation: false,
        navigation: Default::default(),
        history: Default::default(),
        ideas: Default::default(),
        societies: Default::default(),
        legend_ships: Default::default(),
        realms: Default::default(),
        lineages: Default::default(),
        creatures: Default::default(),
        arcana: Default::default(),
        upbringing: Default::default(),
        good_sources: Vec::new(),
        trade_dist: Vec::new(),
        rare_source: Vec::new(),
    })
}

/// 小型世界的主角身世（测试用，ECONOMY.md 第 5 节）：点数规则与 `data/captain.toml` 相同；星座与数据文件一样——
/// 十二个旧版星宫在前（只为旧存档保留，提灯座带特性），按现实日期划分的十二星座追加在后（首日相同、加点相同，摩羯座带特性）；
/// 三道问题的选项覆盖全部八种开局效果（家世：资金 +10% / 声望 +8 / 东海海图 / 无效果；少年：士气 / 名声 / 资金 −10%；
/// 出海：贷款 / 传闻 / 货物 / 声望 −5）。航海士 navigator（开局即在麾下）是算学奇才，会递减权重均价与最小二乘直线。
pub fn captain_defs() -> Arc<StaticData> {
    use crate::captain::*;
    let mut d = (*tiny_defs()).clone();
    // 旧版星宫：原先按出生月份 1–12 依次判定
    let legacy = [
        ("petrel", ELOQUENCE),
        ("quill", NUMERACY),
        ("anchor", STEWARDSHIP),
        ("compass", SEAMANSHIP),
        ("purse", COMMERCE),
        ("cutlass", ARMS),
        ("astrolabe", NUMERACY),
        ("merchantman", COMMERCE),
        ("hive", STEWARDSHIP),
        ("horn", ARMS),
        ("lighthouse", SEAMANSHIP),
        ("lantern", ELOQUENCE),
    ];
    // 现行的十二星座：首日（月、日），到下一个星座首日的前一天为止
    let zodiac = [
        ("aries", 3, 21, ARMS),
        ("taurus", 4, 20, COMMERCE),
        ("gemini", 5, 21, ELOQUENCE),
        ("cancer", 6, 22, STEWARDSHIP),
        ("leo", 7, 23, ELOQUENCE),
        ("virgo", 8, 23, NUMERACY),
        ("libra", 9, 23, COMMERCE),
        ("scorpio", 10, 24, ARMS),
        ("sagittarius", 11, 23, SEAMANSHIP),
        ("capricorn", 12, 22, STEWARDSHIP),
        ("aquarius", 1, 20, NUMERACY),
        ("pisces", 2, 19, SEAMANSHIP),
    ];
    let sign = |key: &str, attribute: usize, start: Option<MonthDay>| SignDef {
        key: key.into(),
        name: key.into(),
        desc: String::new(),
        attribute,
        start,
    };
    let signs: Vec<SignDef> = legacy
        .iter()
        .map(|(key, attribute)| sign(key, *attribute, None))
        .chain(
            zodiac.iter().map(|(key, month, day, attribute)| sign(key, *attribute, Some(MonthDay::new(*month, *day)))),
        )
        .collect();
    let o = |key: &str, question: usize, attrs: [i64; 6], effect: Option<StartEffect>| OptionDef {
        key: key.into(),
        question,
        name: key.into(),
        text: String::new(),
        attrs: attrs.to_vec(),
        effect,
        hero: None,
    };
    d.captain = CaptainDefs {
        points: CaptainPoints {
            base: 1,
            free: 5,
            creation_cap: 7,
            max: 10,
            genius_numeracy: 7,
            manual_numeracy: 4,
            learn_numeracy: 5,
            learn_days: 360,
            age_min: 16,
            age_max: 45,
            age_default: 18,
            birthday_morale: 5,
        },
        attributes: ATTRIBUTES
            .iter()
            .map(|k| AttributeDef {
                key: (*k).into(),
                name: (*k).into(),
                desc: String::new(),
                group: "classic".into(),
                hidden: false,
                hooks: crate::captain::classic_hooks(k),
            })
            .collect(),
        signs,
        questions: ["family", "youth", "motive"]
            .iter()
            .map(|k| QuestionDef { key: (*k).into(), title: (*k).into(), prompt: String::new() })
            .collect(),
        options: vec![
            o("merchant", 0, [0, 2, 0, 0, 0, 0], Some(StartEffect::CashPct(10))),
            o("noble", 0, [0, 0, 0, 1, 0, 1], Some(StartEffect::Reputation(8))),
            o("scribes", 0, [0, 0, 0, 0, 2, 0], Some(StartEffect::Chart(RegionId(1)))),
            o("plain", 0, [0, 0, 0, 0, 0, 0], None),
            o("cadet", 1, [1, 0, 1, 0, 0, 0], Some(StartEffect::Morale(10))),
            o("expedition", 1, [1, 0, 0, 0, 0, 1], Some(StartEffect::Fame(10))),
            o("gambler", 1, [0, 1, 0, 0, 1, 0], Some(StartEffect::CashPct(-10))),
            o("university", 1, [0, 0, 0, 0, 2, 0], None),
            o("debt", 2, [0, 0, 0, 1, 0, 0], Some(StartEffect::Loan { amount: 8_000, months: 12 })),
            o("relative", 2, [1, 0, 0, 0, 0, 0], Some(StartEffect::Rumor)),
            o("caravan", 2, [0, 1, 0, 0, 0, 0], Some(StartEffect::Goods(GoodId(2), 12))),
            o("privateer", 2, [0, 0, 2, 0, 0, 0], Some(StartEffect::Reputation(-5))),
        ],
        ..CaptainDefs::default()
    };
    d.captain.groups = vec![crate::captain::AttributeGroup::classic(&d.captain.points)];
    d.mates[0].methods = vec!["ses".into(), "linear".into()];
    d.meta.hash = "testkit-captain".into();
    Arc::new(d)
}

/// 小型世界的扩充版（测试用）：追加古籍、珍珠、丝绸、火药四种商品（在 alpha 港出售）、
/// 两种独有船型与三处古代遗迹。
pub fn ruins_defs() -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    // 商品 4–7：古籍、珍珠、丝绸、火药
    let first_new = d.goods.len() as u16;
    for (key, price) in [("books", 300), ("pearl", 300), ("silk", 260), ("gunpowder", 140)] {
        d.goods.push(good(key, price, 1));
    }
    for g in first_new..first_new + 4 {
        d.locations[0].market.push(market(g, 20, 20));
    }
    // 船型 2–3：两种独有船型
    let unique =
        |key: &str, speed: i64, capacity: i64, durability: i64, crew_min: i64, crew_max: i64, guns: i64| ShipTypeDef {
            key: key.into(),
            name: key.into(),
            sail: SailType::Square,
            speed: Fx::from_int(speed),
            capacity,
            durability,
            crew_min,
            crew_max,
            guns,
            price: 90_000,
            description: String::new(),
            unique: true,
        };
    d.ships.push(unique("unique_escort", 8, 150, 120, 10, 40, 16));
    d.ships.push(unique("unique_flagship", 7, 300, 260, 30, 120, 50));
    // 三处古代遗迹
    for (i, cell) in [Cell::new(3, 3), Cell::new(36, 20), Cell::new(3, 20)].into_iter().enumerate() {
        d.discoveries.push(DiscoveryDef {
            key: format!("ruin_{i}"),
            name: format!("ruin_{i}"),
            cell,
            kind: DiscoveryKind::Ruins,
            fame: 25,
            value: 1_000,
            lore: String::new(),
        });
    }
    let k = &mut d.meta.keys;
    k.goods = d.goods.iter().map(|g| g.key.clone()).collect();
    k.ships = d.ships.iter().map(|g| g.key.clone()).collect();
    k.discoveries = d.discoveries.iter().map(|g| g.key.clone()).collect();
    d.meta.hash = "testkit-ruins".into();
    Arc::new(d)
}

/// 测试用的殖民地建筑（key 与 EXPANSION.md §4.1 的顺序一致，取其中几种）。
fn tiny_colony_buildings() -> Vec<ColonyBuildingDef> {
    let b = |key: &str, kind: BuildingKind, cost: i64| ColonyBuildingDef {
        key: key.into(),
        name: key.into(),
        kind,
        cost,
        materials: Vec::new(),
        build_days: 5,
        workers: 0,
        upkeep: 20,
        max_level: 3,
        goods: Vec::new(),
        output: 0,
        inputs: Vec::new(),
        outputs: Vec::new(),
        capacity: 0,
        defense: 0,
        morale: 0,
        housing: 0,
        description: String::new(),
    };
    vec![
        // 农庄：粮食（grain），每级每天 12 件 × 肥力
        ColonyBuildingDef { goods: vec![GoodId(0)], output: 12, workers: 10, ..b("farm", BuildingKind::Food, 1_500) },
        // 种植园：香料（spice），需要 5 件布作建材
        ColonyBuildingDef {
            goods: vec![GoodId(2)],
            output: 6,
            workers: 10,
            materials: vec![(GoodId(1), 5)],
            ..b("plantation", BuildingKind::Extract, 2_000)
        },
        // 酿酒坊（此处用作加工示例）：6 粮 → 1 布
        ColonyBuildingDef {
            inputs: vec![(GoodId(0), 6)],
            outputs: vec![(GoodId(1), 1)],
            workers: 5,
            ..b("distillery", BuildingKind::Process, 1_000)
        },
        ColonyBuildingDef { capacity: 300, ..b("storehouse", BuildingKind::Storage, 800) },
        ColonyBuildingDef { defense: 25, ..b("fort", BuildingKind::Defense, 2_500) },
        ColonyBuildingDef { morale: 10, ..b("chapel", BuildingKind::Morale, 1_200) },
        b("dock", BuildingKind::Dock, 1_500),
        ColonyBuildingDef { housing: 100, ..b("housing", BuildingKind::Housing, 1_000) },
    ]
}

/// 测试用的组合事件规则：全部效果都在词表中，边界宽松。
pub fn composed_rules() -> crate::composed::ComposedRules {
    use crate::composed::{ComposedRules, EffectBounds};
    let effects = EffectKind::ALL
        .iter()
        .map(|&k| EffectBounds {
            effect: k,
            name: k.key().into(),
            description: String::new(),
            mult: k.needs_mult().then_some((Fx::from_pct(50), Fx::from_pct(200))),
            days: k.needs_days().then_some((5, 90)),
            delta: k.needs_delta().then_some((-20, 20)),
            port_only: k == EffectKind::Development,
            peace_delta: (k == EffectKind::RelationShift).then_some((-10, 20)),
        })
        .collect();
    ComposedRules {
        max_effects: 3,
        cooldown_days: 10,
        max_per_year: 12,
        repeat_days: 60,
        budget: Fx::from_pct(120),
        max_title_chars: 24,
        max_text_chars: 240,
        colony_grace_days: 30,
        effects,
    }
}

/// 检查世界的全部不变量；违反时返回可读描述。
///
/// - 每个账本试算平衡且满足会计恒等式；
/// - 账本现金 = 实际现金；账本存货 = 存货簿总成本；存货簿数量 = 实际持有数量；
/// - 货币守恒：当前总量 = 初始总量 + Σ来源 − Σ去向；
/// - 库存、船货、粮水非负；价格不低于下限。
pub fn check_invariants(world: &crate::world::World) -> Result<(), String> {
    use crate::ledger::Account;
    use std::collections::BTreeMap;
    let defs = &world.defs;
    let day = world.day();
    for (owner, a) in &world.state.agents {
        if !a.ledger.is_balanced() {
            return Err(format!("第 {day} 天：{owner:?} 账本借贷不平衡"));
        }
        if !a.ledger.identity_holds() {
            return Err(format!("第 {day} 天：{owner:?} 会计恒等式不成立"));
        }
        if a.ledger.balance(Account::Cash) != a.cash {
            return Err(format!(
                "第 {day} 天：{owner:?} 账本现金 {} ≠ 实际现金 {}",
                a.ledger.balance(Account::Cash),
                a.cash
            ));
        }
        if a.ledger.balance(Account::Inventory) != a.book.total_cost() {
            return Err(format!(
                "第 {day} 天：{owner:?} 账本存货 {} ≠ 存货簿 {}",
                a.ledger.balance(Account::Inventory),
                a.book.total_cost()
            ));
        }
        let margin: i64 = world.state.futures.margin.get(owner).map(|m| m.values().sum()).unwrap_or(0);
        if a.ledger.balance(Account::MarginDeposits) != margin {
            return Err(format!(
                "第 {day} 天：{owner:?} 账本保证金 {} ≠ 保证金账户 {margin}",
                a.ledger.balance(Account::MarginDeposits)
            ));
        }
        if a.ledger.balance(Account::BankDeposits) != a.deposit {
            return Err(format!(
                "第 {day} 天：{owner:?} 账本存款 {} ≠ 存款 {}",
                a.ledger.balance(Account::BankDeposits),
                a.deposit
            ));
        }
        if -a.ledger.balance(Account::Loans) != world.loan_total(*owner) {
            return Err(format!(
                "第 {day} 天：{owner:?} 账本贷款 {} ≠ 贷款合计 {}",
                -a.ledger.balance(Account::Loans),
                world.loan_total(*owner)
            ));
        }
        let mut held: BTreeMap<GoodId, i64> = BTreeMap::new();
        for f in world.fleets_of(*owner) {
            for (g, q) in &f.cargo {
                *held.entry(*g).or_insert(0) += q;
            }
        }
        for c in world.caravans_of(*owner) {
            for (g, q) in &c.cargo {
                *held.entry(*g).or_insert(0) += q;
            }
        }
        for ls in &world.state.locations {
            if let Some(w) = ls.warehouses.get(owner) {
                for (g, q) in &w.stock {
                    if *q < 0 {
                        return Err(format!("第 {day} 天：{owner:?} 仓库存量为负"));
                    }
                    *held.entry(*g).or_insert(0) += q;
                }
            }
        }
        for (g, lot) in &a.book.goods {
            if held.get(g).copied().unwrap_or(0) != lot.qty {
                return Err(format!("第 {day} 天：{owner:?} 商品 {g:?} 存货簿 {} ≠ 实际 {:?}", lot.qty, held.get(g)));
            }
            if lot.qty < 0 || lot.cost < 0 {
                return Err(format!("第 {day} 天：{owner:?} 存货簿出现负数"));
            }
        }
        for (g, q) in &held {
            if *q != 0 && a.book.qty(*g) != *q {
                return Err(format!("第 {day} 天：{owner:?} 商品 {g:?} 实际持有 {q} 未记入存货簿"));
            }
        }
    }
    if !world.money_conserved() {
        return Err(format!(
            "第 {day} 天：货币不守恒：当前 {}，按记录应为 {}",
            world.total_money(),
            world.state.money.expected_total()
        ));
    }
    for (li, ls) in world.state.locations.iter().enumerate() {
        for (g, e) in &ls.market {
            if e.stock < 0 {
                return Err(format!("第 {day} 天：地点 {li} 商品 {g:?} 库存为负"));
            }
            let floor = defs.rules.price_floor.apply(e.base_price).max(1);
            if e.price < floor {
                return Err(format!("第 {day} 天：地点 {li} 商品 {g:?} 价格 {} 低于下限 {floor}", e.price));
            }
        }
    }
    for f in world.state.fleets.values() {
        if f.food < 0 || f.water < 0 || f.crew < 0 {
            return Err(format!("第 {day} 天：舰队 {:?} 粮水或船员为负", f.id));
        }
        if f.cargo.values().any(|q| *q < 0) {
            return Err(format!("第 {day} 天：舰队 {:?} 船货为负", f.id));
        }
        // 航行中的舰队：所在格与剩余航路都是界内海格（EXPANSION §10.2 的读档修正保证地图重做后仍成立）
        if let crate::world::FleetLocation::AtSea(crate::world::Voyage::Route(v)) = &f.location
            && let Some(bad) = v.path.get(v.step..).unwrap_or(&[]).iter().find(|c| !defs.map.is_sea_in_bounds(**c))
        {
            return Err(format!("第 {day} 天：舰队 {:?} 的航路经过非海格 ({}, {})", f.id, bad.x, bad.y));
        }
    }
    world.validate_navigation_snapshot().map_err(|e| e.to_string())?;
    for f in world.state.fleets.values() {
        if let crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { manual }) = &f.location
            && !defs.map.is_sea_in_bounds(manual.pos.cell())
        {
            return Err(format!("舰队 {:?} 的手动航行位置不是海格", f.id));
        }
        // 有细海岸的世界：手动航行的船位还必须落在细层的水里
        if let crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { manual }) = &f.location
            && defs.fine_coast.as_deref().is_some_and(|fine| !fine.water_at(manual.pos.x, manual.pos.y))
        {
            return Err(format!("舰队 {:?} 的手动航行位置压在细海岸的陆上", f.id));
        }
    }
    for p in world.state.battles.pirates.values() {
        if !defs.map.is_sea_in_bounds(p.cell) {
            return Err(format!("第 {day} 天：海盗舰队 {} 停在非海格 ({}, {})", p.id, p.cell.x, p.cell.y));
        }
    }
    for c in world.state.caravans.values() {
        if c.cargo.values().any(|q| *q < 0) {
            return Err(format!("第 {day} 天：商队 {:?} 货物为负", c.id));
        }
    }
    // 殖民地：人口为正、士气在 0–100、殖民点的归属与殖民地一一对应
    for c in world.state.colonies.values() {
        if c.population <= 0 || !(0..=100).contains(&c.morale) {
            return Err(format!("第 {day} 天：殖民地 {:?} 人口 {} 或士气 {} 越界", c.id, c.population, c.morale));
        }
        if world.claim_of(c.loc) != Some(crate::colony::Claim::Colony(c.id)) || !defs.loc(c.loc).is_site() {
            return Err(format!("第 {day} 天：殖民地 {:?} 与殖民点 {:?} 的归属不一致", c.id, c.loc));
        }
    }
    for (li, ls) in world.state.locations.iter().enumerate() {
        if let Some(crate::colony::Claim::Colony(id)) = ls.claim
            && world.colony(id).is_none_or(|c| c.loc.idx() != li)
        {
            return Err(format!("第 {day} 天：地点 {li} 记录的殖民地 {id:?} 不存在"));
        }
    }
    // 期货：每日盯市盈亏全体（含做市方）合计为零
    for r in &world.state.futures.mtm_log {
        if r.participants + r.house != 0 {
            return Err(format!(
                "第 {} 天：期货盯市合计不为零（参与者 {}，做市方 {}）",
                r.day, r.participants, r.house
            ));
        }
    }
    Ok(())
}

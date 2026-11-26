//! C14：审计真实寰宇的物品来源；剧情专属物逐条注明，不把关键物品放进商店。
use manifest_core::{
    items::ItemDef,
    story2::{ChapterDef, Condition, Effect, ObjectiveKind, TrackDef},
    *,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn defs() -> &'static Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("完整寰宇生产加载"))
}

// 这些来源是初始开放的普通港；不把尚未触发历史解锁或秘境门槛的港口算作供货点。
fn open_port(d: &StaticData, id: LocId) -> bool {
    let loc = d.loc(id);
    loc.is_port()
        && d.geography.places.authored.locations.get(&loc.key).is_some_and(|p| p.dormant.is_none() && p.realm.is_none())
}

fn shop_ports(d: &StaticData, item: &ItemDef, year: i64) -> Vec<LocId> {
    let Some(rule) = &item.shop else { return Vec::new() };
    if item.protected()
        || rule.weight <= 0
        || item.published.as_ref().is_some_and(|(y, _)| *y > year)
        || (!rule.seasons.is_empty() && !rule.seasons.iter().any(|s| *s < 4))
    {
        return Vec::new();
    }
    d.locations
        .iter()
        .enumerate()
        .filter(|(i, l)| {
            open_port(d, LocId::from_idx(*i))
                && l.shop
                && l.size >= rule.min_size
                && (rule.cultures.is_empty() || rule.cultures.contains(&l.culture))
        })
        .map(|(i, _)| LocId::from_idx(i))
        .collect()
}

fn public_source(d: &StaticData, key: &str, year: i64) -> bool {
    let item = d.items.item(key).expect("引用必须是已定义物品");
    !shop_ports(d, item, year).is_empty()
        || d.auctions.auctions.iter().any(|a| {
            open_port(d, a.port)
                && a.lots.iter().any(|l| {
                    l.item == key
                        && l.weight > 0
                        && l.from.is_none_or(|from| from <= year)
                        && item.published.as_ref().is_none_or(|(published, _)| *published <= year)
                })
        })
}

struct StoryOnly {
    item: &'static str,
    track: &'static str,
    chapter: &'static str,
    reason: &'static str,
    pending_c13: bool,
}

// C13 九项已只读核对 c13-integrate@78435304，发放者尚未随 main 合入。
// 名单只豁免购买要求；合入后同一测试立即核验指定章节真实发放，不能默默丢失奖励。
const STORY_ONLY: &[StoryOnly] = &[
    StoryOnly {
        item: "leather_bookwrap",
        track: "bond_yun_haeri",
        chapter: "a2",
        reason: "尹海璃养成羁绊先赠书套，出海后的重逢变体检查是否留存",
        pending_c13: false,
    },
    StoryOnly {
        item: "linen_handkerchief",
        track: "bond_elene_urruti",
        chapter: "a2",
        reason: "埃莱内在养成羁绊中赠手帕，可作后续手工原料；结业资产另有赠送",
        pending_c13: false,
    },
    StoryOnly {
        item: "emerald_mark_tides",
        track: "main_mio",
        chapter: "a14_kanju",
        reason: "澪在潮珠章节记录印记，圣物本身不出售",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_genoa",
        track: "main_lieve",
        chapter: "c01_catino",
        reason: "莉芙获准抄录热那亚圣盘，印记由章节发放",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_toledo",
        track: "main_noel",
        chapter: "a08_toledo_mark",
        reason: "诺埃尔在托莱多拓下印记，不买卖圣物",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_cortes",
        track: "main_tariq",
        chapter: "c05_wreck",
        reason: "塔里克在沉船章节取得科尔特斯印记",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_seal",
        track: "main_lin_wandeng",
        chapter: "c02_paper_not_seal",
        reason: "晚灯取得玉玺拓纸，不出售玉玺",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_solomon",
        track: "main_baraka",
        chapter: "b06_two_rubbings",
        reason: "巴拉卡合并两张拓纸取得所罗门印记",
        pending_c13: true,
    },
    StoryOnly {
        item: "emerald_mark_buddha",
        track: "main_kaicili",
        chapter: "a07_buddha",
        reason: "凯奇利记录佛前印记，圣物不转让",
        pending_c13: true,
    },
    StoryOnly {
        item: "majid_hidden_route",
        track: "main_najma",
        chapter: "b04_star_check",
        reason: "纳吉玛校星后取得隐藏航路，是秘境前置",
        pending_c13: true,
    },
    StoryOnly {
        item: "star_crossing_original",
        track: "main_lin_wandeng",
        chapter: "b02_last_page",
        reason: "晚灯由温星槎取得原记，是宝船图前置",
        pending_c13: true,
    },
    // C13 合入以后（2026-11-02）补登：主线读的信物都由章节发放，原先的审计只等着白名单。
    StoryOnly {
        item: "tabula_smaragdina",
        track: "c11_najma_star_key",
        chapter: "read_route",
        reason: "摩卡的星路对读交出醒来的《翠玉录》，十条主线的黑暗之海章都读它；秘境钥匙，不出售",
        pending_c13: false,
    },
    StoryOnly {
        item: "leo_ms",
        track: "free_fez_scholar",
        chapter: "a01_leo",
        reason: "非斯学者把手稿交给自由船长，同一条线后面讲席章用它",
        pending_c13: false,
    },
    StoryOnly {
        item: "kongo_royal_letter",
        track: "main_free_atlantic_europe_b",
        chapter: "b1_offer",
        reason: "罗安达接下刚果王的信，下一章送到里斯本",
        pending_c13: false,
    },
    StoryOnly {
        item: "maya_inheritance_codex",
        track: "main_ix_nikte",
        chapter: "a07_codex",
        reason: "伊希·尼克特在坎佩切藏下祖传抄本，兰达归来与契兰章都读它",
        pending_c13: false,
    },
    StoryOnly {
        item: "commander_journal",
        track: "main_noel",
        chapter: "c05_corvo",
        reason: "诺埃尔在安格拉取得指挥官日志，无敌舰队章读它",
        pending_c13: false,
    },
    StoryOnly {
        item: "divers_witness",
        track: "main_tariq",
        chapter: "c04_diver",
        reason: "塔里克在阿尔及尔雇来潜水人作证，沉船章读它",
        pending_c13: false,
    },
];

fn effects(chapter: &ChapterDef) -> impl Iterator<Item = &Effect> {
    chapter
        .choices
        .iter()
        .flat_map(|c| c.effects.iter().chain(c.fail.iter().flat_map(|b| &b.effects)))
        .chain(chapter.default.iter().chain(&chapter.timeout).flat_map(|b| &b.effects))
}

fn next_chapters(chapter: &ChapterDef) -> impl Iterator<Item = &str> {
    chapter
        .choices
        .iter()
        .flat_map(|c| std::iter::once(c.next.as_str()).chain(c.fail.iter().map(|b| b.next.as_str())))
        .chain(chapter.default.iter().chain(&chapter.timeout).map(|b| b.next.as_str()))
}

fn reaches(track: &TrackDef, from: &str, to: &str) -> bool {
    let mut pending = vec![from];
    let mut seen = BTreeSet::new();
    while let Some(key) = pending.pop() {
        if key == to {
            return true;
        }
        if seen.insert(key)
            && let Some(chapter) = track.chapter(key)
        {
            pending.extend(next_chapters(chapter));
        }
    }
    false
}

fn gives(chapter: &ChapterDef, key: &str, quantity: i64) -> bool {
    effects(chapter).any(|e| matches!(e, Effect::Item { item, qty } if item == key && *qty >= quantity))
}

fn first_year(chapter: &ChapterDef) -> i64 {
    chapter
        .when
        .iter()
        .filter_map(|c| match c {
            Condition::Date { from: Some(date), .. } => Some(i64::from(date[0])),
            _ => None,
        })
        .chain(chapter.window.iter().map(|w| i64::from(w[0][0])))
        .max()
        .unwrap_or(1553)
}

fn last_year(chapter: &ChapterDef) -> i64 {
    chapter
        .when
        .iter()
        .filter_map(|c| match c {
            Condition::Date { to: Some(date), .. } => Some(i64::from(date[0])),
            _ => None,
        })
        .chain(chapter.window.iter().map(|w| i64::from(w[1][0])))
        .chain(chapter.deadline.iter().map(|d| i64::from(d[0])))
        .min()
        .unwrap_or(i64::MAX)
}

fn initial_source(d: &StaticData, key: &str, quantity: i64) -> bool {
    d.upbringing
        .completions
        .values()
        .map(|c| &c.capital)
        .chain(d.upbringing.paths.iter().map(|p| &p.capital))
        .any(|c| c.items.get(key).is_some_and(|qty| *qty >= quantity))
}

fn reward_source<'a>(d: &'a StaticData, key: &str, qty: i64, year: i64) -> Option<(&'a TrackDef, &'a ChapterDef)> {
    let source = STORY_ONLY.iter().find(|s| s.item == key)?;
    let provider = d.story2.track(source.track)?;
    let reward = provider.chapter(source.chapter)?;
    (gives(reward, key, qty)
        && first_year(reward) <= year
        && !required_items(reward).contains_key(key)
        && reaches(provider, &provider.start, &reward.key))
    .then_some((provider, reward))
}

fn has_source(d: &StaticData, track: &TrackDef, chapter: &ChapterDef, item: &str, qty: i64) -> bool {
    let year = last_year(chapter);
    if public_source(d, item, year) || (year >= 1557 && initial_source(d, item, qty)) {
        return true;
    }
    let Some(source) = STORY_ONLY.iter().find(|s| s.item == item) else {
        return false;
    };
    assert!(!source.reason.is_empty());
    let Some(provider) = d.story2.track(source.track) else {
        // C13 未合入时明确保留跨卡依赖，不能把它说成本分支已经可获得。
        return source.pending_c13 && !d.story2.tracks.iter().any(|t| t.key.starts_with("main_"));
    };
    assert!(provider.chapter(source.chapter).is_some(), "白名单发放章节必须存在");
    reward_source(d, item, qty, year).is_some_and(|(provider, reward)| {
        provider.key != track.key || (reward.key != chapter.key && reaches(provider, &reward.key, &chapter.key))
    })
}

fn required_items(chapter: &ChapterDef) -> BTreeMap<&str, i64> {
    let mut items = BTreeMap::new();
    let mut add = |key, qty| {
        items.entry(key).and_modify(|q: &mut i64| *q = (*q).max(qty)).or_insert(qty);
    };
    for condition in chapter
        .when
        .iter()
        .chain(chapter.variants.iter().flat_map(|v| &v.when))
        .chain(chapter.choices.iter().flat_map(|c| &c.requires))
    {
        match condition {
            Condition::Item { item, qty } => add(item.as_str(), *qty),
            Condition::Equipped { item } => add(item.as_str(), 1),
            _ => {}
        }
    }
    for objective in &chapter.objectives {
        if let ObjectiveKind::Item { item, qty } = &objective.kind {
            add(item.as_str(), *qty);
        }
    }
    for effect in effects(chapter) {
        if let Effect::Item { item, qty } = effect
            && *qty < 0
        {
            add(item.as_str(), -*qty);
        }
    }
    items
}

#[test]
fn story_items_have_zero_unexplained_missing_sources() {
    let d = defs();
    let mut missing = Vec::new();
    let mut required = BTreeSet::new();
    for track in &d.story2.tracks {
        for chapter in &track.chapters {
            for (key, qty) in required_items(chapter) {
                required.insert(key);
                if !has_source(d, track, chapter, key, qty) {
                    missing.push(format!("{}/{}/{} ×{}", track.key, chapter.key, key, qty));
                }
            }
        }
    }
    assert!(!required.is_empty(), "审计必须实际扫描到故事物品条件");
    required.extend(d.upbringing.crafts.iter().flat_map(|c| c.materials.iter().map(|m| m.item.as_str())));
    for entry in STORY_ONLY {
        assert!(required.contains(entry.item), "过时白名单：{}", entry.item);
        assert!(d.items.item(entry.item).expect(entry.item).shop.is_none(), "剧情专属物不能新增购买捷径");
    }
    assert_eq!(missing.len(), 0, "无来源且未说明的物品（买不到）：{missing:#?}");
}

#[test]
fn shop_cultures_exist_and_every_shop_item_has_an_open_suitable_port() {
    let d = defs();
    let mut count = 0;
    for item in &d.items.items {
        if let Some(shop) = &item.shop {
            for culture in &shop.cultures {
                assert!(
                    d.locations.iter().any(|p| p.is_port() && p.culture == *culture),
                    "{}/{} 不是寰宇港口文化",
                    item.key,
                    culture
                );
            }
            assert!(!shop_ports(d, item, i64::MAX).is_empty(), "{}", item.key);
            count += 1;
        }
    }
    assert!(count > 0);
}

#[test]
fn upbringing_materials_and_nested_item_conditions_have_sources() {
    fn inspect(d: &StaticData, req: &upbringing::ExcursionRequirement, context: &str) {
        if let Some(item) = &req.item {
            assert!(
                public_source(d, item, 1556) || reward_source(d, item, req.qty, 1556).is_some(),
                "养成外出 {context}/{item} 缺少当期来源"
            );
        }
        for child in &req.any {
            inspect(d, child, context);
        }
    }
    let d = defs();
    assert!(!d.upbringing.crafts.is_empty() && !d.upbringing.excursions.is_empty());
    for craft in &d.upbringing.crafts {
        for material in &craft.materials {
            assert!(
                public_source(d, &material.item, 1556)
                    || reward_source(d, &material.item, material.qty, 1556).is_some(),
                "合成原料 {}/{}",
                craft.key,
                material.item
            );
        }
        for tool in &craft.tools {
            assert!(public_source(d, tool, 1553), "合成工具 {}/{tool}", craft.key);
        }
        assert!(d.items.item(&craft.output.item).is_some());
    }
    for excursion in &d.upbringing.excursions {
        for node in &excursion.nodes {
            for step in &node.steps {
                inspect(d, &step.unlock, &excursion.key);
            }
        }
    }
    for spell in &d.arcana.spells {
        for item in spell.cost.items.keys() {
            assert!(public_source(d, item, 1557), "秘术材料 {}/{item}", spell.key);
        }
        for good in spell.cost.goods.keys() {
            let id = d.find_good(good).unwrap();
            let ordinary = d.locations.iter().enumerate().any(|(i, p)| {
                open_port(d, LocId::from_idx(i)) && p.market.iter().any(|m| m.good == id && m.supply > 0)
            });
            if !ordinary {
                // 既有 C11 的药草船货只在七岛自产，必须先解锁秘境；不将仅有配方误算成产地。
                assert_eq!(good, "herbs", "未说明的秘术船货来源：{}/{good}", spell.key);
                assert!(d.realms.realm("persephone_isles").is_some());
                for n in 1..=7 {
                    let key = format!("persephone_isle_{n}");
                    let port = d.find_loc(&key).expect("七岛供货港");
                    assert_eq!(d.geography.places.authored.locations[&key].realm.as_deref(), Some("persephone_isles"));
                    assert!(d.loc(port).market.iter().any(|m| m.good == id && m.supply > 0));
                }
            }
        }
    }
}

#[test]
fn ownable_legend_blueprints_are_rewards_and_display_only_plans_stay_unobtainable() {
    // C11 的这些船只用于借乘、目击或会战，不颁发造船权；不能为清点结果凭空开放购买。
    let display_only = [
        ("solomon_ship", "圣杯传说之船只借乘"),
        ("botafogo", "葡萄牙旗舰只供见证"),
        ("henry_grace", "英王旗舰不转让"),
        ("lepanto_galleass", "勒班陀舰队只供会战协作"),
        ("san_martin", "无敌舰队旗舰不转让"),
        ("ark_royal", "英格兰旗舰不转让"),
        ("falkenberg", "幽灵船只供遭遇"),
        ("draug_boat", "海亡者之舟只供遭遇"),
        ("naglfar", "纳吉尔法只供末日征兆"),
        ("ghost_junk", "幽灵中国船只供遭遇"),
    ];
    let d = defs();
    let mut exemptions = BTreeSet::new();
    for ship in &d.legend_ships.ships {
        let Some(plan) = ship.acquire.blueprint.as_deref() else { continue };
        let track = d.story2.track(ship.acquire.track.as_deref().unwrap()).unwrap();
        let granted = d.story2.tracks.iter().any(|t| t.chapters.iter().any(|c| gives(c, plan, 1)));
        if let Some((_, reason)) = display_only.iter().find(|(key, _)| *key == ship.key) {
            assert!(!reason.is_empty() && !granted, "{} 不应发放所有权", ship.key);
            assert!(!track.chapters.iter().flat_map(|c| &c.choices).any(|c| c.next == "done"));
            exemptions.insert(ship.key.as_str());
        } else {
            assert!(track.chapters.iter().any(|c| gives(c, plan, 1)), "{} 的取得轨道未发船图", ship.key);
        }
        assert!(!public_source(d, plan, i64::MAX), "船图不能绕过取得故事购买");
    }
    assert_eq!(exemptions, display_only.iter().map(|(key, _)| *key).collect());
}

fn trade_world(year: u32, seed: u64, at: &str) -> World {
    let mut d = defs().clone();
    let port = d.find_loc(at).unwrap();
    let faction = d.loc(port).faction;
    let d_mut = Arc::make_mut(&mut d);
    // 只搭建交易夹具，不改实际货架规则、物品权重、市场或港口文化。
    let scenario = &mut d_mut.scenarios[0];
    scenario.start_date = [year, 1, 1];
    scenario.control_date = scenario.start_date;
    scenario.start = port;
    scenario.start_loc = port;
    scenario.upbringing = false;
    scenario.timeline = None;
    scenario.cash = 100_000;
    scenario.ships = vec![ShipTypeId(0)];
    scenario.crew = 20;
    scenario.cargo.clear();
    scenario.food = 0;
    scenario.water = 0;
    scenario.reputation = vec![(faction, d_mut.rules.diplomacy.license_reputation)];
    for track in &mut d_mut.story2.tracks {
        track.auto = false;
    }
    World::new(d, ScenarioId(0), seed).unwrap()
}

#[test]
fn named_regressions_reach_real_shelves_and_can_be_bought() {
    let cases = [
        ("euclid_ratdolt", "venice"),
        ("gemma_antwerp", "antwerp"),
        ("agricola_basel", "antwerp"),
        ("zacuto_leiria", "lisbon"),
        ("murano_mirror", "venice"),
        ("half_hour_glass", "lisbon"),
        ("behaim_globe", "hamburg"),
    ];
    let d = defs();
    let mut remaining: BTreeSet<_> = cases.iter().map(|(key, _)| *key).collect();
    for (key, port) in cases {
        assert!(shop_ports(d, d.items.item(key).unwrap(), 1557).contains(&d.find_loc(port).unwrap()), "{key}/{port}");
    }
    let early = trade_world(1555, 42, "antwerp");
    assert!(early.state.items.shelves.values().all(|s| !s.stock.contains_key("agricola_basel")));
    drop(early);
    for seed in 0..16 {
        if remaining.is_empty() {
            break;
        }
        let mut w = trade_world(1557, seed, "lisbon");
        let fleet = w.fleets_of(OwnerId::Player).next().unwrap().id;
        for key in remaining.clone() {
            let port = w.state.items.shelves.iter().find_map(|(loc, shelf)| {
                (w.location_open(*loc) && shelf.stock.get(key).is_some_and(|qty| *qty > 0)).then_some(*loc)
            });
            if let Some(loc) = port {
                // 移动只搭建停泊夹具；库存由原始月货架随机域生成，购买走正式命令。
                w.state.fleets.get_mut(&fleet).unwrap().location = world::FleetLocation::Docked(loc);
                let before = w.item_quantity(OwnerId::Player, key);
                let money = w.all_money();
                Command::BuyItem { owner: OwnerId::Player, loc, item: key.into(), qty: 1, max_total: None }
                    .apply(&mut w)
                    .unwrap();
                assert_eq!(w.item_quantity(OwnerId::Player, key), before + 1);
                assert_eq!(w.all_money(), money);
                remaining.remove(key);
            }
        }
    }
    assert!(remaining.is_empty(), "正式货架未能购得：{remaining:?}");
}

#[test]
fn sakai_license_route_can_buy_six_arquebuses() {
    let mut w = trade_world(1557, 42, "sakai");
    let loc = w.defs.find_loc("sakai").unwrap();
    let good = w.defs.find_good("arquebus").unwrap();
    let faction = w.location_faction(loc);
    assert!(w.location_open(loc) && w.defs.good(good).license);
    assert!(w.defs.loc(loc).market.iter().any(|m| m.good == good && m.supply > 0));
    let fleet = w.fleets_of(OwnerId::Player).next().unwrap().id;
    let buy = Command::Buy { owner: OwnerId::Player, fleet, good, qty: 6, max_total: None };
    let state = w.state_hash();
    assert!(buy.apply(&mut w).is_err(), "没有许可证不能购买军需");
    assert_eq!(w.state_hash(), state);
    let money = w.all_money();
    Command::BuyLicense { owner: OwnerId::Player, faction }.apply(&mut w).unwrap();
    // T01：火绳枪是珍货（要商誉 60），光有许可证、声望只有 10 时行会不卖（世界不变）。
    // 这条路线是为巴布拉的请托（request_babullah / deliver：把火绳枪（6）运到特尔纳特）准备的：
    // 那一章进行中时，对请托要的货放行。
    let state = w.state_hash();
    assert_eq!(buy.apply(&mut w).unwrap_err().code(), "trade.rank", "没有请托在身时照货档");
    assert_eq!(w.state_hash(), state);
    w.state.story2.tracks.insert(
        "request_babullah".into(),
        story2::TrackState {
            chapter: "deliver".into(),
            visited: BTreeSet::new(),
            entered: w.day(),
            status: story2::Status::Active,
            failure: None,
        },
    );
    assert!(w.errand_goods(OwnerId::Player).contains(&good));
    buy.apply(&mut w).unwrap();
    assert_eq!(w.state.fleets[&fleet].cargo[&good], 6);
    assert_eq!(w.all_money(), money);
}

#[test]
fn source_audit_rejects_the_old_culture_and_late_or_circular_rewards() {
    let d = defs();
    let mut item = d.items.item("half_hour_glass").unwrap().clone();
    item.shop.as_mut().unwrap().cultures = vec!["iberian".into()];
    assert!(shop_ports(d, &item, 1557).is_empty());
    assert!(shop_ports(d, d.items.item("agricola_basel").unwrap(), 1555).is_empty());
    let track = d.story2.track("main_lin_wandeng").unwrap();
    let before = track.chapter("a01_compass_box").unwrap().clone();
    assert!(!has_source(d, track, &before, "star_crossing_original", 1), "后章奖励不能满足前章");
    let mut own = track.chapter("b02_last_page").unwrap().clone();
    own.deadline = Some([1552, 12, 31]);
    assert!(!has_source(d, track, &own, "star_crossing_original", 1), "不能用本章奖励满足自身要求");
    let source = STORY_ONLY.iter().find(|s| s.item == "star_crossing_original").unwrap();
    let mut missing = track.chapter(source.chapter).unwrap().clone();
    for choice in &mut missing.choices {
        choice.effects.retain(|e| !matches!(e, Effect::Item { item, .. } if item == source.item));
    }
    assert!(!gives(&missing, source.item, 1), "删除发放效果后必须失去来源");
}

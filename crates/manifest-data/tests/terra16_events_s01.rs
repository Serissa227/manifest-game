//! S01：寰宇的行情事件——真实数据走生产加载器。
//!
//! - 条数；不用在寰宇不起作用的效果（各海区的海盗基准概率是 0）；
//! - 落在对应的地方：带地点、海区、势力的事件都写了限定；
//! - 参数逐一枚举（不抽样）：限定的每个地点 × 每种商品、每片海区、每个势力，取范围的两端，都通过内核的事件校验；
//!   每种商品、每个地点至少各有一组能过；产量类的事件限定的地点确实出产那种货；
//! - 限定之外的地点、海区、势力，内核一律拒绝；开局时还没开的港口（月港、澳门）落不上带商品的事件。
//!
//! 离线事件导演按限定挑选、每一种事件都挑得到，在 `manifest-ai --test director_s01`；
//! 加载器对限定字段的校验在 `story_events_s01`。
use manifest_core::defs::{EffectKind, EventTypeDef};
use manifest_core::events::EventParams;
use manifest_core::{EventTypeId, FactionId, Fx, GoodId, LocId, RegionId, StaticData, World};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("寰宇完整加载")).clone()
}

/// 自由航海剧本开局的世界（1557-01-01）：事件的冷却与年度上限都还没有记录。
fn world() -> World {
    let d = defs();
    World::new(d.clone(), d.find_scenario("free_1557").expect("自由航海剧本"), 42).expect("开局预演")
}

/// 范围的一端：`end` 为 0 取下限，否则取上限；效果用不上的参数为 None。
fn params_at(def: &EventTypeDef, end: usize) -> EventParams {
    let e = def.effect;
    let pick = |range: Option<(Fx, Fx)>| range.map(|(lo, hi)| if end == 0 { lo } else { hi });
    EventParams {
        mult: if e.needs_mult() { pick(def.mult) } else { None },
        days: if e.needs_days() { def.days.map(|(lo, hi)| if end == 0 { lo } else { hi }) } else { None },
        delta: if e.needs_delta() { def.delta.map(|(lo, hi)| if end == 0 { lo } else { hi }) } else { None },
        ..EventParams::default()
    }
}

#[test]
fn the_catalog_is_terra16s_own_and_every_located_event_names_its_places() {
    let d = defs();
    assert!(d.events.len() >= 18, "寰宇的行情事件 {} 条", d.events.len());
    let keys: BTreeSet<&str> = d.events.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys.len(), d.events.len());
    for key in [
        "monsoon_late",
        "treasure_fleet",
        "locust_swarm",
        "pepper_blight",
        "kiln_sealed",
        "sea_ban_tightened",
        "tribute_ships",
        "plague_closure",
        "herring_run",
    ] {
        assert!(keys.contains(key), "{key}");
    }
    let mut limited = 0;
    for def in &d.events {
        let e = def.effect;
        // 寰宇各海区的海盗基准概率是 0，乘什么系数都没有效果：这张表不用它。也不碰殖民点与发现物。
        assert_ne!(e, EffectKind::RegionPirates, "{}", def.key);
        assert!(!e.targets_site() && !e.needs_discovery() && !e.needs_faction_b(), "{}", def.key);
        // 带地点、海区、势力的事件都写了限定；带商品的都限定了商品。整个世界的收成、利率不必。
        assert_eq!(e.needs_loc(), !def.locs.is_empty(), "{}：地点", def.key);
        assert_eq!(e.needs_region(), !def.regions.is_empty(), "{}：海区", def.key);
        assert_eq!(e.needs_faction_a(), !def.factions.is_empty(), "{}：势力", def.key);
        assert_eq!(e.needs_good(), !def.goods.is_empty(), "{}：商品", def.key);
        limited += usize::from(e.needs_loc() || e.needs_region() || e.needs_faction_a());
        assert!(!def.name.is_empty() && !def.description.is_empty(), "{}", def.key);
        // 一年里同一种不泛滥：冷却至少五个月，每年至多两次。
        assert!(def.cooldown_days >= 150 && def.max_per_year <= 2, "{}", def.key);
        // 系数不出格：涨不过两倍半，跌不过一半。
        if let Some((lo, hi)) = def.mult {
            assert!(lo >= Fx::from_pct(50) && hi <= Fx::from_pct(250), "{}：{lo}–{hi}", def.key);
        }
    }
    assert!(limited >= 14, "限定了地点、海区或势力的行情事件 {limited} 条");
}

#[test]
fn every_limited_combination_passes_the_kernel_and_everything_outside_is_refused() {
    let d = defs();
    let w = world();
    for (i, def) in d.events.iter().enumerate() {
        let kind = EventTypeId::from_idx(i);
        let e = def.effect;
        let goods: Vec<Option<GoodId>> =
            if e.needs_good() { def.goods.iter().copied().map(Some).collect() } else { vec![None] };
        let regions: Vec<Option<RegionId>> =
            if e.needs_region() { def.regions.iter().copied().map(Some).collect() } else { vec![None] };
        let factions: Vec<Option<FactionId>> =
            if e.needs_faction_a() { def.factions.iter().copied().map(Some).collect() } else { vec![None] };
        // 开局时还没开的港口（月港要到 1567 年开海；澳门要等葡人入居那件史事落定，窗口到 1557 年底）没有市场：
        // 带商品的事件落不上去，内核拒绝；港口开了以后才轮得到。“开没开”用内核查市场时的同一个判断（`location_open`）。
        let asleep: Vec<LocId> = def.locs.iter().copied().filter(|l| !w.location_open(*l)).collect();
        assert!(def.locs.is_empty() || asleep.len() < def.locs.len(), "{}：限定的地点开局时全在休眠", def.key);
        for loc in &asleep {
            assert!(e.needs_good(), "{}：不带商品的事件不要落在休眠的 {} 上", def.key, d.loc(*loc).key);
            let params = EventParams { loc: Some(*loc), good: goods[0], ..params_at(def, 0) };
            assert!(w.validate_event(kind, &params).is_err(), "{}：休眠的 {} 也过了校验", def.key, d.loc(*loc).key);
        }
        let locs: Vec<Option<LocId>> = if e.needs_loc() {
            def.locs.iter().copied().filter(|l| !asleep.contains(l)).map(Some).collect()
        } else {
            vec![None]
        };
        // 逐一枚举：地点 × 商品（当地交易那种商品的组合）× 海区 × 势力 × 范围的两端。
        let (mut ok_goods, mut ok_locs, mut passed) = (BTreeSet::new(), BTreeSet::new(), 0);
        for good in &goods {
            for loc in &locs {
                if let (Some(g), Some(l)) = (good, loc)
                    && !d.loc(*l).market.iter().any(|m| m.good == *g)
                {
                    continue;
                }
                for region in &regions {
                    for faction in &factions {
                        for end in [0, 1] {
                            let params = EventParams {
                                loc: *loc,
                                good: *good,
                                region: *region,
                                faction_a: *faction,
                                ..params_at(def, end)
                            };
                            w.validate_event(kind, &params)
                                .unwrap_or_else(|err| panic!("{}：{params:?} 没过内核校验：{err}", def.key));
                            passed += 1;
                            ok_goods.insert(*good);
                            ok_locs.insert(*loc);
                        }
                    }
                }
            }
        }
        assert!(passed >= 2, "{}", def.key);
        assert_eq!(ok_goods.len(), goods.len(), "{}：有商品在限定的地点里一处也不交易", def.key);
        assert_eq!(ok_locs.len(), locs.len(), "{}：有地点不交易限定的任何一种商品", def.key);
        // 产量类的事件乘的是产量：限定的地点要真的出产那种货，否则是空事件。
        if e == EffectKind::SupplyShift {
            for loc in &def.locs {
                let grows = d.loc(*loc).market.iter().any(|m| def.goods.contains(&m.good) && m.supply > 0);
                assert!(grows, "{}：{} 不出产限定的货", def.key, d.loc(*loc).key);
            }
        }
        // 限定之外的地点（开着的、交易那种货的、合乎 port_only 的）、海区、势力：内核拒绝。
        if e.needs_loc() {
            let outside = d
                .loc_ids()
                .find(|l| {
                    !def.locs.contains(l)
                        && w.location_open(*l)
                        && !d.loc(*l).is_site()
                        && (!def.port_only || d.loc(*l).is_port())
                        && goods[0].is_none_or(|g| w.market(*l, g).is_some())
                })
                .unwrap_or_else(|| panic!("{}：找不到一处限定之外的地点", def.key));
            let params = EventParams { loc: Some(outside), good: goods[0], ..params_at(def, 0) };
            let err = w.validate_event(kind, &params).expect_err("限定之外的地点");
            assert!(err.to_string().contains("不适用于这个地点"), "{}：{}：{err}", def.key, d.loc(outside).key);
        }
        if e.needs_region() {
            let outside = (0..d.regions.len()).map(RegionId::from_idx).find(|r| !def.regions.contains(r)).unwrap();
            let params = EventParams { region: Some(outside), ..params_at(def, 0) };
            let err = w.validate_event(kind, &params).expect_err("限定之外的海区");
            assert!(err.to_string().contains("不适用于这片海区"), "{}：{err}", def.key);
        }
        if e.needs_faction_a() {
            let outside = (0..d.factions.len()).map(FactionId::from_idx).find(|f| !def.factions.contains(f)).unwrap();
            let params = EventParams { faction_a: Some(outside), good: goods[0], ..params_at(def, 0) };
            let err = w.validate_event(kind, &params).expect_err("限定之外的势力");
            assert!(err.to_string().contains("不适用于这个势力"), "{}：{err}", def.key);
        }
    }
}

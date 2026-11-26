//! 殖民相关的组合事件在情报与探险视图中的形状：殖民地效果带殖民地名与建筑名（或“全部建筑”），
//! 发现物传闻带发现物名与大致海区；探险记录列出传闻（只有海区，不给位置）。小型世界，不读文件、不访问服务。

use manifest_app::views;
use manifest_core::composed::{ComposedEffect, ComposedSource};
use manifest_core::defs::EffectKind;
use manifest_core::events::EventParams;
use manifest_core::testkit::tiny_defs;
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const SIGMA: LocId = LocId(4);
const FARM: ColonyBuildingId = ColonyBuildingId(0);
const ARCH: DiscoveryId = DiscoveryId(1);

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

/// 小型世界里在 sigma 建立殖民地、建好农庄。
fn colony_world() -> (World, ColonyId) {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.colony.raid_scale = Fx::ZERO;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 3).unwrap();
    let f = w.fleets_of(P).next().unwrap().id;
    let crew = w.fleet(f).unwrap().crew;
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 24 - crew });
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: GoodId(0), qty: 60, max_total: None });
    ok(&mut w, Command::SetSail { owner: P, fleet: f, dest: SIGMA });
    for _ in 0..40 {
        if w.fleet(f).unwrap().docked_at() == Some(SIGMA) {
            break;
        }
        w.end_day().unwrap();
    }
    let CommandOutcome::ColonyFounded { colony } =
        ok(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "晨星垦地".into(), settlers: 12 })
    else {
        panic!("建立殖民地");
    };
    let q = w.fleet(f).unwrap().cargo.get(&GoodId(0)).copied().unwrap_or(0);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: GoodId(0), qty: q },
    );
    ok(&mut w, Command::BuildColony { owner: P, colony, building: FARM });
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    (w, colony)
}

#[test]
fn colony_effects_and_rumors_show_names_in_the_intel_and_exploration_views() {
    let (mut w, _) = colony_world();
    let effects = vec![
        ComposedEffect {
            effect: EffectKind::ColonyOutput,
            params: EventParams {
                loc: Some(SIGMA),
                building: Some(FARM),
                mult: Some(Fx(12_000)),
                days: Some(30),
                ..EventParams::default()
            },
        },
        ComposedEffect {
            effect: EffectKind::ColonyMorale,
            params: EventParams { loc: Some(SIGMA), delta: Some(6), ..EventParams::default() },
        },
        ComposedEffect {
            effect: EffectKind::DiscoveryRumor,
            params: EventParams { discovery: Some(ARCH), ..EventParams::default() },
        },
    ];
    ok(
        &mut w,
        Command::ApplyComposedEvent {
            title: "垦地丰收".into(),
            text: "据拓荒者的书信所述，晨星垦地的田里一片金黄。".into(),
            effects,
            source: ComposedSource::Template,
        },
    );
    let intel = views::intel_view(&w);
    let card = &intel.composed[0];
    assert_eq!(card.effects.len(), 3);
    let out = &card.effects[0];
    assert_eq!(
        (out.effect, out.colony.as_deref(), out.building.as_deref()),
        ("colony_output", Some("晨星垦地"), Some("farm"))
    );
    assert!(!out.all_buildings && out.mult_bp == Some(12_000) && out.end.is_some());
    assert_eq!(out.hint, "殖民地增产");
    let morale = &card.effects[1];
    assert_eq!((morale.delta, morale.hint, morale.end), (Some(6), "殖民地士气高涨", None));
    let rumor = &card.effects[2];
    assert_eq!((rumor.discovery.as_deref(), rumor.region.as_deref()), (Some("sky_arch"), Some("东海")));
    assert!(card.place.iter().any(|p| p == "晨星垦地") && card.place.iter().any(|p| p == "sky_arch"));
    // 进行中的卡片只算一张（持续效果只有产量一条）
    assert_eq!(intel.events.iter().filter(|e| e.id == card.id).count(), 1);
    // JSON 形状：新字段总在（可为 null）
    let v = serde_json::to_value(&intel).unwrap();
    for field in ["building", "all_buildings", "colony", "discovery"] {
        assert!(v["composed"][0]["effects"][0].get(field).is_some(), "EffectView 缺少 {field}");
    }
    // 探险记录：传闻只给海区
    let d = views::discoveries_view(&w);
    assert_eq!(d.rumors.len(), 1);
    let r = &d.rumors[0];
    assert_eq!((r.id, r.region_name.as_str(), r.found), (ARCH.0, "东海", false));
    let v = serde_json::to_value(&d).unwrap();
    assert!(v["rumors"][0].get("x").is_none() && v["rumors"][0].get("y").is_none(), "传闻不给位置");
}

#[test]
fn output_for_all_buildings_is_marked() {
    let (mut w, _) = colony_world();
    ok(
        &mut w,
        Command::ApplyComposedEvent {
            title: "工匠抵达".into(),
            text: "一船木匠与铁匠在垦地上岸。".into(),
            effects: vec![ComposedEffect {
                effect: EffectKind::ColonyOutput,
                params: EventParams {
                    loc: Some(SIGMA),
                    mult: Some(Fx(11_000)),
                    days: Some(30),
                    ..EventParams::default()
                },
            }],
            source: ComposedSource::Template,
        },
    );
    let intel = views::intel_view(&w);
    let e = &intel.composed[0].effects[0];
    assert!(e.all_buildings && e.building.is_none());
}

#[test]
fn colony_view_lists_the_effects_acting_on_it() {
    let (mut w, colony) = colony_world();
    ok(
        &mut w,
        Command::ApplyComposedEvent {
            title: "移民潮".into(),
            text: "故乡的饥荒让许多农户渡海而来。".into(),
            effects: vec![ComposedEffect {
                effect: EffectKind::ColonyGrowth,
                params: EventParams {
                    loc: Some(SIGMA),
                    mult: Some(Fx(14_000)),
                    days: Some(40),
                    ..EventParams::default()
                },
            }],
            source: ComposedSource::Template,
        },
    );
    let v = views::colony_view(&w, w.colony(colony).unwrap());
    assert_eq!(v.growth_mult_bp, 14_000);
    assert_eq!(v.effects.len(), 1);
    assert_eq!((v.effects[0].effect, v.effects[0].hint), ("colony_growth", "移民涌入"));
    assert!(v.effects[0].end.is_some());
}

//! U02 工作包 1：开局属性三层叠加（年龄基线 + 家境底子 + 个人优势）的真实寰宇数据验收。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    captain::background_attrs,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest},
    upbringing::{FamilyDef, Phase},
};
use std::{
    collections::BTreeSet,
    sync::{Arc, OnceLock},
};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn start(d: Arc<StaticData>, f: &FamilyDef) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut start = StartParams::new(sid, 42);
    start.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U02".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &start, |_| {}).unwrap()
}

/// 界面上显示、可以练的 1–10 刻度属性：不含品行、生日运气与未觉醒的秘术。
fn visible(d: &StaticData) -> Vec<(usize, &str)> {
    d.captain
        .attributes
        .iter()
        .enumerate()
        .filter(|(i, a)| a.key != "arcana" && a.key != "fortune" && d.captain.group(*i).unwrap().key != "conduct")
        .map(|(i, a)| (i, a.key.as_str()))
        .collect()
}

/// 归一化开局点：资质、本领每高一档计一分，品行每十计一分；运气由生日定、秘术须觉醒，不计。
fn normalized(w: &World) -> i64 {
    let d = &w.defs;
    d.captain
        .attributes
        .iter()
        .enumerate()
        .filter(|(_, a)| a.key != "fortune" && a.key != "arcana")
        .map(|(i, a)| {
            if d.captain.group(i).unwrap().key == "conduct" {
                (w.upbringing_growth(&a.key) - 50) / 10
            } else {
                w.upbringing_projected(&a.key) - 1
            }
        })
        .sum()
}

fn profile(w: &World) -> Vec<i64> {
    visible(&w.defs).iter().map(|(_, key)| w.upbringing_projected(key)).collect()
}

#[test]
fn nine_named_openings_are_equal_in_total_and_never_a_row_of_ones() {
    let d = defs();
    assert_eq!(d.upbringing.rules.age_baseline.get("aptitude"), Some(&1));
    let named: Vec<_> = d.upbringing.families.iter().filter(|f| !f.protagonists.is_empty()).collect();
    assert_eq!(named.len(), 9);
    let mut totals = BTreeSet::new();
    let mut profiles = Vec::new();
    for f in &named {
        let w = start(d.clone(), f);
        assert_eq!(f.initial_points.values().sum::<i64>(), 10, "{} 的个人优势须保持 U01 的十点", f.key);
        assert_eq!(f.origin_points.values().sum::<i64>(), 8, "{} 的家境底子须为八点", f.key);
        totals.insert(normalized(&w));
        // 运气也算在“值为 1”里：生日运气为 1 的主角同样受这条约束。
        let ones = visible(&d).iter().filter(|(_, key)| w.upbringing_projected(key) == 1).count()
            + usize::from(w.upbringing_growth("fortune") == 1);
        assert!(ones <= 5, "{} 开局有 {ones} 项为 1", f.key);
        let at_least_two = visible(&d).iter().filter(|(_, key)| w.upbringing_projected(key) >= 2).count();
        assert!(at_least_two >= 8, "{} 只有 {at_least_two} 项在 2 以上", f.key);
        assert!(profile(&w).iter().all(|v| (1..=10).contains(v)), "{}", f.key);
        assert_eq!(w.upbringing_projected("arcana"), 0, "{} 的秘术未觉醒不能显示", f.key);
        assert!(w.state.upbringing.as_ref().unwrap().year_growth.is_empty(), "开局点不占年度额度");
        profiles.push((f.key.clone(), profile(&w)));
    }
    assert_eq!(totals.len(), 1, "九人开局总点数须相同：{totals:?}");
    assert_eq!(totals.first(), Some(&25), "年龄基线 7 + 家境底子 8 + 个人优势 10");
    for (i, (a, pa)) in profiles.iter().enumerate() {
        for (b, pb) in &profiles[i + 1..] {
            let distance: i64 = pa.iter().zip(pb).map(|(x, y)| (x - y).abs()).sum();
            assert!(distance >= 8, "{a} 与 {b} 的开局分布太像（档差合计 {distance}）");
        }
    }
}

#[test]
fn twelve_custom_origins_keep_their_allocation_and_add_an_equal_origin_layer() {
    let d = defs();
    let custom: Vec<_> = d.upbringing.families.iter().filter(|f| !f.templates.is_empty()).collect();
    assert_eq!(custom.len(), 12);
    let mut spreads = BTreeSet::new();
    for f in &custom {
        let w = start(d.clone(), f);
        assert_eq!(f.initial_points.values().sum::<i64>(), 10, "{}", f.key);
        assert_eq!(f.origin_points.values().sum::<i64>(), 8, "{}", f.key);
        assert_eq!(normalized(&w), 25, "{} 的开局总点数须与具名主角相同", f.key);
        // 自创出身的生日由玩家定，运气不计入；其余显示的属性同样不能一排 1。
        let ones = visible(&d).iter().filter(|(_, key)| w.upbringing_projected(key) == 1).count();
        assert!(ones <= 5, "{} 开局有 {ones} 项为 1", f.key);
        for (key, points) in &f.initial_points {
            let i = d.captain.attribute_index(key).unwrap();
            if d.captain.group(i).unwrap().key != "conduct" {
                assert!(w.upbringing_projected(key) > *points, "{} 的创建分配 {key} 被吞掉", f.key);
            }
        }
        assert!(spreads.insert(profile(&w)), "{} 与其他自创出身的开局完全相同", f.key);
    }
}

#[test]
fn opening_layers_follow_the_data_and_saved_growth_is_never_regranted() {
    let d = defs();
    let f = d.upbringing.family("noel").unwrap();
    let w = start(d.clone(), f);
    let points = w.upbringing_opening_points(f);
    assert_eq!(points["fortune"], 0);
    assert_eq!(points["arcana"], 0);
    // 武艺：个人优势 3；敏捷：基线 1 + 个人 3；统率：家境 1；信义：个人 2（品行每点十）。
    assert_eq!((points["arms"], points["agility"], points["command"], points["honor"]), (3, 4, 1, 2));
    assert_eq!(w.upbringing_projected("arms"), 4);
    assert_eq!(w.upbringing_projected("agility"), 5);
    assert_eq!(w.upbringing_growth("honor"), 70);
    // 没有基线与底子的旧世界数据：去掉两层后回到 U01 的结果。
    let mut legacy = (*d).clone();
    legacy.upbringing.rules.age_baseline.clear();
    for f in &mut legacy.upbringing.families {
        f.origin_points.clear();
    }
    let legacy = Arc::new(legacy);
    let old = start(legacy.clone(), legacy.upbringing.family("noel").unwrap());
    assert_eq!(normalized(&old), 10);
    assert_eq!(old.upbringing_projected("agility"), 4);
    assert_eq!(old.upbringing_projected("constitution"), 1);
    // 读档只补缺项：已有的成长不被三层开局点覆盖。
    let mut saved = start(d.clone(), f);
    saved.state.upbringing.as_mut().unwrap().growth.insert("command".into(), 17);
    let restored = World::from_snapshot(d.clone(), saved.state.clone()).unwrap();
    assert_eq!(restored.upbringing_growth("command"), 17);
    assert_eq!(restored.state_hash(), saved.state_hash());
}

#[test]
fn invalid_age_baseline_or_origin_points_are_rejected() {
    let d = defs();
    for (group, points) in [("missing", 1), ("aptitude", 4), ("craft", -1)] {
        let mut bad = (*d).clone();
        bad.upbringing.rules.age_baseline.insert(group.into(), points);
        assert!(
            manifest_core::upbringing::activity_validation::validate(&bad).iter().any(|e| e.contains("年龄基线")),
            "{group}/{points}"
        );
    }
    for (key, points) in [("missing", 1), ("fortune", 1), ("arcana", 1), ("arms", -1), ("arms", 10), ("honor", 6)] {
        let mut bad = (*d).clone();
        bad.upbringing.families[0].origin_points.insert(key.into(), points);
        assert!(
            manifest_core::upbringing::validation::validate(&bad).iter().any(|e| e.contains("家境底子")),
            "{key}/{points}"
        );
    }
}

#[test]
fn skipped_upbringing_and_adult_creation_never_start_with_a_row_of_ones() {
    let d = defs();
    for f in &d.upbringing.families {
        let mut w = start(d.clone(), f);
        w.state.day = manifest_core::scenario::day_of(&d, f.graduation).unwrap();
        w.state.upbringing.as_mut().unwrap().phase = Phase::Graduation;
        Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
        let attrs = &w.captain_profile(OwnerId::Player).unwrap().attrs;
        let ones: Vec<_> = visible(&d).into_iter().filter(|(i, _)| attrs[*i] == 1).map(|(_, key)| key).collect();
        assert!(ones.is_empty(), "{} 跳过养成后仍有一级属性：{ones:?}", f.key);
        for (i, a) in d.captain.attributes.iter().enumerate() {
            let g = d.captain.group(i).unwrap();
            assert!((g.range[0]..=g.range[1]).contains(&attrs[i]) || (a.key == "arcana" && attrs[i] == 0));
        }
        // 缺省成长是下限：开局较高的属性跳过后不会被压回缺省值。
        let defaults = &f.completion.as_ref().unwrap().defaults.growth;
        for (key, value) in defaults {
            assert!(w.upbringing_growth(key) >= *value, "{}/{key}", f.key);
        }
    }
    // 自由航海补建身世的创建页：资质、本领起点二档，自由点数全堆一处也不会出现一排 1。
    let bg = background_attrs(&d.captain, &[], None);
    for (i, _) in visible(&d) {
        assert!(bg[i] >= 2, "{} 的创建起点仍是 1", d.captain.attributes[i].key);
    }
    let mut alloc = vec![0; d.captain.attributes.len()];
    let index = |key: &str| d.captain.attribute_index(key).unwrap();
    alloc[index("constitution")] = 5;
    alloc[index("might")] = 1;
    alloc[index("seamanship")] = 5;
    alloc[index("commerce")] = 3;
    let attrs = d.captain.allocated_attrs(&bg, &alloc).unwrap();
    assert!(visible(&d).iter().all(|(i, _)| attrs[*i] >= 2));
    assert_eq!(attrs[index("seamanship")], d.captain.groups.iter().find(|g| g.key == "craft").unwrap().creation_cap);
}

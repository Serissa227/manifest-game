//! U01：真实寰宇的同额开局、存档幂等和结业边界。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
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
            name: "U01".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &start, |_| {}).unwrap()
}

#[test]
fn nine_named_openings_have_equal_points_and_distinct_ratings() {
    let d = defs();
    let expected = [
        // U02 起开局叠加年龄基线与家境底子，评价随之抬高（旧 → 新值见 DECISIONS 的 U02 测试期望值变更）。
        ("mio", [240, 180, 160, 360]),
        ("lieve", [120, 370, 180, 320]),
        ("najma", [210, 200, 260, 230]),
        ("lin_wandeng", [140, 270, 160, 340]),
        ("ix_nikte", [230, 240, 200, 330]),
        ("noel", [240, 120, 180, 260]),
        ("tariq", [300, 150, 180, 270]),
        ("kaicili", [200, 260, 200, 340]),
        ("baraka", [120, 300, 220, 320]),
    ];
    let mut ratings = BTreeSet::new();
    for (key, expected) in expected {
        let f = d.upbringing.family(key).unwrap();
        let w = start(d.clone(), f);
        assert_eq!(f.initial_points.values().sum::<i64>(), 10, "{key}");
        let sc = &d.scenarios[w.state.scenario.idx()];
        let card = sc.protagonist_defs.iter().find(|p| p.key == key).unwrap().card.as_ref().unwrap();
        for (attr, points) in card.strengths.iter().zip([3, 3, 2, 2]) {
            assert_eq!(f.initial_points[attr], points, "{key}/{attr}");
        }
        let actual = ["naval", "mercantile", "scholarship", "social_rating"].map(|r| w.upbringing_rating(r));
        assert_eq!(actual, expected, "{key}");
        assert!(ratings.insert(actual), "{key} 的评价重复");
        let normalized: i64 = d
            .captain
            .attributes
            .iter()
            .enumerate()
            .filter(|(_, a)| a.key != "fortune")
            .map(|(i, a)| {
                if d.captain.group(i).unwrap().key == "conduct" {
                    (w.upbringing_growth(&a.key) - 50) / 10
                } else {
                    w.upbringing_growth(&a.key) / 100
                }
            })
            .sum();
        // U02：个人十点之外再叠年龄基线七点与家境底子八点，九人仍等额。
        assert_eq!(normalized, 25, "{key} 的实际成长点不等额");
        assert_eq!(w.upbringing_growth("fortune"), 1 + i64::from((f.born[1] * 31 + f.born[2]) % 10));
        assert_eq!(w.upbringing_projected("arcana"), 0);
        assert!(w.state.upbringing.as_ref().unwrap().year_growth.is_empty());
    }
    assert_eq!(ratings.len(), 9);
}

#[test]
fn twelve_custom_origins_have_distinct_equal_bonuses_and_do_not_regrant_on_load() {
    let d = defs();
    let mut spreads = BTreeSet::new();
    for f in d.upbringing.families.iter().filter(|f| !f.templates.is_empty()) {
        assert_eq!(f.initial_points.values().sum::<i64>(), 10, "{}", f.key);
        assert!(spreads.insert(f.initial_points.clone()));
        let mut w = start(d.clone(), f);
        let attr = f.initial_points.keys().next().unwrap();
        let before = w.upbringing_growth(attr);
        assert_eq!(w.gain_upbringing_growth(attr, 50), 50);
        assert_eq!(w.gain_upbringing_growth(attr, 1000), 250, "开局不能消耗年度额度");
        assert_eq!(w.upbringing_growth(attr), before + 300);
        let restored = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
        assert_eq!(restored.state_hash(), w.state_hash(), "{}", f.key);
    }
    assert_eq!(spreads.len(), 12);
}

#[test]
fn existing_custom_allocations_are_added_before_family_points_and_old_growth_is_kept() {
    let d = defs();
    let f = d.upbringing.family("custom_seville_pilot").unwrap();
    let mut w = start(d.clone(), f);
    let mut attrs =
        d.captain.attributes.iter().enumerate().map(|(i, _)| d.captain.group(i).unwrap().start).collect::<Vec<_>>();
    // U02 把成年创建页的组起点由 1 改为 2：分配仍按“起点之上多分 1 点、2 点”构造，保持本测的原意。
    attrs[d.captain.attribute_index("seamanship").unwrap()] += 1;
    attrs[d.captain.attribute_index("medicine").unwrap()] += 2;
    w.state.agents.get_mut(&OwnerId::Player).unwrap().captain = Some(manifest_core::captain::CaptainProfile {
        birthday: w.state.protagonist.as_ref().unwrap().birthday(),
        sign: String::new(),
        answers: Vec::new(),
        attrs,
        genius: None,
        learned: Vec::new(),
        teachers: Vec::new(),
        created: w.day(),
    });
    w.state.upbringing.as_mut().unwrap().growth.clear();
    let restored = World::from_snapshot(d.clone(), w.state).unwrap();
    assert_eq!(restored.upbringing_projected("seamanship"), 5);
    assert_eq!(restored.upbringing_projected("medicine"), 3);
    assert_eq!(World::from_snapshot(d.clone(), restored.state.clone()).unwrap().state_hash(), restored.state_hash());
    let mut old = start(d.clone(), d.upbringing.family("mio").unwrap());
    old.state.upbringing.as_mut().unwrap().growth.insert("seamanship".into(), 17);
    assert_eq!(World::from_snapshot(d, old.state).unwrap().upbringing_growth("seamanship"), 17);
}

#[test]
fn initial_points_are_optional_and_invalid_attributes_or_ranges_are_rejected() {
    let d = defs();
    let root = manifest_data::find_data_dir().unwrap();
    let text = std::fs::read_to_string(root.join("worlds/terra16/upbringing/families/mio.toml")).unwrap();
    let mut value: toml::Value = toml::from_str(&text).unwrap();
    value["families"].as_array_mut().unwrap()[0].as_table_mut().unwrap().remove("initial_points");
    let legacy: manifest_core::upbringing::UpbringingDefs = value.try_into().unwrap();
    assert!(legacy.families[0].initial_points.is_empty());
    for (key, points) in [("missing", 1), ("fortune", 1), ("arcana", 1), ("arms", -1), ("arms", 10), ("honor", 6)] {
        let mut bad = (*d).clone();
        bad.upbringing.families[0].initial_points.insert(key.into(), points);
        assert!(
            manifest_core::upbringing::validation::validate(&bad).iter().any(|e| e.contains("家庭开局点")),
            "{key}/{points}"
        );
    }
}

#[test]
fn skip_defaults_are_floors_and_graduation_stays_inside_attribute_ranges() {
    let d = defs();
    for f in &d.upbringing.families {
        let key = &f.key;
        let mut w = start(d.clone(), f);
        w.gain_upbringing_growth("seamanship", 1000);
        let before = w.state.upbringing.as_ref().unwrap().growth.clone();
        // 直接构造到期状态以专测兑现；完整四年与重放由既有 upbringing_terra16 测试覆盖。
        w.state.day = manifest_core::scenario::day_of(&d, f.graduation).unwrap();
        w.state.upbringing.as_mut().unwrap().phase = Phase::Graduation;
        Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
        assert!(!w.upbringing_active());
        let defaults = &f.completion.as_ref().unwrap().defaults.growth;
        for (i, a) in d.captain.attributes.iter().enumerate() {
            assert_eq!(
                w.upbringing_growth(&a.key),
                before[&a.key].max(defaults.get(&a.key).copied().unwrap_or(0)),
                "{key}/{}",
                a.key
            );
            let group = d.captain.group(i).unwrap();
            let value = w.captain_profile(OwnerId::Player).unwrap().attrs[i];
            assert!((group.range[0]..=group.range[1]).contains(&value) || (a.key == "arcana" && value == 0));
        }
        let once = w.state_hash();
        assert!(Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).is_err());
        assert_eq!(w.state_hash(), once);
    }
}

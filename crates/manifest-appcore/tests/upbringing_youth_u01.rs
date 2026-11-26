//! U01：少年称呼的优先级与应用层自创姓名贯通。
use manifest_appcore::{cast_view, upbringing_view, views::Ctx};
use manifest_core::{
    ScenarioId, StaticData, World,
    cast::{NameDef, relations::Bond},
    replay::StartParams,
    scenario::NewGameRequest,
    upbringing::{CompanionRole, Phase},
};
use std::sync::{Arc, OnceLock};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn world() -> World {
    let d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    let mut start = StartParams::new(sid, 42);
    start.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: "mio_1553".into(),
        protagonist: Some("mio".into()),
        ..Default::default()
    });
    World::from_start(d, &start, |_| {}).unwrap()
}

fn call(w: &World, key: &str) -> String {
    cast_view::person(Ctx::plain(&w.defs), w, key).unwrap_or_else(|| panic!("人物尚未见过：{key}"))["call_name"]
        .as_str()
        .unwrap()
        .into()
}

fn companion_call(w: &World, key: &str) -> String {
    upbringing_view::upbringing(Ctx::plain(&w.defs), w)["companions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["key"] == key)
        .unwrap()["call_name"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn first_day_family_uses_their_youth_calls_in_both_views() {
    let w = world();
    let family = w.upbringing_family().unwrap().clone();
    let expected = |key: &str| -> String {
        family.call_you.get(key).filter(|s| !s.trim().is_empty()).unwrap_or(&family.youth_name).clone()
    };
    assert!(!family.youth_name.trim().is_empty());
    let before = w.state_hash();
    for key in ["ase", "mio_mother"] {
        assert!(!family.call_you[key].trim().is_empty(), "{key}");
        assert_eq!(call(&w, key), expected(key));
        assert_eq!(companion_call(&w, key), expected(key));
    }
    for person in cast_view::persons(Ctx::plain(&w.defs), &w, None)["persons"].as_array().unwrap() {
        assert_eq!(person["call_name"], expected(person["key"].as_str().unwrap()).as_str());
    }
    assert_eq!(w.state_hash(), before);
    // 弟弟此时远在京都，见面记录出现后也走家族称呼，不因测试公开未见人物。
    let mut met = w.clone();
    met.state.cast.persons.entry("ichijo_kanesada".into()).or_default().met = true;
    assert_eq!(call(&met, "ichijo_kanesada"), family.call_you["ichijo_kanesada"]);
    assert_eq!(companion_call(&met, "ichijo_kanesada"), family.call_you["ichijo_kanesada"]);
}

fn set_call(w: &mut World, family: &str, person: &str, name: &str) {
    Arc::make_mut(&mut w.defs)
        .upbringing
        .families
        .iter_mut()
        .find(|f| f.key == family)
        .unwrap()
        .call_you
        .insert(person.into(), name.into());
}

fn set_bond(w: &mut World, person: &str, bond: Option<Bond>) {
    let p = w.state.cast.persons.entry(person.into()).or_default();
    p.met = true;
    p.affection.bond = bond;
}

fn set_names(w: &mut World, person: &str, names: &[(&str, &str)]) {
    Arc::make_mut(&mut w.defs).cast.persons.iter_mut().find(|p| p.key == person).unwrap().names =
        names.iter().map(|(bond, name)| NameDef { bond: (*bond).into(), name: (*name).into() }).collect();
}

#[test]
fn bonded_peer_names_then_family_call_then_youth_name_then_protagonist_name() {
    let mut w = world();
    let stage = w.upbringing_family().unwrap().stages.iter().find(|s| s.academy.is_some()).unwrap().clone();
    w.state.day = manifest_core::scenario::day_of(&w.defs, stage.from).unwrap();
    w.state.upbringing.as_mut().unwrap().flags.insert(stage.entry_flag.unwrap());
    let academy = stage.academy.unwrap();
    let d = Arc::make_mut(&mut w.defs);
    let family = d.upbringing.families.iter_mut().find(|f| f.key == "mio").unwrap();
    family.youth_name = "U01.youth".into();
    family.call_you.clear();
    let a = d.upbringing.academies.iter_mut().find(|a| a.key == academy).unwrap();
    a.companions.insert("ase".into(), CompanionRole::Classmate);
    set_names(&mut w, "ase", &[("C", "U01.peer.C"), ("A", "U01.peer.A")]);
    assert_eq!(call(&w, "ase"), "U01.youth", "同窗仍须满足 names 的羁绊条件");
    set_call(&mut w, "mio", "ase", "U01.override");
    assert_eq!(call(&w, "ase"), "U01.override", "未结羁绊的同窗先用家族 call_you");
    assert_eq!(companion_call(&w, "ase"), "U01.override");
    w.state.cast.persons.get_mut("ase").unwrap().affection.bond = Some(Bond::B);
    assert_eq!(call(&w, "ase"), "U01.peer.C", "结了羁绊的同窗随等级改口，不被 call_you 盖住");
    assert_eq!(companion_call(&w, "ase"), "U01.peer.C");
    w.state.cast.persons.get_mut("ase").unwrap().affection.bond = Some(Bond::A);
    assert_eq!(call(&w, "ase"), "U01.peer.A");
    assert_eq!(companion_call(&w, "ase"), "U01.peer.A");
    // 结了羁绊、但当前等级还没有对应的 names：仍用 call_you。
    set_names(&mut w, "ase", &[("S", "U01.peer.S")]);
    assert_eq!(call(&w, "ase"), "U01.override", "羁绊等级不够的 names 不算");
    set_names(&mut w, "ase", &[("C", "U01.peer.C"), ("A", "U01.peer.A")]);
    set_call(&mut w, "mio", "ase", "  ");
    assert_eq!(call(&w, "ase"), "U01.peer.A", "空白覆盖须继续按同窗羁绊回退");
    for role in [
        CompanionRole::Rival,
        CompanionRole::Family,
        CompanionRole::Friend,
        CompanionRole::Mentor,
        CompanionRole::Penpal,
    ] {
        Arc::make_mut(&mut w.defs)
            .upbringing
            .academies
            .iter_mut()
            .find(|a| a.key == academy)
            .unwrap()
            .companions
            .insert("ase".into(), role);
        let peer = role == CompanionRole::Rival;
        set_call(&mut w, "mio", "ase", "");
        assert_eq!(call(&w, "ase"), if peer { "U01.peer.A" } else { "U01.youth" }, "{role:?}");
        set_call(&mut w, "mio", "ase", "U01.override");
        assert_eq!(call(&w, "ase"), if peer { "U01.peer.A" } else { "U01.override" }, "{role:?}");
    }
    set_call(&mut w, "mio", "ase", "");
    Arc::make_mut(&mut w.defs).upbringing.families.iter_mut().find(|f| f.key == "mio").unwrap().youth_name.clear();
    assert_eq!(call(&w, "ase"), w.defs.cast.person("mio").unwrap().name);
}

#[test]
fn same_classmate_uses_family_call_until_bonded_then_the_bond_level_name() {
    // 真实名册与真实 names：汐、冷泉雪是京都的同窗；鹰丸不在澪的学院名册里，只在家族同伴名单里是对手。
    let mut w = world();
    let stage = w.upbringing_family().unwrap().stages.iter().find(|s| s.academy.is_some()).unwrap().clone();
    w.state.day = manifest_core::scenario::day_of(&w.defs, stage.from).unwrap();
    w.state.upbringing.as_mut().unwrap().flags.insert(stage.entry_flag.clone().unwrap());
    let academy = w.defs.upbringing.academy(stage.academy.as_deref().unwrap()).unwrap();
    assert_eq!(academy.companions["ushio"], CompanionRole::Classmate);
    assert_eq!(academy.companions["reizei_yuki"], CompanionRole::Classmate);
    let family = w.upbringing_family().unwrap();
    assert_eq!(family.companions["takamaru"], CompanionRole::Rival);
    let mut rosters = family.stages.iter().filter_map(|s| s.academy.as_deref()).map(|k| w.defs.upbringing.academy(k));
    assert!(rosters.all(|a| !a.unwrap().companions.contains_key("takamaru")));
    let level = |w: &World, key: &str, rank: &str| {
        w.defs.cast.person(key).unwrap().names.iter().find(|n| n.bond == rank).unwrap().name.clone()
    };
    for key in ["ushio", "reizei_yuki", "takamaru"] {
        let family_call = format!("U01.call.{key}");
        set_call(&mut w, "mio", key, &family_call);
        set_bond(&mut w, key, None);
        assert_eq!(call(&w, key), family_call, "{key} 未结羁绊");
        let mut seen = vec![family_call.clone()];
        for (bond, rank) in [(Bond::C, "C"), (Bond::B, "B"), (Bond::A, "A"), (Bond::S, "S")] {
            set_bond(&mut w, key, Some(bond));
            let expected = level(&w, key, rank);
            assert_eq!(call(&w, key), expected, "{key} {rank}");
            seen.push(expected);
        }
        seen.dedup();
        assert_eq!(seen.len(), 5, "{key} 的称呼应随羁绊逐级改口：{seen:?}");
    }
    // 返乡探亲的学段没有学院；已结羁绊的同窗不改回生分的叫法，未结羁绊仍用 call_you。
    let home =
        w.upbringing_family().unwrap().stages.iter().find(|s| s.from > stage.from && s.academy.is_none()).unwrap().from;
    w.state.day = manifest_core::scenario::day_of(&w.defs, home).unwrap();
    assert!(w.upbringing_active() && w.upbringing_academy().is_none());
    set_bond(&mut w, "reizei_yuki", Some(Bond::B));
    assert_eq!(call(&w, "reizei_yuki"), level(&w, "reizei_yuki", "B"));
    set_bond(&mut w, "reizei_yuki", None);
    assert_eq!(call(&w, "reizei_yuki"), "U01.call.reizei_yuki");
}

#[test]
fn family_mentors_friends_and_penpals_always_use_family_call() {
    let mut w = world();
    let roles = w.upbringing_family().unwrap().companions.clone();
    let keys = ["ase", "mio_mother", "hirohashi_yasuko", "chidori", "lin_wandeng"];
    for key in keys {
        assert!(
            matches!(
                roles[key],
                CompanionRole::Family | CompanionRole::Mentor | CompanionRole::Friend | CompanionRole::Penpal
            ),
            "{key}"
        );
        let (c, s) = (format!("U01.names.C.{key}"), format!("U01.names.S.{key}"));
        set_names(&mut w, key, &[("C", &c), ("S", &s)]);
        set_call(&mut w, "mio", key, &format!("U01.call.{key}"));
    }
    for bond in [None, Some(Bond::C), Some(Bond::B), Some(Bond::A), Some(Bond::S)] {
        for key in keys {
            set_bond(&mut w, key, bond);
            assert_eq!(call(&w, key), format!("U01.call.{key}"), "{key} {bond:?}");
        }
        for key in ["ase", "mio_mother"] {
            assert_eq!(companion_call(&w, key), format!("U01.call.{key}"), "{key} {bond:?}");
        }
    }
}

#[test]
fn custom_origin_with_empty_youth_name_falls_back_to_the_player_name() {
    let d = defs();
    let family = d.upbringing.families.iter().find(|f| f.key == "custom_seville_pilot").unwrap().clone();
    assert!(family.youth_name.trim().is_empty(), "自创出身的 youth_name 有意留空");
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == family.scenario).unwrap());
    let mut start = StartParams::new(sid, 42);
    start.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: family.scenario.clone(),
        template: Some("custom_seville_pilot".into()),
        captain: Some(manifest_core::scenario::CustomCaptain {
            name: "U01自创".into(),
            look: 0,
            gender: family.gender,
            birthday: [family.born[1], family.born[2]],
        }),
        ..Default::default()
    });
    let mut w = World::from_start(d, &start, |_| {}).unwrap();
    assert!(w.upbringing_active());
    let key = "custom_seville_pilot_guardian";
    let name = |w: &World| -> String {
        cast_view::person_with_name(Ctx::plain(&w.defs), w, key, Some("U01自创")).unwrap()["call_name"]
            .as_str()
            .unwrap()
            .into()
    };
    set_call(&mut w, "custom_seville_pilot", key, "");
    for bond in [None, Some(Bond::S)] {
        set_bond(&mut w, key, bond);
        assert_eq!(name(&w), "U01自创", "{bond:?}");
    }
    set_call(&mut w, "custom_seville_pilot", key, "U01.call");
    assert_eq!(name(&w), "U01.call");
}

#[test]
fn graduation_preserves_the_original_bond_names_and_captain_fallback() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    let family = d.upbringing.families.iter_mut().find(|f| f.key == "mio").unwrap();
    family.youth_name = "U01.youth".into();
    family.call_you.insert("ase".into(), "U01.override".into());
    d.cast.persons.iter_mut().find(|p| p.key == "ase").unwrap().names =
        vec![NameDef { bond: "C".into(), name: "U01.adult".into() }];
    w.state.upbringing.as_mut().unwrap().phase = Phase::Done;
    assert_eq!(call(&w, "ase"), "船长");
    w.state.cast.persons.get_mut("ase").unwrap().affection.bond = Some(Bond::C);
    assert_eq!(call(&w, "ase"), "U01.adult");
}

#[test]
fn custom_name_reaches_all_three_handlers_and_survives_save_load() {
    use manifest_appcore::{AppPaths, AppState, handlers};
    use serde_json::json;
    let dir = std::env::temp_dir().join(format!("manifest-u01-youth-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let request = serde_json::from_value(json!({
        "world":"terra16", "scenario":"plus_ultra", "template":"custom_seville_pilot", "seed":42,
        "captain":{"name":"U01自创姓名", "look":0, "gender":"f", "birthday":[1,1]}
    }))
    .unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let family = defs().upbringing.family("custom_seville_pilot").unwrap().clone();
    assert!(family.youth_name.trim().is_empty());
    // 交接单写了的人用家族称呼；其余已见人物沿用玩家自己起的名字，验证自创姓名贯通三个处理函数。
    let expected = |key: &str| -> String {
        family.call_you.get(key).filter(|s| !s.trim().is_empty()).cloned().unwrap_or_else(|| "U01自创姓名".into())
    };
    let check = || {
        let detail = handlers::pending::person(&st, "custom_seville_pilot_guardian".into()).unwrap();
        assert_eq!(detail["call_name"], expected("custom_seville_pilot_guardian").as_str());
        let list = handlers::pending::persons(&st, None).unwrap();
        let persons = list["persons"].as_array().unwrap();
        assert!(!persons.is_empty());
        assert!(persons.iter().all(|p| p["call_name"] == expected(p["key"].as_str().unwrap()).as_str()));
        assert!(persons.iter().any(|p| p["call_name"] == "U01自创姓名"), "须有人回退到自创姓名");
        let upbringing = handlers::pending::upbringing(&st).unwrap();
        assert_eq!(upbringing["protagonist"]["name"], "U01自创姓名");
        let companions = upbringing["companions"].as_array().unwrap();
        assert!(!companions.is_empty());
        assert!(companions.iter().all(|p| p["call_name"] == expected(p["key"].as_str().unwrap()).as_str()));
    };
    check();
    handlers::save_game(&st, "u01-custom").unwrap();
    handlers::load_game(&st, "u01-custom").unwrap();
    check();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    drop(st);
    std::fs::remove_dir_all(dir).unwrap();
}

//! A9：真实模板归属、缺省结业、一次性资本与旧同学重逢。
use manifest_core::{
    replay::{LogEntry, Source, StartParams, replay},
    scenario::{Gender, NewGameRequest, templates},
    *,
};
use std::sync::{Arc, OnceLock};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

#[test]
fn twelve_templates_have_authoritative_profiles_and_all_awards_have_story_flags() {
    let d = terra();
    let keys: Vec<_> = d.scenarios.iter().flat_map(|s| &s.template_defs).map(|t| &t.key).collect();
    assert_eq!(keys.len(), 12);
    assert!(templates::validate(&d).is_empty());
    for key in keys {
        let p = templates::profile(&d, key).unwrap();
        assert_eq!(&p.family, key);
        assert!(!p.academies.is_empty());
        assert!(!p.growth.is_empty());
        assert!(!p.skills.is_empty());
        assert!(!p.titles.is_empty());
        assert_eq!(p.voyage_flag, Some(format!("c12_voyage_{key}")));
        assert_eq!(p.npcs.len(), 2, "{key}");
        for (npc, tracks) in p.npcs {
            assert!(p.companions.contains_key(&npc), "{key}/{npc}");
            assert!(!tracks.is_empty(), "{key}/{npc}");
        }
    }
    for family in &d.upbringing.families {
        let completion = family.completion.as_ref().unwrap();
        let flag = Some(format!("c12_voyage_{}", family.key));
        assert_eq!(completion.capital.grant_once, flag, "{}", family.key);
        for key in &completion.paths {
            let path = d.upbringing.paths.iter().find(|p| &p.key == key).unwrap();
            assert_eq!(path.capital.grant_once, flag, "{key}");
        }
    }
    for path in &d.upbringing.paths {
        assert!(path.award.flags.contains(&format!("path_{}", path.key)), "{}", path.key);
    }
    for ending in &d.upbringing.endings {
        assert!(ending.award.flags.contains(&format!("ending_{}", ending.key)), "{}", ending.key);
    }
}

#[test]
fn ambiguous_families_and_foreign_default_paths_or_voyage_flags_are_rejected() {
    for mutation in 0..3 {
        let mut d = terra();
        let defs = Arc::make_mut(&mut d);
        let index = defs.upbringing.families.iter().position(|f| f.key == "custom_seville_pilot").unwrap();
        match mutation {
            0 => {
                let mut f = defs.upbringing.families[index].clone();
                f.key = "duplicate".into();
                defs.upbringing.families.push(f);
            }
            1 => defs.upbringing.families[index].completion.as_mut().unwrap().defaults.path = Some("mio_path_1".into()),
            _ => {
                defs.upbringing
                    .paths
                    .iter_mut()
                    .find(|p| p.key == "custom_seville_pilot_path_1")
                    .unwrap()
                    .capital
                    .grant_once = Some("c12_voyage_mio".into())
            }
        }
        assert!(!templates::validate(&d).is_empty());
    }
}

#[test]
fn every_template_graduates_with_only_its_voyage_flag_and_never_regrants_capital() {
    let base = terra();
    let keys: Vec<_> = base.scenarios.iter().flat_map(|s| &s.template_defs).map(|t| t.key.clone()).collect();
    for key in keys {
        let mut d = base.clone();
        let defs = Arc::make_mut(&mut d);
        let sid = defs.scenarios.iter().position(|s| s.key == "plus_ultra").unwrap();
        // 定位在真实结业日前三天；四年普通月程由 E69 矩阵另行审计。
        defs.scenarios[sid].start_date = [1556, 12, 29];
        defs.scenarios[sid].control_date = [1556, 12, 29];
        let request = NewGameRequest {
            world: "terra16".into(),
            scenario: "plus_ultra".into(),
            template: Some(key.clone()),
            seed: Some(42),
            captain: Some(scenario::CustomCaptain {
                name: "测试船长".into(),
                look: 0,
                gender: Gender::F,
                birthday: [1, 1],
            }),
            ..Default::default()
        };
        let start =
            StartParams { scenario: ScenarioId::from_idx(sid), seed: 42, opening: Some(request), bootstrap_days: 0 };
        let mut w = World::from_start(d.clone(), &start, |_| {}).unwrap();
        assert_eq!(w.state.upbringing.as_ref().unwrap().family, key);
        let command = Command::SkipUpbringing { owner: OwnerId::Player };
        let log =
            vec![LogEntry { tick: w.day(), seq: 0, source: Source::Player, command: command.clone(), minute: None }];
        command.apply(&mut w).unwrap();
        while w.upbringing_skipping() {
            w.end_day().unwrap();
        }
        let record = w.state.upbringing.as_ref().unwrap().graduation.as_ref().unwrap();
        let path = record.path.as_ref().unwrap();
        if record.path_fulfilled {
            assert!(w.state.story2.flags.contains(&format!("path_{path}")));
        }
        let ending = record.ending.as_ref().unwrap();
        assert!(w.state.story2.flags.contains(&format!("ending_{ending}")));
        let voyages: Vec<_> = w.state.story2.flags.iter().filter(|f| f.starts_with("c12_voyage_")).cloned().collect();
        assert_eq!(voyages, vec![format!("c12_voyage_{key}")]);
        let before = w.state.clone();
        assert!(command.apply(&mut w).is_err());
        assert_eq!(before, w.state);
        assert!(w.money_conserved());
        let loaded = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
        assert_eq!(loaded.state.upbringing, w.state.upbringing);
        assert_eq!(loaded.state.cast, w.state.cast);
        assert_eq!(loaded.state.items, w.state.items);
        assert_eq!(replay(d, start, &log, w.day()).unwrap().state, w.state);
    }
}

#[test]
fn reunion_remembers_real_school_bonds_once_without_giving_assets() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let defs = Arc::make_mut(&mut d);
    let family = &mut defs.upbringing.families[0];
    family.graduation = [1553, 1, 2];
    family.stages.remove(0);
    family.stages[0].from = [1553, 1, 1];
    family.stages[0].entry_flag = None;
    family.stages[0].entry_event = None;
    family.completion.as_mut().unwrap().capital.allies.push("classmate_b".into());
    for path in &mut defs.upbringing.paths {
        path.capital.allies.push("classmate_b".into());
    }
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d.clone(), sid, 42).unwrap();
    // 这位伙伴只在结业资本中成为盟友，没有实际的同学相识记录。
    let newcomer = w.state.cast.persons.entry("classmate_b".into()).or_default();
    newcomer.met = false;
    newcomer.schedule = Some(cast::ScheduleDef {
        from: [1553, 1, 1],
        to: None,
        at: "test_east".into(),
        venue: String::new(),
        seasons: vec![],
    });
    w.change_affinity("classmate_a", 80).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    w.promise_to("classmate_a").unwrap();
    w.state.cast.persons.get_mut("classmate_a").unwrap().interactions.memories.push("测试经历".into());
    let affection = w.affection("classmate_a").unwrap().clone();
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
    w.end_day().unwrap();
    let school = w.state.cast.persons["classmate_a"].school.as_ref().unwrap();
    assert_eq!(school.affection, affection);
    assert!(school.promise);
    assert_eq!(school.memories, vec!["测试经历"]);
    assert_eq!(school.academies, vec!["test_academy"]);
    assert!(school.reunited_on.is_none());
    assert!(w.state.cast.persons.get("mentor").is_none_or(|p| p.school.is_none()));
    assert!(w.state.cast.persons["classmate_b"].met);
    assert!(w.state.cast.persons["classmate_b"].school.is_none());
    let loaded = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    assert_eq!(loaded.state.cast, w.state.cast);
    w.end_day().unwrap();
    let at = w.state.cast.place.clone();
    let away = w.defs.locations.iter().position(|l| l.key == "test_east").unwrap();
    w.state.cast.place = Some(cast::CastPlace { loc: LocId::from_idx(away), venue: String::new() });
    w.cast_meet_here();
    assert!(w.state.cast.persons["classmate_a"].school.as_ref().unwrap().parted);
    w.state.cast.place = at;
    let cash = w.state.agents[&OwnerId::Player].cash;
    let items = w.state.items.clone();
    let fleets = w.state.fleets.clone();
    w.cast_meet_here();
    let memory = w.state.cast.persons["classmate_a"].school.clone();
    assert_eq!(memory.as_ref().unwrap().reunited_on, Some(w.day()));
    w.cast_meet_here();
    assert_eq!(w.state.cast.persons["classmate_a"].school, memory);
    assert_eq!(w.state.agents[&OwnerId::Player].cash, cash);
    assert_eq!(w.state.items, items);
    assert_eq!(w.state.fleets, fleets);
    let future = w.day() + 1;
    w.state.cast.persons.get_mut("classmate_a").unwrap().school.as_mut().unwrap().reunited_on = Some(future);
    assert!(World::from_snapshot(d, w.state).is_err());
}

#[test]
fn legacy_person_states_do_not_invent_school_memories() {
    let state: cast::PersonState = serde_json::from_str("{}").unwrap();
    assert!(state.school.is_none());
    assert!(serde_json::to_value(&state).unwrap().get("school").is_none());
}

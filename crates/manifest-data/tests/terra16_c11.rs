//! C11：真实寰宇内容走生产加载器，守住中文回退与玩法边界。
use manifest_core::StaticData;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn defs() -> &'static Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("C11 完整生产加载与引用校验"))
}

#[test]
fn chinese_only_arcana_loads_with_bounded_costs_and_no_religious_consumables() {
    let world = manifest_data::resolve_world(&root(), "terra16").expect("寰宇分片");
    assert_eq!(world.manifest.languages, ["zh"]);
    assert!(!root().join("worlds/terra16/locales/en/arcana.toml").exists());
    let d = defs();
    assert_eq!(d.arcana.schools.len(), 37);
    assert_eq!(d.arcana.spells.len(), 34);
    for school in &d.arcana.schools {
        assert!(school.basis.is_some() && !school.sources.is_empty(), "{}", school.key);
    }
    for spell in &d.arcana.spells {
        assert!(spell.cooldown_days >= 14 && !spell.requires.is_empty(), "{}", spell.key);
        assert!(spell.cost.cash > 0 || !spell.cost.goods.is_empty() || !spell.cost.items.is_empty());
    }
    for school in ["talismanic_shirt", "ryukyu_blessing", "ethiopian_scroll"] {
        assert!(!d.arcana.spells.iter().any(|s| s.school == school));
    }
    assert!(manifest_core::arcana::validation::validate(d).is_empty());
}

#[test]
fn societies_have_real_trials_and_separate_suspicion_from_affection() {
    let d = defs();
    assert_eq!(d.societies.societies.len(), 69);
    let hermetic = d.societies.society("hermetic").expect("赫尔墨斯结社");
    assert_eq!(hermetic.ranks.len(), 7);
    for society in &d.societies.societies {
        for rank in &society.ranks {
            let t = d.story2.track(rank.trial.as_deref().expect("真实试炼引用")).expect("试炼存在");
            assert!(!t.auto && !t.chapters.is_empty());
        }
    }
    assert_eq!(d.societies.policies.len(), 6);
    assert!(d.societies.policies.iter().all(|p| p.forbids.ideas.is_empty() && p.forbids.lineages.is_empty()));
    assert!(manifest_core::societies::validation::validate(d).is_empty());
}

#[test]
fn inherited_cast_keys_and_every_transformation_have_safe_reversals() {
    let d = defs();
    assert_eq!(d.lineages.lineages.len(), 19);
    for key in ["human", "undead", "revenant", "dhampir", "elf"] {
        assert!(d.lineages.lineage(key).is_some(), "{key}");
    }
    assert_eq!(d.lineages.lineages.iter().filter(|l| l.reversal.is_some()).count(), 4);
    let daylight = d.lineages.lineage("cain_kin").unwrap().daylight.as_ref().unwrap();
    assert_eq!(daylight.shade, ["parasol", "veil", "covered_litter"]);
    assert!(manifest_core::lineages::validation::validate(d).is_empty());
}

#[test]
fn draft_arcana_uses_the_production_schema_and_rejects_unknown_fields() {
    let temp = tempfile::tempdir().expect("仅在配置的 target 临时目录内测试");
    let package = temp.path().join("worlds/probe");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(
        package.join("world.toml"),
        "key='probe'\nname='校验'\nmap='absent'\ndraft=true\nlanguages=['zh']\n[tables]\narcana=['arcana.toml']\n",
    )
    .unwrap();
    let valid =
        "[[schools]]\nkey='probe'\nname='校验流派'\nskill='probe_skill'\nbasis='historical'\nsources=['校验出处']\n";
    std::fs::write(package.join("arcana.toml"), valid).unwrap();
    assert!(manifest_data::worlds::validate_draft_world(temp.path(), "probe").is_ok());
    std::fs::write(package.join("arcana.toml"), format!("{valid}unknown=1\n")).unwrap();
    assert!(manifest_data::worlds::validate_draft_world(temp.path(), "probe").is_err());
    let mut invalid = (**defs()).clone();
    invalid.arcana.spells[0].school = "missing_school".into();
    assert!(!manifest_core::arcana::validation::validate(&invalid).is_empty());
}

fn play_world(at: &str) -> manifest_core::World {
    use manifest_core::*;
    let mut d = defs().clone();
    let loc = d.find_loc(at).unwrap();
    let dd = Arc::make_mut(&mut d);
    // 只把测试开局放到会议当天，内容定义及其条件不变，不推演此前三十年。
    let sc = &mut dd.scenarios[0];
    sc.start_date = [1583, 3, 1];
    sc.control_date = sc.start_date;
    sc.start = loc;
    sc.start_loc = loc;
    sc.upbringing = false;
    sc.timeline = None;
    for t in &mut dd.story2.tracks {
        t.auto = false;
    }
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.state.story2 = Default::default();
    w.state.protagonist = Some(scenario::ProtagonistIdentity {
        protagonist: None,
        template: None,
        born: [1540, 1, 1],
        gender: scenario::Gender::F,
    });
    w
}

fn activate(w: &mut manifest_core::World, track: &str, chapter: &str) {
    use manifest_core::story2::*;
    w.state.story2.tracks.insert(
        track.into(),
        TrackState {
            chapter: chapter.into(),
            entered: w.day(),
            status: Status::Active,
            visited: Default::default(),
            failure: None,
        },
    );
    w.refresh_story2();
}

#[test]
fn city_and_seven_isles_require_their_actual_keys_and_keep_npcs_out() {
    use manifest_core::*;
    let mut w = play_world("lisbon");
    let p = OwnerId::Player;
    assert!(!w.realm_passable(p, "atlantis"));
    w.grant_item(p, "tabula_smaragdina", 1).unwrap();
    assert!(!w.realm_passable(p, "atlantis"), "普通翠玉录不等于唤醒");
    w.state.story2.flags.insert("c11_atlantis_key_ready".into());
    assert!(w.realm_passable(p, "atlantis"));
    assert!(!w.realm_passable(OwnerId::Company(CompanyId(0)), "atlantis"));
    assert!(!w.realm_passable(p, "persephone_isles"));
    w.grant_item(p, "seven_isles_route", 1).unwrap();
    for n in 1..=7 {
        let port = w.defs.find_loc(&format!("persephone_isle_{n}")).unwrap();
        assert!(w.realm_port_allowed(p, port));
        assert_eq!(w.realm_key_at_port(port), Some("persephone_isles"));
    }
    let a = w.defs.realms.realm("atlantis").unwrap();
    let b = w.defs.realms.realm("persephone_isles").unwrap();
    assert!(a.veil.cells.iter().all(|c| !b.veil.contains(&w.defs, *c)));
    assert_eq!(w.defs.realms.realms.len(), 2);
}

#[test]
fn all_six_council_verdicts_are_exclusive_real_commands_and_survive_reload() {
    use manifest_core::*;
    let base = play_world("atlantis_port");
    let names = ["close", "open", "hand_hermetic", "hand_christ", "hand_ottoman", "hand_dragon"];
    for (choice, name) in names.iter().enumerate() {
        let mut w = base.clone();
        w.grant_item(OwnerId::Player, "tabula_smaragdina", 1).unwrap();
        w.state.story2.flags.extend(["c11_atlantis_key_ready".into(), "c13_main_free_stance_open".into()]);
        activate(&mut w, "atlantis_council", "arrival");
        assert!(!w.state.story2.flags.contains("atlantis_council_met"));
        for chapter in ["arrival", "keepsakes", "testimony", "stance"] {
            assert_eq!(w.pending_story2().unwrap().chapter, chapter);
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
        assert!(w.state.story2.flags.contains("atlantis_council_met"));
        assert_eq!(w.pending_story2().unwrap().chapter, "verdict");
        let mut replayed = w.clone();
        let cmd = Command::StoryAnswer { owner: OwnerId::Player, choice: choice as u32 };
        cmd.apply(&mut w).unwrap();
        cmd.apply(&mut replayed).unwrap();
        assert_eq!(w.state_hash(), replayed.state_hash());
        for other in names {
            assert_eq!(w.state.story2.flags.contains(&format!("atlantis_verdict_{other}")), other == *name);
        }
        assert_eq!(w.realm_passable(OwnerId::Player, "atlantis"), *name != "close");
        assert_eq!(w.realm_passable(OwnerId::Company(CompanyId(0)), "atlantis"), *name == "open");
        assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state_hash(), w.state_hash());
        let before = w.state_hash();
        assert!(cmd.apply(&mut w).is_err());
        assert_eq!(w.state_hash(), before, "结局不能重复领奖");
    }
}

#[test]
fn historical_flagships_and_encounters_never_grant_ownership() {
    let d = defs();
    let nonowners = [
        "solomon_ship",
        "botafogo",
        "henry_grace",
        "lepanto_galleass",
        "san_martin",
        "ark_royal",
        "falkenberg",
        "draug_boat",
        "naglfar",
        "ghost_junk",
    ];
    for s in &d.legend_ships.ships {
        assert!(s.unique && s.limit == 1);
        let t = d.story2.track(s.acquire.track.as_deref().unwrap()).unwrap();
        let done = t.chapters.iter().flat_map(|c| &c.choices).any(|c| c.next == "done");
        assert_eq!(done, !nonowners.contains(&s.key.as_str()), "{}", s.key);
        assert!(s.acquire.blueprint.is_some());
    }
    assert!(!d.legend_ships.ship("santa_anna").unwrap().traits.contains(&manifest_core::legend_ships::Trait::Armored));
}

#[test]
fn seventh_trial_requires_all_existing_marks_without_consuming_them() {
    use manifest_core::story2::{Condition, Effect, ObjectiveKind};
    let d = defs();
    let trial = d.story2.track("c11_trial_hermetic_7").unwrap();
    assert_eq!(trial.chapters.len(), 3);
    let marks = ["tides", "genoa", "toledo", "cortes", "seal", "solomon", "buddha"];
    for choice in &trial.chapters[0].choices {
        for suffix in marks {
            assert!(choice.requires.contains(&Condition::Item { item: format!("emerald_mark_{suffix}"), qty: 1 }));
        }
    }
    for c in trial.chapters.iter().skip(1) {
        assert!(c.objectives.iter().any(|o| o.kind == ObjectiveKind::Wait { days: 7 }));
    }
    assert!(
        !trial
            .chapters
            .iter()
            .flat_map(|c| &c.choices)
            .flat_map(|c| &c.effects)
            .any(|e| matches!(e, Effect::Item { item, qty } if item.starts_with("emerald_mark_") && *qty < 0))
    );
    assert_eq!(d.creatures.creatures.len(), 100);
}

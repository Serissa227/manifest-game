// U03 工作包 1、6（钱卡不死、自动安排打分）的数据测试；与工作包 2–5 的 upbringing_u03.rs 同名新建，合并时改成本文件名。
//! U03：寰宇的零用钱档次、每所学院的免费自习，以及自动安排预设的评价映射。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest},
    upbringing::{ActivityKind, FamilyDef, Stage},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn start(d: Arc<StaticData>, f: &FamilyDef) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut p = StartParams::new(sid, 42);
    p.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U03".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &p, |_| {}).unwrap()
}

#[test]
fn every_family_has_a_monthly_allowance_by_household_wealth() {
    let d = defs();
    assert_eq!(d.upbringing.families.len(), 21);
    for f in &d.upbringing.families {
        let capital = f.completion.as_ref().unwrap().capital.cash;
        let expected = if capital >= 9500 {
            (20, 36)
        } else if capital >= 7000 {
            (15, 30)
        } else {
            (10, 24)
        };
        assert_eq!((f.allowance.home, f.allowance.academy), expected, "{}：结业出资 {capital}", f.key);
    }
    // 渔家竹筏是“薄”档，安特卫普的交易所人家是“富”档。
    assert_eq!(d.upbringing.family("custom_chincha_rafts").unwrap().allowance.home, 10);
    assert_eq!(d.upbringing.family("lieve").unwrap().allowance.home, 20);
    // 学院本身不另发津贴（字段留空）。
    assert!(d.upbringing.academies.iter().all(|a| a.allowance == 0));
}

#[test]
fn every_academy_offers_one_free_self_study_at_half_a_normal_lesson() {
    let d = defs();
    assert_eq!(d.upbringing.academies.len(), 23);
    for academy in &d.upbringing.academies {
        let free: Vec<_> = academy.curriculum.iter().filter(|c| c.cost == 0).collect();
        assert_eq!(free.len(), 1, "{} 应有且只有一门免费课", academy.key);
        let study = free[0];
        assert_eq!(study.key, format!("{}_course_self_study", academy.key));
        assert_eq!(study.kind, ActivityKind::Lesson);
        assert!(study.needs.is_empty() && study.skills.is_empty() && study.mentor.is_none() && study.events.is_empty());
        assert_eq!(study.unlock.year, Some(1));
        assert!(study.unlock.flag.is_none() && study.monthly_limit.is_none() && study.age.is_none());
        assert_eq!(study.place.academy.as_deref(), Some(academy.key.as_str()));
        // 收益是本院第一门一年级课的一半，疲劳也减半。
        let base = academy.curriculum.iter().find(|c| c.cost > 0 && c.unlock.year == Some(1)).unwrap();
        let half: BTreeMap<_, _> =
            base.gains.iter().map(|(k, r)| (k.clone(), [(r[0] / 2).max(1), ((r[1] + 1) / 2).max(1)])).collect();
        assert_eq!(study.gains, half, "{}", academy.key);
        assert_eq!(study.fatigue, base.fatigue / 2);
        // 自习也进了全局活动表，自动安排与视图都看得到。
        assert_eq!(d.upbringing.activity(&study.key), Some(study));
        assert!(academy.curriculum.iter().filter(|c| c.cost > 0).all(|c| c.cost == 6));
    }
}

#[test]
fn presets_map_to_rating_attributes() {
    let d = defs();
    let expected: BTreeMap<String, Vec<String>> = [
        ("navigation", vec!["seamanship", "astronomy", "command"]),
        ("trade", vec!["commerce", "numeracy", "eloquence", "stewardship"]),
        ("combat", vec!["arms", "gunnery", "command", "agility"]),
        ("learning", vec!["learning", "intellect", "astronomy", "medicine"]),
        ("social", vec!["etiquette", "eloquence", "charm", "sensibility"]),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v.into_iter().map(String::from).collect()))
    .collect();
    assert_eq!(d.upbringing.rules.auto_presets, expected);
    for attrs in expected.values() {
        assert!(attrs.iter().all(|a| d.captain.attribute_index(a).is_some()));
    }
}

#[test]
fn opening_month_budget_and_free_fallbacks_exist_for_every_family() {
    let d = defs();
    for f in &d.upbringing.families {
        let mut w = start(d.clone(), f);
        // U07：完整确认开场介绍后才授予入场旗标。
        while w.upbringing_stage_on(w.cast_date()).is_none() {
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
        let b = w.upbringing_budget();
        assert_eq!(b.allowance, f.allowance.home, "{}", f.key);
        assert_eq!(b.cash, 200, "{}", f.key);
        assert_eq!(b.reserve, 0, "{}", f.key);
        assert_eq!(w.upbringing_stage_on(w.cast_date()).unwrap().stage, Stage::Home);
        // U06K：行动制已取代旧月/周程；其余家庭仍检查一文不名时的免费预设。
        if !w.act_running() {
            w.state.agents.get_mut(&OwnerId::Player).unwrap().cash = 0;
            for preset in manifest_core::upbringing::AUTO_PRESETS {
                let slots = w.auto_plan(preset).unwrap_or_else(|e| panic!("{}/{preset}: {e}", f.key));
                // U05：寰宇按周排程，自动安排给的是本周各格，用周程的校验。
                if w.upbringing_weekly() {
                    w.check_week_plan(OwnerId::Player, &slots).unwrap();
                } else {
                    w.check_month_plan(OwnerId::Player, &slots).unwrap();
                }
            }
        }
    }
}

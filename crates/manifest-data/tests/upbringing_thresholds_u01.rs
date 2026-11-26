//! U01：首旬可用选择、首年绝对成长上限及延后资格的真实数据审计。
use manifest_core::{
    Command, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest},
    story2::{ChapterDef, Condition},
    upbringing::{ActivityDef, ActivityKind, ActivityStage, FamilyDef, RatingRequirement, Requirements, Stage},
};
use std::sync::{Arc, OnceLock};

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
            name: "U01".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    let mut w = World::from_start(d, &p, |_| {}).unwrap();
    // U07：澪的入场旗标在整段开场介绍的最后一幕授予；逐幕确认到家乡日程开放。
    while w.upbringing_stage_on(w.cast_date()).is_none() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    }
    assert!(w.upbringing_stage_on(w.cast_date()).is_some(), "{} 的开场尚未完成", f.key);
    w
}
fn ceiling(w: &mut World, years: i64) {
    w.state.upbringing.as_mut().unwrap().flags.insert("arcana_awakened".into());
    for (i, a) in w.defs.captain.attributes.iter().enumerate() {
        if a.key == "fortune" {
            continue;
        }
        let cap = if w.defs.captain.group(i).unwrap().key == "conduct" { 100 } else { 1000 };
        let g = w.state.upbringing.as_mut().unwrap().growth.get_mut(&a.key).unwrap();
        *g = (*g + w.defs.upbringing.rules.annual_growth_cap * years).min(cap);
    }
    let inventory = w.state.items.owners.entry(OwnerId::Player).or_default();
    for skill in &w.defs.story2.skills {
        inventory.skill_xp.insert(skill.clone(), 24 * 12 * years);
    }
    w.state.upbringing.as_mut().unwrap().fame = 100;
}
fn numeric(w: &World, c: &Condition, source: &str) -> usize {
    let pair = match c {
        Condition::Attr { attr, ge } => (w.story2_check_value(attr), *ge),
        Condition::Growth { attr, ge } => (w.upbringing_growth(attr), *ge),
        Condition::Skill { skill, ge } => (w.upbringing_skill_xp(skill), *ge),
        Condition::Fame { ge } => (100, *ge),
        _ => return 0,
    };
    assert!(pair.0 >= pair.1, "{source}: {c:?} 超过开局加年度成长上限 {}", pair.0);
    1
}
fn appears(f: &FamilyDef, c: &ChapterDef, year: u32) -> bool {
    c.window.is_none_or(|[from, _]| from[0] <= year)
        && c.when.iter().all(|c| match c {
            Condition::Date { from, .. } => from.is_none_or(|d| d[0] <= year),
            Condition::Flag { flag, value: true } if flag.starts_with("c9_family_") => {
                flag == &format!("c9_family_{}", f.key)
            }
            Condition::Protagonist { protagonist } => {
                f.protagonists.contains(protagonist) || f.templates.contains(protagonist)
            }
            Condition::ProtagonistIn { protagonist_in } => {
                protagonist_in.iter().any(|p| f.protagonists.contains(p) || f.templates.contains(p))
            }
            Condition::Age { person: None, ge, .. } => ge.is_none_or(|age| f.born[0] + age <= year),
            _ => true,
        })
}
fn requirements(w: &World, r: &Requirements) -> bool {
    let min = r.min.unwrap_or(0);
    r.all.iter().all(|r| requirements(w, r))
        && (r.any.is_empty() || r.any.iter().any(|r| requirements(w, r)))
        && r.attr.as_ref().is_none_or(|k| w.upbringing_projected(k) >= min)
        && r.rating.as_ref().is_none_or(|k| {
            w.upbringing_rating(k.key())
                >= match k {
                    RatingRequirement::Key(_) => min,
                    RatingRequirement::Threshold(t) => min.max(t.min),
                }
        })
        && r.skill.as_ref().is_none_or(|k| w.upbringing_skill_level(k) >= r.level)
        && r.fame_min.is_none_or(|v| v <= 100)
}

#[test]
fn first_critical_event_never_requires_more_than_one_training_slot() {
    let d = defs();
    let mut count = 0;
    let mut unreachable = Vec::new();
    for f in &d.upbringing.families {
        let w = start(d.clone(), f);
        let mut reachable = vec![w.clone()];
        for a in d
            .upbringing
            .activities
            .iter()
            .filter(|a| a.needs.is_empty() && w.upbringing_activity_available(a, w.cast_date()).is_ok())
        {
            let mut after = w.clone();
            for (key, range) in &a.gains {
                after.gain_upbringing_growth(key, range[0]);
            }
            for skill in &a.skills {
                *after
                    .state
                    .items
                    .owners
                    .entry(OwnerId::Player)
                    .or_default()
                    .skill_xp
                    .entry(skill.skill.clone())
                    .or_default() += skill.xp;
            }
            reachable.push(after);
        }
        let key = format!("c9_{}_critical_00", f.key);
        let track = d.story2.track(&key).unwrap();
        for choice in &track.chapters[0].choices {
            for condition in &choice.requires {
                if matches!(
                    condition,
                    Condition::Attr { .. }
                        | Condition::Growth { .. }
                        | Condition::Skill { .. }
                        | Condition::Fame { .. }
                ) {
                    count += 1;
                }
            }
            let can_reach = reachable.iter().any(|after| {
                choice.requires.iter().all(|condition| match condition {
                    Condition::Attr { attr, ge } => after.story2_check_value(attr) >= *ge,
                    Condition::Growth { attr, ge } => after.upbringing_growth(attr) >= *ge,
                    Condition::Skill { skill, ge } => after.upbringing_skill_xp(skill) >= *ge,
                    Condition::Fame { ge } => after.state.upbringing.as_ref().unwrap().fame >= *ge,
                    _ => true,
                })
            });
            if !can_reach {
                unreachable.push(format!("{key}/{}：开局或一旬后不可达 {:?}", choice.key, choice.requires));
            }
        }
    }
    // 养成内容（2026-11-03）：九位主角的关键事件 00 改成“稳妥 / 检定 / 情谊或物件”三岔，不再有数值门槛，
    // 只剩十二种自定义出身各 3 项（63 → 36）。
    assert_eq!(count, 36);
    assert!(unreachable.is_empty(), "{}", unreachable.join("\n"));
}

fn courses(w: &World) -> Vec<Option<ActivityDef>> {
    std::iter::once(None)
        .chain(
            w.defs
                .upbringing
                .activities
                .iter()
                .filter(|a| {
                    matches!(a.kind, ActivityKind::Lesson | ActivityKind::Training | ActivityKind::Job)
                        && w.upbringing_risk(a) < 10_000
                        && a.needs.is_empty()
                        && w.upbringing_activity_available(a, w.cast_date()).is_ok()
                })
                .cloned()
                .map(Some),
        )
        .collect()
}

/// 每阶段专练一门，成功时取最低成长；保留活动风险，失手会延后达到门槛的时间。
fn forecast(w: &World, condition: &Condition, route: [(Option<&ActivityDef>, i64); 2]) -> i64 {
    let mut growth = w.state.upbringing.as_ref().unwrap().growth.clone();
    let mut xp = match condition {
        Condition::Skill { skill, .. } => w.upbringing_skill_xp(skill),
        _ => 0,
    };
    for (activity, slots) in route {
        let Some(a) = activity else { continue };
        for (key, range) in &a.gains {
            if key == "fortune" || key == "arcana" {
                continue;
            }
            let i = w.defs.captain.attribute_index(key).unwrap();
            let cap = if w.defs.captain.group(i).unwrap().key == "conduct" { 100 } else { 1000 };
            let gain = (range[0] * slots).min(w.defs.upbringing.rules.annual_growth_cap);
            *growth.get_mut(key).unwrap() = (growth[key] + gain).clamp(0, cap);
        }
        if let Condition::Skill { skill, .. } = condition {
            xp += slots * a.skills.iter().filter(|s| &s.skill == skill).map(|s| s.xp).sum::<i64>();
        }
    }
    let projected = |i: usize| {
        let key = &w.defs.captain.attributes[i].key;
        let value = growth[key];
        if key == "arcana" {
            0
        } else if key == "fortune" || w.defs.captain.group(i).unwrap().key == "conduct" {
            value
        } else {
            w.defs.upbringing.rules.growth_table.iter().find(|b| (b.from..=b.to).contains(&value)).unwrap().value
        }
    };
    match condition {
        Condition::Growth { attr, .. } => growth[attr],
        Condition::Skill { .. } => xp,
        Condition::Attr { attr, .. } => {
            if let Some(i) = w.defs.captain.attribute_index(attr) {
                return projected(i);
            }
            let rating = w.defs.captain.ratings.iter().find(|r| &r.key == attr).unwrap();
            rating
                .weights
                .iter()
                .map(|(i, weight)| {
                    let scale = if w.defs.captain.group(*i).unwrap().key == "conduct" { 10 } else { 100 };
                    projected(*i) * scale * weight
                })
                .sum::<i64>()
                / rating.weights.iter().map(|(_, weight)| weight).sum::<i64>()
        }
        _ => panic!("非数值门槛"),
    }
}

#[test]
fn early_critical_gates_have_routes_with_two_training_slots_per_month() {
    let d = defs();
    let mut checked = 0;
    let mut unreachable = Vec::new();
    for f in &d.upbringing.families {
        let w = start(d.clone(), f);
        let home = courses(&w);
        let stage = f.stages.iter().find(|s| s.stage == Stage::Academy).unwrap();
        let mut school_world = w.clone();
        school_world.state.day = manifest_core::scenario::day_of(&d, stage.from).unwrap();
        school_world.state.cast.place.as_mut().unwrap().loc =
            manifest_core::LocId::from_idx(d.locations.iter().position(|l| l.key == stage.at).unwrap());
        if let Some(flag) = &stage.entry_flag {
            school_world.state.upbringing.as_mut().unwrap().flags.insert(flag.clone());
        }
        let school = courses(&school_world);
        for index in 0..10 {
            let key = format!("c9_{}_critical_{index:02}", f.key);
            let chapter = &d.story2.track(&key).unwrap().chapters[0];
            let date = chapter
                .when
                .iter()
                .filter_map(|c| match c {
                    Condition::Date { from, .. } => *from,
                    _ => None,
                })
                .max()
                .unwrap();
            let within_month = i64::from(date[2] >= 11) + i64::from(date[2] >= 21);
            let home_slots = if date[0] == 1553 { 2 * i64::from(date[1] - 1) + within_month } else { 24 };
            let school_slots = if date[0] == 1554 && date[1] > stage.from[1] {
                2 * i64::from(date[1] - stage.from[1] - 1) + within_month
            } else {
                0
            };
            for condition in chapter.choices.iter().flat_map(|c| &c.requires) {
                let min = match condition {
                    Condition::Growth { ge, .. } | Condition::Attr { ge, .. } | Condition::Skill { ge, .. } => *ge,
                    _ => continue,
                };
                let mut best = 0;
                for h in &home {
                    for s in &school {
                        best =
                            best.max(forecast(&w, condition, [(h.as_ref(), home_slots), (s.as_ref(), school_slots)]));
                    }
                }
                if best < min {
                    unreachable.push(format!("{key}: {condition:?}，实际可用课程／成功打工最多 {best}"));
                }
                checked += 1;
            }
        }
    }
    // 养成内容（2026-11-03）：九位主角的关键事件 00–05 改写后起始章没有数值门槛（每家少 6 件 × 3 项），
    // 06–09 与十二种自定义出身照旧（630 → 468）。
    assert_eq!(checked, 468);
    assert!(unreachable.is_empty(), "{}", unreachable.join("\n"));
}

#[test]
fn all_home_and_first_academy_year_numeric_gates_fit_annual_bounds() {
    let d = defs();
    let mut counts = [0, 0];
    let mut exams = 0;
    let mut paths = 0;
    let mut checks = 0;
    for f in &d.upbringing.families {
        for (index, year) in [1553, 1554].into_iter().enumerate() {
            let mut w = start(d.clone(), f);
            ceiling(&mut w, i64::from(year - 1552));
            for t in d.story2.tracks.iter().filter(|t| t.source.starts_with("upbringing/")) {
                if d.upbringing.event_gates.get(&t.key).is_some_and(|g| {
                    g.from.is_some_and(|d| d[0] > year)
                        || (!g.years.is_empty() && g.years.iter().all(|y| *y > year))
                        || (g.stage == ActivityStage::Academy && year == 1553)
                        || g.academy.as_ref().is_some_and(|a| !f.stages.iter().any(|s| s.academy.as_ref() == Some(a)))
                }) {
                    continue;
                }
                for c in t.chapters.iter().filter(|c| appears(f, c, year)) {
                    for condition in c
                        .when
                        .iter()
                        .chain(c.choices.iter().flat_map(|c| &c.requires))
                        .chain(c.variants.iter().flat_map(|v| &v.when))
                    {
                        counts[index] += numeric(&w, condition, &t.key);
                    }
                    for check in c.choices.iter().filter_map(|c| c.check.as_ref()) {
                        assert!(w.story2_check_pct(check) >= 25, "{}: {check:?}", t.key);
                        checks += 1;
                    }
                }
            }
            // 别家专属的活动（unlock.flag 是别家的进门旗标，如 U04 每家的解锁练习）这一家排不上，不对照这一家的上限。
            let own = f.stages.first().and_then(|s| s.entry_flag.as_deref());
            for a in &d.upbringing.activities {
                if !a.stage.allows(if year == 1553 { Stage::Home } else { Stage::Academy })
                    || a.unlock.year.is_some_and(|y| y > 1)
                    || a.unlock.flag.as_deref().is_some_and(|fl| fl.starts_with("c9_family_") && Some(fl) != own)
                {
                    continue;
                }
                for (key, min) in &a.unlock.attrs {
                    assert!(w.upbringing_projected(key) >= *min, "{}", a.key);
                }
                for (key, min) in &a.unlock.growth {
                    assert!(w.upbringing_growth(key) >= *min, "{}", a.key);
                }
                for (key, min) in &a.unlock.rating {
                    assert!(w.upbringing_rating(key) >= *min, "{}", a.key);
                }
                for (key, min) in &a.unlock.skills {
                    assert!(w.upbringing_skill_xp(key) >= *min, "{}", a.key);
                }
            }
            for e in &d.upbringing.exams {
                if e.requirements.year.is_some_and(|y| y > u32::from(year == 1554))
                    || e.requirements.all.iter().any(|r| r.year.is_some_and(|y| y > 1))
                {
                    continue;
                }
                assert!(requirements(&w, &e.requirements), "{} / {}", f.key, e.key);
                exams += 1;
                assert!(w.exam_pass_pct(e) >= 25, "{} / {}", f.key, e.key);
            }
            for p in &d.upbringing.paths {
                if year == 1553
                    || !f.completion.as_ref().unwrap().paths.contains(&p.key)
                    || p.requirements.year.is_some_and(|y| y > 1)
                {
                    continue;
                }
                assert!(requirements(&w, &p.requirements), "{}", p.key);
                paths += 1;
            }
        }
    }
    assert!(counts[0] > 1000 && counts[1] > 1000, "未覆盖真实事件：{counts:?}");
    assert_eq!(exams, 84);
    assert_eq!(paths, 63);
    println!("首年数值门槛：家乡 {}，学院 {}，考试 {exams}，志向 {paths}，概率检定 {checks}", counts[0], counts[1]);
}

#[test]
fn general_exams_and_hidden_paths_have_explicit_school_year_gates() {
    let d = defs();
    for (key, year) in
        [("exam_pilot", 1), ("exam_merchant", 1), ("exam_sword", 1), ("exam_interpreter", 1), ("exam_society", 2)]
    {
        let e = d.upbringing.exams.iter().find(|e| e.key == key).unwrap();
        assert_eq!(e.requirements.year, Some(year));
        // U02 起这些数值由中位成长曲线生成（见 manifest-sim 的 upbringing_thresholds_u02），不会高过 U01 定的二级。
        for r in &e.requirements.all {
            if r.attr.is_some() {
                assert!(r.min.is_some_and(|m| (1..=2).contains(&m)), "{key}: {:?}", r.min);
            }
        }
    }
    assert_eq!(d.upbringing.paths.iter().filter(|p| p.hidden).count(), 21);
    for p in d.upbringing.paths.iter().filter(|p| p.hidden) {
        assert_eq!(p.requirements.year, Some(2));
        assert_eq!(p.reveal.year, Some(2));
    }
    assert!(d.upbringing.exams.iter().filter(|e| e.academy.is_some()).all(|e| e.requirements.year == Some(3)));
    assert_eq!(d.upbringing.activities.iter().filter(|a| a.key.ends_with("_initiative")).count(), 15);
    for a in d.upbringing.activities.iter().filter(|a| a.key.ends_with("_initiative")) {
        assert_eq!(a.tier.as_ref().unwrap().after, 12);
        assert!(a.unlock.attrs.values().all(|v| (1..=2).contains(v)), "{}", a.key);
        let tier = a.tier.as_ref().unwrap();
        let branch = |level| {
            d.upbringing
                .activities
                .iter()
                .find(|v| v.tier.as_ref().is_some_and(|t| t.group == tier.group && t.level == level))
                .unwrap()
        };
        for (key, level) in &a.unlock.attrs {
            let minimum = 6 * branch(1).gains[key][0] + 18 * branch(2).gains[key][0];
            let required = d.upbringing.rules.growth_table.iter().find(|b| b.value == *level).unwrap().from;
            assert!(
                minimum >= required,
                "{}: 每月两旬、全年二十四次成功打工的最低成长 {minimum} 不足 {required}",
                a.key
            );
        }
    }
}

#[test]
fn hidden_paths_stay_hidden_in_first_school_year_even_with_both_omens() {
    let d = defs();
    for f in &d.upbringing.families {
        let mut w = start(d.clone(), f);
        let path = d
            .upbringing
            .paths
            .iter()
            .find(|p| p.hidden && f.completion.as_ref().unwrap().paths.contains(&p.key))
            .unwrap();
        for flag in path.reveal.all.iter().filter_map(|r| r.flag.as_ref()) {
            w.state.upbringing.as_mut().unwrap().flags.insert(flag.clone());
        }
        w.state.day = manifest_core::scenario::day_of(&d, [1554, 12, 31]).unwrap();
        assert!(!w.path_visible(path), "{} 不应在首年显示", path.key);
        w.state.day = manifest_core::scenario::day_of(&d, [1555, 1, 1]).unwrap();
        assert!(w.path_visible(path), "{} 二年级应按原见闻旗标显示", path.key);
    }
}

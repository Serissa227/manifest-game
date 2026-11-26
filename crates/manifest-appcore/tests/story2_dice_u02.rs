//! U02 工作包 3：选项的数值门槛改成掷骰。达标必成、差距越大越难但不低于 5%、硬条件照旧锁住、
//! 同一 seed 同一结果、失败后本次不能再选，以及规则关闭时（经典与测试世界）行为不变。
use manifest_appcore::{story_view::story_view_in, views::Ctx};
use manifest_core::{
    scenario::{Gender, ProtagonistIdentity},
    story2::{dice::curve_chance, *},
    *,
};
use serde_json::{Value, json};
use std::sync::Arc;

const O: OwnerId = OwnerId::Player;
const TRY: u32 = 0;
const HARD: u32 = 1;
const FLAG: u32 = 2;
const SAFE: u32 = 3;
const RISKY: u32 = 4;
const BOTH: u32 = 5;

fn chapter() -> Value {
    json!({"key":"a","title":"掷骰","text":"测试掷骰。","choices":[
        {"key":"try","text":"凭本事","next":"done","requires":[{"kind":"skill","skill":"sailing","ge":60}],"reply":"成了。"},
        {"key":"hard","text":"读原文","next":"done","requires":[{"kind":"skill","skill":"sailing","ge":60,"hard":true}]},
        {"key":"flag","text":"凭旧交情","next":"done","requires":[{"kind":"flag","flag":"never_set"}]},
        {"key":"safe","text":"稳妥","next":"done"},
        {"key":"risky","text":"有失败分支","next":"done","requires":[{"kind":"growth","attr":"commerce","ge":100}],"fail":{"next":"failed"}},
        {"key":"both","text":"门槛加检定","next":"done","requires":[{"kind":"skill","skill":"sailing","ge":60}],
         "check":{"attr":"commerce","base":80,"per":0},"fail":{"next":"failed"}}
    ]})
}

fn world_with(soft: bool, seed: u64) -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    assert!(!d.rules.story.soft_requires, "测试世界缺省不开掷骰");
    d.rules.story.soft_requires = soft;
    d.rules.story.fail_lines.insert("skill".into(), vec![String::new(), "手一抖，没成。".into()]);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    d.story2 = serde_json::from_value(
        json!({"tracks":[{"key":"dice","name":"掷骰样例","kind":"request","start":"a","chapters":[chapter()]}]}),
    )
    .unwrap();
    d.story2.skills.insert("sailing".into());
    let mut w = World::new(defs, ScenarioId(0), seed).unwrap();
    w.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender: Gender::F });
    w.refresh_story2();
    assert_eq!(w.pending_story2().map(|p| p.chapter.as_str()), Some("a"));
    w
}

fn set_skill(w: &mut World, xp: i64) {
    w.state.items.owners.entry(O).or_default().skill_xp.insert("sailing".into(), xp);
}

fn choice(w: &World, i: u32) -> Choice {
    w.defs.story2.tracks[0].chapters[0].choices[i as usize].clone()
}

fn answer(w: &mut World, i: u32) -> Result<CommandOutcome, CommandError> {
    Command::StoryAnswer { owner: O, choice: i }.apply(w)
}

fn view(w: &World) -> Value {
    serde_json::to_value(story_view_in(Ctx::plain(&w.defs), w)).unwrap()
}

/// 找一个让“凭本事”掷骰失败的种子（技能为 0，成功率 5%）。
fn failing_world() -> World {
    (1..200)
        .map(|seed| {
            let mut w = world_with(true, seed);
            set_skill(&mut w, 0);
            w
        })
        .find(|w| {
            let mut trial = w.clone();
            answer(&mut trial, TRY).is_ok() && trial.state.story2.last.as_ref().is_some_and(|r| r.soft_fail.is_some())
        })
        .expect("两百个种子里总有掷骰失败的")
}

#[test]
fn meeting_the_threshold_always_succeeds_without_a_roll() {
    let mut w = world_with(true, 42);
    set_skill(&mut w, 60);
    let c = choice(&w, TRY);
    assert!(w.story2_soft_gaps(&c).is_empty());
    assert_eq!(w.story2_choice_chance(&c), None, "达标又没有检定时不掷骰");
    answer(&mut w, TRY).unwrap();
    let last = w.state.story2.last.as_ref().unwrap();
    assert_eq!((last.success, last.roll.as_ref()), (None, None));
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Done);
}

#[test]
fn chance_falls_monotonically_with_the_gap_and_never_below_five_percent() {
    let mut w = world_with(true, 42);
    let c = choice(&w, TRY);
    let mut previous = 100;
    for xp in (0..60).rev() {
        set_skill(&mut w, xp);
        let chance = w.story2_choice_chance(&c).unwrap();
        assert!((5..=95).contains(&chance), "{xp}: {chance}");
        assert!(chance <= previous, "技能 {xp} 的成功率 {chance} 高于差距更小时的 {previous}");
        previous = chance;
        assert_eq!(chance, curve_chance(&w.defs.rules.story.skill_curve, xp, 60));
    }
    assert_eq!(previous, 5);
    set_skill(&mut w, 59);
    assert!(w.story2_choice_chance(&c).unwrap() >= 70, "刚差一点约七八成");
    set_skill(&mut w, 30);
    assert!(w.story2_choice_chance(&c).unwrap() <= 10, "差一半落到一成以下");
    // 门槛加检定：两者相乘再夹在 5–95。
    let both = choice(&w, BOTH);
    assert_eq!(w.story2_choice_chance(&both), Some(80 * curve_chance(&w.defs.rules.story.skill_curve, 30, 60) / 100));
    set_skill(&mut w, 0);
    assert_eq!(w.story2_choice_chance(&both), Some(5));
    set_skill(&mut w, 60);
    assert_eq!(w.story2_choice_chance(&both), Some(80), "门槛满足时只剩原检定");
}

#[test]
fn hard_conditions_stay_locked_while_soft_gaps_become_rolls() {
    let mut w = world_with(true, 42);
    set_skill(&mut w, 0);
    let before = w.state_hash();
    for i in [HARD, FLAG] {
        let err = Command::StoryAnswer { owner: O, choice: i }.validate(&w).unwrap_err();
        assert!(err.to_string().contains("选项条件未满足"), "{i}: {err}");
    }
    assert!(Command::StoryAnswer { owner: O, choice: TRY }.validate(&w).is_ok(), "软门槛不再锁死");
    assert_eq!(w.state_hash(), before);
    let v = view(&w);
    let choices = v["pending"]["choices"].as_array().unwrap();
    assert!(choices[HARD as usize]["blocked"].is_string());
    assert!(choices[HARD as usize]["chance"].is_null());
    assert!(choices[HARD as usize]["soft_gap"].is_null(), "标了 hard 的门槛不算软缺口");
    assert!(choices[FLAG as usize]["blocked"].is_string());
    assert!(choices[TRY as usize]["blocked"].is_null());
    assert_eq!(choices[TRY as usize]["chance"], 5);
    assert_eq!(choices[TRY as usize]["soft_gap"], json!([{"key":"sailing","label":"sailing","have":0,"need":60}]));
    assert!(choices[SAFE as usize]["chance"].is_null() && choices[SAFE as usize]["soft_gap"].is_null());
    assert_eq!(w.state_hash(), before, "视图不改世界");
    // 标了 hard 的门槛达到以后照常可选，不掷骰。
    set_skill(&mut w, 60);
    answer(&mut w, HARD).unwrap();
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Done);
}

#[test]
fn a_failed_roll_without_fail_branch_stays_put_costs_nothing_outside_upbringing_and_cannot_be_retried() {
    let mut w = failing_world();
    let seed = w.state.seed;
    answer(&mut w, TRY).unwrap();
    let last = w.state.story2.last.clone().unwrap();
    let roll = last.roll.clone().unwrap();
    assert_eq!((roll.chance, roll.success, roll.choice.as_str()), (5, false, "try"));
    assert!((6..=100).contains(&roll.roll));
    let fail = last.soft_fail.clone().unwrap();
    assert_eq!((fail.pool.as_str(), fail.fatigue, fail.mood), ("skill", 0, 0), "养成之外没有疲劳与心情可扣");
    assert_eq!(last.success, Some(false));
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Active);
    assert_eq!(w.state.story2.tracks["dice"].chapter, "a", "回到同一节点");
    assert!(!w.state.story2.tracks["dice"].visited.contains("a"), "通用失败不算结算");
    assert_eq!(w.pending_story2().unwrap().chapter, "a");
    assert!(w.state.story2.news.is_empty());
    // 本次事件里不能再选；视图给出 failed 与 blocked，不给成功率。
    let err = answer(&mut w, TRY).unwrap_err();
    assert!(err.to_string().contains("已经试过"), "{err}");
    let v = view(&w);
    let c = &v["pending"]["choices"][TRY as usize];
    assert_eq!(c["failed"], true);
    assert!(c["blocked"].is_string() && c["chance"].is_null());
    assert_eq!(v["last_roll"], json!({"chance":5,"roll":roll.roll,"success":false,"choice":"try"}));
    assert_eq!(v["last"]["success"], false);
    assert_eq!(v["last"]["ended"], false);
    assert_eq!(v["last"]["reply"], "手一抖，没成。", "池里空串跳过，取写好的那一条");
    // 存读档后仍然不能再选，世界逐字节相同。
    let restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(restored.state, w.state);
    assert!(Command::StoryAnswer { owner: O, choice: TRY }.validate(&restored).is_err());
    // 换一个选项结算后，失败记录随事件一起清掉。
    let mut other = w.clone();
    answer(&mut other, SAFE).unwrap();
    assert!(other.state.story2.failed_choices.is_empty());
    assert_eq!(other.state.story2.tracks["dice"].status, Status::Done);
    // 本事真正达标以后可以照常选，不再掷骰。
    set_skill(&mut w, 60);
    answer(&mut w, TRY).unwrap();
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Done);
    assert!(w.state.story2.failed_choices.is_empty());
    assert_eq!(w.state.seed, seed);
}

#[test]
fn rolls_are_deterministic_for_the_same_seed_and_use_fail_branches() {
    for seed in [1, 7, 42, 99] {
        let mut a = world_with(true, seed);
        let mut b = world_with(true, seed);
        set_skill(&mut a, 40);
        set_skill(&mut b, 40);
        answer(&mut a, TRY).unwrap();
        answer(&mut b, TRY).unwrap();
        assert_eq!(a.state, b.state, "seed {seed}");
        assert_eq!(a.state_hash(), b.state_hash());
    }
    // 有 fail 分支的选项掷骰失败就走 fail 分支：轨道失败，不记通用失败。
    let mut w = (1..200)
        .map(|seed| world_with(true, seed))
        .find(|w| {
            let mut t = w.clone();
            answer(&mut t, RISKY).is_ok() && t.state.story2.last.as_ref().is_some_and(|r| r.success == Some(false))
        })
        .unwrap();
    answer(&mut w, RISKY).unwrap();
    let last = w.state.story2.last.as_ref().unwrap();
    assert!(last.soft_fail.is_none() && last.roll.as_ref().is_some_and(|r| !r.success));
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Failed);
    // 成功的软掷骰同样写骰子，结果标为成功。
    let mut w = (1..400)
        .map(|seed| {
            let mut w = world_with(true, seed);
            set_skill(&mut w, 50);
            w
        })
        .find(|w| {
            let mut t = w.clone();
            answer(&mut t, TRY).is_ok() && t.state.story2.last.as_ref().is_some_and(|r| r.success == Some(true))
        })
        .unwrap();
    answer(&mut w, TRY).unwrap();
    assert_eq!(w.state.story2.last.as_ref().unwrap().roll.as_ref().map(|r| r.success), Some(true));
    assert_eq!(w.state.story2.tracks["dice"].status, Status::Done);
    // 有成败的见闻在读档对账时保留。
    let restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(restored.state, w.state);
}

#[test]
fn with_the_rule_off_numeric_gates_lock_and_checks_roll_exactly_as_before() {
    let mut off = world_with(false, 42);
    set_skill(&mut off, 0);
    for i in [TRY, HARD, RISKY, BOTH] {
        assert!(answer(&mut off.clone(), i).unwrap_err().to_string().contains("选项条件未满足"), "{i}");
    }
    let v = view(&off);
    assert!(v.get("last_roll").is_none());
    for c in v["pending"]["choices"].as_array().unwrap() {
        assert!(c.get("chance").is_none() && c.get("soft_gap").is_none() && c.get("failed").is_none(), "{c}");
    }
    // 门槛达到后，规则开与关掷出的检定结果相同；规则关闭时不写骰子。
    for seed in 1..40 {
        let mut off = world_with(false, seed);
        let mut on = world_with(true, seed);
        set_skill(&mut off, 60);
        set_skill(&mut on, 60);
        answer(&mut off, BOTH).unwrap();
        answer(&mut on, BOTH).unwrap();
        let (a, b) = (off.state.story2.last.as_ref().unwrap(), on.state.story2.last.as_ref().unwrap());
        assert_eq!(a.success, b.success, "seed {seed}");
        assert!(a.roll.is_none());
        assert_eq!(b.roll.as_ref().map(|r| (r.chance, r.success)), Some((80, b.success == Some(true))));
        assert_eq!(off.state.story2.tracks["dice"].status, on.state.story2.tracks["dice"].status);
    }
    assert!(serde_json::to_value(&off.state.story2).unwrap().get("failed_choices").is_none());
}

#[test]
fn hard_marks_only_attach_to_numeric_option_gates() {
    let parse = |requires: Value| {
        serde_json::from_value::<Choice>(json!({"key":"x","text":"x","next":"done","requires":requires}))
            .map_err(|e| e.to_string())
    };
    let ok = parse(json!([{"kind":"flag","flag":"f"},{"kind":"growth","attr":"commerce","ge":1,"hard":true},
        {"kind":"skill","skill":"s","ge":1,"hard":false}]))
    .unwrap();
    assert_eq!(ok.hard.iter().copied().collect::<Vec<_>>(), vec![1]);
    assert!(!ok.soft_condition(0) && !ok.soft_condition(1) && ok.soft_condition(2));
    assert!(parse(json!([{"kind":"flag","flag":"f","hard":true}])).unwrap_err().contains("hard"));
    assert!(parse(json!([{"kind":"skill","skill":"s","ge":1,"hard":"yes"}])).unwrap_err().contains("hard"));
    assert!(parse(json!([{"kind":"skill","skill":"s","ge":1,"soft":true}])).is_err(), "其余未知字段照旧拒绝");
    // 章节的 when 条件不接受 hard。
    assert!(
        serde_json::from_value::<ChapterDef>(json!({"key":"a","title":"t","text":"t",
            "when":[{"kind":"skill","skill":"s","ge":1,"hard":true}]}))
        .is_err()
    );
}

#[test]
fn old_story_state_without_dice_fields_loads_and_new_fields_stay_out_when_empty() {
    let w = world_with(true, 42);
    let value = serde_json::to_value(&w.state.story2).unwrap();
    assert!(value.get("failed_choices").is_none());
    let state: Story2State = serde_json::from_value(value).unwrap();
    assert!(state.failed_choices.is_empty());
    let result: Story2Result =
        serde_json::from_value(json!({"track":"dice","chapter":"a","day":1,"text":"","choice":0,"news":null})).unwrap();
    assert!(result.roll.is_none() && result.soft_fail.is_none());
    let json = serde_json::to_value(&result).unwrap();
    assert!(json.get("roll").is_none() && json.get("soft_fail").is_none());
}

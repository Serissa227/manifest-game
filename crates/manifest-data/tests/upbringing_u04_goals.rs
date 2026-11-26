//! U04 工作包 5（A13）：年度目标卡的引擎轨道——入队、完成判定与发奖励、过年作废不罚、旧档照读、校验。
//! 另跑九位主角四年“均衡”，打印每家完成了几张（只打印，不设门槛：目标是可选的）。
#[path = "support/u04.rs"]
mod u04;
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    story2::{Effect, ObjectiveKind},
    upbringing::{GoalStatus, Phase},
};

fn mio() -> World {
    let d = u04::defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    World::new(d, sid, 42).unwrap()
}

fn plan_rest(w: &mut World) {
    if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
        let slots = w.auto_plan("balanced").unwrap();
        // U05：排程命令按本局的模式给（寰宇按周是 PlanWeek）。
        w.upbringing_plan_command(slots).apply(w).unwrap();
    }
}

fn next_day(w: &mut World, ordinal: &mut u64) {
    loop {
        while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
            *ordinal += 1;
            u04::answer(w, *ordinal);
        }
        if w.act_running() && w.act_bot_step().unwrap() {
            continue;
        }
        plan_rest(w);
        w.end_day().unwrap();
        return;
    }
}

#[test]
fn this_years_goals_are_queued_at_the_start_and_later_years_wait() {
    let w = mio();
    let s = w.state.upbringing.as_ref().unwrap();
    let goals = w.upbringing_annual_goals();
    assert_eq!(goals.len(), 12);
    for g in goals {
        let state = s.goals.get(&g.key);
        if g.year == 1553 {
            assert_eq!(state.map(|st| st.status), Some(GoalStatus::Active), "{}", g.key);
        } else {
            assert!(state.is_none(), "{} 还没到年份就入队了", g.key);
        }
    }
}

#[test]
fn meeting_the_condition_completes_the_goal_and_grants_the_reward_once() {
    let mut w = mio();
    let g = w.upbringing_annual_goals().into_iter().find(|g| g.key == "u04_goal_mio_1553_1").unwrap().clone();
    let ObjectiveKind::Growth { attr, ge } = &g.objectives[0].kind else { panic!("第一张是属性目标") };
    let Effect::Growth { value, .. } = &g.rewards[0] else { panic!("奖励是成长") };
    let mut ordinal = 0;
    while w.act_phase() != manifest_core::upbringing::act::ActPhase::Free {
        next_day(&mut w, &mut ordinal);
    }
    while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
        ordinal += 1;
        u04::answer(&mut w, ordinal);
    }
    // 把成长推到门槛后用真实周末行动刷新目标，完成日应当是这次行动当天。
    w.state.upbringing.as_mut().unwrap().growth.insert(attr.clone(), *ge);
    let action_day = w.day();
    let command = w
        .act_places()
        .iter()
        .find_map(|place| {
            let command = Command::DoAction {
                owner: OwnerId::Player,
                place: place.key.clone(),
                action: manifest_core::upbringing::act::ActAction::Rest,
            };
            command.validate(&w).is_ok().then_some(command)
        })
        .unwrap();
    command.apply(&mut w).unwrap();
    next_day(&mut w, &mut ordinal);
    let s = w.state.upbringing.as_ref().unwrap();
    let st = &s.goals[&g.key];
    assert_eq!(st.status, GoalStatus::Done);
    assert_eq!(st.done, Some(action_day), "行动制在行动当天完成目标");
    let after = s.growth[attr];
    assert!(after >= ge + value, "奖励成长没发：{after} < {ge} + {value}");
    // 再过几天：已完成的目标不再判定、不再发奖励，完成日不变。
    let done_day = st.done;
    for _ in 0..3 {
        next_day(&mut w, &mut ordinal);
    }
    let st = &w.state.upbringing.as_ref().unwrap().goals[&g.key];
    assert_eq!((st.status, st.done), (GoalStatus::Done, done_day));
}

#[test]
fn cash_goal_completes_with_an_item_and_unfinished_goals_lapse_without_penalty() {
    let mut w = mio();
    let g = w.upbringing_annual_goals().into_iter().find(|g| g.key == "u04_goal_mio_1553_3").unwrap().clone();
    let ObjectiveKind::Cash { ge } = g.objectives[0].kind else { panic!("第三张是攒钱") };
    let Effect::Item { item, qty } = g.rewards[0].clone() else { panic!("奖励是物品") };
    w.state.agents.get_mut(&OwnerId::Player).unwrap().cash = ge;
    let before = w.item_quantity(OwnerId::Player, &item);
    let mut ordinal = 0;
    next_day(&mut w, &mut ordinal);
    assert_eq!(w.state.upbringing.as_ref().unwrap().goals[&g.key].status, GoalStatus::Done);
    assert_eq!(w.item_quantity(OwnerId::Player, &item), before + qty);
    // 跳到 1553 年最后一天，再过一天：没完成的 1553 年目标作废，1554 年的入队；钱和成长不因作废而少。
    let last = manifest_core::scenario::day_of(&w.defs, [1553, 12, 31]).unwrap();
    while w.day() < last {
        next_day(&mut w, &mut ordinal);
    }
    let open: Vec<String> = w
        .state
        .upbringing
        .as_ref()
        .unwrap()
        .goals
        .iter()
        .filter(|(_, st)| st.status == GoalStatus::Active)
        .map(|(k, _)| k.clone())
        .collect();
    let growth = w.state.upbringing.as_ref().unwrap().growth.clone();
    next_day(&mut w, &mut ordinal);
    let s = w.state.upbringing.as_ref().unwrap();
    // 年底最后一天才练到的，在那一天结算时完成（完成日是 12-31），其余一律作废；没有一张还停在进行中。
    for k in &open {
        let st = &s.goals[k];
        assert!(
            st.status == GoalStatus::Missed || (st.status == GoalStatus::Done && st.done == Some(last)),
            "{k} 过年没作废：{st:?}"
        );
    }
    for g in w.upbringing_annual_goals().into_iter().filter(|g| g.year == 1554) {
        assert!(s.goals.contains_key(&g.key), "{} 没有在 1554 年入队", g.key);
    }
    for (k, v) in &growth {
        assert!(s.growth.get(k).copied().unwrap_or(0) >= *v, "{k} 成长因作废而减少");
    }
}

#[test]
fn goal_state_round_trips_and_old_saves_without_goals_load() {
    let mut w = mio();
    let mut ordinal = 0;
    next_day(&mut w, &mut ordinal);
    let w2 = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(w2.state, w.state);
    let mut json = serde_json::to_value(&w.state).unwrap();
    json["upbringing"].as_object_mut().unwrap().remove("goals");
    let old: manifest_core::WorldState = serde_json::from_value(json).unwrap();
    assert!(old.upbringing.unwrap().goals.is_empty());
}

#[test]
fn skipping_does_not_touch_goals() {
    let mut w = mio();
    let before = w.state.upbringing.as_ref().unwrap().goals.clone();
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
    let after = w.state.upbringing.as_ref().map(|s| s.goals.clone()).unwrap_or_default();
    assert!(after.iter().all(|(k, st)| before.get(k) == Some(st)), "跳过养成时不该发目标奖励或改状态");
}

type Edit = Box<dyn Fn(&mut manifest_core::upbringing::AnnualGoalDef)>;

#[test]
fn goal_validation_rejects_bad_references_and_big_rewards() {
    let d = u04::defs();
    let base = d.upbringing.annual_goals[0].clone();
    let cases: Vec<(&str, Edit)> = vec![
        ("未知家庭", Box::new(|g| g.family = "no_such_family_u04".into())),
        ("年份", Box::new(|g| g.year = 1560)),
        ("条件须有", Box::new(|g| g.objectives.clear())),
        ("奖励只许", Box::new(|g| g.rewards = vec![Effect::Growth { attr: "seamanship".into(), value: 500 }])),
        ("奖励只许", Box::new(|g| g.rewards = vec![Effect::Cash { value: 100 }])),
        (
            "目标条件只许",
            Box::new(|g| {
                g.objectives[0].kind = ObjectiveKind::Growth { attr: "no_such_attr".into(), ge: 10 };
            }),
        ),
    ];
    for (needle, edit) in cases {
        let mut v = (*d).clone();
        let mut g = base.clone();
        edit(&mut g);
        g.key = "u04_goal_validation_case".into();
        v.upbringing.annual_goals.push(g);
        let errors = manifest_core::upbringing::validation::validate(&v);
        assert!(errors.iter().any(|e| e.contains(needle)), "{needle}：{errors:?}");
    }
    let mut v = (*d).clone();
    v.upbringing.annual_goals.push(base.clone());
    assert!(manifest_core::upbringing::validation::validate(&v).iter().any(|e| e.contains("目标键重复")));
    assert!(manifest_core::upbringing::validation::validate(&d).iter().all(|e| !e.starts_with("annual_goal:")));
}

fn four_years(family: &str) {
    let w = u04::run_balanced(family, 7, [1557, 1, 1], |_| {});
    let s = w.state.upbringing.as_ref().unwrap();
    let goals = w.upbringing_annual_goals();
    let done: Vec<&str> = goals
        .iter()
        .filter(|g| s.goals.get(&g.key).is_some_and(|st| st.status == GoalStatus::Done))
        .map(|g| g.key.as_str())
        .collect();
    eprintln!("{family}：四年完成 {}/{} 张：{done:?}", done.len(), goals.len());
    for g in goals.iter().filter(|g| g.year < 1556) {
        assert!(
            s.goals.get(&g.key).is_some_and(|st| st.status != GoalStatus::Active),
            "{family}：{} 过了年份还在进行中",
            g.key
        );
    }
}

macro_rules! heroes {
    ($($name:ident => $key:literal),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                four_years($key);
            }
        )*
    };
}

heroes! {
    four_years_goals_mio => "mio",
    four_years_goals_lieve => "lieve",
    four_years_goals_najma => "najma",
    four_years_goals_lin_wandeng => "lin_wandeng",
    four_years_goals_ix_nikte => "ix_nikte",
    four_years_goals_noel => "noel",
    four_years_goals_tariq => "tariq",
    four_years_goals_kaicili => "kaicili",
    four_years_goals_baraka => "baraka",
}

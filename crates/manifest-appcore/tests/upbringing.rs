//! I6 月程入口与应用时钟使用相同的暂停条件。
use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_core::Command;
use serde_json::json;
use std::sync::Arc;
#[test]
fn monthly_plan_query_submit_pause_resume_and_duplicate_rejection() {
    let tmp = std::env::temp_dir().join(format!("manifest-a6-month-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&tmp),
    )
    .unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let view = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(view["phase"], "plan");
    assert_eq!(view["today"], json!([1553, 1, 1]));
    assert_eq!(view["protagonist"]["age"], 12);
    assert_eq!(view["plan"]["slots"].as_array().unwrap().len(), 3);
    handlers::set_speed(&st, 1).unwrap();
    assert!(!handlers::tick(&st).unwrap());
    assert!(handlers::advance_clock(&st, 1440).unwrap().is_none());
    assert_eq!(handlers::current_speed(&st), 0);
    let overview = handlers::step(&st, 30).unwrap();
    assert_eq!(overview.mode, "upbringing");
    assert_eq!(overview.world_date, [1553, 1, 1]);
    let slots = handlers::pending::auto_plan(&st, "balanced".into()).unwrap()["slots"].clone();
    assert_eq!(handlers::pending::upbringing(&st).unwrap(), view);
    let slots = rest_first(slots);
    let command: Command = serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":slots}})).unwrap();
    handlers::submit(&st, command.clone()).unwrap();
    assert!(handlers::submit(&st, command).is_err());
    let overview = handlers::step(&st, 31).unwrap();
    assert_eq!(overview.world_date, [1553, 1, 11]);
    assert!(overview.story.unwrap().pending.is_some());
    let result = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(result["last"].as_array().unwrap().len(), 1);
    handlers::submit(&st, Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice: 0 }).unwrap();
    let overview = handlers::step(&st, 31).unwrap();
    assert_eq!(overview.world_date, [1553, 2, 1]);
    let result = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(result["phase"], "plan");
    assert_eq!(result["last"].as_array().unwrap().len(), 3);
    // U03：一月的休息是不累时硬排的（见 rest_first），二月初疲劳不到 30，“照上月”不照抄这份带闲休息的月程，
    // 改按均衡重排（`previous_plan_fits` 的 idle_rest）。
    assert!(result["meters"]["fatigue"]["value"].as_i64().unwrap() < 30, "{}", result["meters"]["fatigue"]);
    let previous = handlers::pending::auto_plan(&st, "previous".into()).unwrap();
    let balanced = handlers::pending::auto_plan(&st, "balanced".into()).unwrap();
    assert_ne!(previous["slots"], slots);
    assert_eq!(previous["slots"], balanced["slots"]);
    // 二月照均衡排（没有闲着的休息），走完二月，“照上月”原样给回二月的安排。
    let february = balanced["slots"].clone();
    let command: Command =
        serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":february.clone()}})).unwrap();
    handlers::submit(&st, command).unwrap();
    for _ in 0..10 {
        let overview = handlers::step(&st, 31).unwrap();
        if overview.world_date == [1553, 3, 1] {
            break;
        }
        assert!(overview.story.unwrap().pending.is_some(), "二月中途停下只能是等回答：{:?}", overview.world_date);
        handlers::submit(&st, Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice: 0 }).unwrap();
    }
    let result = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(result["today"], json!([1553, 3, 1]));
    assert_eq!(result["phase"], "plan");
    let previous = handlers::pending::auto_plan(&st, "previous".into()).unwrap();
    assert_eq!(previous["slots"], february);
}

/// 养成期执行月计划时不按倍速播放：1× 下 1 毫秒的实时折算不到 1 游戏分钟，快进照样每一步至少推进一整天；
/// 遇到要玩家回答的剧情、或一个月走完等新安排时停下（与原来的暂停条件相同）。
#[test]
fn upbringing_month_runs_without_speed_pacing() {
    use manifest_appcore::Ticker;
    use std::time::Instant;
    let tmp = std::env::temp_dir().join(format!("manifest-ub-turbo-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&tmp),
    )
    .unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let today = |st: &AppState| handlers::pending::upbringing(st).unwrap()["today"].clone();
    assert!(handlers::upbringing_turbo(&st).is_none(), "还没安排本月：不快进");
    let slots = rest_first(handlers::pending::auto_plan(&st, "balanced".into()).unwrap()["slots"].clone());
    let command: Command = serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":slots}})).unwrap();
    handlers::submit(&st, command).unwrap();
    assert!(handlers::upbringing_turbo(&st).is_none(), "暂停中：不快进");
    handlers::set_speed(&st, 1).unwrap();
    assert!(handlers::upbringing_turbo(&st).is_some());
    let mut ticker = Ticker::new(Instant::now());
    let mut steps = 0;
    while handlers::current_speed(&st) != 0 {
        let before = today(&st);
        let now = ticker_now(&mut ticker);
        ticker.step(&st, now);
        steps += 1;
        assert_ne!(today(&st), before, "每一步至少推进一天（第 {steps} 步）");
        assert!(steps <= 10, "上旬十天最多十步");
    }
    assert_eq!(today(&st), json!([1553, 1, 11]));
    assert!(handlers::overview(&st).unwrap().story.unwrap().pending.is_some(), "上旬的回顾等玩家回答：停下");
    handlers::submit(&st, Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice: 0 }).unwrap();
    handlers::set_speed(&st, 1).unwrap();
    for _ in 0..40 {
        if handlers::current_speed(&st) == 0 {
            break;
        }
        let now = ticker_now(&mut ticker);
        ticker.step(&st, now);
    }
    assert_eq!(today(&st), json!([1553, 2, 1]));
    assert_eq!(handlers::pending::upbringing(&st).unwrap()["phase"], "plan", "一个月走完，等新的安排");
    assert!(handlers::upbringing_turbo(&st).is_none());
}

/// 因为有事要玩家回应而自动停下的（养成的旬回顾、月末等新安排），回应完不用再按开始：后台时钟下一小步按停前的倍速继续；
/// 玩家自己按了暂停的，回应完照旧停着。
#[test]
fn time_resumes_by_itself_after_answering_what_paused_it() {
    use manifest_appcore::Ticker;
    use std::time::Instant;
    let tmp = std::env::temp_dir().join(format!("manifest-ub-resume-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&tmp),
    )
    .unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let today = |st: &AppState| handlers::pending::upbringing(st).unwrap()["today"].clone();
    // 上旬排“休息”：testbed 里休息会引出一件要回应的小事（upbringing_note），时钟在上旬回顾时停下等回答。
    // U03 修好自动安排后，疲劳低时不再排休息，所以这里明确排上，不靠自动安排的选择。
    let plan = |st: &AppState| {
        let slots = handlers::pending::auto_plan(st, "balanced".into()).unwrap()["slots"].clone();
        let mut slots: Vec<manifest_core::upbringing::PlanSlot> = serde_json::from_value(slots).unwrap();
        slots[0].after = Some(manifest_core::upbringing::AfterChoice::activity("rest"));
        handlers::submit(st, Command::PlanMonth { owner: manifest_core::OwnerId::Player, slots }).unwrap();
    };
    let answer = |st: &AppState| {
        handlers::submit(st, Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice: 0 }).unwrap();
    };
    plan(&st);
    handlers::set_speed(&st, 2).unwrap();
    let mut ticker = Ticker::new(Instant::now());
    let run_until_pause = |ticker: &mut Ticker| {
        for _ in 0..40 {
            if handlers::current_speed(&st) == 0 {
                return;
            }
            let now = ticker_now(ticker);
            ticker.step(&st, now);
        }
        panic!("四十步内没有停下");
    };
    run_until_pause(&mut ticker);
    assert_eq!(today(&st), json!([1553, 1, 11]), "上旬的回顾：停下等玩家回答");
    // 回答之后不按开始：后台时钟的下一小步就按原来的 2 倍速继续
    answer(&st);
    assert_eq!(handlers::current_speed(&st), 0, "回答本身不改倍速");
    let now = ticker_now(&mut ticker);
    ticker.step(&st, now);
    assert_eq!(handlers::current_speed(&st), 2, "回应完自动按停前的倍速继续");
    assert_eq!(handlers::overview(&st).unwrap().speed, 2);
    // 月末等新安排：排好下个月就按原来的倍速接着走（不用再按开始）
    run_until_pause(&mut ticker);
    assert_eq!(today(&st), json!([1553, 2, 1]));
    assert_eq!(handlers::pending::upbringing(&st).unwrap()["phase"], "plan", "一个月走完，等新的安排");
    plan(&st);
    let now = ticker_now(&mut ticker);
    ticker.step(&st, now);
    assert_eq!(handlers::current_speed(&st), 2, "排好下个月自动继续");
    // 下一个停顿（回顾或月末）：这次玩家先自己按了暂停，回应后照旧停着
    run_until_pause(&mut ticker);
    let stopped = today(&st);
    handlers::set_speed(&st, 0).unwrap();
    if handlers::overview(&st).unwrap().story.and_then(|s| s.pending).is_some() {
        answer(&st);
    } else {
        plan(&st);
    }
    for _ in 0..3 {
        let now = ticker_now(&mut ticker);
        ticker.step(&st, now);
    }
    assert_eq!(handlers::current_speed(&st), 0, "玩家自己暂停的不自动继续");
    assert_eq!(today(&st), stopped);
}

#[test]
fn opted_in_playback_pauses_by_week_and_keeps_the_midweek_story() {
    let tmp = std::env::temp_dir().join(format!("manifest-ub-weekly-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&tmp),
    )
    .unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let month_days = {
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        Arc::make_mut(&mut world.defs).rules.upbringing.weekly_playback = true;
        world.defs.calendar.month_days(world.day())
    };
    let slots = rest_first(handlers::pending::auto_plan(&st, "balanced".into()).unwrap()["slots"].clone());
    handlers::submit(&st, serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":slots}})).unwrap())
        .unwrap();

    let fast_forward = || handlers::advance_clock(&st, 31 * 1440).unwrap().unwrap().days;
    handlers::set_speed(&st, 2).unwrap();
    assert_eq!(fast_forward(), 7);
    assert_eq!(handlers::current_speed(&st), 0);
    assert!(!handlers::auto_resume(&st));
    let view = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(view["today"], json!([1553, 1, 8]));
    assert_eq!(view["week"], json!({"number":2,"from":[1553,1,8],"to":[1553,1,14]}));
    assert_eq!(view["phase"], "running");

    handlers::set_speed(&st, 2).unwrap();
    assert_eq!(fast_forward(), 3);
    let overview = handlers::overview(&st).unwrap();
    assert_eq!(overview.world_date, [1553, 1, 11]);
    assert!(overview.story.unwrap().pending.is_some());
    assert_eq!(overview.speed, 0);
    handlers::submit(&st, Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice: 0 }).unwrap();
    assert!(handlers::auto_resume(&st));
    assert_eq!(fast_forward(), 4);
    assert_eq!(handlers::overview(&st).unwrap().world_date, [1553, 1, 15]);
    assert!(!handlers::auto_resume(&st));

    for (days, date) in [(7, [1553, 1, 22]), (7, [1553, 1, 29]), (month_days - 28, [1553, 2, 1])] {
        handlers::set_speed(&st, 2).unwrap();
        assert_eq!(fast_forward(), days);
        let overview = handlers::overview(&st).unwrap();
        assert_eq!(overview.world_date, date);
        assert_eq!(overview.speed, 0);
        assert!(!handlers::auto_resume(&st));
    }
    let view = handlers::pending::upbringing(&st).unwrap();
    assert_eq!(view["phase"], "plan");
    assert_eq!(view["last"].as_array().unwrap().len(), 3);
}

/// 上旬改排休息：测试世界里只有休息带旬后的回顾事件。U03 起“均衡”在不累的时候不再排休息
/// （不再把负疲劳当收益），所以显式排一次，继续检验“旬后有事件就停下”。
fn rest_first(slots: serde_json::Value) -> serde_json::Value {
    let mut plan: Vec<manifest_core::upbringing::PlanSlot> = serde_json::from_value(slots).unwrap();
    plan[0].after = Some(manifest_core::upbringing::AfterChoice::activity("rest"));
    serde_json::to_value(plan).unwrap()
}

/// 与上一步只隔 1 毫秒的“现在”：1× 下按倍速折算是 0 游戏分钟。
fn ticker_now(ticker: &mut manifest_appcore::Ticker) -> std::time::Instant {
    let now = std::time::Instant::now();
    ticker.idle(now);
    now + std::time::Duration::from_millis(1)
}

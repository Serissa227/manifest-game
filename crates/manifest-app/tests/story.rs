//! 剧情事件的应用层（推荐角色的故事线与奇遇）：静态数据里的“推荐选择”（带主角与故事线的剧本、只给推荐角色的身世选项）、
//! 推荐角色开局（专属外貌只在它自己的剧本里有效、以界面 JSON 立下定好的身世）、概览的 `story`（字段与前端 ipc/types.ts 一致，按语言）、
//! 剧情事件出现的那一天像遭遇一样暂停并推送 `story` 事件、以界面 JSON 提交 StoryAnswer、情报日志、存档读档；
//! 诺埃尔开局的文案不点破长得像姑娘（留作伏笔）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::views::CaptainView;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::Command;
use manifest_data::Locale;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::{Arc, Mutex};

fn app(dir: &Path) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

type Events = Arc<Mutex<Vec<(String, Value)>>>;

fn capture(st: &AppState) -> Events {
    let events: Events = Arc::default();
    let sink = events.clone();
    st.set_emitter(Arc::new(move |name, payload| sink.lock().unwrap().push((name.to_string(), payload))));
    events
}

fn named(events: &Events, name: &str) -> Vec<Value> {
    events.lock().unwrap().iter().filter(|(n, _)| n == name).map(|(_, v)| v.clone()).collect()
}

fn cmd(v: Value) -> Command {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("命令 JSON 无法解析：{e}\n{v}"))
}

/// 概览（JSON，与界面拿到的一样）。
fn overview_json(st: &AppState) -> Value {
    serde_json::to_value(handlers::overview(st).unwrap()).unwrap()
}

/// 按剧本里定好的主角开局：新游戏、主角的姓名与外貌、以界面 JSON 立下定好的身世（与前端 StartScreen 的做法相同）。
fn start_hero(st: &AppState, key: &str, seed: u64) -> Value {
    let statics = serde_json::to_value(handlers::static_data(st)).unwrap();
    let s = statics["scenarios"].as_array().unwrap().iter().find(|s| s["key"] == key).unwrap().clone();
    let hero = s["hero"].clone();
    handlers::new_game(st, key, Some(seed)).unwrap();
    let name = hero["name"].as_str().unwrap().to_string();
    let look = hero["look"].as_u64().unwrap() as u32;
    handlers::set_captain(st, CaptainView { name, portrait: look }).unwrap();
    let year = statics["world"]["start_year"].as_i64().unwrap() - hero["age"].as_i64().unwrap();
    let create = json!({"CreateCaptain": {
        "owner": "player",
        "birthday": { "year": year, "month": hero["month"], "day": hero["day"] },
        "answers": hero["answers"],
        "alloc": hero["alloc"],
        "genius": hero["genius"],
    }});
    handlers::submit(st, cmd(create)).expect("定好的身世总能立下");
    hero
}

#[test]
fn static_data_highlights_the_recommended_heroes_and_their_storylines() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let s = serde_json::to_value(handlers::static_data(&st)).unwrap();
    let scenarios = s["scenarios"].as_array().unwrap();
    assert_eq!(scenarios[0]["key"], "newcomer", "原有剧本的顺序不变（剧本按文件名排序，编号即下标）");
    let heroes: Vec<&Value> = scenarios.iter().filter(|x| x["recommended"] == true).collect();
    let keys: Vec<&str> = heroes.iter().map(|x| x["key"].as_str().unwrap()).collect();
    assert_eq!(keys, ["rossella", "noel", "xingcha"]);
    for h in &heroes {
        assert!(h["hero"].is_object() && h["story"].is_object(), "{h}");
        assert_eq!(h["goal"]["kind"], "story");
        assert_eq!(h["goal"]["target"], h["story"]["chapters"], "目标是走完故事线的全部章节");
        for field in ["name", "look", "tagline", "bio", "month", "day", "age", "answers", "alloc", "genius"] {
            assert!(h["hero"].get(field).is_some(), "HeroView 缺少 {field}");
        }
    }
    let looks: Vec<u64> = heroes.iter().map(|x| x["hero"]["look"].as_u64().unwrap()).collect();
    assert_eq!(looks, [101, 100, 23], "罗塞拉与诺埃尔是专属头像，温星槎用普通外貌 23 号");
    // 普通剧本没有推荐角色
    assert!(scenarios.iter().filter(|x| x["recommended"] != true).all(|x| x["hero"].is_null()));
    // 只给推荐角色的身世选项带着 hero（开局向导据此不列出）；每道问题都还有足够的普通选项
    let questions = s["captain"]["questions"].as_array().unwrap();
    let tagged: Vec<&str> = questions
        .iter()
        .flat_map(|q| q["options"].as_array().unwrap().iter())
        .filter(|o| o.get("hero").is_some())
        .map(|o| o["hero"].as_str().unwrap())
        .collect();
    assert_eq!(tagged.len(), 11);
    assert!(tagged.iter().all(|h| ["rossella", "noel", "xingcha"].contains(h)));
    for q in questions {
        let plain = q["options"].as_array().unwrap().iter().filter(|o| o.get("hero").is_none()).count();
        assert!(plain >= 2, "{}", q["key"]);
    }
}

/// 诺埃尔开局看得到的文案：剧本简介、一句话介绍与小传（按当前语言）。
fn noel_opening_copy(st: &AppState) -> Vec<String> {
    let s = serde_json::to_value(handlers::static_data(st)).unwrap();
    let noel = s["scenarios"].as_array().unwrap().iter().find(|x| x["key"] == "noel").cloned().expect("有诺埃尔的剧本");
    let text = |v: &Value| v.as_str().unwrap_or_else(|| panic!("缺少文字：{v}")).to_string();
    vec![text(&noel["description"]), text(&noel["hero"]["tagline"]), text(&noel["hero"]["bio"])]
}

/// 诺埃尔长得像姑娘是伏笔：开局看得到的文案中英文都不点破，
/// 也不用第三人称代词说出性别；第一章只说“漂亮得过分”，第三章“小姐骑士”才揭开。
#[test]
fn noels_opening_copy_leaves_the_secret_for_the_story() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    for t in noel_opening_copy(&st) {
        for w in ["姑娘", "女孩", "小姐", "男的", "美少年"] {
            assert!(!t.contains(w), "中文开局文案不该出现“{w}”：{t}");
        }
        // “他们”“其他”不说明诺埃尔的性别
        assert!(!t.replace("他们", "").replace("其他", "").contains('他'), "中文开局文案不该用“他”指诺埃尔：{t}");
    }
    let mut s = handlers::get_settings(&st).settings;
    s.language = Some(Locale::En);
    handlers::save_settings(&st, s).unwrap();
    for t in noel_opening_copy(&st) {
        assert!(!t.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)), "英文界面拿到英文：{t}");
        let words: Vec<String> = t.split(|c: char| !c.is_alphanumeric()).map(str::to_lowercase).collect();
        for w in ["girl", "lady", "he", "his", "him", "himself", "sir"] {
            assert!(!words.iter().any(|x| x == w), "英文开局文案不该出现 “{w}”：{t}");
        }
    }
}

#[test]
fn a_hero_portrait_is_only_valid_in_its_own_scenario() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    let err = handlers::set_captain(&st, CaptainView { name: "罗塞拉·萨利纳".into(), portrait: 101 });
    assert!(matches!(err, Err(AppError::Invalid(_))), "普通剧本不能用推荐角色的专属头像");
    handlers::new_game(&st, "noel", Some(1)).unwrap();
    assert!(
        handlers::set_captain(&st, CaptainView { name: "诺埃尔".into(), portrait: 101 }).is_err(),
        "101 号是罗塞拉的"
    );
    let o = handlers::set_captain(&st, CaptainView { name: "诺埃尔·德·卡德纳".into(), portrait: 100 }).unwrap();
    assert_eq!(o.captain.map(|c| c.portrait), Some(100));
    // 普通外貌照常可用
    assert!(handlers::set_captain(&st, CaptainView { name: "顾川".into(), portrait: 3 }).is_ok());
    // 推荐角色的名字按界面语言给出，译名可以比玩家自取的名字长（上限 24 个字）
    assert!(handlers::set_captain(&st, CaptainView { name: "Noël de Cadena".into(), portrait: 100 }).is_ok());
    let long = "Noël de Cadena the Last Knight".to_string();
    assert!(matches!(handlers::set_captain(&st, CaptainView { name: long, portrait: 100 }), Err(AppError::Invalid(_))));
    // 普通剧本仍是 12 个字
    handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    assert!(handlers::set_captain(&st, CaptainView { name: "Noël de Cadena".into(), portrait: 4 }).is_err());
}

#[test]
fn a_hero_story_opens_pauses_the_game_and_takes_ui_answers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let events = capture(&st);
    let hero = start_hero(&st, "rossella", 11);
    let o = overview_json(&st);
    let line = &o["story"]["line"];
    assert_eq!(line["name"], "盐与潮");
    assert_eq!((line["done"].as_u64(), line["total"].as_u64()), (Some(0), Some(7)));
    assert!(line["hint"].as_str().is_some_and(|h| !h.is_empty()), "下一章的提示");
    assert_eq!(o["goal"]["kind"], "story");
    // 立下的身世：她自己的五个回答，交易 6、口才 1
    let p = &o["profile"];
    assert_eq!(p["answers"], hero["answers"]);
    let attrs: Vec<i64> = p["attrs"].as_array().unwrap().iter().map(|a| a[1].as_i64().unwrap()).collect();
    assert_eq!(attrs, vec![3, 6, 4, 4, 3, 1]);
    // 推进一天：第一章出现，像遭遇一样暂停并推送 story 事件
    handlers::set_speed(&st, 4).unwrap();
    assert!(handlers::tick(&st).unwrap());
    let o = overview_json(&st);
    assert_eq!(o["speed"], 0, "剧情事件出现：暂停");
    let pushed = named(&events, "story");
    assert_eq!(pushed.len(), 1);
    let p = &o["story"]["pending"];
    assert_eq!(pushed[0]["key"], p["key"]);
    for key in ["day", "fleet", "kind", "key", "chapter", "total", "story", "title", "text", "speaker", "choices"] {
        assert!(p.get(key).is_some(), "StoryEventView 缺少 {key}：{p}");
    }
    assert_eq!(
        (p["kind"].as_str(), p["key"].as_str(), p["chapter"].as_u64()),
        (Some("chapter"), Some("farewell"), Some(1))
    );
    assert_eq!(p["title"], "出港的那天早上");
    assert_eq!(p["speaker"]["kind"], "portrait");
    assert_eq!(p["speaker"]["name"], "盐婆婆");
    assert_eq!(p["choices"].as_array().unwrap().len(), 2);
    // 合上继续：章节还在等，不再暂停
    handlers::set_speed(&st, 4).unwrap();
    assert!(handlers::tick(&st).unwrap());
    let o = overview_json(&st);
    assert_eq!(o["speed"], 4, "章节等着回应，但只在出现的那一天暂停");
    assert_eq!(o["story"]["pending"]["key"], "farewell");
    assert_eq!(named(&events, "story").len(), 1);
    // 界面 JSON：回应
    handlers::set_speed(&st, 0).unwrap();
    let bad = handlers::submit(&st, cmd(json!({"StoryAnswer": {"owner": "player", "choice": 9}})));
    assert!(matches!(bad, Err(AppError::Command(_))), "没有这个选项");
    let cash0 = o["cash"].as_i64().unwrap();
    let out = handlers::submit(&st, cmd(json!({"StoryAnswer": {"owner": "player", "choice": 1}}))).unwrap();
    let o = serde_json::to_value(&out.overview).unwrap();
    assert!(o["story"]["pending"].is_null());
    let last = &o["story"]["last"];
    assert_eq!(last["choice"], "（小声）……我能不能不去。");
    assert!(last["reply"].as_str().unwrap().contains("盐婆婆"));
    assert_eq!(last["outcomes"], json!([{"kind": "cash", "value": 300}]));
    assert_eq!(last["ended"], false);
    assert_eq!(o["cash"].as_i64().unwrap(), cash0 + 300);
    assert_eq!(o["story"]["line"]["done"], 1);
    assert_eq!(o["story"]["journal"].as_array().unwrap().len(), 1);
    // 情报日志：标题与所选选项
    let logs = handlers::intel(&st).unwrap();
    let log = serde_json::to_value(&logs).unwrap();
    let found =
        log["log"].as_array().unwrap().iter().find(|e| e["kind"] == "StoryResolved").cloned().expect("日志里有一条");
    let args: Vec<(String, String)> = serde_json::from_value(found["args"].clone()).unwrap();
    assert!(args.contains(&("title".into(), "出港的那天早上".into())), "{args:?}");
    // 英文界面：同一件事换成英文（数据的英文覆盖）
    let mut s = handlers::get_settings(&st).settings;
    s.language = Some(Locale::En);
    handlers::save_settings(&st, s).unwrap();
    let o = overview_json(&st);
    assert_eq!(o["story"]["line"]["name"], "Salt and Tide");
    assert!(!o["story"]["last"]["reply"].as_str().unwrap().chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c)));
}

#[test]
fn a_hero_game_saves_and_loads_with_its_portrait_and_story() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    start_hero(&st, "noel", 5);
    handlers::step(&st, 1).unwrap();
    handlers::submit(&st, cmd(json!({"StoryAnswer": {"owner": "player", "choice": 0}}))).unwrap();
    handlers::save_game(&st, "knight").unwrap();
    handlers::new_game(&st, "newcomer", Some(2)).unwrap();
    let back = handlers::load_game(&st, "knight").unwrap();
    assert_eq!(back.captain.map(|c| (c.name, c.portrait)), Some(("诺埃尔·德·卡德纳".to_string(), 100)));
    let story = serde_json::to_value(back.story).unwrap();
    assert_eq!(story["line"]["done"], 1);
    assert_eq!(story["line"]["name"], "链与缎带");
}

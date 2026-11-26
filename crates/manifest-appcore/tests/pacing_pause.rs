//! P11 第二阶段：出海后待决的章节只在刚出场的那一天让时钟停一次，到它的最后一天再提醒一次；
//! 中间的日子不再每天日结都暂停、把人从旅店叫醒。没开节奏规则的世界与养成期照旧。
//!
//! 夹具照 `chat.rs`：用测试世界开一局，再换上改过的定义（1558-01-01 开局、测试自己的故事轨道、开或不开节奏规则）。
use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_appcore::{AppPaths, AppState, handlers};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

type Events = Arc<Mutex<Vec<String>>>;

struct Fixture {
    st: AppState,
    dir: PathBuf,
    events: Events,
}

impl Fixture {
    /// 测试世界的一局：`scenario` 是剧本 key；`tracks` 不为空时换掉全部故事轨道；`gate` 决定开不开节奏规则。
    fn new(scenario: &str, tracks: Option<Value>, gate: bool) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "manifest-p11-pause-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let root = manifest_data::find_data_dir().unwrap();
        let st = AppState::from_data_dir(&root, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(&dir)).unwrap();
        let mut settings = st.settings();
        settings.ai.mode = AiMode::Off;
        settings.autosave_days = 0;
        handlers::save_settings(&st, settings).unwrap();
        handlers::new_world_game(
            &st,
            serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap(),
        )
        .unwrap();
        {
            let mut guard = st.game().unwrap();
            let g = guard.as_mut().unwrap();
            let mut defs = g.session.world.defs.clone();
            let d = Arc::make_mut(&mut defs);
            let index = d.scenarios.iter().position(|s| s.key == scenario).unwrap();
            if let Some(tracks) = tracks {
                d.scenarios[index].start_date = [1558, 1, 1];
                d.scenarios[index].control_date = [1558, 1, 1];
                d.story2.tracks = serde_json::from_value(tracks).unwrap();
            }
            d.rules.pacing.enabled = gate;
            g.session = manifest_sim::GameSession::new(defs, manifest_core::ScenarioId::from_idx(index), 42).unwrap();
        }
        let events: Events = Arc::default();
        let sink = events.clone();
        st.set_emitter(Arc::new(move |name, _| sink.lock().unwrap().push(name.to_string())));
        Self { st, dir, events }
    }

    fn overview(&self) -> Value {
        serde_json::to_value(handlers::overview(&self.st).unwrap()).unwrap()
    }

    /// 按开始、让时钟走一天；返回走完之后的概览。
    fn run_a_day(&self) -> Value {
        handlers::set_speed(&self.st, 4).unwrap();
        assert!(handlers::tick(&self.st).unwrap(), "时钟没有走");
        self.overview()
    }

    fn story_events(&self) -> usize {
        self.events.lock().unwrap().iter().filter(|name| *name == "story").count()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// 借用测试世界现成的轨道与章节 key（视图按名字表里的 key 取标题与文字，认不出新造的 key），
/// 换成一条只有一章、自动开始的轨道。
const TRACK: &str = "request_letters";

fn track(chapter: Value) -> Value {
    let mut c =
        json!({"key":"ask","title":"占位","text":"占位","choices":[{"key":"accept","text":"继续","next":"done"}]});
    c.as_object_mut().unwrap().extend(chapter.as_object().unwrap().clone());
    json!([{"key":TRACK,"name":"占位","kind":"request","start":"ask","chapters":[c]}])
}

/// 1 月 2 日出场、1 月 5 日是最后一天的章节。
fn windowed() -> Value {
    track(json!({"window":[[1558,1,2],[1558,1,5]]}))
}

/// 1 月 2 日出场、一直等着的章节。
fn open_ended() -> Value {
    track(json!({"when":[{"kind":"date","from":[1558,1,2]}]}))
}

fn pending(o: &Value) -> &Value {
    &o["story"]["pending"]["track"]
}

#[test]
fn a_waiting_chapter_pauses_the_clock_when_it_appears_and_again_on_its_last_day() {
    let f = Fixture::new("sandbox", Some(windowed()), true);
    let start = f.overview();
    assert!(start["awaiting"].is_null() && pending(&start).is_null());
    let day = start["day"].as_u64().unwrap();
    // 1 月 2 日：章节出场，时钟停一次，推送 story 事件。
    let o = f.run_a_day();
    assert_eq!(
        (o["day"].as_u64(), o["speed"].as_u64(), o["awaiting"].as_str()),
        (Some(day + 1), Some(0), Some("story"))
    );
    assert_eq!(pending(&o), TRACK);
    assert_eq!(f.story_events(), 1);
    // 1 月 3 日、4 日：章节还等着，时钟不再为它停下。
    for n in 2..=3 {
        let o = f.run_a_day();
        assert_eq!((o["day"].as_u64(), o["speed"].as_u64()), (Some(day + n), Some(4)), "第 {n} 天");
        assert!(o["awaiting"].is_null());
        assert_eq!(pending(&o), TRACK);
    }
    assert_eq!(f.story_events(), 1);
    // 1 月 5 日是它的最后一天：再提醒一次。
    let o = f.run_a_day();
    assert_eq!(
        (o["day"].as_u64(), o["speed"].as_u64(), o["awaiting"].as_str()),
        (Some(day + 4), Some(0), Some("story"))
    );
    assert_eq!(f.story_events(), 2);
    // 过了窗口，章节走掉。
    let o = f.run_a_day();
    assert_eq!((o["speed"].as_u64(), pending(&o).is_null()), (Some(4), true));
    assert!(o["awaiting"].is_null());
    assert_eq!(f.story_events(), 2);
}

/// 概览里待答章节的 `last_day`：只在它的最后一天给出（界面据此把玩家收起的对话框重新交到面前、写明“过了今天就错过”），
/// 别的日子与没开节奏规则的世界都不输出这个键。
#[test]
fn the_story_view_marks_the_last_day_of_a_waiting_chapter() {
    let f = Fixture::new("sandbox", Some(windowed()), true);
    // 1 月 2 日出场，3 日、4 日等着：都不是最后一天。
    for n in 1..=3 {
        let o = f.run_a_day();
        assert_eq!(pending(&o), TRACK, "第 {n} 天");
        assert!(o["story"]["pending"].get("last_day").is_none(), "第 {n} 天：{}", o["story"]["pending"]);
    }
    // 1 月 5 日是它的最后一天。
    let o = f.run_a_day();
    assert_eq!(pending(&o), TRACK);
    assert_eq!(o["story"]["pending"]["last_day"], true);

    // 没开节奏规则的世界：同一章到了最后一天也不输出。
    let off = Fixture::new("sandbox", Some(windowed()), false);
    for n in 1..=4 {
        let o = off.run_a_day();
        assert_eq!(pending(&o), TRACK, "第 {n} 天");
        assert!(o["story"]["pending"].get("last_day").is_none(), "第 {n} 天");
    }
}

#[test]
fn without_the_pacing_rules_a_waiting_chapter_still_pauses_every_day() {
    let f = Fixture::new("sandbox", Some(windowed()), false);
    f.run_a_day();
    for n in 1..=3 {
        let o = f.overview();
        assert_eq!((o["speed"].as_u64(), o["awaiting"].as_str()), (Some(0), Some("story")), "第 {n} 天");
        assert_eq!(f.story_events(), n);
        f.run_a_day();
    }
}

#[test]
fn resting_is_interrupted_once_by_a_new_chapter_and_not_by_an_old_one() {
    let f = Fixture::new("sandbox", Some(open_ended()), true);
    let day = f.overview()["day"].as_u64().unwrap();
    // 住五天：第二天章节出场，提前起来。
    let o = serde_json::to_value(handlers::step(&f.st, 5).unwrap()).unwrap();
    assert_eq!((o["day"].as_u64(), o["awaiting"].as_str()), (Some(day + 1), Some("story")));
    assert_eq!(pending(&o), TRACK);
    // 再住五天：章节还等着，但不再每天把人叫醒。
    let o = serde_json::to_value(handlers::step(&f.st, 5).unwrap()).unwrap();
    assert_eq!(o["day"].as_u64(), Some(day + 6));
    assert!(o["awaiting"].is_null());
    assert_eq!(pending(&o), TRACK);

    // 没开节奏规则：每住一天就被同一章叫醒一次。
    let f = Fixture::new("sandbox", Some(open_ended()), false);
    for n in 1..=3 {
        let o = serde_json::to_value(handlers::step(&f.st, 5).unwrap()).unwrap();
        assert_eq!((o["day"].as_u64(), o["awaiting"].as_str()), (Some(day + n), Some("story")), "第 {n} 次");
    }
}

#[test]
fn the_upbringing_clock_still_waits_for_every_answer() {
    for gate in [true, false] {
        let f = Fixture::new("upbringing", None, gate);
        // 开局在等月程；时钟不走。
        let o = f.overview();
        assert_eq!(o["awaiting"], "upbringing", "gate = {gate}");
        handlers::set_speed(&f.st, 4).unwrap();
        assert!(!handlers::tick(&f.st).unwrap());
        // 养成期里只要队首是 story2 的章节就算在等（与没有节奏规则时一样），不看它是哪天出场的。
        let guard = f.st.game().unwrap();
        let w = &guard.as_ref().unwrap().session.world;
        assert!(w.upbringing_active() && w.pacing_enabled() == gate);
        assert_eq!(w.story2_front_fresh(), w.story2_is_front());
    }
}

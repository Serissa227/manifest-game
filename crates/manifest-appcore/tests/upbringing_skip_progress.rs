//! P05：分段跳过与原逐日循环同轨，锁外进度可读，换局不会被旧任务推进。
use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppPaths, AppState, clock, handlers};
use manifest_core::{Command, OwnerId};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

struct Fixture {
    st: Arc<AppState>,
    dir: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "manifest-p05-skip-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let st = Arc::new(
            AppState::from_data_dir(
                &manifest_data::find_data_dir().unwrap(),
                Arc::new(MemoryKeyStore::default()),
                AppPaths::in_dir(&dir),
            )
            .unwrap(),
        );
        handlers::new_world_game(
            &st,
            serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap(),
        )
        .unwrap();
        Self { st, dir }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn skip() -> Command {
    Command::SkipUpbringing { owner: OwnerId::Player }
}

#[test]
fn progress_releases_lock_and_preserves_every_boundary_and_final_save() {
    let reference = Fixture::new();
    let (expected, book, boundaries, outcome) = {
        let mut guard = reference.st.game().unwrap();
        let g = guard.as_mut().unwrap();
        let outcome = g.session.submit_at(clock::since_day_start(g.minute) as u16, skip()).unwrap();
        let start = g.session.day();
        let mut boundaries = Vec::new();
        while g.session.world.upbringing_skipping() {
            g.session.advance_day().unwrap();
            g.book.record_day(&g.session.world);
            let day = g.session.day() - start;
            if day.is_multiple_of(7) || !g.session.world.upbringing_skipping() {
                boundaries.push((day, g.session.world.state_hash()));
            }
        }
        (serde_json::to_vec(&g.session.to_save()).unwrap(), g.book.clone(), boundaries, outcome)
    };
    let f = Fixture::new();
    let notifications = Arc::new(Mutex::new(Vec::new()));
    let notify = notifications.clone();
    f.st.set_overview_notifier(Arc::new(move |generation, rev| {
        notify.lock().unwrap().push((generation, rev));
    }));
    let events = Arc::new(Mutex::new(Vec::<(Value, String)>::new()));
    let capture = events.clone();
    let weak = Arc::downgrade(&f.st);
    f.st.set_emitter(Arc::new(move |name, value| {
        if name != "upbringing_progress" {
            return;
        }
        let st = weak.upgrade().unwrap();
        // 同步回调能重入读接口，证明不是仍持有游戏锁后再发事件。
        let overview = handlers::overview(&st).unwrap();
        assert_eq!(value["date"], json!(overview.world_date));
        let guard = st.game().unwrap();
        let g = guard.as_ref().unwrap();
        capture.lock().unwrap().push((value, g.session.world.state_hash()));
    }));
    let result = handlers::submit(&f.st, skip()).unwrap();
    assert_eq!(result.outcome, outcome);
    assert_eq!(result.overview.world_date, [1557, 1, 1]);
    let events = events.lock().unwrap();
    assert_eq!(events.len(), boundaries.len());
    assert_eq!(notifications.lock().unwrap().len(), boundaries.len());
    let mut previous_rev = 0;
    for ((event, hash), (day, expected_hash)) in events.iter().zip(&boundaries) {
        assert_eq!(event["day"], *day);
        assert_eq!(event["total"], 1460);
        assert_eq!(event["target"], json!([1557, 1, 1]));
        assert_eq!(event["done"], *day == 1460);
        assert_eq!(event["epoch"], result.overview.epoch);
        let rev = event["rev"].as_u64().unwrap();
        assert!(rev > previous_rev);
        previous_rev = rev;
        assert_eq!(hash, expected_hash);
    }
    let guard = f.st.game().unwrap();
    let g = guard.as_ref().unwrap();
    assert_eq!(serde_json::to_vec(&g.session.to_save()).unwrap(), expected);
    assert_eq!(g.book, book);
}

#[test]
fn replacing_game_in_progress_stops_old_work_before_touching_new_game() {
    let f = Fixture::new();
    let replacement = Arc::new(Mutex::new(None));
    let capture = replacement.clone();
    let weak = Arc::downgrade(&f.st);
    f.st.set_emitter(Arc::new(move |name, event| {
        if name != "upbringing_progress" {
            return;
        }
        assert_eq!(event["day"], 7);
        let st = weak.upgrade().unwrap();
        handlers::new_world_game(
            &st,
            serde_json::from_value(json!({"world":"classic","scenario":"newcomer","seed":99})).unwrap(),
        )
        .unwrap();
        let guard = st.game().unwrap();
        *capture.lock().unwrap() = Some(serde_json::to_vec(&guard.as_ref().unwrap().session.to_save()).unwrap());
    }));
    let error = handlers::submit(&f.st, skip()).unwrap_err();
    assert!(matches!(
        error,
        manifest_appcore::AppError::Invalid(message) if message.key == "app.upbringing_switched"
    ));
    let guard = f.st.game().unwrap();
    assert_eq!(
        serde_json::to_vec(&guard.as_ref().unwrap().session.to_save()).unwrap(),
        *replacement.lock().unwrap().as_ref().unwrap()
    );
}

#[test]
fn duplicate_skip_during_progress_is_rejected_without_changing_state_or_log() {
    let f = Fixture::new();
    let weak = Arc::downgrade(&f.st);
    let attempted = Arc::new(Mutex::new(false));
    let capture = attempted.clone();
    f.st.set_emitter(Arc::new(move |name, event| {
        if name != "upbringing_progress" || event["day"] != 7 {
            return;
        }
        let st = weak.upgrade().unwrap();
        let before = {
            let guard = st.game().unwrap();
            serde_json::to_vec(&guard.as_ref().unwrap().session.to_save()).unwrap()
        };
        assert!(handlers::submit(&st, skip()).is_err());
        let guard = st.game().unwrap();
        assert_eq!(serde_json::to_vec(&guard.as_ref().unwrap().session.to_save()).unwrap(), before);
        *capture.lock().unwrap() = true;
    }));
    handlers::submit(&f.st, skip()).unwrap();
    assert!(*attempted.lock().unwrap());
}

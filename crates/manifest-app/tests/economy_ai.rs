//! 第八批 E7：LLM 进入经济（docs/ECONOMY.md 第 8 节）在应用层——请账房点评预测（8.6）与身世序章（8.7）只返回文字、
//! 不改世界状态、结果缓存，按界面语言显示；酒馆里的商会传闻（8.2）与情报里的市场月报（8.5）。离线模板，不访问任何服务。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::Command;
use manifest_data::Locale;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

fn app(dir: &Path, mode: AiMode) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = mode;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

fn set_language(st: &AppState, locale: Locale) {
    let mut settings = handlers::get_settings(st).settings;
    settings.language = Some(locale);
    handlers::save_settings(st, settings).unwrap();
}

fn hash(st: &AppState) -> String {
    handlers::debug(st).unwrap().state_hash
}

fn cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

#[test]
fn the_bookkeeper_comments_on_a_forecast_without_touching_the_world() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    handlers::step(&st, 20).unwrap();
    let before = hash(&st);
    let facts = vec!["实际价格比预测高了 18%".to_string(), "预测期内这种货开始流行".to_string()];
    let text = handlers::review_comment(&st, 7, "澄港的谷物".into(), facts.clone()).unwrap();
    assert!(text.contains("澄港的谷物") && text.contains("实际价格比预测高了 18%"), "{text}");
    assert_eq!(hash(&st), before, "点评不改世界状态");
    // 同样的请求命中缓存
    assert_eq!(handlers::review_comment(&st, 7, "澄港的谷物".into(), facts).unwrap(), text);
    // 没有可写的内容
    let r = handlers::review_comment(&st, 7, "澄港的谷物".into(), vec![]);
    assert!(matches!(r, Err(AppError::Invalid(m)) if m.key == "app.note_unavailable"));
    // 英文界面：框架句是英文，诊断照界面给的原样放进去
    set_language(&st, Locale::En);
    let en = handlers::review_comment(
        &st,
        7,
        "grain at Villamare".into(),
        vec!["the price rose 18% above the forecast".into()],
    )
    .unwrap();
    assert!(!cjk(&en) && en.contains("the price rose 18% above the forecast"), "{en}");
    assert_eq!(hash(&st), before);
}

#[test]
fn a_prologue_is_written_from_the_background() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    handlers::new_game(&st, "newcomer", Some(4)).unwrap();
    // 还没有身世：没有可写的
    assert!(matches!(handlers::prologue(&st), Err(AppError::Invalid(m)) if m.key == "app.note_unavailable"));
    handlers::set_captain(&st, manifest_app::views::CaptainView { name: "林远舟".into(), portrait: 3 }).unwrap();
    let create: Command = serde_json::from_value(json!({
        "CreateCaptain": {
            "owner": "player",
            "birthday": { "year": 1480, "month": 2, "day": 12 },
            "answers": ["lighthouse_scribes", "dock_ledger", "university", "broker", "fortune"],
            "alloc": [0, 0, 0, 0, 0, 0],
            "genius": null,
        }
    }))
    .unwrap();
    let alloc_free = handlers::static_data(&st).captain.unwrap().points.free;
    let create = match create {
        Command::CreateCaptain { owner, birthday, answers, genius, .. } => {
            Command::CreateCaptain { owner, birthday, answers, alloc: vec![alloc_free, 0, 0, 0, 0, 0], genius }
        }
        other => other,
    };
    handlers::submit(&st, create).unwrap();
    let before = hash(&st);
    let text = handlers::prologue(&st).unwrap();
    assert!(text.contains("林远舟") && text.contains("灯塔修道院"), "{text}");
    assert_eq!(hash(&st), before, "序章不改世界状态");
    assert_eq!(handlers::prologue(&st).unwrap(), text, "缓存");
    set_language(&st, Locale::En);
    let en = handlers::prologue(&st).unwrap();
    assert!(en.contains("林远舟") || en.contains("Lin"), "{en}");
    assert!(!cjk(&en.replace("林远舟", "")), "英文界面的序章是英文：{en}");
}

#[test]
fn taverns_repeat_company_outlooks_and_intel_carries_market_reports() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Offline);
    handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    handlers::step(&st, 70).unwrap();
    // 各商会的本据港：酒馆里能听到它近 30 天的展望
    let defs = st.defs().clone();
    let heard: Vec<_> = defs.companies.iter().flat_map(|c| handlers::port(&st, c.home.0).unwrap().outlooks).collect();
    assert!(!heard.is_empty(), "商会展望成了酒馆里的传闻");
    assert!(heard.iter().all(|o| !o.memo.is_empty() && !o.company.is_empty()));
    // 情报：市场月报（每月至多两个海区）
    let intel = handlers::intel(&st).unwrap();
    assert!(!intel.reports.is_empty() && intel.reports.len() <= 4, "两个月的月报 {}", intel.reports.len());
    assert!(intel.reports.iter().all(|r| !r.text.is_empty() && r.month < 2));
    // 英文界面：月报与传闻按英文模板重新写
    set_language(&st, Locale::En);
    let intel = handlers::intel(&st).unwrap();
    assert!(intel.reports.iter().all(|r| !cjk(&r.text)), "{:?}", intel.reports);
    let heard: Vec<_> = defs.companies.iter().flat_map(|c| handlers::port(&st, c.home.0).unwrap().outlooks).collect();
    assert!(heard.iter().all(|o| !cjk(&o.memo)), "{heard:?}");
}

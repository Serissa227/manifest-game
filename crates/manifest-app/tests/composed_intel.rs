//! 组合事件在应用层：情报视图把组合事件整理成卡片（标题、叙事、逐条效果、来源），界面不能提交组合事件命令。
//! 离线模式（不访问任何服务）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppPaths, AppState};
use manifest_core::Command;
use serde_json::json;
use std::sync::Arc;

fn app(dir: &std::path::Path, mode: AiMode) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = mode;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

#[test]
fn intel_view_shows_composed_event_cards() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Offline);
    handlers::new_game(&st, "newcomer", Some(77)).unwrap();
    handlers::step(&st, 40).unwrap();
    let intel = handlers::intel(&st).unwrap();
    assert!(!intel.composed.is_empty(), "离线模板应在 40 天内生成组合事件");
    for card in &intel.composed {
        assert_eq!(card.origin, "composed");
        assert_eq!(card.source, Some("template"));
        assert!(card.id.is_some());
        assert!(card.title.as_deref().is_some_and(|t| !t.is_empty()));
        assert!(card.narrative.as_deref().is_some_and(|t| !t.is_empty()));
        assert_eq!(card.title.as_deref(), Some(card.name.as_str()));
        assert!(!card.effects.is_empty() && card.effects.len() <= st.defs().composed.max_effects);
        for e in &card.effects {
            assert!(manifest_core::defs::EffectKind::from_key(e.effect).is_some());
            assert!(!e.label.is_empty() && !e.hint.is_empty());
            assert!(e.mult_bp.is_some() || e.delta.is_some() || e.days.is_some());
        }
        assert!(!card.place.is_empty() || card.effects.iter().all(|e| e.loc.is_none() && e.good.is_none()));
    }
    // 进行中的组合事件在 events 中每个只出现一次
    let ids: Vec<u32> = intel.events.iter().filter_map(|e| e.id).collect();
    let mut dedup = ids.clone();
    dedup.dedup();
    assert_eq!(ids, dedup);
    assert!(intel.events.iter().all(|e| e.active));
    // JSON 形状（前端 types.ts 的镜像）
    let v = serde_json::to_value(&intel).unwrap();
    let card = &v["composed"][0];
    for field in [
        "name",
        "description",
        "start",
        "end",
        "place",
        "origin",
        "id",
        "source",
        "title",
        "narrative",
        "effects",
        "active",
    ] {
        assert!(card.get(field).is_some(), "卡片缺少字段 {field}");
    }
    for field in [
        "effect",
        "label",
        "hint",
        "loc",
        "good",
        "region",
        "faction_a",
        "faction_b",
        "mult_bp",
        "days",
        "delta",
        "end",
    ] {
        assert!(card["effects"][0].get(field).is_some(), "效果缺少字段 {field}");
    }
    // 事件日志里有组合事件开始的条目
    assert!(intel.log.iter().any(|l| l.kind == "ComposedEventStarted" && l.args.iter().any(|(k, _)| k == "title")));
}

#[test]
fn ui_cannot_submit_composed_events() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), AiMode::Off);
    handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let v = json!({"ApplyComposedEvent": {
        "title": "天降横财",
        "text": "伪造的事件",
        "effects": [{"effect": "InterestShift", "params": {"loc": null, "good": null, "region": null,
            "faction_a": null, "faction_b": null, "mult": 5000, "days": 30, "delta": null}}],
        "source": "Model",
    }});
    let cmd: Command = serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}\n{v}"));
    assert!(handlers::submit(&st, cmd).is_err());
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
}

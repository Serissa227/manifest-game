//! 静态图错误、旧存档key适配和严格英文覆盖。
use manifest_core::story2::{Story2Defs, graph};
use serde_json::json;

fn graph_errors(chapters: serde_json::Value) -> String {
    let defs: Story2Defs = serde_json::from_value(
        json!({"tracks":[{"key":"test","name":"检验","kind":"request","start":"a","chapters":chapters}]}),
    )
    .unwrap();
    graph::validate(&defs).join("\n")
}

#[test]
fn dead_ends_unreachable_chapters_and_once_cycles_are_rejected() {
    let errors = graph_errors(json!([
        {"key":"a","title":"一","text":"开始。","choices":[{"key":"go","text":"继续","next":"b"}]},
        {"key":"b","title":"二","text":"循环。","choices":[{"key":"back","text":"返回","next":"a"}]},
        {"key":"orphan","title":"三","text":"孤岛。","choices":[{"key":"end","text":"结束","next":"done"}]}]));
    for message in ["死路", "不可达", "一次性章节"] {
        assert!(errors.contains(message), "{errors}");
    }
}

#[test]
fn sourced_flags_and_repeatable_loops_with_exits_are_valid() {
    assert!(graph_errors(json!([
        {"key":"a","title":"一","text":"每天再来。","once":false,"family":"visit","family_cooldown_days":2,
         "choices":[{"key":"loop","text":"继续","next":"a","effects":[{"kind":"flag","flag":"visited"}]},{"key":"leave","text":"离开","next":"b"}]},
        {"key":"b","title":"二","text":"回家。","when":[{"kind":"flag","flag":"visited"}],"choices":[{"key":"end","text":"结束","next":"done"}]}])).is_empty());
}

#[test]
fn impossible_dates_ages_flags_and_self_generated_gates_are_reported() {
    let errors = graph_errors(json!([{"key":"a","title":"一","text":"矛盾。",
      "window":[[1553,1,1],[1553,2,1]],"when":[{"kind":"date","from":[1554,1,1]},{"kind":"flag","flag":"missing"},{"kind":"flag","flag":"self"}],
      "choices":[{"key":"end","text":"结束","next":"done","effects":[{"kind":"flag","flag":"self"}]}]}]));
    for message in ["条件互相矛盾", "没有来源：missing", "本章产生：self"] {
        assert!(errors.contains(message), "{errors}");
    }
}

#[test]
fn legacy_progress_pending_and_flags_adapt_to_keys_without_changing_save_bytes() {
    let defs = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    assert_eq!(defs.stories.stories.len(), 3);
    for story in &defs.stories.stories {
        let state:manifest_core::story::StoryState=serde_json::from_value(json!({"chapter":1,"flags":["old_flag"],"pending":{"day":5,"fleet":1,"source":{"chapter":1}},"journal":[{"day":4,"source":{"chapter":0},"choice":0}]})).unwrap();
        let bytes = serde_json::to_vec(&state).unwrap();
        let migrated = story.migrate_progress(&state).unwrap();
        assert_eq!(migrated.chapter, story.chapters[1].key);
        assert_eq!(migrated.pending.as_ref(), Some(&story.chapters[1].key));
        assert!(migrated.visited.contains(&story.chapters[0].key));
        assert!(migrated.flags.contains("old_flag"));
        assert_eq!(migrated.journal, vec![story.chapters[0].key.clone()]);
        assert_eq!(serde_json::to_vec(&state).unwrap(), bytes);
        let old: manifest_core::story::StoryState = serde_json::from_str("{}").unwrap();
        assert_eq!(story.migrate_progress(&old).unwrap().chapter, story.chapters[0].key);
    }
}

#[test]
fn a_timeout_without_a_deadline_is_a_dead_branch() {
    let mut defs = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    std::sync::Arc::make_mut(&mut defs).story2=serde_json::from_value(json!({"tracks":[{"key":"test","name":"超时","kind":"request","start":"a","chapters":[
        {"key":"a","title":"等待","text":"未声明期限。","timeout":{"next":"failed"},"choices":[{"key":"end","text":"完成","next":"done"}]}]}]})).unwrap();
    let error = manifest_data::story2::validate_story_tracks(&defs).unwrap_err().to_string();
    assert!(error.contains("timeout分支缺少限期"), "{error}");
}

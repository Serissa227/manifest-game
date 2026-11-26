//! U04 工作包 4：活动列表折叠永远排不上的（`hidden_count`）、给“差一点”的解锁差项（`unlock_gap`）与解锁通知（`unlocked_now`）。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{Command, OwnerId, ScenarioId, World, upbringing::Phase};
use std::collections::BTreeSet;

fn mio() -> World {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    World::new(d, sid, 42).unwrap()
}

fn answer_all(w: &mut World) {
    while w.pending_story2().is_some() || w.state.story.pending.is_some() {
        let answered = (0..manifest_core::story::MAX_CHOICES as u32)
            .any(|choice| Command::StoryAnswer { owner: OwnerId::Player, choice }.apply(w).is_ok());
        assert!(answered, "剧情没有能选的选项");
    }
}

#[test]
fn never_possible_activities_are_folded_into_a_count() {
    let mut w = mio();
    answer_all(&mut w);
    let before = w.state.clone();
    let v = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(w.state, before, "读视图改了世界");
    assert!(v["hidden_count"].as_u64().unwrap() > 0, "澪家乡期应当折叠掉没人教的外语等");
    assert!(v["hidden_lessons"].is_u64());
    let own: BTreeSet<String> =
        w.upbringing_family().unwrap().stages.iter().filter_map(|s| s.entry_flag.clone()).collect();
    let entry: BTreeSet<String> =
        w.defs.upbringing.families.iter().flat_map(|f| &f.stages).filter_map(|s| s.entry_flag.clone()).collect();
    for card in v["activities"].as_array().unwrap() {
        let key = card["key"].as_str().unwrap();
        let a = w.defs.upbringing.activity(key).unwrap();
        assert!(
            a.unlock.flag.as_ref().is_none_or(|f| !entry.contains(f) || own.contains(f)),
            "{key}：别家专属的活动没有折叠"
        );
        assert_ne!(key, "lesson_languages_lang_nahuatl", "没人教的外语没有折叠");
        assert!(
            card.get("unlock_gap").is_some() && card["near"].is_boolean() && card["placeholder"].is_boolean(),
            "{key}"
        );
        if let Some(gaps) = card["unlock_gap"].as_array() {
            assert_eq!(card["enabled"], false, "{key}：开着的活动不该有差项");
            for g in gaps {
                for field in ["key", "label", "have", "need"] {
                    assert!(!g[field].is_null(), "{key}：差项缺 {field}");
                }
                assert!(g["have"].as_i64() < g["need"].as_i64(), "{key}：{g}");
            }
        }
    }
    let card = v["activities"].as_array().unwrap().iter().find(|c| c["key"] == "u04_unlock_mio_1").cloned();
    let card = card.expect("本家的解锁练习要列出来（锁着）");
    // 11-04 名称按地区写好（澪：Opus），不再是占位键
    assert_eq!(card["placeholder"], false, "名称还是占位键");
    assert_eq!(card["name"], "誊星簿");
    if w.upbringing_flag("c9_family_mio") {
        let gaps = card["unlock_gap"].as_array().expect("只差成长时给差项");
        assert!(gaps.iter().any(|g| g["key"].as_str().unwrap().starts_with("growth:")));
    }
    assert!(v["unlocked_now"].as_array().unwrap().is_empty(), "开局已开放的不报");
}

#[test]
fn reaching_a_threshold_reports_the_new_activity_once_in_unlocked_now() {
    let mut w = mio();
    let a = w.defs.upbringing.activity("u04_unlock_mio_1").unwrap().clone();
    let (attr, need) = a.unlock.growth.iter().next().map(|(k, v)| (k.clone(), *v)).unwrap();
    w.state.upbringing.as_mut().unwrap().growth.insert(attr, need);
    // U05：寰宇按周，第一格在 1 月 2 日结算；跑到 5 日（按旬时第一旬 10 日结算，跑到 12 日）。都在开放提示的 10 天之内。
    let end =
        manifest_core::scenario::day_of(&w.defs, if w.upbringing_weekly() { [1553, 1, 5] } else { [1553, 1, 12] })
            .unwrap();
    while w.day() < end {
        answer_all(&mut w);
        if w.act_running() {
            if w.act_bot_step().unwrap() {
                continue;
            }
        } else if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
            let slots = w.auto_plan("balanced").unwrap();
            w.upbringing_plan_command(slots).apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    let v = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let now = v["unlocked_now"].as_array().unwrap();
    let item = now.iter().find(|n| n["key"] == "u04_unlock_mio_1").unwrap_or_else(|| panic!("{now:?}"));
    assert_eq!(item["kind"], "activity");
    // 名称写好以后给名称（还是占位键时给 null，界面回退通用语）
    assert_eq!(item["label"], "誊星簿");
    assert!(item["date"].is_array());
    let card = v["activities"].as_array().unwrap().iter().find(|c| c["key"] == "u04_unlock_mio_1").unwrap();
    assert!(card["unlock_gap"].is_null());
}

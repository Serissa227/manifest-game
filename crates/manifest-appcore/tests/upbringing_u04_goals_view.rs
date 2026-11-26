//! U04 工作包 5：年度目标卡的视图形状（DECISIONS 里写明的字段），读视图不改世界。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, World};

fn mio() -> World {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    World::new(d, sid, 42).unwrap()
}

#[test]
fn goals_view_lists_this_years_three_cards_with_progress_and_rewards() {
    let w = mio();
    let before = w.state.clone();
    let v = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(w.state, before, "读视图改了世界");
    let goals = &v["goals"];
    assert_eq!(goals["year"], 1553);
    let items = goals["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    for item in items {
        assert!(item["key"].as_str().unwrap().starts_with("u04_goal_mio_1553_"));
        // 11-04 目标文字按地区写好，不再回退通用语；fallback_code 照旧给
        assert!(item["text"].as_str().is_some_and(|t| !t.is_empty()), "目标文字没写：{item}");
        assert_eq!(item["fallback_code"], "upbringing.goal_generic");
        assert_eq!(item["status"], "active");
        let o = &item["objectives"].as_array().unwrap()[0];
        for field in ["key", "label", "have", "need", "done"] {
            assert!(!o[field].is_null(), "目标条件缺 {field}：{o}");
        }
        let r = &item["rewards"].as_array().unwrap()[0];
        assert!(["growth", "skill", "item", "memory"].contains(&r["kind"].as_str().unwrap()), "{r}");
    }
    assert!(goals["done_now"].as_array().unwrap().is_empty());
    assert!(goals["history"].as_array().unwrap().is_empty());
}

#[test]
fn a_completed_goal_shows_as_done_and_in_done_now() {
    let mut w = mio();
    let key = "u04_goal_mio_1553_3";
    let g = w.defs.upbringing.annual_goals.iter().find(|g| g.key == key).unwrap().clone();
    let manifest_core::story2::ObjectiveKind::Cash { ge } = g.objectives[0].kind else { panic!("第三张是攒钱") };
    w.state.agents.get_mut(&manifest_core::OwnerId::Player).unwrap().cash = ge;
    // 先答开局剧情：U03 起家乡期要等开局事件设了家庭旗标才算开始，之前排不了月程。
    let answer = |w: &mut World| {
        while w.pending_story2().is_some() {
            let answered = (0..manifest_core::story::MAX_CHOICES as u32).any(|choice| {
                manifest_core::Command::StoryAnswer { owner: manifest_core::OwnerId::Player, choice }.apply(w).is_ok()
            });
            assert!(answered, "开局的剧情没有能选的选项");
        }
    };
    answer(&mut w);
    if w.act_running() {
        while w.act_bot_step().unwrap() {}
    } else {
        let slots = w.auto_plan("balanced").unwrap();
        w.upbringing_plan_command(slots).apply(&mut w).unwrap();
    }
    answer(&mut w);
    w.end_day().unwrap();
    let v = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let item = v["goals"]["items"].as_array().unwrap().iter().find(|i| i["key"] == key).unwrap().clone();
    assert_eq!(item["status"], "done");
    assert_eq!(item["objectives"][0]["done"], true);
    assert!(item["done_date"].is_array());
    assert!(v["goals"]["done_now"].as_array().unwrap().iter().any(|k| k == key));
}

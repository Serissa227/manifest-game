//! 月份门槛在旬预算之前过滤，并保留缺省事件的原行为。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    upbringing::{AfterChoice, EventGate, PlanSlot},
};
use std::sync::Arc;

fn fixture(months: Option<Vec<u32>>) -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let data = Arc::make_mut(&mut d);
    for a in &mut data.upbringing.activities {
        a.events.clear();
    }
    data.story2.tracks = vec![toml::from_str(
        "key='monthly'\nname='测试'\nkind='encounter'\nstart='event'\nauto=false\nacademy=true\n\
         [[chapters]]\nkey='event'\ntitle='测试'\ntext='月份测试。'\nonce=false\nfamily='monthly'\nfamily_cooldown_days=1\n\
         [[chapters.choices]]\nkey='ok'\ntext='继续'\nnext='done'\n"
    ).unwrap()];
    data.upbringing.event_gates.clear();
    data.upbringing.event_gates.insert("monthly".into(), EventGate { months, ..Default::default() });
    let sid = ScenarioId::from_idx(data.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, 42).unwrap()
}

fn plan(w: &mut World) {
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(w)
    .unwrap();
}

#[test]
fn daily_budget_excludes_other_months_and_keeps_absent_months_unrestricted() {
    for months in [None, Some(vec![2])] {
        let mut w = fixture(months.clone());
        plan(&mut w);
        for _ in 0..31 {
            if w.pending_story2().is_some() {
                assert!(months.is_none(), "一月不能排入二月事件");
                Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
            }
            w.end_day().unwrap();
            if months.is_some() && w.cast_date()[1] == 1 {
                assert!(w.pending_story2().is_none());
                assert!(!w.state.upbringing.as_ref().unwrap().event_permits.contains("monthly"));
            }
        }
        if months.is_none() {
            assert!(!w.state.story2.tracks["monthly"].visited.is_empty());
        }
        // 一月最后一旬的事件在二月一日入队，按排队当天的月份判断。
        assert_eq!(w.cast_date(), [1553, 2, 1]);
        assert_eq!(w.pending_story2().unwrap().track, "monthly");
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        plan(&mut w);
        for _ in 0..28 {
            if w.pending_story2().is_some() {
                Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
            }
            w.end_day().unwrap();
        }
        assert_eq!(w.cast_date(), [1553, 3, 1]);
        // 隔旬排期：二月最后一旬空出普通短事件位；缺省月份门槛不应绕过这项频率规则。
        assert!(w.pending_story2().is_none());
        plan(&mut w);
        for _ in 0..10 {
            w.end_day().unwrap();
        }
        // 三月第一个允许的旬：缺省月份照常出现，只限二月的事件仍不能入队。
        assert_eq!(w.cast_date(), [1553, 3, 11]);
        assert_eq!(w.pending_story2().is_some(), months.is_none());
        if let Some(pending) = w.pending_story2() {
            assert_eq!(pending.track, "monthly");
        }
        let restored = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
        assert_eq!(restored.state_hash(), w.state_hash());
    }
}

#[test]
fn months_reject_empty_duplicate_and_out_of_range_lists() {
    for months in [vec![], vec![0], vec![13], vec![1, 1]] {
        let w = fixture(Some(months));
        assert!(manifest_core::upbringing::native_validation::validate(&w.defs).iter().any(|e| e.contains("月份")));
    }
    for months in [None, Some(vec![12, 1, 2]), Some((1..=12).collect())] {
        let w = fixture(months);
        assert!(!manifest_core::upbringing::native_validation::validate(&w.defs).iter().any(|e| e.contains("月份")));
    }
}

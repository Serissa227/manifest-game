//! U03：寰宇真实数据上的定向测试（远足许可、孤儿旗标与无入口轨道）。
#[path = "support/u03.rs"]
mod u03;
use manifest_core::{
    log::LogKind,
    story2::graph::validate_reachability,
    upbringing::{AfterChoice, OUTING_PERMISSION_FLAG},
};
use u03::*;

const HEROES: [&str; 9] = ["baraka", "ix_nikte", "kaicili", "lieve", "lin_wandeng", "mio", "najma", "noel", "tariq"];

#[test]
fn terra16_has_no_orphan_unlock_flags_or_tracks_without_entry() {
    let d = defs();
    let errors = validate_reachability(&d);
    assert!(errors.is_empty(), "{errors:#?}");
    // 检查是真的：把一个已经改过来源的门槛放回去，校验就报出来。
    let mut broken = (*d).clone();
    let patrol = broken.upbringing.activities.iter_mut().find(|a| a.key == "night_patrol").unwrap();
    patrol.unlock.flag = Some("patrol_permission".into());
    let gate = broken.upbringing.event_gates.remove("c9_zhangzhou_giri_letters");
    assert!(gate.is_some());
    let errors = validate_reachability(&broken);
    assert!(errors.iter().any(|e| e == "activity:night_patrol: 旗标没有来源：patrol_permission"), "{errors:?}");
    assert!(
        errors.iter().any(|e| e.starts_with("c9_zhangzhou_giri_letters: 不自动开始的轨道没有任何入口")),
        "{errors:?}"
    );
}

#[test]
fn outing_permission_reaches_every_hero_after_thirty_home_days_and_opens_outings() {
    let d = defs();
    for hero in HEROES {
        let (before, _) = run_until(hero, Some([1553, 1, 30]));
        assert!(!before.upbringing_flag(OUTING_PERMISSION_FLAG), "{hero}：满 30 天前就发了远足许可");
        let (w, report) = run_until(hero, Some([1553, 2, 2]));
        assert!(report.locked.is_empty() && report.errors.is_empty(), "{hero}：{report:?}");
        // 剧情旗标表与养成旗标集都设上，日志恰好一条。
        assert!(w.state.story2.flags.contains(OUTING_PERMISSION_FLAG), "{hero}");
        assert!(w.state.upbringing.as_ref().unwrap().flags.contains(OUTING_PERMISSION_FLAG), "{hero}");
        let logs: Vec<u32> = w.state.log.iter().filter(|e| e.kind == LogKind::OutingPermitted).map(|e| e.day).collect();
        assert_eq!(logs, [day_of(&d, [1553, 1, 31])], "{hero}");
        // 远足活动排得上：家乡的远足图里至少有一个起点节点通过内核检查。
        let a = d.upbringing.activity("excursion").unwrap();
        let date = w.cast_date();
        let open = d.upbringing.excursions.iter().any(|e| {
            e.starts.iter().any(|n| {
                let c = AfterChoice {
                    excursion: Some(e.key.clone()),
                    node: Some(n.clone()),
                    ..AfterChoice::activity(&a.key)
                };
                w.check_upbringing_choice(a, Some(&c), date).is_ok()
            })
        });
        assert!(open, "{hero}：拿到远足许可后仍排不上远足");
        // 各家“第一次远足”的起始章：远足许可这一条已经满足。
        let first = d
            .story2
            .tracks
            .iter()
            .find(|t| {
                t.key.starts_with(&format!("c9_{hero}_"))
                    && (t.key.ends_with("first_outing") || t.key.ends_with("outing_first"))
            })
            .unwrap_or_else(|| panic!("{hero} 没有第一次远足"));
        let c = first.chapter(&first.start).unwrap();
        let permits: Vec<_> = c
            .when
            .iter()
            .filter(|cond| matches!(cond, manifest_core::story2::Condition::Flag { flag, .. } if flag == OUTING_PERMISSION_FLAG))
            .cloned()
            .collect();
        assert_eq!(permits.len(), 1, "{hero}");
        assert!(w.story2_conditions(&permits, w.day()), "{hero}");
        assert!(!before.story2_conditions(&permits, before.day()), "{hero}");
    }
}

#[test]
fn terra16_static_reachability_finds_nothing_impossible() {
    let d = defs();
    let r = manifest_core::upbringing::Reachability::new(&d);
    let errors = r.unreachable();
    assert!(errors.is_empty(), "{} 处静态不可达：{errors:#?}", errors.len());
    // 引擎发的远足许可在家乡期开始满 30 天那天。
    assert_eq!(r.flags.get(OUTING_PERMISSION_FLAG), Some(&day_of(&d, [1553, 1, 31])));
}

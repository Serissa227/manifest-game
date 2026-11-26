//! H02：寰宇 `[voyage_wear]` 引用的商品、改装与奇遇都存在；三阶段的事件都在海上、守奇遇的规矩；经典世界不开。
use manifest_core::story::{Place, StoryEffect};

#[test]
fn terra16_wear_rules_reference_real_goods_refits_and_crew_events() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "terra16").unwrap();
    let r = &d.rules.voyage_wear;
    assert!(r.enabled && r.problems().is_empty(), "{:?}", r.problems());
    for g in &r.antiscorbutic {
        assert!(d.find_good(g).is_some(), "抗坏血病的货 {g} 不存在");
    }
    for (k, _) in r.refit_fouling.iter().chain(&r.refit_leak).chain(&r.refit_rigging) {
        assert!(d.refits.iter().any(|x| &x.key == k), "改装 {k} 不存在");
    }
    for list in [&r.grumble_events, &r.slowdown_events, &r.mutiny_events] {
        assert_eq!(list.len(), 3, "每个阶段三套说法");
        for key in list {
            let e = d.stories.encounter(key).unwrap_or_else(|| panic!("奇遇 {key} 不存在"));
            assert_eq!(e.place, Place::Sea);
            assert!(r.is_crisis_event(key));
            // 至少一个不花钱的选项，身无分文也答得了
            assert!(e.choices.iter().any(|c| c.cost == 0 && c.give.is_none()), "{key}");
        }
    }
    // 怠工与哗变的事件里都有“复工”或“许诺靠港”或“哗变成真”的出路
    for key in r.slowdown_events.iter().chain(&r.mutiny_events) {
        let e = d.stories.encounter(key).unwrap();
        let flags: Vec<&str> = e
            .choices
            .iter()
            .flat_map(|c| c.effects.iter().chain(&c.fail))
            .filter_map(|x| if let StoryEffect::Flag(f) = x { Some(f.as_str()) } else { None })
            .collect();
        assert!(
            flags.iter().any(|f| ["voyage_back_to_work", "voyage_promise_port", "voyage_mutiny"].contains(f)),
            "{key}: {flags:?}"
        );
    }
    let classic = manifest_data::load_world(&root, "classic").unwrap();
    assert!(!classic.rules.voyage_wear.enabled && !classic.rules.voyage_posts.enabled);
}

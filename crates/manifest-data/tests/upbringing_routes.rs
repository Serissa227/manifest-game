//! 11-04 改投学院：两所原来没有家庭入读的学院（能岛水路见习处、安特卫普印书与修辞见习圈）开给澪和莉芙。
//! 家乡期选了路线旗标的局，学院期整段改去那所学院；原学院专属的事件一条不出，照常结业。
#[path = "support/u03.rs"]
mod u03;
use manifest_core::upbringing::Stage;
use std::collections::BTreeSet;
use u03::*;

const ROUTES: [(&str, &str, &str, &str); 2] = [
    ("mio", "c9_mio_route_noshima", "noshima_boat_school", "kyoto_court"),
    ("lieve", "c9_lieve_route_printing", "antwerp_printing_rhetoric", "antwerp_laurel"),
];

#[test]
fn a_route_swaps_every_academy_stage_and_nothing_else() {
    let d = defs();
    for (family, flag, academy, original) in ROUTES {
        let f = d.upbringing.family(family).unwrap();
        let a = d.upbringing.academy(academy).unwrap();
        let [(route_flag, v)] = f.routed.as_slice() else { panic!("{family}：应当恰有一条改投路线") };
        assert_eq!(route_flag, flag);
        assert_eq!(v.key, f.key);
        assert_eq!(v.stages.len(), f.stages.len());
        let mut first = true;
        for (s, b) in v.stages.iter().zip(&f.stages) {
            assert_eq!((s.from, s.stage), (b.from, b.stage), "{family}：日期与阶段不变");
            if s.stage == Stage::Academy {
                assert_eq!(b.academy.as_deref(), Some(original));
                assert_eq!(
                    (s.academy.as_deref(), s.at.as_str(), s.name.as_str()),
                    (Some(academy), a.at.as_str(), a.name.as_str())
                );
                if first {
                    assert_eq!(s.entry_flag, a.entry_flag, "{family}：头一段学院期用新学院的入学标记");
                    assert_eq!(
                        s.entry_event.as_deref(),
                        Some(format!("c9_academy_{academy}_enrollment_1554").as_str())
                    );
                }
                first = false;
            } else {
                assert_eq!(s, b, "{family}：家乡期不变");
            }
        }
        let promise = v.completion.as_ref().and_then(|c| c.promise_at.as_deref());
        assert_eq!(promise, a.graduation.as_ref().map(|g| g.promise_at.as_str()));
        // 结业事件换成路线版（原条写的是原学院）
        let event = v.completion.as_ref().and_then(|c| c.event.as_deref());
        assert_eq!(event, f.routes[0].completion_event.as_deref());
        assert_ne!(event, f.completion.as_ref().and_then(|c| c.event.as_deref()));
        // 原学院的校历事件都挡着这条路线（校验也保证这一点）
        let prefix = format!("c9_academy_{original}_");
        let gated: Vec<_> = d.upbringing.event_gates.iter().filter(|(k, _)| k.starts_with(&prefix)).collect();
        assert!(!gated.is_empty());
        assert!(gated.iter().all(|(_, g)| g.not_flag.as_deref() == Some(flag)), "{family}：{gated:?}");
    }
}

#[test]
fn the_route_flag_switches_the_family_the_world_uses() {
    let d = defs();
    for (family, flag, academy, original) in ROUTES {
        let f = d.upbringing.family(family).unwrap().clone();
        let mut w = start(d.clone(), &f);
        let academies = |w: &manifest_core::World| -> BTreeSet<String> {
            w.upbringing_family().unwrap().stages.iter().filter_map(|s| s.academy.clone()).collect()
        };
        assert_eq!(academies(&w), BTreeSet::from([original.to_owned()]));
        w.state.story2.flags.insert(flag.into());
        assert_eq!(academies(&w), BTreeSet::from([academy.to_owned()]));
        // 换了语言的显示数据取同一条路线
        assert_eq!(w.upbringing_family_in(&d.upbringing).unwrap().stages, w.upbringing_family().unwrap().stages);
    }
}

/// 走改投路线跑完整个养成期：新学院的入学与结业事件都出现，原学院的校历与被挡掉的原事件一条不出，
/// 路线版的事件（起始章条件带路线旗标的）到期的出现八成以上，养成期不混进非养成轨道。
fn check_route(family: &str, flag: &str, academy: &str, original: &str) {
    let d = defs();
    let (w, r) = run_route(family, flag);
    eprintln!("{}", summary(&r));
    assert!(r.locked.is_empty(), "{family}：没有可选选项的待回应章节 {:?}", r.locked);
    assert!(r.errors.is_empty(), "{family}：{:?}", r.errors);
    assert!(r.graduated, "{family}：没有跑到结业，停在 {:?}", r.end);
    assert!(w.upbringing_flag(flag), "{family}：改投事件没有出现或没选上");
    let seen: BTreeSet<&str> = r.seen.iter().map(|s| s.track.as_str()).collect();
    let f = d.upbringing.family(family).unwrap();
    let route = f.routes.iter().find(|x| x.flag == flag).unwrap();
    assert!(seen.contains(route.entry_event.as_str()), "{family}：新学院的入学事件没有出现");
    let completion = route.completion_event.as_deref().unwrap();
    assert!(seen.contains(completion), "{family}：路线版的结业事件 {completion} 没有出现");
    let blocked: BTreeSet<&str> = d
        .upbringing
        .event_gates
        .iter()
        .filter(|(_, g)| g.not_flag.as_deref() == Some(flag))
        .map(|(k, _)| k.as_str())
        .collect();
    let prefix = format!("c9_academy_{original}_");
    let base_completion = f.completion.as_ref().and_then(|c| c.event.as_deref());
    // 只看学院期开始以后：多章的支线在家乡期（改投之前）就开了头，被门槛挡掉的是之后的章节。
    let school = f.stages.iter().find(|s| s.stage == Stage::Academy).map(|s| day_of(&d, s.from)).unwrap();
    let after: BTreeSet<&str> = r.seen.iter().filter(|s| s.day >= school).map(|s| s.track.as_str()).collect();
    let leaked: Vec<&str> = after
        .iter()
        .copied()
        .filter(|k| k.starts_with(&prefix) || blocked.contains(k) || Some(*k) == base_completion)
        .collect();
    assert!(leaked.is_empty(), "{family}：改投后还出了原学院的事件 {leaked:?}");
    let not_upbringing: Vec<&str> =
        seen.iter().copied().filter(|k| d.story2.track(k).is_some_and(|t| !t.academy)).collect();
    assert!(not_upbringing.is_empty(), "{family}：养成期出现了非养成轨道 {not_upbringing:?}");
    // 路线版事件：门槛到期（早于结束 30 天）、起始章条件带路线旗标
    let last = day_of(&d, r.end).saturating_sub(30);
    let route_events: Vec<&str> = d
        .upbringing
        .event_gates
        .iter()
        .filter(|(k, g)| {
            g.from.is_none_or(|from| day_of(&d, from) <= last)
                && d.story2.track(k).and_then(|t| t.chapter(&t.start)).is_some_and(|c| {
                    c.when.iter().any(
                        |w| matches!(w, manifest_core::story2::Condition::Flag { flag: x, value: true } if x == flag),
                    )
                })
        })
        .map(|(k, _)| k.as_str())
        .collect();
    assert!(!route_events.is_empty(), "{family}：没有路线版事件");
    let shown = route_events.iter().filter(|k| seen.contains(**k)).count();
    assert!(
        shown * 100 >= route_events.len() * 80,
        "{family}：路线版事件只出了 {shown}/{}，没出的 {:?}",
        route_events.len(),
        route_events.iter().filter(|k| !seen.contains(**k)).collect::<Vec<_>>()
    );
    // 学院期确实在新学院
    assert!(seen.iter().any(|k| k.starts_with(&format!("c9_academy_{academy}_"))), "{family}：新学院的校历没有出现");
}

#[test]
fn mio_on_the_noshima_route_runs_to_graduation() {
    let (family, flag, academy, original) = ROUTES[0];
    check_route(family, flag, academy, original);
}

#[test]
fn lieve_on_the_printing_route_runs_to_graduation() {
    let (family, flag, academy, original) = ROUTES[1];
    check_route(family, flag, academy, original);
}

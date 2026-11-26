//! 学院及自由行动引用检查，远足图必须有 6–12 个可达的稳定节点。
use super::*;
use crate::StaticData;
pub fn validate(defs: &StaticData) -> Vec<String> {
    let d = &defs.upbringing;
    let mut errors = Vec::new();
    let mut check = |ok: bool, key: &str, message: &str| {
        if !ok {
            errors.push(format!("{key}: {message}"));
        }
    };
    let key = |s: &str| {
        !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    };
    let loc = |s: &str| defs.locations.iter().any(|l| l.key == s);
    let attr = |s: &str| defs.captain.attribute_index(s).is_some();
    let date =
        |v: WorldDate| defs.calendar.day_of(crate::calendar::Date { year: v[0], month: v[1], day: v[2] }).is_ok();
    let event = |s: &str| defs.story2.tracks.iter().any(|t| super::activity_validation::event_matches(s, &t.key));
    let people = |p: &BTreeMap<String, CompanionRole>| p.keys().all(|s| defs.cast.person(s).is_some());
    let mut keys = BTreeSet::new();
    for a in &d.academies {
        check(key(&a.key) && keys.insert(&a.key) && !a.name.trim().is_empty(), &a.key, "学院键重复或名称无效");
        check(loc(&a.at), &a.key, "学院地点不存在");
        check(a.allowance >= 0, &a.key, "学院津贴不能为负");
        check((6..=10).contains(&a.places.len()), &a.key, "学院小地图须有 6–10 个场所");
        check(
            a.culture.is_empty() || super::native_validation::culture_exists(defs, &a.culture),
            &a.key,
            "学院文化不存在",
        );
        check(
            people(&a.companions) && a.mentor_roles.values().all(|p| defs.cast.person(p).is_some()),
            &a.key,
            "学院引用未知人物",
        );
        let mut marks = BTreeSet::new();
        for m in &a.calendar {
            check(
                key(&m.key) && marks.insert(&m.key) && !m.name.trim().is_empty() && date(m.date),
                &a.key,
                "校历键、名称或日期无效",
            );
            check(
                ["school", "exam", "contest", "letter", "news"].contains(&m.kind.as_str())
                    && m.event.as_deref().is_none_or(event),
                &a.key,
                "校历类别或事件引用无效",
            );
        }
    }
    for f in &d.families {
        check(people(&f.companions), &f.key, "家庭引用未知人物");
        for s in &f.stages {
            check(
                s.academy.as_ref().is_none_or(|key| d.academy(key).is_some_and(|a| a.at == s.at)),
                &f.key,
                "阶段学院不存在或地点不一致",
            );
            check(
                s.entry_event
                    .as_ref()
                    .is_none_or(|key| defs.story2.track(key).is_some_and(|t| t.kind == crate::story2::TrackKind::Main)),
                &f.key,
                "入学事件必须引用主线轨道",
            );
            check(s.entry_flag.is_some() == s.entry_event.is_some(), &f.key, "入学标记与事件必须同时给出");
        }
        // 改投路线：学院有入学标记、不是本家原来的学院；入学事件是主线、某个选项设那个入学标记；选择旗标有故事来源。
        let sets = |track: &str, flag: &str| {
            defs.story2.track(track).is_some_and(|t| {
                t.chapters
                    .iter()
                    .flat_map(crate::story2::graph::branches)
                    .flat_map(|b| b.effects)
                    .any(|e| matches!(e, crate::story2::Effect::Flag { flag: ref set, value: true } if set == flag))
            })
        };
        let mut route_flags = BTreeSet::new();
        for r in &f.routes {
            let academy = d.academy(&r.academy);
            check(
                academy.is_some_and(|a| a.entry_flag.is_some())
                    && f.stages.iter().any(|s| s.stage == Stage::Academy)
                    && !f.stages.iter().any(|s| s.academy.as_ref() == Some(&r.academy)),
                &f.key,
                "改投路线的学院不存在、没有入学标记、与原学院相同，或本家没有学院期",
            );
            check(
                defs.story2.track(&r.entry_event).is_some_and(|t| t.kind == crate::story2::TrackKind::Main)
                    && academy.and_then(|a| a.entry_flag.as_deref()).is_some_and(|flag| sets(&r.entry_event, flag)),
                &f.key,
                "改投路线的入学事件必须是主线，并设那所学院的入学标记",
            );
            check(
                key(&r.flag) && route_flags.insert(&r.flag) && defs.story2.tracks.iter().any(|t| sets(&t.key, &r.flag)),
                &f.key,
                "改投路线的选择旗标无效、重复，或没有故事设它",
            );
            check(
                r.completion_event.as_ref().is_none_or(|k| defs.story2.track(k).is_some()),
                &f.key,
                "改投路线的结业事件不存在",
            );
            // 原学院的校历事件（`c9_academy_<原学院>_*`）改投后不能再出：门槛要么限定学院，要么对这条路线 not_flag。
            for original in f.stages.iter().filter_map(|s| s.academy.as_deref()).collect::<BTreeSet<_>>() {
                let prefix = format!("c9_academy_{original}_");
                for (k, g) in d.event_gates.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)) {
                    check(
                        g.academy.is_some() || g.not_flag.as_deref() == Some(r.flag.as_str()),
                        k,
                        "改投路线开着时，原学院的校历事件门槛要限定学院或 not_flag 这条路线",
                    );
                }
            }
        }
    }
    let mut places = BTreeSet::new();
    for (owner, list) in
        d.families.iter().map(|f| (&f.key, &f.places)).chain(d.academies.iter().map(|a| (&a.key, &a.places)))
    {
        check(list.is_empty() || (6..=10).contains(&list.len()), owner, "小地图须有 6–10 个场所");
        for p in list {
            check(
                key(&p.key) && places.insert(&p.key) && !p.name.trim().is_empty() && !p.venue.is_empty(),
                owner,
                "场所键重复或字段为空",
            );
            check((0..=100).contains(&p.x) && (0..=100).contains(&p.y), &p.key, "场所坐标越界");
            check(p.events.iter().all(|s| event(s)), &p.key, "场所引用未知事件");
            check(
                p.unlock.growth.iter().all(|(k, v)| attr(k) && (0..=1000).contains(v))
                    && p.unlock
                        .rating
                        .iter()
                        .all(|(k, v)| defs.captain.ratings.iter().any(|r| &r.key == k) && (0..=1000).contains(v))
                    && p.unlock.skills.keys().all(|k| defs.story2.skills.contains(k)),
                &p.key,
                "场所门槛引用无效",
            );
        }
    }
    keys.clear();
    for f in &d.festivals {
        check(key(&f.key) && keys.insert(&f.key) && !f.name.trim().is_empty(), &f.key, "节庆键重复或名称为空");
        check(
            !f.dates.is_empty() && f.dates.iter().copied().all(date) && f.dates.windows(2).all(|p| p[0] < p[1]),
            &f.key,
            "节庆须逐年给出不重复的有效日期",
        );
        check(
            !f.cultures.is_empty() && f.cultures.iter().all(|c| super::native_validation::culture_exists(defs, c)),
            &f.key,
            "节庆引用未知文化",
        );
        check(f.event.as_deref().is_none_or(event), &f.key, "节庆引用未知事件");
    }
    keys.clear();
    for e in &d.excursions {
        check(
            key(&e.key)
                && keys.insert(&e.key)
                && !e.name.trim().is_empty()
                && (loc(&e.at) || (e.at.is_empty() && (!e.place.cultures.is_empty() || !e.place.academies.is_empty()))),
            &e.key,
            "远足键、名称或地点无效",
        );
        let mut nodes = BTreeSet::new();
        check((6..=12).contains(&e.nodes.len()), &e.key, "远足必须有 6–12 个节点");
        for n in &e.nodes {
            check(key(&n.key) && nodes.insert(&n.key) && !n.name.trim().is_empty(), &e.key, "远足节点键重复或名称为空");
        }
        check(!e.starts.is_empty() && e.starts.iter().all(|n| nodes.contains(n)), &e.key, "远足起点不存在");
        for n in &e.nodes {
            check(
                (0..=100).contains(&n.x) && (0..=100).contains(&n.y) && (0..=10000).contains(&n.danger),
                &n.key,
                "远足坐标或危险越界",
            );
            check(
                n.links.iter().all(|k| k != &n.key && nodes.contains(k))
                    && n.links.iter().collect::<BTreeSet<_>>().len() == n.links.len(),
                &n.key,
                "远足链接重复、自指或不存在",
            );
            check(
                n.tools.iter().all(|k| defs.items.item(k).is_some())
                    && n.items.iter().all(|(k, v)| defs.items.item(k).is_some() && (1..=100).contains(v)),
                &n.key,
                "远足物品引用或数量无效",
            );
            check(n.companion_skills.iter().all(|s| defs.story2.skills.contains(s)), &n.key, "远足引用未知同行技能");
            check(
                n.growth.iter().chain(&n.rewards).all(|(k, v)| attr(k) && (0..=1000).contains(v))
                    && n.events.iter().all(|s| event(s)),
                &n.key,
                "远足成长或事件引用无效",
            );
        }
        let mut reachable = e.starts.iter().collect::<BTreeSet<_>>();
        loop {
            let before = reachable.len();
            for n in &e.nodes {
                if reachable.contains(&n.key) {
                    reachable.extend(n.links.iter());
                }
            }
            if reachable.len() == before {
                break;
            }
        }
        check(reachable.len() == e.nodes.len(), &e.key, "远足存在无法从起点到达的节点");
    }
    for (person, skills) in &d.helpers {
        check(
            defs.cast.person(person).is_some() && skills.iter().all(|s| defs.story2.skills.contains(s)),
            person,
            "同行技能表引用未知人物或技能",
        );
    }
    for a in &d.activities {
        check(
            (0..=10).contains(&a.heart) && (a.heart == 0 || a.needs.contains(&Need::Companion)),
            &a.key,
            "心动数值或同行要求无效",
        );
        check(
            a.training_ship
                .as_ref()
                .is_none_or(|k| a.kind == ActivityKind::Voyage && defs.ships.iter().any(|s| &s.key == k)),
            &a.key,
            "实习船型号或活动种类无效",
        );
        check(a.kind != ActivityKind::Voyage || a.training_ship.is_some(), &a.key, "实习航行必须声明临时船型");
    }
    // 从学院活动和入学入口推导学院语境，作者漏写 academy 也不能绕过恋爱效果上限。
    let mut academy_events = BTreeSet::new();
    for f in d.family_variants() {
        for s in &f.stages {
            if s.stage == Stage::Academy {
                academy_events.extend(s.entry_event.iter().cloned());
            }
        }
    }
    for a in &d.academies {
        academy_events.extend(a.calendar.iter().filter_map(|m| m.event.clone()));
        academy_events.extend(a.places.iter().flat_map(|p| p.events.iter().cloned()));
    }
    for a in &d.activities {
        if a.stage.allows(Stage::Academy) {
            academy_events.extend(a.events.iter().chain(&a.failure.events).cloned());
            if let Some(r) = &a.risk {
                academy_events.extend(r.success_events.iter().chain(&r.failure_events).cloned());
            }
        }
    }
    if !d.academies.is_empty() && !academy_events.is_empty() {
        // 学院线在结业时开启的后续轨道（例如 C7 的重逢，1557 年以后）不属于学院语境：
        // 只有全部章节都带窗口、且都在最晚的结业日当天或之后才开始的轨道才这样算，其余照旧传染学院语境。
        let graduation = d.families.iter().map(|f| f.graduation).max();
        let after_academy = |t: &crate::story2::TrackDef| {
            graduation.is_some_and(|g| {
                !t.chapters.is_empty() && t.chapters.iter().all(|c| c.window.is_some_and(|w| w[0] >= g))
            })
        };
        let mut checked = defs.clone();
        loop {
            let before = academy_events.len();
            let mut next = Vec::new();
            for t in &checked.story2.tracks {
                if t.academy
                    || (!after_academy(t)
                        && academy_events.iter().any(|p| super::activity_validation::event_matches(p, &t.key)))
                {
                    for c in &t.chapters {
                        for e in c
                            .choices
                            .iter()
                            .flat_map(|c| c.effects.iter().chain(c.fail.iter().flat_map(|b| &b.effects)))
                            .chain(c.default.iter().chain(c.timeout.iter()).flat_map(|b| &b.effects))
                        {
                            if let crate::story2::Effect::StartTrack { track } = e {
                                next.push(track.clone());
                            }
                        }
                    }
                }
            }
            academy_events.extend(next);
            if academy_events.len() == before {
                break;
            }
        }
        for t in &mut checked.story2.tracks {
            if !after_academy(t) && academy_events.iter().any(|p| super::activity_validation::event_matches(p, &t.key))
            {
                t.academy = true;
            }
        }
        errors.extend(crate::story2::validation::validate(&checked));
    }
    errors
}

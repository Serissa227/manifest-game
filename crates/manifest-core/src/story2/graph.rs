//! 故事图的结构与必要条件检查；动态门禁由故事机器人再用真实命令验证。
use super::*;

pub fn branches(c: &ChapterDef) -> Vec<Branch> {
    c.choices
        .iter()
        .map(Choice::branch)
        .chain(c.choices.iter().filter_map(|o| o.fail.clone()))
        .chain(c.default.iter().cloned())
        .chain(c.timeout.iter().cloned())
        .collect()
}

pub fn validate(defs: &Story2Defs) -> Vec<String> {
    validate_external(defs, &BTreeSet::new())
}

/// 世界效果与养成引擎也是实际设置者；从已经通过定义校验的声明收集旗标。
pub fn validate_world(defs: &crate::StaticData) -> Vec<String> {
    validate_external(&defs.story2, &external_flag_sources(defs))
}

/// 故事效果以外的旗标来源：结社、怪物、历史结果、养成引擎与定义里的固定来源。
pub fn external_flag_sources(defs: &crate::StaticData) -> BTreeSet<String> {
    let mut flags = BTreeSet::new();
    for effect in defs.societies.societies.iter().flat_map(|s| &s.ranks).flat_map(|r| &r.effects) {
        if let Effect::Flag { flag, value: true } = effect {
            flags.insert(flag.clone());
        }
    }
    for outcome in defs.creatures.creatures.iter().flat_map(|c| c.outcomes.values()) {
        if let Some(flag) = &outcome.clue {
            flags.insert(flag.clone());
        }
    }
    if !defs.upbringing.families.is_empty() {
        flags.extend(crate::upbringing::ENGINE_FLAGS.iter().map(|flag| (*flag).to_string()));
    }
    for capital in defs
        .upbringing
        .families
        .iter()
        .filter_map(|f| f.completion.as_ref().map(|c| &c.capital))
        .chain(defs.upbringing.paths.iter().map(|p| &p.capital))
    {
        flags.extend(capital.grant_once.iter().cloned());
        flags.extend(capital.estate.iter().map(|e| e.grant_once.clone()));
        flags.extend(capital.caravan.iter().map(|c| c.grant_once.clone()));
    }
    flags.extend(defs.history.outcome_flags().map(str::to_string));
    // 养成引擎自己设置的旗标：入学标记由入学章节设，结业时的志向与约定结果、职业分支、考试与志向奖励、跳过时的缺省旗标。
    for f in defs.upbringing.family_variants() {
        flags.extend(f.stages.iter().filter_map(|s| s.entry_flag.clone()));
        flags.extend(f.completion.iter().flat_map(|c| c.defaults.flags.iter().cloned()));
    }
    if !defs.upbringing.families.is_empty() {
        flags.extend(crate::upbringing::GRADUATION_RESULT_FLAGS.iter().map(|flag| (*flag).to_string()));
    }
    if !defs.arcana.spells.is_empty() {
        flags.insert(crate::upbringing::ARCANA_AWAKENED_FLAG.into());
    }
    flags.extend(defs.upbringing.activities.iter().filter_map(|a| a.tier.as_ref()?.branch.clone()));
    flags.extend(
        defs.upbringing
            .exams
            .iter()
            .map(|e| &e.award)
            .chain(defs.upbringing.paths.iter().map(|p| &p.award))
            .chain(defs.upbringing.endings.iter().map(|e| &e.award))
            .flat_map(|a| a.flags.iter().cloned()),
    );
    // K3a：周首引荐也是地点与师长解锁旗标的实际来源。
    flags.extend(defs.upbringing.act_perks.iter().filter(|p| p.kind == "introduce").map(|p| p.flag.clone()));
    flags
}

/// 内容世界的可达性（U03 / A3）：养成解锁与门槛里的孤儿旗标、没有任何入口的非自动轨道。
/// 加载器对可玩与草稿世界都执行；隐藏的测试世界由测试代码直接开轨道、直接设旗标，不查。
pub fn validate_reachability(defs: &crate::StaticData) -> Vec<String> {
    let mut errors = upbringing_orphan_flags(defs, &external_flag_sources(defs));
    errors.extend(tracks_without_entry(defs));
    errors
}

/// 故事效果里设为真的旗标，加上世界与引擎的固定来源。
fn story_producers(defs: &Story2Defs) -> BTreeSet<String> {
    defs.tracks
        .iter()
        .flat_map(|t| &t.chapters)
        .flat_map(branches)
        .flat_map(|b| b.effects)
        .filter_map(|e| match e {
            Effect::Flag { flag, value: true } => Some(flag),
            _ => None,
        })
        .collect()
}

/// 养成的解锁（活动、场所、学院访问、远足节点的 `unlock.flag`）与考试、志向、结局门槛里的旗标都必须有来源（U03 / A3）。
/// 故事章节条件与选项 `requires` 里的旗标由 `validate_external` 检查。
fn upbringing_orphan_flags(defs: &crate::StaticData, external: &BTreeSet<String>) -> Vec<String> {
    let u = &defs.upbringing;
    let produced = story_producers(&defs.story2);
    let mut readers: Vec<(String, &str)> = Vec::new();
    for a in &u.activities {
        readers.extend(a.unlock.flag.iter().map(|f| (format!("activity:{}", a.key), f.as_str())));
    }
    for p in u.families.iter().flat_map(|f| &f.places).chain(u.academies.iter().flat_map(|a| &a.places)) {
        readers.extend(p.unlock.flag.iter().map(|f| (format!("place:{}", p.key), f.as_str())));
    }
    for a in &u.academies {
        for v in &a.visits {
            readers.extend(v.unlock.flag.iter().map(|f| (format!("visit:{}:{}", a.key, v.at), f.as_str())));
        }
    }
    for e in &u.excursions {
        for n in &e.nodes {
            readers.extend(n.unlock.flag.iter().map(|f| (format!("excursion:{}:{}", e.key, n.key), f.as_str())));
        }
    }
    fn requirement_flags<'a>(r: &'a crate::upbringing::Requirements, out: &mut Vec<&'a str>) {
        if let Some(flag) = &r.flag
            && r.flag_value != Some(false)
        {
            out.push(flag);
        }
        for r in r.all.iter().chain(&r.any) {
            requirement_flags(r, out);
        }
    }
    let gated = u
        .exams
        .iter()
        .map(|e| (format!("exam:{}", e.key), vec![&e.requirements]))
        .chain(u.paths.iter().map(|p| (format!("path:{}", p.key), vec![&p.reveal, &p.requirements])))
        .chain(u.endings.iter().map(|e| (format!("ending:{}", e.key), vec![&e.requirements])));
    for (place, list) in gated {
        let mut found = Vec::new();
        for r in list {
            requirement_flags(r, &mut found);
        }
        readers.extend(found.into_iter().map(|f| (place.clone(), f)));
    }
    readers
        .into_iter()
        .filter(|(_, flag)| !produced.contains(*flag) && !external.contains(*flag))
        .map(|(place, flag)| format!("{place}: 旗标没有来源：{flag}"))
        .collect()
}

/// 不自动开始的轨道必须有入口：故事里的 start_track / end_track、人物的 bond_track 等轨道字段、养成的短事件门槛与各处事件引用、
/// 结社试炼与政策事件、血脉的反转与传说之船的轨道（U03 / A3）。
fn tracks_without_entry(defs: &crate::StaticData) -> Vec<String> {
    let entries = entry_patterns(defs, true);
    defs.story2
        .tracks
        .iter()
        .filter(|t| {
            !t.auto && !entries.iter().any(|p| crate::upbringing::activity_validation::event_matches(p, &t.key))
        })
        .map(|t| {
            format!("{}: 不自动开始的轨道没有任何入口（start_track、bond_track、短事件门槛或养成事件引用）", t.key)
        })
        .collect()
}

/// 轨道入口的全部引用（可含 `*` 结尾的前缀）；`with_start_track` 为假时不含故事章节效果里的 start_track / end_track。
pub fn entry_patterns(defs: &crate::StaticData, with_start_track: bool) -> Vec<String> {
    let mut entries: Vec<&str> = Vec::new();
    let mut started = Vec::new();
    if with_start_track {
        for b in defs.story2.tracks.iter().flat_map(|t| &t.chapters).flat_map(branches) {
            for e in b.effects {
                if let Effect::StartTrack { track } | Effect::EndTrack { track } = e {
                    started.push(track);
                }
            }
        }
    }
    for e in defs.societies.societies.iter().flat_map(|s| &s.ranks).flat_map(|r| &r.effects) {
        if let Effect::StartTrack { track } | Effect::EndTrack { track } = e {
            started.push(track.clone());
        }
    }
    entries.extend(started.iter().map(String::as_str));
    for p in &defs.cast.persons {
        entries
            .extend(p.bond_track.iter().chain(&p.main_track).chain(&p.npc_track).chain(&p.tracks).map(String::as_str));
    }
    let u = &defs.upbringing;
    entries.extend(u.event_gates.keys().map(String::as_str));
    entries.extend(u.rules.illness_events.iter().map(String::as_str));
    // 心情低谷时排进候选的“闹脾气”场景（U04 工作包 3）。
    entries.extend(u.rules.mood.iter().flat_map(|m| &m.low_events).map(String::as_str));
    for a in &u.activities {
        entries.extend(a.events.iter().chain(&a.failure.events).map(String::as_str));
        if let Some(r) = &a.risk {
            entries.extend(r.success_events.iter().chain(&r.failure_events).map(String::as_str));
        }
    }
    for f in &u.festivals {
        entries.extend(f.event.iter().chain(&f.events).map(String::as_str));
    }
    for a in &u.academies {
        entries.extend(a.calendar.iter().filter_map(|m| m.event.as_deref()));
        entries.extend(a.places.iter().flat_map(|p| &p.events).map(String::as_str));
        entries.extend(a.clubs.iter().flat_map(|c| &c.events).map(String::as_str));
        entries.extend(a.graduation.iter().map(|g| g.event.as_str()));
    }
    for f in u.family_variants() {
        entries.extend(f.places.iter().flat_map(|p| &p.events).map(String::as_str));
        entries.extend(f.stages.iter().filter_map(|s| s.entry_event.as_deref()));
        entries.extend(
            f.completion
                .iter()
                .flat_map(|c| c.event.iter().chain(&c.family_event).chain(&c.choose_event))
                .map(String::as_str),
        );
    }
    entries.extend(u.contests.iter().flat_map(|c| &c.events).map(String::as_str));
    entries.extend(u.exams.iter().flat_map(|e| &e.events).map(String::as_str));
    entries.extend(u.paths.iter().flat_map(|p| &p.events).map(String::as_str));
    entries.extend(u.excursions.iter().flat_map(|e| &e.nodes).flat_map(|n| &n.events).map(String::as_str));
    for s in &defs.societies.societies {
        entries.extend(s.ranks.iter().filter_map(|r| r.trial.as_deref()));
    }
    entries.extend(defs.societies.policies.iter().filter_map(|p| p.event.as_deref()));
    entries.extend(defs.lineages.lineages.iter().filter_map(|l| l.reversal.as_deref()));
    entries.extend(defs.legend_ships.ships.iter().filter_map(|s| s.acquire.track.as_deref()));
    entries.into_iter().map(str::to_string).collect()
}

fn validate_external(defs: &Story2Defs, external: &BTreeSet<String>) -> Vec<String> {
    let mut producers: BTreeMap<_, BTreeSet<_>> = defs
        .tracks
        .iter()
        .flat_map(|t| t.chapters.iter().map(move |c| (t, c)))
        .fold(BTreeMap::new(), |mut map, (t, c)| {
            for e in branches(c).into_iter().flat_map(|b| b.effects) {
                if let Effect::Flag { flag, value: true } = e {
                    map.entry(flag).or_default().insert((t.key.clone(), c.key.clone()));
                }
            }
            map
        });
    for flag in external {
        producers.entry(flag.clone()).or_default().insert(("$world".into(), "$effect".into()));
    }
    let mut errors = Vec::new();
    for t in &defs.tracks {
        let mut reachable = BTreeSet::from([t.start.as_str()]);
        loop {
            let before = reachable.len();
            for c in &t.chapters {
                if reachable.contains(c.key.as_str()) {
                    for b in branches(c) {
                        if let Some(c) = t.chapter(&b.next) {
                            reachable.insert(&c.key);
                        }
                    }
                }
            }
            if before == reachable.len() {
                break;
            }
        }
        let mut terminal = BTreeSet::from(["done".to_string(), "failed".to_string()]);
        loop {
            let before = terminal.len();
            for c in &t.chapters {
                if branches(c).iter().any(|b| terminal.contains(&b.next)) {
                    terminal.insert(c.key.clone());
                }
            }
            if before == terminal.len() {
                break;
            }
        }
        for c in &t.chapters {
            let mut issue = |s: &str| errors.push(format!("{}:{}: {s}", t.key, c.key));
            if !reachable.contains(c.key.as_str()) {
                issue("章节从起点不可达");
            }
            if !terminal.contains(&c.key) {
                issue("死路：章节无法抵达done或failed");
            }
            if c.once && returns_to(t, &c.key) {
                issue("一次性章节处于循环中，重新进入会重复结算");
            }
            for cond in c.when.iter().chain(c.choices.iter().flat_map(|o| &o.requires)) {
                if let Condition::Flag { flag, value: true } = cond {
                    match producers.get(flag) {
                        None if defs.pending_flags.contains(flag) => {}
                        None => issue(&format!("旗标没有来源：{flag}")),
                        Some(p)
                            if p.iter().all(|(track, chapter)| track == &t.key && chapter == &c.key)
                                && (c.once
                                    || c.when
                                        .iter()
                                        .any(|c| matches!(c,Condition::Flag{flag:f,value:true} if f==flag))) =>
                        {
                            issue(&format!("旗标只能由尚未触发的本章产生：{flag}"))
                        }
                        _ => {}
                    }
                }
            }
            let mut conditions = c.when.clone();
            if let Some(w) = c.window {
                conditions.push(Condition::Date { from: Some(w[0]), to: Some(w[1]) });
            }
            if contradictory(&conditions) {
                issue("章节条件互相矛盾");
            }
            for o in &c.choices {
                let all: Vec<_> = conditions.iter().chain(&o.requires).cloned().collect();
                if contradictory(&all) {
                    issue(&format!("选项{}的条件互相矛盾", o.key));
                }
            }
        }
    }
    // 待交付旗标只替“还没交付的设置者”占位：已有故事或引擎设置者、或者没有任何读取的登记都是错误。
    let readers: BTreeSet<&str> = defs
        .tracks
        .iter()
        .flat_map(|t| &t.chapters)
        .flat_map(|c| {
            c.when
                .iter()
                .chain(c.choices.iter().flat_map(|o| &o.requires))
                .chain(c.variants.iter().flat_map(|v| &v.when))
        })
        .filter_map(|cond| match cond {
            Condition::Flag { flag, .. } => Some(flag.as_str()),
            _ => None,
        })
        .collect();
    for flag in &defs.pending_flags {
        if producers.contains_key(flag) {
            errors.push(format!("pending_flags: 待交付旗标已有故事设置，请从 pending_flags 删掉：{flag}"));
        } else if !readers.contains(flag.as_str()) {
            errors.push(format!("pending_flags: 待交付旗标没有任何章节、选项或变体读取：{flag}"));
        }
    }
    errors
}

fn returns_to(t: &TrackDef, start: &str) -> bool {
    let mut seen = BTreeSet::new();
    let mut stack = vec![start.to_string()];
    while let Some(key) = stack.pop() {
        if !seen.insert(key.clone()) {
            continue;
        }
        if let Some(c) = t.chapter(&key) {
            for b in branches(c) {
                if b.next == start {
                    return true;
                }
                if t.chapter(&b.next).is_some() {
                    stack.push(b.next);
                }
            }
        }
    }
    false
}

fn contradictory(list: &[Condition]) -> bool {
    let mut from = [0; 3];
    let mut to = [u32::MAX; 3];
    let mut flags = BTreeMap::new();
    let mut ages = BTreeMap::<Option<&str>, (u32, u32)>::new();
    let mut places = BTreeMap::new();
    let mut season = None;
    let mut protagonists: Option<BTreeSet<&str>> = None;
    for c in list {
        let keys = match c {
            Condition::Protagonist { protagonist } => Some(BTreeSet::from([protagonist.as_str()])),
            Condition::ProtagonistIn { protagonist_in } => Some(protagonist_in.iter().map(String::as_str).collect()),
            _ => None,
        };
        if let Some(keys) = keys {
            let remaining = protagonists.map_or(keys.clone(), |old| old.intersection(&keys).copied().collect());
            if remaining.is_empty() {
                return true;
            }
            protagonists = Some(remaining);
        }
        match c {
            Condition::Date { from: a, to: b } => {
                if let Some(a) = a {
                    from = from.max(*a);
                }
                if let Some(b) = b {
                    to = to.min(*b);
                }
            }
            Condition::Flag { flag, value } => {
                if flags.insert(flag, *value).is_some_and(|v| v != *value) {
                    return true;
                }
            }
            Condition::Age { person, ge, le } => {
                let (lo, hi) = ages.entry(person.as_deref()).or_insert((0, u32::MAX));
                *lo = (*lo).max(ge.unwrap_or(0));
                *hi = (*hi).min(le.unwrap_or(u32::MAX));
                if *lo > *hi {
                    return true;
                }
            }
            Condition::At { at, person } => {
                if places.insert(person, at).is_some_and(|p| p != at) {
                    return true;
                }
            }
            Condition::Season { season: s } if season.replace(*s).is_some_and(|old| old != *s) => return true,
            _ => {}
        }
    }
    from > to
}

//! 人物分片的严格结构、日期与引用校验。
mod catalog;
mod pending;

use super::{Issues, check_keys, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::{cast::*, defs::LocationDef, ids::FactionId, scenario::WorldDate};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn load(
    dir: &EffectiveWorld,
    locations: &[LocationDef],
    places: &mut manifest_core::geo::places::PlaceCatalog,
    factions: &BTreeMap<String, FactionId>,
    is: &mut Issues,
) -> CastDefs {
    let mut defs = CastDefs::default();
    if !dir.module_enabled("cast") {
        return defs;
    }
    let sources = match dir.cast_sources() {
        Ok(v) => v,
        Err(e) => {
            is.push("cast", "", e.to_string());
            return defs;
        }
    };
    for (file, text) in sources {
        let Some(mut value) = parse::<toml::Value>(&file, &text, is) else { continue };
        // E08 的身份头兼容：没有 kind 的条目只供开局身份使用，不当成完整 NPC。
        if let Some(persons) = value.get_mut("persons").and_then(toml::Value::as_array_mut) {
            persons.retain(|p| p.get("kind").is_some());
        }
        let mut parsed: CastDefs = match catalog::parse_cast(value, &file, dir.manifest.draft) {
            Ok(v) => v,
            Err(e) => {
                is.push(&file, "cast", format!("人物 TOML 格式错误：{e}"));
                continue;
            }
        };
        for person in &mut parsed.persons {
            person.source.clone_from(&file);
            validate_person(dir, &file, person, locations, places, factions, is);
        }
        defs.persons.extend(parsed.persons);
        for past in &mut parsed.past {
            past.source.clone_from(&file);
        }
        defs.past.extend(parsed.past);
        defs.ties.extend(parsed.ties);
        defs.tie_metadata.extend(parsed.tie_metadata);
        defs.deferred_ties.extend(parsed.deferred_ties);
        defs.diagnostics.extend(parsed.diagnostics);
        check_keys(&file, "figures", parsed.figures.iter().map(|f| (f.key.as_str(), f.name.as_str())), is);
        for figure in &mut parsed.figures {
            figure.source.clone_from(&file);
            if figure.name.chars().count() > 80 {
                is.push(&file, &figure.key, "立绘名称超过80字");
            }
        }
        defs.figures.extend(parsed.figures);
    }
    check_keys("cast", "persons", defs.persons.iter().map(|p| (p.key.as_str(), p.name.as_str())), is);
    check_keys("cast", "past", defs.past.iter().map(|p| (p.key.as_str(), p.name.as_str())), is);
    let mut figures = BTreeSet::new();
    for figure in &defs.figures {
        if !figures.insert(&figure.key) || defs.person(&figure.key).is_some() {
            is.push(&figure.source, &figure.key, "立绘key重复或与人物key重名");
        }
    }
    for p in &defs.persons {
        if p.audience.introducer.as_ref().is_some_and(|key| defs.person(key).is_none() || key == &p.key) {
            is.push("cast", &p.key, "引荐人不存在或引用自己");
        }
    }
    catalog::validate_references(dir, &defs, is);
    places.authored.pending_ties = pending::collect(dir, &mut defs, is);
    validate_ties(dir, &defs, is);
    defs
}

/// runtime_links.toml 显式登记的待交付旗标（只在草稿里有效）；整包加载交给故事图检查。
pub(super) fn pending_flags(dir: &EffectiveWorld, is: &mut Issues) -> BTreeSet<String> {
    pending::declared_flags(dir, is)
}

pub(crate) fn validate_pending_text(text: &str) -> Result<(), String> {
    pending::validate_text(text)
}

pub(super) fn valid_date(dir: &EffectiveWorld, date: WorldDate) -> bool {
    dir.manifest.calendar.day_of(manifest_core::calendar::Date { year: date[0], month: date[1], day: date[2] }).is_ok()
}

fn validate_birthday(dir: &EffectiveWorld, file: &str, p: &PersonDef, is: &mut Issues) {
    if let Some([month, day]) = p.birthday
        && (!valid_date(dir, [p.born[0].max(1), month, day]) || [month, day] != [p.born[1], p.born[2]])
    {
        is.push(file, &p.key, "birthday 必须是有效月日并与 born 一致");
    }
}

fn validate_person(
    dir: &EffectiveWorld,
    file: &str,
    p: &PersonDef,
    locations: &[LocationDef],
    places: &manifest_core::geo::places::PlaceCatalog,
    factions: &BTreeMap<String, FactionId>,
    is: &mut Issues,
) {
    if !valid_date(dir, [p.born[0].max(1), p.born[1], p.born[2]])
        || (p.born[0] == 0 && !matches!(p.kind, PersonKind::Historical | PersonKind::Legend))
    {
        is.push(file, &p.key, "born 无效；只有史料未详的历史人物或传说人物可用未知年 0");
    }
    validate_birthday(dir, file, p, is);
    if p.name.chars().count() > 80
        || [&p.persona, &p.summary, &p.secret, &p.after].iter().any(|s| s.chars().count() > 4000)
        || p.lines.values().flatten().any(|s| s.chars().count() > 1000)
    {
        is.push(file, &p.key, "人物文字超过长度上限");
    }
    if !p.faction.is_empty() && !factions.contains_key(&p.faction) {
        is.push(file, &p.key, "未知势力");
    }
    if p.kind == PersonKind::Historical && (!p.romance.with.is_empty() || p.sources.is_empty()) {
        is.push(file, &p.key, "历史人物必须有出处且不能开放 romance");
    }
    if p.romance.with.iter().any(|s| !["f", "m", "any"].contains(&s.as_str())) {
        is.push(file, &p.key, "romance.with 只允许 f/m/any");
    }
    for (tag, gender, target) in
        [("pure_gl", manifest_core::scenario::Gender::F, "f"), ("pure_bl", manifest_core::scenario::Gender::M, "m")]
    {
        if p.tags.iter().any(|t| t == tag) && (p.gender != gender || p.romance.with != [target]) {
            is.push(file, &p.key, "纯 GL/BL 的性别与 romance.with 不一致");
        }
    }
    let mut ages = BTreeSet::new();
    if p.portraits.iter().any(|v| v.asset.is_empty() || !ages.insert(v.from_age)) {
        is.push(file, &p.key, "头像年龄重复或素材为空");
    }
    for s in p.schedule.iter().chain(p.fate.iter().filter_map(|f| f.schedule.as_ref())) {
        if !valid_date(dir, s.from)
            || s.to.is_some_and(|to| !valid_date(dir, to) || to < s.from)
            || s.seasons.iter().any(|v| *v > 3)
        {
            is.push(file, &p.key, "日程日期段或季节无效");
        }
        if !locations.iter().any(|l| l.key == s.at) && places.offstage(&s.at).is_none() {
            is.push(file, &p.key, format!("日程引用未知地点 {}", s.at));
        }
    }
    for (i, a) in p.schedule.iter().enumerate() {
        for b in p.schedule.iter().skip(i + 1) {
            if a.from <= b.to.unwrap_or([u32::MAX; 3])
                && b.from <= a.to.unwrap_or([u32::MAX; 3])
                && (a.seasons.is_empty() || b.seasons.is_empty() || a.seasons.iter().any(|s| b.seasons.contains(s)))
            {
                is.push(file, &p.key, "日程日期和季节重叠");
            }
        }
    }
    for f in &p.fate {
        if f.event.is_empty() || f.outcome.is_empty() || (f.then == FateAction::Moves && f.schedule.is_none()) {
            is.push(file, &p.key, "命运缺事件、结果或移动日程");
        }
    }
    if p.audience.fame < 0
        || p.audience.reputation.iter().any(|(key, value)| !factions.contains_key(key) || !(-100..=100).contains(value))
    {
        is.push(file, &p.key, "求见条件无效");
    }
    if let Some(m) = &p.mate
        && ([m.navigation, m.trade, m.combat, m.management, m.affinity].iter().any(|n| !(0..=100).contains(n))
            || m.salary < 0)
    {
        is.push(file, &p.key, "航海士能力、薪水或招募门槛无效");
    }
}

fn validate_ties(dir: &EffectiveWorld, defs: &CastDefs, is: &mut Issues) {
    use manifest_core::cast::relations::*;
    let mut seen = BTreeSet::new();
    let mut promises = BTreeMap::new();
    for t in &defs.ties {
        let item = format!("{}:{}", t.a, t.b);
        let (Some(_), Some(_)) = (defs.person(&t.a), defs.person(&t.b)) else {
            is.push("cast/ties", &item, "关系引用未知人物");
            continue;
        };
        if t.a == t.b
            || !seen.insert((&t.a, &t.b, t.kind, t.since))
            || !valid_date(dir, t.since)
            || t.to.is_some_and(|to| !valid_date(dir, to) || to < t.since)
        {
            is.push("cast/ties", &item, "关系重复、指向自己或日期段无效");
        }
        if let Err(e) = initial_tie_gate_in(t, defs, t.since) {
            is.push("cast/ties", &item, e.to_string());
        }
        if t.kind == Relation::Promise {
            if t.to.is_some()
                || promises.get(&t.a).is_some_and(|p| p != &t.b)
                || promises.get(&t.b).is_some_and(|p| p != &t.a)
            {
                is.push("cast/ties", &item, "S 约定不能限时或改换对象");
            }
            promises.insert(t.a.clone(), t.b.clone());
            promises.insert(t.b.clone(), t.a.clone());
        }
        for condition in &t.when {
            match condition {
                RelationCondition::NotBondS { person } | RelationCondition::Bond { person, .. } => {
                    if defs.person(person).is_none() {
                        is.push("cast/ties", &item, "条件引用未知人物");
                    }
                }
                RelationCondition::Date { from, to } => {
                    if from.is_some_and(|d| !valid_date(dir, d))
                        || to.is_some_and(|d| !valid_date(dir, d))
                        || from.zip(*to).is_some_and(|(a, b)| a > b)
                    {
                        is.push("cast/ties", &item, "条件日期无效");
                    }
                }
                RelationCondition::Flag { flag, .. } => {
                    if flag.is_empty() {
                        is.push("cast/ties", &item, "条件旗标为空");
                    }
                }
            }
        }
    }
}

/// 每个人物绑定唯一既有或末尾追加的航海士定义，不创建第二套在队状态。
pub(super) fn link_mates(
    cast: &CastDefs,
    locations: &[LocationDef],
    mates: &mut Vec<manifest_core::defs::MateDef>,
    is: &mut Issues,
) {
    let mut used = BTreeSet::new();
    for p in &cast.persons {
        let Some(m) = &p.mate else { continue };
        let key = m.key.as_deref().unwrap_or(&p.key);
        if !used.insert(key) {
            is.push("cast", &p.key, "多个人物不能绑定同一航海士");
            continue;
        }
        if mates.iter().any(|mate| mate.key == key) {
            continue;
        }
        if m.key.is_some() {
            is.push("cast", &p.key, "引用的既有航海士不存在");
            continue;
        }
        if !m.joinable {
            continue;
        }
        // 隐藏航海士槽的 home 仅供旧结构记账；实际在场与招募始终由人物日程决定。
        // 全部行程在场外的人物也需要唯一槽，不能为满足旧结构捏造地理坐标。
        let Some(home) =
            p.schedule.iter().find_map(|s| locations.iter().position(|l| l.key == s.at)).or_else(|| {
                (!p.schedule.is_empty()).then(|| locations.iter().position(LocationDef::is_port)).flatten()
            })
        else {
            is.push("cast", &p.key, "可招募人物必须有有效日程且世界须有港口");
            continue;
        };
        mates.push(manifest_core::defs::MateDef {
            abilities: BTreeMap::new(),
            key: p.key.clone(),
            name: p.name.clone(),
            bio: p.persona.clone(),
            home: manifest_core::ids::LocId::from_idx(home),
            navigation: m.navigation,
            trade: m.trade,
            combat: m.combat,
            management: m.management,
            level: 1,
            salary: m.salary,
            hire_cost: 0,
            loyalty: 60,
            hidden: true,
            methods: Vec::new(),
        });
    }
}

/// `held` 是 runtime_links 暂存的跨包关系：它们不在活跃关系里，story 引用仍与草稿校验一样核对（只核对，不放回）。
pub(super) fn link_tracks(
    dir: &EffectiveWorld,
    cast: &mut CastDefs,
    stories: &manifest_core::story2::Story2Defs,
    held: &[manifest_core::geo::authored::PendingTie],
    is: &mut Issues,
) {
    let declared = pending::declared_tracks(dir, is);
    let active = cast.ties.len();
    cast.ties.extend(held.iter().map(|p| p.tie.clone()));
    catalog::link_tracks(dir, cast, stories, &declared, is);
    cast.ties.truncate(active);
}

/// 草稿与正式加载共用人物元数据及引用检查；不依赖经济或地图已完成。
pub(crate) fn validate_catalog(dir: &EffectiveWorld) -> Result<CastDefs, crate::DataError> {
    let mut is = Issues::default();
    let mut defs = CastDefs::default();
    match dir.cast_sources() {
        Ok(sources) => {
            for (file, text) in sources {
                let Some(mut value) = parse::<toml::Value>(&file, &text, &mut is) else { continue };
                if let Some(persons) = value.get_mut("persons").and_then(toml::Value::as_array_mut) {
                    persons.retain(|p| p.get("kind").is_some());
                }
                match catalog::parse_cast(value, &file, dir.manifest.draft) {
                    Ok(mut parsed) => {
                        for p in &mut parsed.persons {
                            p.source.clone_from(&file);
                            validate_birthday(dir, &file, p, &mut is);
                        }
                        for p in &mut parsed.past {
                            p.source.clone_from(&file);
                        }
                        defs.persons.extend(parsed.persons);
                        defs.ties.extend(parsed.ties);
                        defs.past.extend(parsed.past);
                        defs.tie_metadata.extend(parsed.tie_metadata);
                        defs.deferred_ties.extend(parsed.deferred_ties);
                        defs.diagnostics.extend(parsed.diagnostics);
                    }
                    Err(e) => is.push(&file, "cast", e),
                }
            }
        }
        Err(e) => is.push("cast", "", e.to_string()),
    }
    catalog::validate_references(dir, &defs, &mut is);
    let mut stories = manifest_core::story2::Story2Defs::default();
    for file in dir.files_in("stories") {
        if let Some(text) = read(dir, &file, &mut is) {
            let Some(raw) = parse::<toml::Value>(&file, &text, &mut is) else { continue };
            if raw.get("tracks").is_none() {
                continue;
            }
            match crate::story2::parse_story_tracks(&text, &file) {
                Ok(parsed) => stories.tracks.extend(parsed.tracks),
                Err(e) => is.list.extend(e.issues),
            }
        }
    }
    let declared = pending::declared_tracks(dir, &mut is);
    catalog::link_tracks(dir, &mut defs, &stories, &declared, &mut is);
    if is.list.is_empty() { Ok(defs) } else { Err(crate::DataError { issues: is.list }) }
}

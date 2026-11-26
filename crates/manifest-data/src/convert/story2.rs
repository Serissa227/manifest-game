//! 新轨道格式与旧故事分文件共存；尚未实现的词表明确拒绝。
use super::{Issues, check_keys, parse, per_file, read};
use crate::worlds::EffectiveWorld;
use manifest_core::{
    cast::{
        CastDefs, PersonKind,
        relations::{self, Relation},
    },
    defs::LocationDef,
    story2::*,
};
use std::collections::BTreeSet;

pub(super) fn load(dir: &EffectiveWorld, cast: &CastDefs, locations: &[LocationDef], is: &mut Issues) -> Story2Defs {
    let mut defs = Story2Defs::default();
    // 各故事文件分给几个线程解析，再按原顺序逐个合并（结果与问题的先后都与逐个解析相同）
    let files = dir.files_in("stories");
    let parsed = per_file(&files, |file, is| {
        let text = read(dir, file, is)?;
        let raw = parse::<toml::Value>(file, &text, is)?;
        raw.get("tracks")?;
        Some(crate::story2::parse_story_tracks(&text, file))
    });
    for (tracks, local) in parsed {
        is.list.extend(local.list);
        match tracks {
            Some(Ok(v)) => defs.tracks.extend(v.tracks),
            Some(Err(e)) => is.list.extend(e.issues),
            None => {}
        }
    }
    check_keys("stories", "tracks", defs.tracks.iter().map(|t| (t.key.as_str(), t.name.as_str())), is);
    for t in &defs.tracks {
        let file = format!("stories/{}", t.key);
        check_keys(&file, "chapters", t.chapters.iter().map(|c| (c.key.as_str(), c.title.as_str())), is);
        if t.chapters.is_empty() || t.chapter(&t.start).is_none() {
            is.push(&file, &t.key, "轨道起始章节不存在");
        }
        for key in &t.cast {
            if cast.person(key).is_none() {
                is.push(&file, key, "cast引用未知人物");
            }
        }
        for c in &t.chapters {
            if ["done", "failed"].contains(&c.key.as_str())
                || c.title.chars().count() > 100
                || c.text.trim().is_empty()
                || c.text.chars().count() > 4000
            {
                is.push(&file, &c.key, "章节key或文字无效");
            }
            if c.at.as_ref().is_some_and(|key| !locations.iter().any(|l| &l.key == key)) {
                is.push(&file, &c.key, "章节引用未知地点");
            }
            for key in &c.cast {
                if cast.person(key).is_none() {
                    is.push(&file, &c.key, "cast引用未知人物");
                }
            }
            if c.speaker.as_ref().is_some_and(|key| key != "captain" && cast.person(key).is_none()) {
                is.push(&file, &c.key, "说话人不存在");
            }
            if c.mood.as_ref().is_some_and(|m| !["cheerful", "tender", "tense", "sad", "mystic"].contains(&m.as_str()))
            {
                is.push(&file, &c.key, "未知情境配乐mood");
            }
            if let Some(w) = c.window
                && (w[0] > w[1] || w.iter().any(|d| !super::cast::valid_date(dir, *d)) || c.default.is_none())
            {
                is.push(&file, &c.key, "窗口日期无效或缺少default分支");
            }
            if c.stage.is_some()
                && (c.window.is_none()
                    || c.default.is_none()
                    || c.at.is_none()
                    || c.news.as_ref().is_none_or(|n| n.trim().is_empty())
                    || (c.cast.is_empty() && t.cast.is_empty()))
            {
                is.push(&file, &c.key, "配角章必须给window/default/at/cast/news");
            }
            if matches!(c.stage, Some(Stage::Witness | Stage::Rumor)) {
                if !c.choices.is_empty() {
                    is.push(&file, &c.key, "witness/rumor没有选项");
                }
            } else if c.choices.is_empty() {
                is.push(&file, &c.key, "普通章与involve必须有选项");
            }
            conditions(&c.when, dir, cast, locations, &file, &c.key, is);
            check_keys(&file, "choices", c.choices.iter().map(|o| (o.key.as_str(), o.text.as_str())), is);
            let mut keys = BTreeSet::new();
            for choice in &c.choices {
                if choice.key.is_empty() || !keys.insert(&choice.key) || choice.text.trim().is_empty() {
                    is.push(&file, &c.key, "选项key重复、为空或缺少文字");
                }
                conditions(&choice.requires, dir, cast, locations, &file, &c.key, is);
            }
            for branch in c
                .default
                .iter()
                .cloned()
                .chain(c.timeout.iter().cloned())
                .chain(c.choices.iter().map(Choice::branch))
                .chain(c.choices.iter().filter_map(|o| o.fail.clone()))
            {
                if !["done", "failed"].contains(&branch.next.as_str()) && t.chapter(&branch.next).is_none() {
                    is.push(&file, &c.key, "分支引用未知章节");
                }
                if branch
                    .news
                    .as_ref()
                    .or(c.news.as_ref())
                    .is_some_and(|s| s.trim().is_empty() || s.chars().count() > 1000)
                {
                    is.push(&file, &c.key, "见闻文字为空或过长");
                }
                for e in &branch.effects {
                    effect(e, t, c, cast, &file, is);
                }
            }
        }
    }
    defs
}

fn conditions(
    list: &[Condition],
    dir: &EffectiveWorld,
    cast: &CastDefs,
    locations: &[LocationDef],
    file: &str,
    item: &str,
    is: &mut Issues,
) {
    for c in list {
        let person = match c {
            Condition::Affinity { person, .. }
            | Condition::Heart { person, .. }
            | Condition::Bond { person, .. }
            | Condition::NotBondS { person } => Some(person),
            Condition::At { person, .. } | Condition::Age { person, .. } => person.as_ref(),
            _ => None,
        };
        if person.is_some_and(|p| cast.person(p).is_none()) {
            is.push(file, item, "条件引用未知人物");
        }
        match c {
            Condition::Date { from, to } => {
                if from.is_some_and(|d| !super::cast::valid_date(dir, d))
                    || to.is_some_and(|d| !super::cast::valid_date(dir, d))
                    || from.zip(*to).is_some_and(|(a, b)| a > b)
                {
                    is.push(file, item, "条件日期无效");
                }
            }
            Condition::Age { ge, le, .. } => {
                if ge.zip(*le).is_some_and(|(a, b)| a > b) {
                    is.push(file, item, "年龄区间反向");
                }
            }
            Condition::At { at, .. } => {
                if !locations.iter().any(|l| l.key == *at) {
                    is.push(file, item, "条件引用未知地点");
                }
            }
            Condition::Affinity { ge, .. } | Condition::Heart { ge, .. } => {
                if !(0..=100).contains(ge) {
                    is.push(file, item, "情谊或心动门槛越界");
                }
            }
            Condition::Flag { flag, .. } if flag.is_empty() => {
                is.push(file, item, "旗标为空");
            }
            _ => {}
        }
    }
}

fn effect(e: &Effect, t: &TrackDef, c: &ChapterDef, cast: &CastDefs, file: &str, is: &mut Issues) {
    let person = match e {
        Effect::Affinity { person, .. }
        | Effect::Heart { person, .. }
        | Effect::Relation { person, .. }
        | Effect::Bond { person, .. }
        | Effect::Letter { person, .. } => Some(person),
        _ => None,
    };
    if person.is_some_and(|p| cast.person(p).is_none()) {
        is.push(file, &c.key, "效果引用未知人物");
    }
    match e {
        Effect::Affinity { value, .. } | Effect::Heart { value, .. } => {
            if !(-100..=100).contains(value) {
                is.push(file, &c.key, "情谊或心动效果越界");
            }
        }
        Effect::Tie { a, b, relation, remove } => {
            if a == b || cast.person(a).is_none() || cast.person(b).is_none() {
                is.push(file, &c.key, "关系效果人物不存在或相同");
            }
            if !*remove
                && let Some(action) = relations::action(*relation)
                && let Some((a, b)) = cast.person(a).zip(cast.person(b))
            {
                if a.kind == PersonKind::Historical || b.kind == PersonKind::Historical {
                    is.push(file, &c.key, "故事效果不得给历史人物编造恋情");
                }
                if let Some(w) = c.window {
                    let mut left = relations::actor(a, w[0]);
                    left.authority |= cast.ties.iter().any(|tie| {
                        tie.kind == Relation::Mentor
                            && tie.since <= w[0]
                            && ((tie.a == a.key && tie.b == b.key) || (tie.a == b.key && tie.b == a.key))
                    });
                    if let Err(e) = relations::romance_gate(&left, &relations::actor(b, w[0]), action, t.academy) {
                        is.push(file, &c.key, e.to_string());
                    }
                }
            }
        }
        Effect::Flag { flag, .. } if flag.is_empty() => {
            is.push(file, &c.key, "效果旗标为空");
        }
        Effect::Letter { text, .. } if text.is_empty() || text.chars().count() > 1000 => {
            is.push(file, &c.key, "来信为空或过长");
        }
        _ => {}
    }
    if matches!(
        e,
        Effect::Heart { .. }
            | Effect::Relation {
                relation: Relation::Crush | Relation::Dating | Relation::Lovers | Relation::Partners,
                remove: false,
                ..
            }
    ) && person.and_then(|p| cast.person(p)).is_some_and(|p| p.kind == PersonKind::Historical)
    {
        is.push(file, &c.key, "历史人物不开放恋爱效果");
    }
    if t.academy
        && matches!(
            e,
            Effect::Relation { relation: Relation::Dating | Relation::Lovers | Relation::Partners, remove: false, .. }
                | Effect::Tie { relation: Relation::Dating | Relation::Lovers | Relation::Partners, .. }
        )
    {
        is.push(file, &c.key, "学院期效果不能超过心照不宣");
    }
}

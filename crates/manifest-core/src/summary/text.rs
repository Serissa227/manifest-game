//! 时间线、书信和日记的文字记录；事实由内核投影，文字不能产生玩法效果。
use super::ai::{AiSource, blocked, check_text};
use crate::{World, error::CommandError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const TEXT_CHARS: usize = 1600;
pub const RECORD_LIMIT: usize = 128;
pub const RECORDS_PER_DAY: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextWrites {
    pub day: u32,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum TextTarget {
    Narration { event: String, phase: String },
    Letter { id: String, purpose: String },
    AltChronicle { year: u32 },
    Diary { year: u32, month: u32 },
}
impl TextTarget {
    pub fn key(&self) -> String {
        match self {
            Self::Narration { event, phase } => format!("narration:{event}:{phase}"),
            Self::Letter { id, .. } => format!("letter:{id}"),
            Self::AltChronicle { year } => format!("alt_chronicle:{year}"),
            Self::Diary { year, month } => format!("diary:{year}:{month}"),
        }
    }
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Narration { .. } => "narration",
            Self::Letter { .. } => "letter",
            Self::AltChronicle { .. } => "alt_chronicle",
            Self::Diary { .. } => "diary",
        }
    }
}

#[derive(Clone, Debug)]
pub struct TextSnapshot {
    pub facts: String,
    pub proof: String,
    pub requests: Vec<String>,
    pub params: BTreeMap<String, String>,
    pub section: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextRecord {
    pub target: TextTarget,
    pub proof: String,
    pub day: u32,
    pub text: String,
    pub request: Option<String>,
    pub source: AiSource,
    pub fallback: String,
    pub section: String,
    pub variant: usize,
    pub params: BTreeMap<String, String>,
}

pub fn date(world: &World, day: u32) -> [u32; 3] {
    let d = world.defs.calendar.date_of(day);
    [(world.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}

/// 离线槽位逐段选取，不能在名称或一句事实的中间截断。
fn compact(lines: impl IntoIterator<Item = String>) -> String {
    let mut text = String::new();
    for line in lines {
        if text.chars().count() + line.chars().count() < 900 {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&line);
        }
    }
    text
}

/// 已存在且已知的请托或当前事件杠杆；引用只用于提示入口，不代替玩家接受请求。
pub fn letter_requests(world: &World, person: &str, track: &str) -> Vec<String> {
    let mut out = Vec::new();
    if world
        .defs
        .story2
        .track(track)
        .is_some_and(|t| t.kind == crate::story2::TrackKind::Request && t.cast.iter().any(|p| p == person))
        && world.state.story2.tracks.get(track).is_some_and(|s| s.status != crate::story2::Status::Done)
    {
        out.push(format!("track:{track}"));
    }
    for event in &world.defs.history.events {
        if !world.history_event_known(event)
            || world.history_outcome(&event.key).is_some()
            || !event.window.is_some_and(|w| w[0] <= world.cast_date() && world.cast_date() <= w[1])
            || world.state.history.events.get(&event.key).is_some_and(|s| s.closed)
        {
            continue;
        }
        for lever in &event.levers {
            if lever.with.as_deref() == Some(person)
                && lever
                    .port
                    .as_ref()
                    .is_none_or(|key| world.defs.find_loc(key).is_some_and(|loc| world.loc_known(loc)))
            {
                out.push(format!("lever:{}:{}", event.key, lever.key));
            }
        }
    }
    out
}

pub fn snapshot(world: &World, target: &TextTarget) -> Option<TextSnapshot> {
    let mut params = BTreeMap::new();
    let mut requests = Vec::new();
    let (facts, section) = match target {
        TextTarget::Narration { event, phase } => {
            let e = world.defs.history.event(event).filter(|e| world.history_event_known(e))?;
            let s = world.state.history.events.get(event);
            if s.is_some_and(|s| s.closed) {
                return None;
            }
            let resolved = s.filter(|s| s.resolved_day.is_some_and(|day| day <= world.day()) && s.outcome.is_some());
            match phase.as_str() {
                "ending" if resolved.is_some() => {}
                "opening" | "progress"
                    if resolved.is_none()
                        && e.window
                            .is_some_and(|range| range[0] <= world.cast_date() && world.cast_date() <= range[1]) => {}
                _ => return None,
            }
            let observation = world
                .state
                .history
                .known_events
                .get(event)
                .filter(|o| world.day().checked_sub(o.day).is_some_and(|age| age <= 90));
            let balance = if let Some(s) = resolved {
                s.balance.to_string()
            } else if let Some(o) = observation {
                if o.exact && world.day().saturating_sub(o.day) <= 30 {
                    o.balance.to_string()
                } else {
                    let lo = o.balance.div_euclid(20) * 20;
                    format!("{lo}..{}", lo.saturating_add(20))
                }
            } else {
                "unknown".into()
            };
            let outcome =
                resolved.and_then(|s| s.outcome.as_ref()).and_then(|key| e.outcomes.iter().find(|o| &o.key == key));
            params.insert("event".into(), e.title.clone());
            params.insert("balance".into(), balance.clone());
            params.insert("outcome".into(), outcome.map(|o| o.chronicle.clone()).unwrap_or_default());
            let facts=serde_json::json!({"event":e.key,"title":e.title,"summary":e.summary,"phase":phase,"sides":e.sides.iter().map(|s|(&s.key,&s.name)).collect::<Vec<_>>(),"balance":balance,"resolved":resolved.and_then(|s|s.resolved_day).map(|day|date(world,day)),"outcome":outcome.map(|o|(&o.key,&o.chronicle))}).to_string();
            (facts, phase.clone())
        }
        TextTarget::Letter { id, purpose } => {
            if !["help", "thanks", "threat", "invite"].contains(&purpose.as_str()) {
                return None;
            }
            let news = world.state.story2.news.values().find(|n| {
                n.id == *id && n.known && n.kind == crate::story2::NewsKind::Letter && n.day <= world.day()
            })?;
            let person = news.persons.first()?;
            let p = world.defs.cast.person(person)?;
            world.state.cast.persons.get(person).filter(|p| p.met)?;
            let arrived =
                world.state.upbringing.as_ref().and_then(|s| s.letter_arrivals.get(id)).copied().unwrap_or(news.day);
            if arrived > world.day() {
                return None;
            }
            requests = letter_requests(world, person, &news.track);
            params.insert("person".into(), p.name.clone());
            params.insert("facts".into(), compact(news.text.split_inclusive(['。', '\n']).map(str::to_owned)));
            (serde_json::json!({"id":id,"person":p.name,"sent":date(world,news.day),"arrived":date(world,arrived),"body":news.text,"purpose":purpose,"requests":requests}).to_string(),purpose.clone())
        }
        TextTarget::AltChronicle { year } => {
            if *year >= world.cast_date()[0] {
                return None;
            }
            let entries:Vec<_>=world.state.history.chronicle.iter().filter(|r|r.day<=world.day() && date(world,r.day)[0]==*year).filter_map(|r| {
                let e=world.defs.history.event(&r.event).filter(|e|world.history_event_known(e))?;
                let actual=e.outcomes.iter().find(|o|o.key==r.outcome)?;
                let historical=e.outcomes.iter().find(|o|o.key==e.history.outcome)?;
                Some(serde_json::json!({"date":date(world,r.day),"event":e.title,"actual":actual.chronicle,"history":historical.chronicle,"deviates":r.deviates}))
            }).collect();
            if entries.is_empty() {
                return None;
            }
            let facts = serde_json::to_string(&entries).ok()?;
            params.insert("year".into(), year.to_string());
            // 离线模板直接把 {facts} 给玩家看：写成“某事（某月）：实际结局”，偏离史书时附上史书原本的结局。
            params.insert(
                "facts".into(),
                compact(entries.iter().map(|e| {
                    let text = |key: &str| e[key].as_str().unwrap_or_default().to_owned();
                    let month = e["date"][1].as_u64().unwrap_or_default();
                    let mut line = format!("{}（{month}月）：{}", text("event"), text("actual"));
                    if e["deviates"] == true {
                        line.push_str(&format!("史书原本写的是：{}", text("history")));
                    }
                    line
                })),
            );
            (facts, "year".into())
        }
        TextTarget::Diary { year, month } => {
            let today = world.cast_date();
            if [*year, *month] >= [today[0], today[1]]
                || *month == 0
                || *month > world.defs.calendar.months().len() as u32
            {
                return None;
            }
            let upbringing = world.state.upbringing.as_ref()?;
            let entries: Vec<_> = upbringing
                .journal
                .iter()
                .filter(|entry| entry.day <= world.day() && date(world, entry.day)[..2] == [*year, *month])
                .collect();
            if entries.is_empty() {
                return None;
            }
            let identity = world.state.protagonist.as_ref().and_then(|p| p.key()).unwrap_or("generic");
            let facts = serde_json::json!({"identity":identity,"entries":entries}).to_string();
            params.insert("year".into(), year.to_string());
            params.insert("month".into(), month.to_string());
            // 同上：离线日记的 {facts} 写成“某月某日：活动”，模型另读完整的 facts JSON。
            params.insert(
                "facts".into(),
                compact(entries.iter().filter(|entry| !entry.result.title.is_empty()).map(|entry| {
                    let [_, month, day] = date(world, entry.day);
                    format!("{month}月{day}日：{}", entry.result.title.replace(" / ", "、"))
                })),
            );
            params.insert("protagonist".into(), super::owner_name(world, crate::OwnerId::Player));
            (facts, format!("voice_{identity}"))
        }
    };
    let proof = blake3::hash(facts.as_bytes()).to_hex().to_string();
    Some(TextSnapshot { facts, proof, requests, params, section })
}

pub fn check(world: &World, record: &TextRecord) -> Result<(), CommandError> {
    check_text(&record.text, TEXT_CHARS)?;
    check_text(&record.fallback, TEXT_CHARS)?;
    if world.day().checked_sub(record.day).is_none_or(|age| age > 1) {
        return Err(blocked("ai.text_stale"));
    }
    let current = snapshot(world, &record.target).ok_or_else(|| blocked("ai.text_target"))?;
    if world.state.cast.ai.text_writes.as_ref().filter(|w| w.day == world.day()).map_or(0, |w| w.count)
        >= RECORDS_PER_DAY
        || current.proof != record.proof
        || record.params != current.params
        || !(record.section == current.section
            || matches!(record.target, TextTarget::Diary { .. }) && record.section == "voice_generic")
        || record.variant >= 64
        || record.request.as_ref().is_some_and(|r| !current.requests.contains(r))
        || world.state.cast.ai.texts.get(&record.target.key()).is_some_and(|r| r.proof == record.proof)
    {
        return Err(blocked("ai.text_context"));
    }
    Ok(())
}

pub fn apply(world: &mut World, record: &TextRecord) {
    let mut record = record.clone();
    record.day = world.day();
    let count = world
        .state
        .cast
        .ai
        .text_writes
        .as_ref()
        .filter(|writes| writes.day == world.day())
        .map_or(1, |writes| writes.count + 1);
    world.state.cast.ai.text_writes = Some(TextWrites { day: world.day(), count });
    let records = &mut world.state.cast.ai.texts;
    records.insert(record.target.key(), record);
    while records.len() > RECORD_LIMIT {
        let Some(key) = records.iter().min_by_key(|(key, r)| (r.day, *key)).map(|(key, _)| key.clone()) else {
            break;
        };
        records.remove(&key);
    }
}

pub fn valid_snapshot(world: &World) -> bool {
    let records = &world.state.cast.ai.texts;
    let writes_valid = match &world.state.cast.ai.text_writes {
        None => records.is_empty(),
        Some(writes) => {
            writes.day <= world.day()
                && (1..=RECORDS_PER_DAY).contains(&writes.count)
                && records.values().all(|record| record.day <= writes.day)
                && records.values().filter(|record| record.day == writes.day).count() <= writes.count
        }
    };
    writes_valid
        && records.len() <= RECORD_LIMIT
        && records.iter().all(|(key, r)| {
            key == &r.target.key()
                && valid_target_ref(world, &r.target, r.day)
                && r.day <= world.day()
                && r.proof.len() == 64
                && r.proof.chars().all(|c| c.is_ascii_hexdigit())
                && check_text(&r.text, TEXT_CHARS).is_ok()
                && check_text(&r.fallback, TEXT_CHARS).is_ok()
                && r.variant < 64
                && r.section.len() <= 100
                && r.params.len() <= 8
                && r.params.iter().all(|(k, v)| k.len() <= 40 && v.chars().count() <= 1200)
                && (matches!(r.target, TextTarget::Letter { .. }) || r.request.is_none())
                && r.request.as_deref().is_none_or(|request| valid_request_ref(world, request))
        })
}

fn valid_target_ref(world: &World, target: &TextTarget, recorded_on: u32) -> bool {
    let recorded_date = date(world, recorded_on);
    match target {
        TextTarget::Narration { event, phase } => {
            world.defs.history.event(event).is_some()
                && ["opening", "progress", "ending"].contains(&phase.as_str())
                && (phase != "ending"
                    || world.state.history.events.get(event).is_some_and(|state| {
                        state.outcome.is_some() && state.resolved_day.is_some_and(|day| day <= recorded_on)
                    }))
        }
        TextTarget::Letter { id, purpose } => {
            id.len() <= 200
                && world
                    .state
                    .story2
                    .news
                    .get(id)
                    .is_some_and(|n| n.kind == crate::story2::NewsKind::Letter && n.day <= recorded_on)
                && world
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|upbringing| upbringing.letter_arrivals.get(id))
                    .is_none_or(|day| *day <= recorded_on)
                && ["help", "thanks", "threat", "invite"].contains(&purpose.as_str())
        }
        TextTarget::AltChronicle { year } => *year < recorded_date[0],
        TextTarget::Diary { year, month } => {
            world.state.upbringing.is_some()
                && *month > 0
                && *month <= world.defs.calendar.months().len() as u32
                && [*year, *month] < [recorded_date[0], recorded_date[1]]
        }
    }
}

fn valid_request_ref(world: &World, request: &str) -> bool {
    let parts: Vec<_> = request.split(':').collect();
    match parts.as_slice() {
        ["track", track] => world.defs.story2.track(track).is_some_and(|t| t.kind == crate::story2::TrackKind::Request),
        ["lever", event, lever] => {
            world.defs.history.event(event).is_some_and(|e| e.levers.iter().any(|l| l.key == *lever))
        }
        _ => false,
    }
}

pub fn letter_purpose(world: &World, id: &str) -> String {
    let Some(news) = world.state.story2.news.get(id) else {
        return "help".into();
    };
    for (purpose, words) in [
        ("threat", &["威胁", "警告", "threat"][..]),
        ("thanks", &["感谢", "谢意", "thank"]),
        ("invite", &["邀请", "邀你", "invite"]),
    ] {
        if words.iter().any(|word| news.text.to_lowercase().contains(word)) {
            return purpose.into();
        }
    }
    "help".into()
}

/// 每日每类最多准备一个缺失快照；范围限定到近期事件、来信和刚结束的月／年。
pub fn due_targets(world: &World) -> Vec<TextTarget> {
    if world.defs.world_key == "classic" {
        return Vec::new();
    }
    let missing = |target: &TextTarget| {
        if matches!(target, TextTarget::Narration {phase,..} if phase == "opening")
            && world.state.cast.ai.texts.contains_key(&target.key())
        {
            return false;
        }
        snapshot(world, target)
            .is_some_and(|s| world.state.cast.ai.texts.get(&target.key()).is_none_or(|r| r.proof != s.proof))
    };
    let mut out = Vec::new();
    if let Some(target) = world
        .defs
        .history
        .events
        .iter()
        .filter(|e| world.history_event_known(e))
        .flat_map(|e| {
            let phases =
                if world.history_outcome(&e.key).is_some() { vec!["ending"] } else { vec!["opening", "progress"] };
            phases.into_iter().map(|phase| TextTarget::Narration { event: e.key.clone(), phase: phase.into() })
        })
        .filter(|t| match t {
            TextTarget::Narration { event, .. } => world
                .state
                .history
                .events
                .get(event)
                .and_then(|s| s.resolved_day)
                .is_none_or(|d| world.day().saturating_sub(d) <= 90),
            _ => false,
        })
        .filter(missing)
        .min_by_key(|target| {
            let saved = world.state.cast.ai.texts.get(&target.key());
            (saved.is_some(), saved.map_or(0, |record| record.day), target.key())
        })
    {
        out.push(target);
    }
    if let Some(target) = world
        .known_news(None)
        .iter()
        .filter(|n| {
            n.kind == crate::story2::NewsKind::Letter && world.day().checked_sub(n.day).is_some_and(|age| age <= 90)
        })
        .map(|n| TextTarget::Letter { id: n.id.clone(), purpose: letter_purpose(world, &n.id) })
        .find(missing)
    {
        out.push(target);
    }
    let today = world.cast_date();
    let last_month = if today[1] > 1 {
        [today[0], today[1] - 1]
    } else {
        [today[0].saturating_sub(1), world.defs.calendar.months().len() as u32]
    };
    let diary = TextTarget::Diary { year: last_month[0], month: last_month[1] };
    if missing(&diary) {
        out.push(diary);
    }
    let chronicle = TextTarget::AltChronicle { year: today[0].saturating_sub(1) };
    if missing(&chronicle) {
        out.push(chronicle);
    }
    out
}

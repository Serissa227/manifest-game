//! AI 使用的已知事实投影：不修改状态、不引入随机数，也不读取未揭示的秘密。

use super::{truncate_chars, world_date_text_in};
use crate::{World, ids::OwnerId};
use std::fmt::Write;

pub const PERSONA_CHARS: usize = 800;
pub const MEMORY_CHARS: usize = 1_200;
pub const PRESENT_LIMIT: usize = 12;
pub const HISTORY_LIMIT: usize = 8;

/// 动态专名表只包含当前可见地点和见过的在世人物；不导出全部作者目录。
pub fn known_catalog(world: &World, max: usize) -> String {
    let mut out = String::new();
    let mut append = |key: &str, name: &str| {
        let line = format!("{key}={name}\n");
        if out.chars().count() + line.chars().count() <= max {
            out.push_str(&line);
        }
    };
    for (index, place) in world.defs.locations.iter().enumerate() {
        if world.location_visible(crate::ids::LocId::from_idx(index)) {
            append(&place.key, &place.name);
        }
    }
    for person in &world.defs.cast.persons {
        if world.state.cast.persons.get(&person.key).is_some_and(|s| s.met) && world.person_alive(&person.key) {
            append(&person.key, &person.name);
        }
    }
    out
}

/// 只取当前玩家能看到的地点、人物与历史观察；天平取已知快照。
pub fn known_summary(world: &World, max: usize) -> String {
    let mut out = world_date_text_in(&world.defs.rules.world, &world.defs.calendar, world.day());
    if let Some(at) = world.cast_player_place() {
        let _ = write!(out, "\n位置：{}", world.defs.loc(at.loc).name);
    }
    if let Ok(player) = world.agent(OwnerId::Player) {
        let _ = write!(out, "\n名声：{}", player.fame);
    }
    for person in world
        .defs
        .cast
        .persons
        .iter()
        .filter(|p| world.person_here(&p.key) && world.state.cast.persons.get(&p.key).is_some_and(|s| s.met))
        .take(PRESENT_LIMIT)
    {
        let _ = write!(out, "\n人物：{}={}", person.key, person.name);
    }
    let mut known: Vec<_> = world
        .state
        .history
        .known_events
        .iter()
        .filter(|(_, observation)| world.day().checked_sub(observation.day).is_some_and(|age| age <= 90))
        .collect();
    known.sort_by(|a, b| b.1.day.cmp(&a.1.day).then(a.0.cmp(b.0)));
    for (key, observation) in known.into_iter().take(HISTORY_LIMIT) {
        let Some(event) = world.defs.history.event(key).filter(|e| world.history_event_known(e)) else { continue };
        let _ = write!(out, "\n时间线：{}；观察日={}；天平=", event.title, observation.day);
        if observation.exact && world.day().saturating_sub(observation.day) <= 30 {
            let _ = write!(out, "{}", observation.balance);
        } else {
            // 与 I7 相同：粗略情报只给二十分档，旧的精确情报也会过时。
            let lo = observation.balance.div_euclid(20).saturating_mul(20);
            let _ = write!(out, "{lo}–{}", lo.saturating_add(20));
        }
        // 已结算事实可公开；未来默认结果、历史对照表不在普通上下文中出现。
        if let Some(state) = world.state.history.events.get(key)
            && state.resolved_day.is_some_and(|day| day <= world.day())
            && let Some(outcome) = &state.outcome
        {
            let _ = write!(out, "；结果={outcome}");
        }
    }
    truncate_chars(&out, max)
}

/// 平铺人设卡没有日期/秘密的结构标签，只投影封闭的口吻标签，不复制人物原句。
pub fn public_persona(world: &World, key: &str) -> Option<String> {
    let person = world.defs.cast.person(key)?;
    world.state.cast.persons.get(key).filter(|s| s.met)?;
    let mut out = format!("{}；{:?}", person.name, person.kind);
    for sentence in person.persona.split_inclusive(['。', '！', '？', '\n']) {
        let voice = ["说话", "口吻", "语气", "措辞", "自称"].iter().any(|s| sentence.contains(s));
        let private = ["秘密", "身世", "身份", "将来", "以后", "未来", "不说破", "不说出口", "化名", "私生", "按当前"]
            .iter()
            .any(|s| sentence.contains(s));
        if voice && !private && !sentence.chars().any(|c| c.is_ascii_digit()) {
            for (label, words) in [
                ("说话简洁", &["简洁", "简短", "短句"][..]),
                ("口吻温和", &["温和", "温柔"]),
                ("措辞直率", &["直率", "直接"]),
                ("措辞谨慎", &["谨慎", "小心"]),
                ("语气克制", &["克制", "冷静"]),
                ("口吻活泼", &["活泼", "轻快"]),
                ("说话诙谐", &["诙谐", "幽默"]),
                ("语气庄重", &["庄重", "严肃"]),
            ] {
                if words.iter().any(|word| sentence.contains(word)) && !out.contains(label) {
                    out.push('\n');
                    out.push_str(label);
                }
            }
        }
    }
    Some(truncate_chars(&out, PERSONA_CHARS))
}

/// 关系及已发生互动；记忆来自确定性内核，不从人物的未来剧情简介推测。
pub fn person_memory(world: &World, key: &str) -> Option<String> {
    let state = world.state.cast.persons.get(key).filter(|s| s.met)?;
    let a = &state.affection;
    let mut out = format!("情谊={}；心动={}；关系={:?}；已认识=true", a.affinity, a.heart, a.relations);
    if state.interactions.day == Some(world.day()) {
        let _ = write!(out, "\n今日交谈次数={}", state.interactions.talks);
    }
    if let Some(gifts) = world.gifts_to(OwnerId::Player, key) {
        let _ = write!(out, "\n赠礼次数={}；类别={:?}", gifts.count, gifts.kinds);
        for (work, book) in gifts.books.iter().filter(|(_, book)| book.day <= world.day()).take(6) {
            if let Some(item) = world.defs.items.item(&book.key) {
                let _ = write!(out, "\n赠书={}；双方已读={}", item.name, world.has_read_work(OwnerId::Player, work));
            }
        }
    }
    if let Some(person) = world.defs.cast.person(key) {
        for key in person
            .tracks
            .iter()
            .filter(|key| world.state.story2.tracks.get(*key).is_some_and(|s| s.status == crate::story2::Status::Done))
            .take(6)
        {
            let _ = write!(out, "\n已完成请托={key}");
        }
    }
    for memory in state.interactions.memories.iter().rev().take(8) {
        let _ = write!(out, "\n{memory}");
    }
    if let Some(promise) = world.state.cast.promises.get(key) {
        let _ = write!(out, "\n约定={promise}");
    }
    Some(truncate_chars(&out, MEMORY_CHARS))
}

//! A10 人物互动：模型没有数值参数，系统命令仍受次数、年龄与当前位置约束。
use crate::{World, error::CommandError, ids::OwnerId};
use serde::{Deserialize, Serialize};

pub const PLAYER_TEXT_CHARS: usize = 200;
pub const REPLY_CHARS: usize = 200;
pub const CHAT_TURNS: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonaIntent {
    Rapport,
    Praise,
    Request,
    Inquiry,
    Threat,
    Bribe,
    Offense,
    Chat,
}

impl PersonaIntent {
    pub const ALL: [Self; 8] = [
        Self::Rapport,
        Self::Praise,
        Self::Request,
        Self::Inquiry,
        Self::Threat,
        Self::Bribe,
        Self::Offense,
        Self::Chat,
    ];
    pub fn key(self) -> &'static str {
        match self {
            Self::Rapport => "rapport",
            Self::Praise => "praise",
            Self::Request => "request",
            Self::Inquiry => "inquiry",
            Self::Threat => "threat",
            Self::Bribe => "bribe",
            Self::Offense => "offense",
            Self::Chat => "chat",
        }
    }
    /// 有害意图优先；完全由输入决定，不采信模型提供的意图标签。
    pub fn classify(text: &str) -> Self {
        let lower = text.to_lowercase();
        for (intent, words) in [
            (Self::Threat, &["威胁", "杀了", "threaten", "kill you"][..]),
            (Self::Bribe, &["贿赂", "收下钱", "bribe"]),
            (Self::Offense, &["蠢", "滚", "idiot"]),
            (Self::Request, &["请", "提议", "同意", "要求", "帮忙", "request", "help", "agree to", "negotiate"]),
            (Self::Inquiry, &["打听", "传闻", "询问", "rumor", "enquire"]),
            (Self::Praise, &["称赞", "佩服", "赞美", "praise", "admire"]),
            (Self::Rapport, &["朋友", "交情", "friend"]),
        ] {
            if words.iter().any(|word| lower.contains(word)) {
                return intent;
            }
        }
        Self::Chat
    }
    fn affinity(self) -> i64 {
        match self {
            Self::Rapport | Self::Praise => 2,
            Self::Request | Self::Inquiry | Self::Chat => 1,
            Self::Threat | Self::Offense => -2,
            Self::Bribe => 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiSource {
    Model,
    Template,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AiCastState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_writes: Option<super::text::TextWrites>,
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub texts: std::collections::BTreeMap<String, super::text::TextRecord>,
    pub seq: u64,
    pub chat: Option<ChatRecord>,
    pub daily_day: Option<u32>,
    pub daily_request_day: Option<u32>,
}
impl AiCastState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatRecord {
    pub person: String,
    pub seq: u64,
    pub turns: Vec<ChatTurn>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatTurn {
    pub seq: u64,
    pub who: String,
    pub text: String,
    pub status: String,
    pub effects: Vec<ChatEffect>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatEffect {
    pub kind: String,
    pub value: i64,
    pub key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonaResult {
    pub owner: OwnerId,
    pub person: String,
    pub seq: u64,
    pub day: u32,
    pub player_text: String,
    pub reply: String,
    pub topic: Option<String>,
    pub source: AiSource,
}

/// 六个封闭原型；钱与物品的收益上限均为零，模型不能额外追加资源。
#[derive(Clone, Copy, Debug)]
pub struct DailyTemplate {
    pub key: &'static str,
    pub phase: &'static str,
    pub affinity: i64,
    pub heart: i64,
}
pub const DAILY_TEMPLATES: [DailyTemplate; 6] = [
    DailyTemplate { key: "home_chat", phase: "upbringing", affinity: 1, heart: 0 },
    DailyTemplate { key: "home_study", phase: "upbringing", affinity: 2, heart: 0 },
    DailyTemplate { key: "academy_study", phase: "academy", affinity: 2, heart: 0 },
    DailyTemplate { key: "academy_moment", phase: "academy", affinity: 1, heart: 1 },
    DailyTemplate { key: "port_chat", phase: "port", affinity: 1, heart: 0 },
    DailyTemplate { key: "port_help", phase: "port", affinity: 2, heart: 0 },
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DailyResult {
    pub owner: OwnerId,
    pub template: String,
    pub person: String,
    pub loc: String,
    pub season: u32,
    pub day: u32,
    pub text: String,
    pub source: AiSource,
}

pub fn blocked(_key: &str) -> CommandError {
    CommandError::Precondition("这条 AI 结果没有通过规则校验，没有采用。".into())
}

pub fn check_text(text: &str, max: usize) -> Result<(), CommandError> {
    if text.trim().is_empty() || crate::news::check_text(text, max).is_err() {
        return Err(blocked("ai.text"));
    }
    let lower = text.to_lowercase();
    if ["http://", "https://", "api key", "apikey", "sk-", "密钥"].iter().any(|s| lower.contains(s)) {
        return Err(blocked("ai.text"));
    }
    Ok(())
}

pub fn check_free(world: &World, owner: OwnerId, person: &str, text: &str) -> Result<(), CommandError> {
    check_text(text, PLAYER_TEXT_CHARS)?;
    if !world.state.cast.persons.get(person).is_some_and(|p| p.met) {
        return Err(blocked("ai.unmet"));
    }
    crate::cast::interactions::check_talk(world, owner, person, "chat")?;
    Ok(())
}

pub fn topics(world: &World, person: &str) -> Vec<String> {
    let Some(p) = world.defs.cast.person(person) else { return Vec::new() };
    let mut topics = vec!["chat".into()];
    if crate::cast::interactions::check_talk(world, OwnerId::Player, person, "gossip").is_ok() {
        topics.push("gossip".into());
    }
    for track in &p.tracks {
        let topic = format!("ask:{track}");
        if world.defs.story2.track(track).is_some()
            && crate::cast::interactions::check_talk(world, OwnerId::Player, person, &topic).is_ok()
        {
            topics.push(topic);
        }
    }
    for event in &world.defs.history.events {
        if !world.history_event_known(event) {
            continue;
        }
        for lever in &event.levers {
            if lever.kind != crate::history::contribution::LeverKind::Negotiate || lever.with.as_deref() != Some(person)
            {
                continue;
            }
            for term in &lever.terms {
                let command = crate::Command::Contribute {
                    owner: OwnerId::Player,
                    event: event.key.clone(),
                    lever: lever.key.clone(),
                    payload: crate::history::contribution::Payload::Negotiate { term: term.clone() },
                };
                if command.validate(world).is_ok() {
                    topics.push(format!("term:{}:{}:{}", event.key, lever.key, term));
                }
            }
        }
    }
    topics
}

/// 封闭的谈判意图词表；未知条款仍可用其数据 key 明确请求，不能凭模型猜测成交。
pub fn requested_term(text: &str, term: &str) -> bool {
    let normalized = text.to_lowercase().chars().filter(|c| !c.is_whitespace()).collect::<String>();
    if ["不要", "取消", "拒绝", "不同意", "不请求", "not", "cancel"].iter().any(|word| normalized.contains(word))
    {
        return false;
    }
    let aliases: &[&str] = match term {
        "secure_safe_passage" => &["安全通行", "保证通行"],
        "honor_supply_agreement" => &["履行供粮约", "遵守供粮协议"],
        "open_frontier_markets" => &["开放边市", "开边市"],
        "guarantee_border_messengers" => &["保证边使通行", "保障使节通行"],
        "keep_pass_closed" => &["保持关隘封闭", "守关不放行"],
        "supply_pass_garrison" => &["补给守关军队", "供给关防"],
        "withhold_seal_recognition" => &["不予承认印信", "暂不认可封号"],
        _ => &[],
    };
    std::iter::once(term.to_owned())
        .chain(std::iter::once(term.replace('_', "")))
        .chain(aliases.iter().map(|s| (*s).into()))
        .any(|alias| {
            ["请", "请求", "提议", "同意", "要求", "request", "agreeto", "negotiate"]
                .iter()
                .any(|verb| normalized.contains(&format!("{verb}{alias}")))
        })
}

pub fn check_persona(world: &World, result: &PersonaResult) -> Result<Box<crate::world::WorldState>, CommandError> {
    check_free(world, result.owner, &result.person, &result.player_text)?;
    check_text(&result.reply, REPLY_CHARS)?;
    if world.state.cast.ai.seq.checked_add(1) != Some(result.seq)
        || world.day().checked_sub(result.day).is_none_or(|age| age > 1)
    {
        return Err(blocked("ai.stale"));
    }
    if result.topic.as_ref().is_some_and(|t| !topics(world, &result.person).contains(t)) {
        return Err(blocked("ai.topic"));
    }
    let mut trial = world.clone();
    if let Some(topic) = result.topic.as_deref().and_then(|t| t.strip_prefix("term:")) {
        let mut parts = topic.splitn(3, ':');
        let (Some(event), Some(lever), Some(term)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(blocked("ai.term"));
        };
        if PersonaIntent::classify(&result.player_text) != PersonaIntent::Request
            || !requested_term(&result.player_text, term)
        {
            return Err(blocked("ai.term_intent"));
        }
        trial.state = *crate::history::contribution::check(
            &trial,
            result.owner,
            event,
            lever,
            &crate::history::contribution::Payload::Negotiate { term: term.into() },
        )?;
    }
    apply_persona(&mut trial, result);
    Ok(Box::new(trial.state))
}

fn affinity(world: &mut World, person: &str, gain: i64, text: &str) -> i64 {
    let day = world.day();
    let p = world.state.cast.persons.entry(person.into()).or_default();
    if p.interactions.day != Some(day) {
        p.interactions.day = Some(day);
        p.interactions.talks = 0;
        p.interactions.gifts = 0;
        p.interactions.gained = 0;
    }
    p.interactions.talks += 1;
    let gain = if gain > 0 {
        gain.min(crate::cast::interactions::AFFINITY_PER_DAY.saturating_sub(p.interactions.gained))
    } else {
        gain
    };
    let before = p.affection.affinity;
    p.affection.affinity = (before + gain).clamp(0, 100);
    let actual = p.affection.affinity - before;
    p.interactions.gained += actual.max(0);
    World::refresh_bond(&mut p.affection);
    world.remember_person(person, text);
    world.state.cast.last = Some(crate::cast::interactions::InteractionResult {
        day,
        person: person.into(),
        text: text.chars().take(crate::cast::interactions::MEMORY_CHARS).collect(),
        affinity: actual,
    });
    actual
}

fn apply_persona(world: &mut World, r: &PersonaResult) {
    let base = PersonaIntent::classify(&r.player_text).affinity();
    let mut preference = 0;
    if base > 0 {
        for item in &world.defs.items.items {
            if !r.player_text.contains(&item.name) {
                continue;
            }
            let mut tags = item.tags.clone();
            tags.push(item.kind.key().into());
            match world.gift_reaction(&r.person, &item.key, &tags) {
                Some(crate::cast::interactions::Reaction::Hate | crate::cast::interactions::Reaction::Dislike) => {
                    preference = -1;
                    break;
                }
                Some(crate::cast::interactions::Reaction::Love | crate::cast::interactions::Reaction::Like) => {
                    preference = 1
                }
                _ => {}
            }
        }
    }
    let gain = affinity(world, &r.person, (base + preference).clamp(-2, 2), &r.reply);
    let mut effects = vec![ChatEffect { kind: "affinity".into(), value: gain, key: None }];
    if let Some(topic) = &r.topic {
        effects.push(ChatEffect {
            kind: if topic.starts_with("ask:") || topic.starts_with("term:") { "request" } else { "topic" }.into(),
            value: 0,
            key: Some(topic.clone()),
        });
    }
    let ai = &mut world.state.cast.ai;
    ai.seq = r.seq;
    let chat = ai.chat.get_or_insert_with(|| ChatRecord { person: r.person.clone(), seq: r.seq, turns: Vec::new() });
    if chat.person != r.person {
        chat.turns.clear();
        chat.person = r.person.clone();
    }
    chat.seq = r.seq;
    chat.turns.push(ChatTurn {
        seq: r.seq,
        who: "you".into(),
        text: r.player_text.clone(),
        status: "done".into(),
        effects: Vec::new(),
    });
    chat.turns.push(ChatTurn {
        seq: r.seq,
        who: "them".into(),
        text: r.reply.clone(),
        status: if r.source == AiSource::Model { "done" } else { "fallback" }.into(),
        effects,
    });
    if chat.turns.len() > CHAT_TURNS {
        chat.turns.drain(..chat.turns.len() - CHAT_TURNS);
    }
}

pub fn daily_phase(world: &World) -> &'static str {
    if world.upbringing_active() { if world.state.cast.academy { "academy" } else { "upbringing" } } else { "port" }
}

pub fn check_daily(world: &World, r: &DailyResult) -> Result<(), CommandError> {
    check_free(world, r.owner, &r.person, &r.text)?;
    let template = DAILY_TEMPLATES.iter().find(|t| t.key == r.template).ok_or_else(|| blocked("ai.daily_template"))?;
    if world.day().checked_sub(r.day).is_none_or(|age| age > 1)
        || world.state.cast.ai.daily_day == Some(world.day())
        || world.state.cast.ai.daily_request_day.is_some_and(|day| day >= r.day)
    {
        return Err(blocked("ai.daily_used"));
    }
    let loc = world.cast_player_place().ok_or(CommandError::WrongLocation)?.loc;
    if world.defs.loc(loc).key != r.loc
        || world.defs.calendar.season_of(world.day()) as u32 != r.season
        || template.phase != daily_phase(world)
    {
        return Err(blocked("ai.daily_context"));
    }
    if template.heart > 0 {
        world.validate_romance(&r.person, crate::cast::relations::RomanceAction::Heart)?;
    }
    Ok(())
}

pub fn apply_daily(world: &mut World, r: &DailyResult) {
    let Some(t) = DAILY_TEMPLATES.iter().find(|t| t.key == r.template) else { return };
    affinity(world, &r.person, t.affinity, &r.text);
    if t.heart > 0 {
        let p = world.state.cast.persons.entry(r.person.clone()).or_default();
        p.affection.heart = (p.affection.heart + t.heart).clamp(0, 100);
        World::refresh_bond(&mut p.affection);
    }
    world.state.cast.ai.daily_day = Some(world.day());
    world.state.cast.ai.daily_request_day = Some(r.day);
}

pub fn valid_snapshot(world: &World) -> bool {
    if !super::text::valid_snapshot(world) {
        return false;
    }
    let ai = &world.state.cast.ai;
    if ai.daily_day.is_some_and(|day| day > world.day())
        || ai.daily_day.is_some() != ai.daily_request_day.is_some()
        || ai.daily_request_day.zip(ai.daily_day).is_some_and(|(requested, executed)| requested > executed)
    {
        return false;
    }
    let Some(chat) = &ai.chat else { return ai.seq == 0 };
    if world.defs.cast.person(&chat.person).is_none()
        || chat.seq != ai.seq
        || chat.turns.is_empty()
        || chat.turns.len() > CHAT_TURNS
        || !chat.turns.len().is_multiple_of(2)
        || chat.turns.last().is_none_or(|turn| turn.seq != chat.seq)
    {
        return false;
    }
    let mut previous = None;
    for pair in chat.turns.chunks_exact(2) {
        let (you, them) = (&pair[0], &pair[1]);
        if you.seq == 0
            || you.seq != them.seq
            || previous.is_some_and(|seq: u64| seq.checked_add(1) != Some(you.seq))
            || you.who != "you"
            || them.who != "them"
            || you.status != "done"
            || !["done", "fallback"].contains(&them.status.as_str())
            || !you.effects.is_empty()
            || check_text(&you.text, PLAYER_TEXT_CHARS).is_err()
            || check_text(&them.text, REPLY_CHARS).is_err()
            || !(1..=2).contains(&them.effects.len())
        {
            return false;
        }
        let gain = &them.effects[0];
        if gain.kind != "affinity" || gain.key.is_some() || !(-2..=2).contains(&gain.value) {
            return false;
        }
        if let Some(effect) = them.effects.get(1) {
            let Some(key) = effect.key.as_deref() else { return false };
            if effect.value != 0
                || !["topic", "request"].contains(&effect.kind.as_str())
                || key.len() > 200
                || !(key == "chat" || key == "gossip" || key.starts_with("ask:") || key.starts_with("term:"))
            {
                return false;
            }
        }
        previous = Some(you.seq);
    }
    true
}

//! 交谈、求见、赠礼和招募：只接受确定性数据中的话题与资源。
use super::*;
use crate::{
    error::CommandError,
    ids::*,
    items::gifts::GiftRecord,
    ledger::{Account, CashClass, JournalEntry, Memo},
    mates::MateRole,
    world::World,
};

pub const TALKS_PER_DAY: u32 = 3;
pub const GIFTS_PER_DAY: u32 = 2;
pub const AFFINITY_PER_DAY: i64 = 20;
pub const MEMORIES_KEPT: usize = 20;
pub const MEMORY_CHARS: usize = 120;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct InteractionState {
    pub day: Option<u32>,
    pub talks: u32,
    pub gifts: u32,
    pub gained: i64,
    pub audience: Option<u32>,
    pub memories: Vec<String>,
    pub likes_known: std::collections::BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reaction {
    Love,
    Like,
    Neutral,
    Dislike,
    Hate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractionResult {
    pub day: u32,
    pub person: String,
    pub text: String,
    pub affinity: i64,
}

pub(crate) struct GiftInteraction {
    pub person: String,
    pub text: String,
    pub gain: i64,
    pub item: String,
}

pub(crate) enum InteractionPlan {
    Talk { person: String, topic: String, text: String },
    Audience { person: String },
    Recruit { person: String, mate: MateId },
    Goods { gift: GiftInteraction, fleet: FleetId, good: GoodId, qty: i64, record: GiftRecord },
}

fn error(text: &str) -> CommandError {
    CommandError::Precondition(text.into())
}

impl World {
    pub fn person_mate(&self, person: &str) -> Option<MateId> {
        let p = self.defs.cast.person(person)?;
        let m = p.mate.as_ref()?;
        let key = m.key.as_deref().unwrap_or(&p.key);
        self.defs.mates.iter().position(|m| m.key == key).map(MateId::from_idx)
    }

    pub fn person_in_team(&self, person: &str) -> bool {
        self.person_mate(person)
            .and_then(|id| self.state.mates.get(&id))
            .is_some_and(|m| m.owner == Some(OwnerId::Player))
    }

    pub fn gift_reaction(&self, person: &str, item: &str, tags: &[String]) -> Option<Reaction> {
        let p = self.defs.cast.person(person)?;
        let matches = |values: &[String]| values.iter().any(|v| v == item || tags.contains(v));
        Some(if matches(&p.hates) {
            Reaction::Hate
        } else if matches(&p.loves) {
            Reaction::Love
        } else if matches(&p.dislikes) {
            Reaction::Dislike
        } else if matches(&p.likes) {
            Reaction::Like
        } else {
            Reaction::Neutral
        })
    }

    pub fn remember_person(&mut self, person: &str, text: &str) {
        if self.defs.cast.person(person).is_none() {
            return;
        }
        let text: String = text.chars().take(MEMORY_CHARS).collect();
        let memories = &mut self.state.cast.persons.entry(person.into()).or_default().interactions.memories;
        if memories.last() != Some(&text) {
            memories.push(text);
        }
        if memories.len() > MEMORIES_KEPT {
            memories.drain(..memories.len() - MEMORIES_KEPT);
        }
    }

    pub(crate) fn valid_interactions_snapshot(&self) -> bool {
        crate::summary::ai::valid_snapshot(self)
            && self.state.cast.persons.values().all(|p| {
                let i = &p.interactions;
                i.day.is_none_or(|day| day <= self.day())
                    && i.audience.is_none_or(|day| day <= self.day())
                    && i.talks <= TALKS_PER_DAY
                    && i.gifts <= GIFTS_PER_DAY
                    && (0..=AFFINITY_PER_DAY).contains(&i.gained)
                    && (i.day.is_some() || (i.talks == 0 && i.gifts == 0 && i.gained == 0))
                    && i.memories.len() <= MEMORIES_KEPT
                    && i.memories.iter().all(|s| s.chars().count() <= MEMORY_CHARS)
            })
            && self.state.cast.last.as_ref().is_none_or(|last| {
                last.day <= self.day()
                    && last.text.chars().count() <= MEMORY_CHARS
                    && (-100..=AFFINITY_PER_DAY).contains(&last.affinity)
            })
    }

    pub fn can_audience(&self, person: &str) -> Result<(), CommandError> {
        let p = self.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
        if !self.person_here(person) {
            return Err(CommandError::WrongLocation);
        }
        let a = self.agent(OwnerId::Player)?;
        let meets = a.fame >= p.audience.fame
            && p.audience.reputation.iter().all(|(key, need)| {
                self.defs
                    .factions
                    .iter()
                    .position(|f| f.key == *key)
                    .is_some_and(|i| a.reputation.get(&FactionId::from_idx(i)).copied().unwrap_or(0) >= *need)
            })
            && p.audience.titles.iter().all(|title| {
                self.state.cast.titles.contains(title) || self.item_titles(OwnerId::Player).contains(&title.as_str())
            });
        let introduced = p.audience.introducer.as_ref().is_some_and(|key| {
            self.affection(key).is_some_and(|a| a.affinity >= 50)
                && self.state.cast.persons.get(key).is_some_and(|s| s.met)
        });
        if meets || introduced { Ok(()) } else { Err(error("名声、声望、称号或引荐条件尚未达到")) }
    }
}

fn present(world: &World, owner: OwnerId, person: &str, audience: bool) -> Result<(), CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let p = world.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
    if !world.person_here(person) {
        return Err(CommandError::WrongLocation);
    }
    if audience
        && p.audience != AudienceDef::default()
        && world.state.cast.persons.get(person).is_none_or(|s| s.interactions.audience != Some(world.day()))
    {
        return Err(error("请先求见这位人物"));
    }
    Ok(())
}

fn daily<'a>(world: &'a World, person: &str) -> Option<&'a InteractionState> {
    world.state.cast.persons.get(person).map(|s| &s.interactions).filter(|s| s.day == Some(world.day()))
}

pub(crate) fn check_talk(
    world: &World,
    owner: OwnerId,
    person: &str,
    topic: &str,
) -> Result<InteractionPlan, CommandError> {
    present(world, owner, person, true)?;
    if daily(world, person).is_some_and(|s| s.talks >= TALKS_PER_DAY) {
        return Err(error("今日交谈次数已用完"));
    }
    let p = world.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
    if (topic == "request" || topic.starts_with("ask:"))
        && p.tracks.iter().any(|key| world.defs.story2.track(key).is_none())
    {
        return Err(error("人物引用了不存在的请托轨道"));
    }
    let text = match topic {
        "gossip" => {
            if world.person_place(person).is_none_or(|p| p.venue != "tavern") {
                return Err(error("须在酒馆打听传闻"));
            }
            "一起打听了当地的传闻。".into()
        }
        "request" => "问起了对方正在挂念的事情。".into(),
        "chat" => world
            .gifts_to(owner, person)
            .and_then(|g| g.books.values().next())
            .and_then(|b| world.defs.items.item(&b.key))
            .map(|b| format!("你送的《{}》，我已经读过了。", b.name))
            .or_else(|| p.lines.get("greet").and_then(|v| v.first()).cloned())
            .unwrap_or_else(|| "聊起了近来的见闻。".into()),
        _ => {
            if let Some(work) = topic.strip_prefix("book:") {
                if !world.has_read_work(owner, work) {
                    return Err(error("只能聊自己已经读过的书"));
                }
                "交换了读书的心得。".into()
            } else if let Some(track) = topic.strip_prefix("ask:") {
                if !p.tracks.iter().any(|t| t == track) {
                    return Err(error("人物没有这个话题"));
                }
                "仔细问过了这件事。".into()
            } else {
                return Err(error("未知交谈话题"));
            }
        }
    };
    Ok(InteractionPlan::Talk { person: person.into(), topic: topic.into(), text })
}

pub(crate) fn check_audience(world: &World, owner: OwnerId, person: &str) -> Result<InteractionPlan, CommandError> {
    present(world, owner, person, false)?;
    world.can_audience(person)?;
    Ok(InteractionPlan::Audience { person: person.into() })
}

pub(crate) fn check_recruit(world: &World, owner: OwnerId, person: &str) -> Result<InteractionPlan, CommandError> {
    present(world, owner, person, true)?;
    let p = world.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
    let m = p.mate.as_ref().filter(|m| m.joinable).ok_or_else(|| error("这位人物不能成为航海士"))?;
    if world.affection(person).map_or(0, |a| a.affinity) < m.affinity {
        return Err(error("情谊不足以邀请同行"));
    }
    let mate = world.person_mate(person).ok_or_else(|| error("缺少对应的航海士定义"))?;
    if world.state.mates.get(&mate).is_some_and(|m| m.owner.is_some()) {
        return Err(error("这位航海士已经受雇"));
    }
    Ok(InteractionPlan::Recruit { person: person.into(), mate })
}

pub(crate) fn check_gift(
    world: &World,
    owner: OwnerId,
    person: &str,
    item: &str,
    name: &str,
    tags: &[String],
    handmade: bool,
) -> Result<GiftInteraction, CommandError> {
    present(world, owner, person, true)?;
    if daily(world, person).is_some_and(|s| s.gifts >= GIFTS_PER_DAY) {
        return Err(error("今日赠礼次数已用完"));
    }
    let p = world.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
    let mut tags = tags.to_vec();
    if let Some(item) = world.defs.items.item(item) {
        tags.push(item.kind.key().into());
    }
    let reaction = world.gift_reaction(person, item, &tags).ok_or_else(|| error("未知收礼人"))?;
    let mut gain = match reaction {
        Reaction::Love => 10,
        Reaction::Like => 6,
        Reaction::Neutral => 2,
        Reaction::Dislike => -3,
        Reaction::Hate => -6,
    };
    if gain > 0 && handmade {
        gain = gain * 3 / 2;
    }
    if p.born[0] != 0 && p.born[1..] == world.cast_date()[1..] {
        gain *= 2;
    }
    let text = format!("收到你送的{name}。{}", if handmade { "是你亲手做的。" } else { "记住了这份心意。" });
    Ok(GiftInteraction { person: person.into(), text, gain, item: item.into() })
}

pub(crate) fn check_goods(
    world: &World,
    owner: OwnerId,
    person: &str,
    good: GoodId,
    qty: i64,
) -> Result<InteractionPlan, CommandError> {
    if qty <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let d = world.defs.goods.get(good.idx()).ok_or_else(|| CommandError::NotFound("商品".into()))?;
    let gift = check_gift(world, owner, person, &d.key, &d.name, std::slice::from_ref(&d.category), false)?;
    let loc = world.cast_player_place().ok_or(CommandError::WrongLocation)?.loc;
    let f = world
        .fleets_of(owner)
        .find(|f| f.docked_at() == Some(loc) && f.cargo.get(&good).copied().unwrap_or(0) >= qty)
        .ok_or(CommandError::InsufficientStock { available: 0 })?;
    let mut record = world.gifts_to(owner, person).cloned().unwrap_or_default();
    record.count = record.count.checked_add(1).ok_or(CommandError::InvalidQuantity)?;
    record.value = record
        .value
        .checked_add(d.base_price.checked_mul(qty).ok_or(CommandError::InvalidQuantity)?)
        .ok_or(CommandError::InvalidQuantity)?;
    let count = record.kinds.entry("goods".into()).or_default();
    *count = count.checked_add(qty as u64).ok_or(CommandError::InvalidQuantity)?;
    let count = record.tags.entry(d.category.clone()).or_default();
    *count = count.checked_add(qty as u64).ok_or(CommandError::InvalidQuantity)?;
    Ok(InteractionPlan::Goods { gift, fleet: f.id, good, qty, record })
}

fn reset_day(world: &mut World, person: &str) {
    let day = world.day();
    let state = world.state.cast.persons.entry(person.into()).or_default();
    state.met = true;
    if state.interactions.day != Some(day) {
        state.interactions.day = Some(day);
        state.interactions.talks = 0;
        state.interactions.gifts = 0;
        state.interactions.gained = 0;
    }
}

fn finish(world: &mut World, person: &str, text: String, gain: i64) {
    let text: String = text.chars().take(MEMORY_CHARS).collect();
    let hook = crate::captain::AttrHook::AffinityGain;
    let p = world.defs.cast.person(person);
    let tags: Vec<_> = p.into_iter().flat_map(|p| p.tags.iter().map(String::as_str)).collect();
    let context = crate::items::effects::EffectContext {
        tags: &tags,
        culture: p.map(|p| p.culture.as_str()),
        ..Default::default()
    };
    let bonus = world
        .captain_profile(OwnerId::Player)
        .map_or(0, |c| world.defs.captain.hook_value(&c.attrs, hook, &world.defs.rules.attributes))
        .saturating_add(world.equipment_attribute_hook(OwnerId::Player, "captain", hook))
        .saturating_add(world.item_hook(OwnerId::Player, "captain", hook, &context))
        .min(world.defs.rules.attributes.cap(hook));
    let gain = if gain > 0 { gain.saturating_add(crate::fixed::mul_div(gain, bonus, 10_000)) } else { gain };
    let gain = if gain > 0
        && !world.person_in_team(person)
        && world.cast_player_place().is_some_and(|p| world.ghost_anchorage(OwnerId::Player, p.loc))
    {
        gain.saturating_sub(world.defs.rules.ships.ghost_affinity_penalty).max(0)
    } else {
        gain
    };
    reset_day(world, person);
    let state = world.state.cast.persons.entry(person.into()).or_default();
    let gain = if gain > 0 { gain.min(AFFINITY_PER_DAY.saturating_sub(state.interactions.gained)) } else { gain };
    state.interactions.gained += gain.max(0);
    state.affection.affinity = state.affection.affinity.saturating_add(gain).clamp(0, 100);
    World::refresh_bond(&mut state.affection);
    world.remember_person(person, &text);
    world.state.cast.last = Some(InteractionResult { day: world.day(), person: person.into(), text, affinity: gain });
}

pub(crate) fn apply_gift(world: &mut World, gift: GiftInteraction) {
    reset_day(world, &gift.person);
    let state = world.state.cast.persons.entry(gift.person.clone()).or_default();
    state.interactions.gifts += 1;
    state.interactions.likes_known.insert(gift.item);
    finish(world, &gift.person, gift.text, gift.gain);
}

pub(crate) fn apply(world: &mut World, plan: InteractionPlan) -> Result<(), CommandError> {
    match plan {
        InteractionPlan::Talk { person, topic, text } => {
            reset_day(world, &person);
            world.state.cast.persons.entry(person.clone()).or_default().interactions.talks += 1;
            if topic == "gossip"
                && let Some(p) = world.cast_player_place()
            {
                world.hear_news_at(p.loc, false);
            }
            if topic == "request" || topic.starts_with("ask:") {
                let tracks = world.defs.cast.person(&person).map(|p| p.tracks.clone()).unwrap_or_default();
                for track in tracks {
                    if topic == "request" || topic.strip_prefix("ask:") == Some(&track) {
                        world.start_story2(&track)?;
                    }
                }
            }
            finish(world, &person, text, if topic.starts_with("book:") { 3 } else { 2 });
        }
        InteractionPlan::Audience { person } => {
            let day = world.day();
            let state = world.state.cast.persons.entry(person.clone()).or_default();
            state.met = true;
            state.interactions.audience = Some(day);
            finish(world, &person, "获得了求见的许可。".into(), 0);
        }
        InteractionPlan::Recruit { person, mate } => {
            let day = world.day();
            let state = world.state.mates.entry(mate).or_insert_with(|| crate::mates::fresh_state(&world.defs, mate));
            state.owner = Some(OwnerId::Player);
            state.role = MateRole::None;
            state.hired_on = Some(day);
            world.refresh_trade_bonus();
            finish(world, &person, "答应作为航海士与你同行。".into(), 0);
        }
        InteractionPlan::Goods { gift, fleet, good, qty, record } => {
            let day = world.day();
            let f = world.fleet_mut(fleet)?;
            let remaining = f.cargo.get(&good).copied().unwrap_or(0) - qty;
            if remaining == 0 {
                f.cargo.remove(&good);
            } else {
                f.cargo.insert(good, remaining);
            }
            let cost = world.agent_mut(OwnerId::Player)?.book.remove(good, qty);
            if cost > 0 {
                world.book_internal(
                    OwnerId::Player,
                    JournalEntry::new(day, Memo::Other, CashClass::Operating)
                        .dr(Account::OtherExpense, cost)
                        .cr(Account::Inventory, cost),
                )?;
            }
            world.state.items.owners.entry(OwnerId::Player).or_default().gifts.insert(gift.person.clone(), record);
            apply_gift(world, gift);
        }
    }
    Ok(())
}

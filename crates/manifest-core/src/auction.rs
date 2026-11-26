//! 年度拍卖：独立随机域、逐件回合制竞价与一次性鉴定。静态估值从不进入应用视图。
use crate::{
    captain::AttrHook,
    error::{CommandError, CoreError, Reason},
    ids::*,
    ledger::{Account, CashClass, JournalEntry, Memo},
    rng::{Domain, Rng},
    treasury::Flow,
    world::World,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default)]
pub struct AuctionDefs {
    pub auctions: Vec<AuctionDef>,
    pub people: BTreeMap<String, AuctionPerson>,
}
#[derive(Clone, Debug)]
pub struct AuctionPerson {
    pub name: String,
    pub portrait: Option<String>,
}
#[derive(Clone, Debug)]
pub struct AuctionDef {
    pub key: String,
    pub name: String,
    pub port: LocId,
    pub month: u32,
    pub days: u32,
    pub announcement_days: u32,
    pub preview_days: u32,
    pub lots_per_session: [usize; 2],
    pub lore: String,
    pub lots: Vec<LotDef>,
    pub bidders: Vec<BidderDef>,
    pub specials: Vec<SpecialDef>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Authenticity {
    Genuine,
    Fake,
    Unsure,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LotDef {
    pub item: String,
    pub reserve: i64,
    pub increment: i64,
    pub weight: i64,
    pub from: Option<i64>,
    pub authenticity: Authenticity,
    pub after_loss: String,
    pub fake_note: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Temper {
    Cautious,
    Steady,
    Aggressive,
    Collector,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BidderDef {
    pub person: String,
    pub budget: i64,
    pub likes: Vec<String>,
    pub temper: Temper,
    pub mood_lines: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecialDef {
    pub item: String,
    pub year: i64,
    pub once: bool,
    pub story_hook: String,
    pub after_loss: String,
}
/// C4 的 story_hook 是叙事文字；故事效果以这个稳定 key 插入特别拍品。
pub fn special_flag(auction: &str, item: &str) -> String {
    format!("auction_{auction}_{item}")
}
impl AuctionDefs {
    pub fn get(&self, key: &str) -> Option<&AuctionDef> {
        self.auctions.iter().find(|a| a.key == key)
    }
}
impl AuctionDef {
    pub fn lot(&self, item: &str, special: bool) -> Option<LotDef> {
        if special {
            self.specials.iter().find(|s| s.item == item).map(|s| LotDef {
                item: item.into(),
                reserve: 1,
                increment: 1,
                weight: 1,
                from: Some(s.year),
                authenticity: Authenticity::Genuine,
                after_loss: s.after_loss.clone(),
                fake_note: None,
            })
        } else {
            self.lots.iter().find(|l| l.item == item).cloned()
        }
    }
    pub fn opens(&self, world: &World, year: u32) -> Option<u32> {
        world.defs.calendar.day_of(crate::calendar::Date { year, month: self.month, day: 1 }).ok()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Upcoming,
    Preview,
    Open,
    Closed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LotStatus {
    Waiting,
    Bidding,
    Sold,
    Passed,
    Withdrawn,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BidderState {
    pub active: bool,
    pub mood: Option<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuctionLot {
    pub key: String,
    pub item: String,
    pub special: bool,
    pub reserve: i64,
    pub increment: i64,
    pub status: LotStatus,
    pub current: Option<i64>,
    pub leader: Option<String>,
    pub bidders: BTreeMap<String, BidderState>,
    pub inspection: Option<Authenticity>,
    pub round: u32,
}
impl AuctionLot {
    pub fn next_min(&self) -> i64 {
        self.current.map_or(self.reserve, |v| v.saturating_add(self.increment))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuctionEvent {
    pub lot: String,
    pub bidder: Option<String>,
    pub amount: Option<i64>,
    pub kind: AuctionEventKind,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuctionEventKind {
    Bid,
    Sold,
    Passed,
    Inspected,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub year: u32,
    pub opens: u32,
    /// 闭区间最后一天。
    pub closes: u32,
    pub lots: Vec<AuctionLot>,
    pub spent: BTreeMap<String, i64>,
    pub log: Vec<AuctionEvent>,
}
impl Session {
    pub fn phase(&self, day: u32, preview: u32) -> Phase {
        if day > self.closes {
            Phase::Closed
        } else if day >= self.opens {
            Phase::Open
        } else if day >= self.opens.saturating_sub(preview) {
            Phase::Preview
        } else {
            Phase::Upcoming
        }
    }
    fn activate(&mut self) {
        if !self.lots.iter().any(|l| l.status == LotStatus::Bidding)
            && let Some(l) = self.lots.iter_mut().find(|l| l.status == LotStatus::Waiting)
        {
            l.status = LotStatus::Bidding;
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuctionState {
    pub sessions: BTreeMap<String, Session>,
    pub specials: BTreeSet<String>,
}
impl AuctionState {
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty() && self.specials.is_empty()
    }
}

fn key_hash(key: &str) -> u64 {
    let h = blake3::hash(key.as_bytes());
    let mut bytes = [0; 8];
    bytes.copy_from_slice(&h.as_bytes()[..8]);
    u64::from_le_bytes(bytes)
}
fn rng(world: &World, auction: &str, lot: &str, round: u32) -> Rng {
    Rng::derive(world.state.seed, round, Domain::Auction, key_hash(auction), key_hash(lot))
}
impl World {
    fn auction_session(&self, def: &AuctionDef, year: u32, opens: u32) -> Session {
        let absolute = self.defs.rules.world.start_year + i64::from(year) - 1;
        let mut random = rng(self, &def.key, &absolute.to_string(), 0);
        let count = random.range(def.lots_per_session[0] as i64, def.lots_per_session[1] as i64) as usize;
        let mut candidates: Vec<_> = def
            .lots
            .iter()
            .filter(|l| {
                l.from.is_none_or(|y| y <= absolute)
                    && self
                        .defs
                        .items
                        .item(&l.item)
                        .is_some_and(|i| i.published.as_ref().is_none_or(|p| p.0 <= absolute))
            })
            .cloned()
            .collect();
        candidates.sort_by(|a, b| a.item.cmp(&b.item));
        let mut selected: Vec<(LotDef, bool)> = def
            .specials
            .iter()
            .filter(|s| {
                s.year <= absolute
                    && self.state.story.flags.contains(&special_flag(&def.key, &s.item))
                    && (!s.once || !self.state.auctions.specials.contains(&special_flag(&def.key, &s.item)))
            })
            .filter_map(|s| {
                let item = self.defs.items.item(&s.item)?;
                let mut lot = def.lot(&s.item, true)?;
                lot.reserve = (item.price / 2).max(1);
                lot.increment = (lot.reserve / 10).max(1);
                Some((lot, true))
            })
            .collect();
        selected.sort_by(|a, b| a.0.item.cmp(&b.0.item));
        selected.truncate(count);
        candidates.retain(|l| !selected.iter().any(|(s, _)| s.item == l.item));
        while selected.len() < count && !candidates.is_empty() {
            let Some(i) = random.weighted(&candidates.iter().map(|l| l.weight).collect::<Vec<_>>()) else { break };
            selected.push((candidates.remove(i), false));
        }
        Session {
            year,
            opens,
            closes: opens.saturating_add(def.days - 1),
            spent: BTreeMap::new(),
            log: Vec::new(),
            lots: selected
                .into_iter()
                .map(|(l, special)| AuctionLot {
                    key: format!("{absolute}:{}", l.item),
                    item: l.item,
                    special,
                    reserve: l.reserve,
                    increment: l.increment,
                    status: LotStatus::Waiting,
                    current: None,
                    leader: None,
                    inspection: None,
                    round: 0,
                    bidders: def
                        .bidders
                        .iter()
                        .map(|b| (b.person.clone(), BidderState { active: true, mood: None }))
                        .collect(),
                })
                .collect(),
        }
    }
    /// 每日与开局共用，查询不创建会场也不推进随机数。
    pub(crate) fn auctions_day(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        for def in &defs.auctions.auctions {
            let mut year = defs.calendar.date_of(self.day()).year;
            if let Some(next) = year.checked_add(1).and_then(|y| def.opens(self, y))
                && self.day() >= next.saturating_sub(def.announcement_days)
            {
                year += 1;
            }
            let Some(opens) = def.opens(self, year) else { continue };
            if self.day() < opens.saturating_sub(def.announcement_days) {
                continue;
            }
            if self.state.auctions.sessions.get(&def.key).is_none_or(|s| s.year != year) {
                let session = self.auction_session(def, year, opens);
                for l in &session.lots {
                    if l.special && def.specials.iter().any(|s| s.item == l.item && s.once) {
                        self.state.auctions.specials.insert(special_flag(&def.key, &l.item));
                    }
                }
                self.state.auctions.sessions.insert(def.key.clone(), session);
            }
            let Some(mut session) = self.state.auctions.sessions.get(&def.key).cloned() else { continue };
            match session.phase(self.day(), def.preview_days) {
                Phase::Open => session.activate(),
                Phase::Closed => {
                    session.activate();
                    while let Some(i) = session.lots.iter().position(|l| l.status == LotStatus::Bidding) {
                        compete(self, def, &mut session, i, true);
                    }
                }
                _ => {}
            }
            if matches!(session.phase(self.day(), def.preview_days), Phase::Preview | Phase::Open) {
                let owners: BTreeSet<_> =
                    self.state.fleets.values().filter(|f| f.docked_at() == Some(def.port)).map(|f| f.owner).collect();
                for owner in owners {
                    self.state.items.owners.entry(owner).or_default().seen.extend(
                        session
                            .lots
                            .iter()
                            .filter(|l| l.status != LotStatus::Withdrawn && defs.items.item(&l.item).is_some())
                            .map(|l| l.item.clone()),
                    );
                }
            }
            self.state.auctions.sessions.insert(def.key.clone(), session);
        }
        Ok(())
    }
    pub fn appraisal_chance(&self, owner: OwnerId, item: &str) -> i64 {
        let Some(item) = self.defs.items.item(item) else { return 0 };
        let related = self.inventory(owner).map_or(0, |inv| {
            inv.bibliography
                .values()
                .filter(|r| {
                    item.tags.contains(&r.category) || item.read.as_ref().is_some_and(|b| b.category == r.category)
                })
                .count()
        }) as i64;
        (2500 + self.attr_hook(owner, AttrHook::Appraisal).clamp(0, 10000) + related.min(5) * 1000).clamp(0, 10000)
    }
    pub(crate) fn validate_auction_snapshot(&self) -> Result<(), CoreError> {
        for s in self.state.auctions.sessions.values() {
            if s.year == 0
                || s.closes < s.opens
                || s.spent.values().any(|n| *n < 0)
                || s.lots.iter().filter(|l| l.status == LotStatus::Bidding).count() > 1
                || s.lots.iter().map(|l| &l.key).collect::<BTreeSet<_>>().len() != s.lots.len()
                || s.lots.iter().any(|l| {
                    l.reserve <= 0
                        || l.increment <= 0
                        || l.current.is_some_and(|p| p < l.reserve)
                        || l.current.is_some() != l.leader.is_some()
                        || l.leader.as_ref().is_some_and(|k| k != "player" && !l.bidders.contains_key(k))
                        || l.status == LotStatus::Sold && l.current.is_none()
                        || !matches!(l.status, LotStatus::Sold | LotStatus::Withdrawn)
                            && l.leader.as_deref() == Some("player")
                })
            {
                return Err(CoreError::SnapshotMismatch("拍卖存档包含负报价、重复拍品或不可能的领先者".into()));
            }
        }
        Ok(())
    }
    pub(crate) fn reconcile_auctions(&mut self) {
        self.state.auctions.sessions.retain(|key, session| {
            let Some(def) = self.defs.auctions.get(key) else { return false };
            for l in &mut session.lots {
                if self.defs.items.item(&l.item).is_none() || def.lot(&l.item, l.special).is_none() {
                    l.status = LotStatus::Withdrawn;
                }
                l.bidders.retain(|k, _| def.bidders.iter().any(|b| b.person == *k));
                for (key, bidder) in &mut l.bidders {
                    if bidder.mood.is_some_and(|i| {
                        def.bidders.iter().find(|b| b.person == *key).is_none_or(|b| i >= b.mood_lines.len())
                    }) {
                        bidder.mood = None;
                    }
                }
                if l.leader.as_ref().is_some_and(|k| k != "player" && !l.bidders.contains_key(k)) {
                    l.leader = None;
                    l.current = None;
                    if l.status == LotStatus::Sold {
                        l.status = LotStatus::Withdrawn;
                    }
                }
            }
            session.spent.retain(|k, _| def.bidders.iter().any(|b| b.person == *k));
            true
        });
        if self.defs.auctions.auctions.is_empty() {
            self.state.auctions = AuctionState::default();
        }
    }
}

fn event(session: &mut Session, i: usize, kind: AuctionEventKind) {
    let l = &session.lots[i];
    session.log.push(AuctionEvent { lot: l.key.clone(), bidder: l.leader.clone(), amount: l.current, kind });
}
fn settle(session: &mut Session, i: usize) {
    let l = &mut session.lots[i];
    if let (Some(key), Some(price)) = (&l.leader, l.current) {
        l.status = LotStatus::Sold;
        if key != "player" {
            *session.spent.entry(key.clone()).or_default() += price;
        }
        event(session, i, AuctionEventKind::Sold);
    } else {
        l.status = LotStatus::Passed;
        event(session, i, AuctionEventKind::Passed);
    }
    session.activate();
}
/// 依人物 key 排序，任何轮次都不依赖数据条目的原始排列。
fn compete(world: &World, def: &AuctionDef, session: &mut Session, i: usize, finish: bool) {
    let mut bidders: Vec<_> = def.bidders.iter().collect();
    bidders.sort_by(|a, b| a.person.cmp(&b.person));
    loop {
        let mut raised = false;
        for b in &bidders {
            let l = &mut session.lots[i];
            if l.leader.as_deref() == Some(&b.person) || !l.bidders.get(&b.person).is_some_and(|b| b.active) {
                continue;
            }
            let liked = world
                .defs
                .items
                .item(&l.item)
                .is_some_and(|item| b.likes.iter().any(|tag| item.tags.contains(tag) || tag == item.kind.key()));
            let left = b.budget - session.spent.get(&b.person).copied().unwrap_or(0);
            let ceiling = left.min(b.budget / (if liked { 1 } else { 2 }));
            let mut random = rng(world, &def.key, &format!("{}:{}", l.key, b.person), l.round);
            let (chance, multiple) = match b.temper {
                Temper::Cautious => (6000, 1),
                Temper::Steady => (8500, 1),
                Temper::Aggressive => (9500, 2),
                Temper::Collector => (if liked { 10000 } else { 7000 }, 3),
            };
            let increment = l.increment.max(l.current.unwrap_or(0) / 16);
            let price =
                l.current.map_or(l.reserve, |v| v.saturating_add(increment.saturating_mul(random.range(1, multiple))));
            let state = l.bidders.get_mut(&b.person);
            if let Some(state) = state {
                state.mood = (!b.mood_lines.is_empty()).then(|| random.below(b.mood_lines.len() as u64) as usize);
                if price > ceiling || !random.chance_bp(chance) {
                    state.active = false;
                    continue;
                }
            }
            l.current = Some(price);
            l.leader = Some(b.person.clone());
            raised = true;
            event(session, i, AuctionEventKind::Bid);
        }
        session.lots[i].round = session.lots[i].round.saturating_add(1);
        if !raised {
            settle(session, i);
            break;
        }
        if !finish {
            break;
        }
    }
}

pub(crate) enum Action {
    Bid(i64),
    Pass,
    Inspect,
}
pub(crate) struct AuctionPlan {
    key: String,
    session: Session,
    purchase: Option<(LocId, String, i64)>,
}
fn rule(code: &'static str, zh: &str) -> CommandError {
    Reason::new(code, zh).rule()
}
pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    key: &str,
    lot: &str,
    action: Action,
) -> Result<AuctionPlan, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let def = world.defs.auctions.get(key).ok_or_else(|| rule("auction.unknown", "没有这场拍卖会"))?;
    if !world.at_item_shop(owner, def.port) {
        return Err(CommandError::WrongLocation);
    }
    let mut session =
        world.state.auctions.sessions.get(key).cloned().ok_or_else(|| rule("auction.not_open", "拍卖尚未开始"))?;
    let phase = session.phase(world.day(), def.preview_days);
    let i = session
        .lots
        .iter()
        .position(|l| l.key == lot)
        .ok_or_else(|| rule("auction.unknown_lot", "这件拍品不在本场拍卖中"))?;
    let l = &mut session.lots[i];
    let mut purchase = None;
    if matches!(action, Action::Inspect) {
        if !matches!(phase, Phase::Preview | Phase::Open)
            || !matches!(l.status, LotStatus::Waiting | LotStatus::Bidding)
        {
            return Err(rule("auction.no_inspection", "此刻不能鉴定这件拍品"));
        }
        if l.inspection.is_some() {
            return Err(rule("auction.inspected", "这件拍品本场已经鉴定过"));
        }
        let truth = def
            .lot(&l.item, l.special)
            .ok_or_else(|| rule("auction.unknown_lot", "这件拍品不在本场拍卖中"))?
            .authenticity;
        l.inspection = Some(if rng(world, key, lot, u32::MAX).chance_bp(world.appraisal_chance(owner, &l.item)) {
            truth
        } else {
            Authenticity::Unsure
        });
        event(&mut session, i, AuctionEventKind::Inspected);
    } else {
        if phase != Phase::Open {
            return Err(rule("auction.not_open", "拍卖尚未开始或已经结束"));
        }
        if l.status != LotStatus::Bidding {
            return Err(rule("auction.not_bidding", "这件拍品此刻不在竞价"));
        }
        if let Action::Bid(amount) = action {
            if amount < l.next_min() {
                return Err(rule("auction.low_bid", "出价低于下一口最低价"));
            }
            amount.checked_add(l.increment).ok_or(CommandError::InvalidQuantity)?;
            let cash = world.agent(owner)?.cash;
            if amount > cash {
                return Err(CommandError::InsufficientCash { need: amount, have: cash });
            }
            world.item_quantity(owner, &l.item).checked_add(1).ok_or(CommandError::InvalidQuantity)?;
            l.current = Some(amount);
            l.leader = Some("player".into());
            event(&mut session, i, AuctionEventKind::Bid);
            compete(world, def, &mut session, i, false);
            if session.lots[i].status == LotStatus::Sold && session.lots[i].leader.as_deref() == Some("player") {
                purchase = Some((def.port, session.lots[i].item.clone(), amount));
            }
        } else {
            compete(world, def, &mut session, i, true);
        }
    }
    Ok(AuctionPlan { key: key.into(), session, purchase })
}
pub(crate) fn apply(world: &mut World, plan: AuctionPlan) -> Result<(), CoreError> {
    if let Some((loc, item, price)) = plan.purchase {
        let entry = JournalEntry::new(world.day(), Memo::Other, CashClass::Operating)
            .dr(Account::OtherExpense, price)
            .cr(Account::Cash, price);
        world.book_external(OwnerId::Player, Flow::Other, world.town_sector(loc), entry)?;
        world.grant_item(OwnerId::Player, &item, 1).map_err(|e| CoreError::Internal(e.to_string()))?;
    }
    world.state.auctions.sessions.insert(plan.key, plan.session);
    Ok(())
}

//! 校验和执行共用原子试算；持续活动在每日结算时核对实际舰队位置。
use super::*;
use crate::{
    World,
    error::{CommandError, CoreError},
    history::blocked,
    ledger::{Account, CashClass, JournalEntry, Memo},
    rng::{Domain, Rng},
    warehouse::Holder,
    world::WorldState,
};

impl World {
    fn idea_berths(&self, fleet: FleetId) -> i64 {
        self.defs
            .ideas
            .ports
            .iter()
            .filter_map(|p| self.defs.find_loc(&p.key).and_then(|loc| self.state.ideas.ports.get(&loc)).map(|s| (p, s)))
            .flat_map(|(p, s)| {
                p.modes
                    .iter()
                    .filter(|m| m.mode == Mode::Protect)
                    .filter_map(move |m| s.modes.get(&mode_key(&m.idea, m.mode)).map(|state| (m, state)))
            })
            .map(|(m, s)| m.berths * s.active.values().filter(|a| a.fleet == fleet).count() as i64)
            .sum()
    }
    pub(crate) fn idea_passenger(&self, person: &str) -> bool {
        self.defs.ideas.ports.iter().any(|p| {
            self.defs.find_loc(&p.key).and_then(|loc| self.state.ideas.ports.get(&loc)).is_some_and(|s| {
                p.modes.iter().any(|m| {
                    m.mode == Mode::Protect
                        && m.person.as_deref() == Some(person)
                        && s.modes.get(&mode_key(&m.idea, m.mode)).is_some_and(|m| !m.active.is_empty())
                })
            })
        })
    }
    fn credit_propagation(&mut self, owner: OwnerId, loc: LocId, m: &ModeDef, points: i64) -> Result<(), CommandError> {
        if !self.state.history.enabled {
            return Ok(());
        }
        let defs = self.defs.clone();
        for e in &defs.history.events {
            let state = self.state.history.events.get(&e.key);
            if state.is_some_and(|s| s.closed || s.outcome.is_some())
                || e.locked && state.is_none_or(|s| !s.unlocked)
                || !e.window.is_some_and(|w| w[0] <= self.cast_date() && self.cast_date() <= w[1])
                || !e
                    .requires
                    .iter()
                    .all(|r| self.history_outcome(&r.event).is_some_and(|o| r.outcome.as_ref().is_none_or(|v| v == o)))
            {
                continue;
            }
            for l in &e.levers {
                if l.kind == crate::history::LeverKind::Propagate
                    && l.idea.as_ref() == Some(&m.idea)
                    && l.mode == Some(m.mode)
                    && l.port.as_ref() == Some(&defs.loc(loc).key)
                    && self.history_conditions_for(owner, e, &l.requires)
                {
                    self.add_contribution(owner, e, l, points * l.value_per_point * 100)?;
                }
            }
        }
        Ok(())
    }
    pub fn idea_share(&self, loc: LocId, idea: &str) -> Option<i64> {
        let p = self.defs.ideas.port(&self.defs.locations.get(loc.idx())?.key)?;
        self.defs.ideas.idea(idea)?;
        let base = p.shares.get(idea).copied().unwrap_or(0);
        let Some(s) = self.state.ideas.ports.get(&loc) else { return Some(base) };
        let mut value = s.shares.get(idea).copied().unwrap_or(base);
        for _ in s.year.saturating_add(1)..=self.cast_date()[0] {
            value -= (value - base) * p.inertia / 100;
        }
        Some(value)
    }
    pub fn idea_delta_year(&self, loc: LocId, idea: &str) -> i64 {
        self.state
            .ideas
            .ports
            .get(&loc)
            .filter(|s| s.year == self.cast_date()[0])
            .and_then(|s| s.gained.get(idea))
            .copied()
            .unwrap_or(0)
    }
    pub fn idea_skill(&self, owner: OwnerId, skill: &str) -> i64 {
        let personal = self.inventory(owner).and_then(|i| i.skill_xp.get(skill)).copied().unwrap_or(0);
        self.state
            .mates
            .iter()
            .filter(|(_, m)| m.owner == Some(owner))
            .map(|(id, _)| self.mate_ability(*id, skill))
            .fold(personal, i64::max)
    }
    fn idea_permission(&self, owner: OwnerId, p: &PortDef) -> bool {
        p.permission.as_ref().is_none_or(|flag| self.state.story2.flags.contains(flag))
            || p.protector.as_ref().is_some_and(|person| {
                self.person_alive(person) && self.history_affinity(owner, person).is_some_and(|a| a >= 50)
            })
    }
    fn idea_carrier(&self, owner: OwnerId, idea: &IdeaDef, loc: LocId) -> bool {
        self.defs.cast.persons.iter().any(|p| {
            p.tags.iter().any(|t| idea.carriers.contains(t))
                && self.person_alive(&p.key)
                && self.person_place(&p.key).is_some_and(|place| place.loc == loc)
                && (self
                    .person_mate(&p.key)
                    .and_then(|id| self.state.mates.get(&id))
                    .is_some_and(|m| m.owner == Some(owner))
                    || self.history_affinity(owner, &p.key).is_some_and(|a| a >= 50))
        }) || idea.carriers.iter().any(|tag| {
            self.state.mates.iter().any(|(id, m)| {
                m.owner == Some(owner)
                    && self
                        .flagship(owner)
                        .and_then(|id| self.state.fleets.get(&id))
                        .is_some_and(|f| f.docked_at() == Some(loc))
                    && self.mate_ability(*id, tag) > 0
            })
        })
    }
    fn prepare_ideas(&mut self, loc: LocId, p: &PortDef) {
        let year = self.cast_date()[0];
        let shares =
            self.defs.ideas.ideas.iter().map(|i| (i.key.clone(), self.idea_share(loc, &i.key).unwrap_or(0))).collect();
        let s = self.state.ideas.ports.entry(loc).or_default();
        if s.year != year {
            s.shares = shares;
            s.year = year;
            s.gained.clear();
            for mode in s.modes.values_mut() {
                mode.raw = 0;
            }
        }
        for (idea, base) in &p.shares {
            s.shares.entry(idea.clone()).or_insert(*base);
        }
    }
    fn idea_points(&self, loc: LocId, p: &PortDef, m: &ModeDef) -> i64 {
        let raw = self
            .state
            .ideas
            .ports
            .get(&loc)
            .filter(|s| s.year == self.cast_date()[0])
            .and_then(|s| s.modes.get(&mode_key(&m.idea, m.mode)))
            .map_or(0, |s| s.raw);
        let effective = |r: i64| {
            (r.min(m.cap / 2) + (r - m.cap / 2).max(0) * m.diminish / 100).min(m.cap) * (100 - p.hostility) / 100
        };
        (effective(raw + m.points) - effective(raw))
            .min(p.annual_cap - self.idea_delta_year(loc, &m.idea))
            .min(100 - self.idea_share(loc, &m.idea).unwrap_or(0))
            .max(0)
    }
    pub fn propagation_points(&self, loc: LocId, idea: &str, mode: Mode) -> i64 {
        let Some(p) = self.defs.locations.get(loc.idx()).and_then(|l| self.defs.ideas.port(&l.key)) else { return 0 };
        p.modes.iter().find(|m| m.idea == idea && m.mode == mode).map_or(0, |m| self.idea_points(loc, p, m))
    }
    fn idea_has_room(&self, loc: LocId, p: &PortDef, m: &ModeDef) -> bool {
        let raw = self
            .state
            .ideas
            .ports
            .get(&loc)
            .filter(|s| s.year == self.cast_date()[0])
            .and_then(|s| s.modes.get(&mode_key(&m.idea, m.mode)))
            .map_or(0, |s| s.raw);
        let effective =
            (raw.min(m.cap / 2) + (raw - m.cap / 2).max(0) * m.diminish / 100).min(m.cap) * (100 - p.hostility) / 100;
        let maximum = if m.diminish == 0 { m.cap / 2 } else { m.cap } * (100 - p.hostility) / 100;
        effective < maximum
            && self.idea_delta_year(loc, &m.idea) < p.annual_cap
            && self.idea_share(loc, &m.idea).unwrap_or(0) < 100
    }
    fn award_idea(&mut self, owner: OwnerId, loc: LocId, p: &PortDef, m: &ModeDef) -> Result<(), CommandError> {
        self.prepare_ideas(loc, p);
        let points = self.idea_points(loc, p, m);
        let s = self.state.ideas.ports.entry(loc).or_default();
        s.modes.entry(mode_key(&m.idea, m.mode)).or_default().raw += m.points;
        *s.shares.entry(m.idea.clone()).or_default() += points;
        *s.gained.entry(m.idea.clone()).or_default() += points;
        if points > 0 {
            self.credit_propagation(owner, loc, m, points)?;
            if self.state.history.enabled
                && let Some((campaign, var)) = m.campaign.as_ref().zip(m.var.as_ref())
            {
                self.change_campaign(campaign, var, points)?;
            }
            for unlock in &p.unlocks {
                if unlock.idea == m.idea
                    && self.idea_share(loc, &m.idea).unwrap_or(0) >= unlock.threshold
                    && self.state.ideas.ports.entry(loc).or_default().unlocked.insert(unlock.key.clone())
                {
                    for effect in &unlock.effects {
                        self.apply_history_effect_for(owner, effect)?;
                    }
                    self.adjust_reputation(owner, self.location_faction(loc), 1);
                }
            }
        }
        self.history_ideas_changed();
        Ok(())
    }
    pub(crate) fn ideas_day(&mut self) -> Result<(), CoreError> {
        if self.defs.ideas.is_empty() || self.state.ideas.is_empty() || self.state.ideas.last_day == Some(self.day()) {
            return Ok(());
        }
        let mut trial = self.clone();
        trial.advance_ideas().map_err(|e| CoreError::Internal(format!("思想传播：{e}")))?;
        self.state = trial.state;
        Ok(())
    }
    fn advance_ideas(&mut self) -> Result<(), CommandError> {
        let defs = self.defs.clone();
        for p in &defs.ideas.ports {
            let Some(loc) = defs.find_loc(&p.key) else { continue };
            if !self.state.ideas.ports.contains_key(&loc) {
                continue;
            }
            self.prepare_ideas(loc, p);
            for m in &p.modes {
                if m.from_date.is_some_and(|date| self.cast_date() < date) {
                    continue;
                }
                let key = mode_key(&m.idea, m.mode);
                let active = self
                    .state
                    .ideas
                    .ports
                    .get_mut(&loc)
                    .and_then(|s| s.modes.get_mut(&key))
                    .map(|s| std::mem::take(&mut s.active))
                    .unwrap_or_default();
                for (owner, mut a) in active {
                    let Some(fleet) = self.state.fleets.get(&a.fleet).filter(|f| f.owner == owner) else { continue };
                    if !self.location_open(loc) || m.person.as_ref().is_some_and(|p| !self.person_alive(p)) {
                        continue;
                    }
                    let at = fleet.docked_at();
                    let complete = if m.mode == Mode::Protect {
                        let from = m.from.as_ref().and_then(|k| defs.find_loc(k));
                        if fleet.free_capacity() < m.berths + self.idea_berths(a.fleet) {
                            continue;
                        }
                        if at != from {
                            a.departed = true;
                        }
                        a.elapsed = a.elapsed.saturating_add(1);
                        a.departed && at == Some(loc)
                    } else {
                        if at != Some(loc)
                            || !self.idea_permission(owner, p)
                            || p.language.as_ref().is_some_and(|s| self.idea_skill(owner, s) == 0)
                            || m.skill.as_ref().is_some_and(|s| self.idea_skill(owner, s) < m.min_skill)
                        {
                            continue;
                        }
                        if m.mode == Mode::Mission
                            && !self.idea_carrier(
                                owner,
                                defs.ideas.idea(&m.idea).ok_or_else(|| blocked("思想不存在"))?,
                                loc,
                            )
                        {
                            continue;
                        }
                        a.elapsed = a.elapsed.saturating_add(1);
                        a.elapsed >= m.days
                    };
                    if complete {
                        if m.mode == Mode::Protect
                            && let Some(person) = &m.person
                        {
                            self.state.ideas.rescued.insert(person.clone());
                            let from = self.cast_date();
                            self.state.cast.persons.entry(person.clone()).or_default().schedule =
                                Some(crate::cast::ScheduleDef {
                                    from,
                                    to: None,
                                    at: p.key.clone(),
                                    venue: String::new(),
                                    seasons: Vec::new(),
                                });
                        }
                        self.award_idea(owner, loc, p, m)?;
                    } else if a.elapsed <= 3650 {
                        self.state
                            .ideas
                            .ports
                            .entry(loc)
                            .or_default()
                            .modes
                            .entry(key.clone())
                            .or_default()
                            .active
                            .insert(owner, a);
                    }
                }
            }
        }
        self.state.ideas.last_day = Some(self.day());
        Ok(())
    }
}

pub(crate) fn check(
    w: &World,
    owner: OwnerId,
    idea: &str,
    loc: LocId,
    mode: Mode,
) -> Result<Box<WorldState>, CommandError> {
    w.agent(owner)?;
    let p =
        w.defs.locations.get(loc.idx()).and_then(|l| w.defs.ideas.port(&l.key)).ok_or(CommandError::WrongLocation)?;
    let idea = w.defs.ideas.idea(idea).ok_or_else(|| blocked("思想不存在"))?;
    let m =
        p.modes.iter().find(|m| m.idea == idea.key && m.mode == mode).ok_or_else(|| blocked("此地没有这种传播方式"))?;
    if m.from_date.is_some_and(|date| w.cast_date() < date) {
        return Err(blocked("时候未到，这样传播还行不通"));
    }
    if !w.location_open(loc) || !w.idea_has_room(loc, p, m) {
        return Err(blocked("地点未开放或年度传播已达上限"));
    }
    let state = w.state.ideas.ports.get(&loc).and_then(|s| s.modes.get(&mode_key(&idea.key, mode)));
    if state.is_some_and(|s| s.active.contains_key(&owner) || s.last.get(&owner) == Some(&w.day())) {
        return Err(blocked("传播正在进行或今日已经提交"));
    }
    let origin = if mode == Mode::Protect {
        m.from.as_ref().and_then(|k| w.defs.find_loc(k)).ok_or(CommandError::WrongLocation)?
    } else {
        loc
    };
    let fleet = w.fleets_of(owner).find(|f| f.docked_at() == Some(origin)).ok_or(CommandError::WrongLocation)?;
    if !w.location_open(origin) {
        return Err(CommandError::WrongLocation);
    }
    if let Some(lang) = &p.language
        && w.idea_skill(owner, lang) == 0
    {
        return Err(blocked("需要当地语言或通事"));
    }
    if m.skill.as_ref().is_some_and(|s| w.idea_skill(owner, s) < m.min_skill) {
        return Err(blocked("所需学识或医术不足"));
    }
    if matches!(mode, Mode::Mission | Mode::School) && !w.idea_permission(owner, p) {
        return Err(blocked("缺少当地许可或保护人"));
    }
    if mode == Mode::Mission && !w.idea_carrier(owner, idea, loc) {
        return Err(blocked("缺少在场传播者"));
    }
    if let Some(book) = &m.book {
        if w.item_available(owner, book) < 1 {
            return Err(blocked("缺少印译底本"));
        }
        let lang = w.defs.items.item(book).and_then(|i| i.read.as_ref()).and_then(|b| b.lang.as_deref());
        if lang.is_some_and(|l| w.idea_skill(owner, l) == 0) {
            return Err(blocked("缺少懂原文的译者"));
        }
    }
    if mode == Mode::Court {
        let person = m.person.as_ref().ok_or_else(|| blocked("未指定宫廷人物"))?;
        w.can_history_audience(owner, person)?;
        if !w.history_audience_today(owner, person) || w.history_affinity(owner, person).is_none_or(|a| a < m.affinity)
        {
            return Err(blocked("需要求见与人物好感"));
        }
    }
    if mode == Mode::Protect {
        let person = m.person.as_ref().ok_or_else(|| blocked("未指定庇护对象"))?;
        if w.state.ideas.rescued.contains(person) || w.idea_passenger(person) {
            return Err(blocked("庇护对象已撤离或正在撤离"));
        }
        if fleet.free_capacity() < m.berths + w.idea_berths(fleet.id)
            || !w.person_alive(person)
            || w.person_place(person).is_none_or(|p| p.loc != origin)
        {
            return Err(blocked("缺少船位或庇护对象不在出发地"));
        }
    }
    for (item, qty) in &m.items {
        if w.item_available(owner, item) < *qty {
            return Err(blocked("传播物品不足"));
        }
    }
    for (good, qty) in &m.goods {
        if w.defs.find_good(good).is_none_or(|g| w.holder_qty(owner, Holder::Fleet(fleet.id), g) < *qty) {
            return Err(blocked("传播物资不足"));
        }
    }
    let have = w.agent(owner)?.cash;
    if have < m.cost {
        return Err(CommandError::InsufficientCash { have, need: m.cost });
    }
    let mut trial = w.clone();
    trial.prepare_ideas(loc, p);
    if m.cost > 0 {
        trial.book_external(
            owner,
            crate::treasury::Flow::Faction,
            crate::circulation::Sector::Treasury(w.location_faction(loc)),
            JournalEntry::new(w.day(), Memo::Other, CashClass::Operating)
                .dr(Account::OtherExpense, m.cost)
                .cr(Account::Cash, m.cost),
        )?;
    }
    for (item, qty) in &m.items {
        trial.take_item(owner, item, *qty);
    }
    for (good, qty) in &m.goods {
        let good = w.defs.find_good(good).ok_or(CommandError::InvalidQuantity)?;
        trial.holder_take(owner, Holder::Fleet(fleet.id), good, *qty)?;
        let cost = trial.agent_mut(owner)?.book.remove(good, *qty);
        trial.book_internal(
            owner,
            JournalEntry::new(w.day(), Memo::Other, CashClass::Operating)
                .dr(Account::OtherExpense, cost)
                .cr(Account::Inventory, cost),
        )?;
    }
    if p.forbidden.contains(&idea.key) || mode == Mode::Protect {
        let hash = blake3::hash(format!("{}:{owner:?}:{mode:?}:{}", idea.key, loc.0).as_bytes());
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        if Rng::derive(w.state.seed, w.day(), Domain::Ideas, u64::from_le_bytes(bytes), 0).chance_bp(m.detection * 100)
        {
            let suspicion =
                trial.state.ideas.suspicion.entry(owner).or_default().entry(w.location_faction(origin)).or_default();
            *suspicion = (*suspicion + m.suspicion).min(100);
        }
    }
    let state = trial.state.ideas.ports.entry(loc).or_default().modes.entry(mode_key(&idea.key, mode)).or_default();
    state.last.insert(owner, w.day());
    if matches!(mode, Mode::Mission | Mode::School | Mode::Protect) {
        state.active.insert(owner, Activity { fleet: fleet.id, started: w.day(), elapsed: 0, departed: false });
    } else {
        trial.award_idea(owner, loc, p, m)?;
    }
    if owner == OwnerId::Player {
        trial.record_forbidden(crate::societies::Activity::Idea(&idea.key));
    }
    Ok(Box::new(trial.state))
}

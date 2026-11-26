//! 条件与检定共用真实内核状态；不认识的种类在反序列化时拒绝。
use super::*;
use crate::{World, cast::relations::RomanceAction, ids::OwnerId};
impl World {
    /// 只过滤身份及恋爱开放门槛；资金、物品等普通门槛仍显示为不可用选项。
    pub fn story2_choice_visible(&self, choice: &Choice, entered: u32) -> bool {
        choice
            .requires
            .iter()
            .filter(|c| c.hides_choice())
            .all(|c| self.story2_conditions(std::slice::from_ref(c), entered))
    }

    /// 有选项、但没有一个可见且满足门槛的选项：此刻回答不了（旁观章没有选项，总能“继续”）。
    pub fn story2_choices_locked(&self, c: &ChapterDef, entered: u32) -> bool {
        self.story2_choices_locked_with(c, entered, None)
    }

    pub(crate) fn story2_choices_locked_for(&self, key: &str, c: &ChapterDef, entered: u32) -> bool {
        self.story2_choices_locked_with(c, entered, self.known_chapter_track(key, c, entered))
    }

    fn story2_choices_locked_with(&self, c: &ChapterDef, entered: u32, known: Option<&str>) -> bool {
        !c.choices.is_empty()
            && !c.choices.iter().any(|o| {
                self.story2_choice_visible(o, entered)
                    && self.story2_choice_open(o, entered)
                    && (self.story2_soft_gaps(o).is_empty()
                        || known
                            .or_else(|| self.chapter_track(c, entered))
                            .is_none_or(|track| !self.story2_choice_failed(track, &c.key, entered, &o.key)))
            })
    }

    pub fn story2_conditions(&self, conditions: &[Condition], entered: u32) -> bool {
        let track = self.conditions_track(conditions, entered);
        self.story2_conditions_in(conditions, entered, track)
    }

    pub fn story2_conditions_in(&self, conditions: &[Condition], entered: u32, track: Option<&str>) -> bool {
        conditions.iter().all(|c| match c {
            Condition::Protagonist { protagonist } => {
                self.state.protagonist.as_ref().and_then(|p| p.key()) == Some(protagonist.as_str())
            }
            Condition::ProtagonistIn { protagonist_in } => self
                .state
                .protagonist
                .as_ref()
                .and_then(|p| p.key())
                .is_some_and(|key| protagonist_in.iter().any(|p| p == key)),
            Condition::RomanceOpen { romance_open } => {
                self.validate_romance(romance_open, RomanceAction::Heart).is_ok()
            }
            Condition::Society { society, ge } => self.society_rank(society).is_some_and(|r| r >= *ge),
            Condition::Spell { spell } => self.spell_known(spell),
            Condition::Lineage { lineage, person } => person.as_ref().map_or_else(
                || self.player_lineage().is_some_and(|l| &l.key == lineage),
                |p| self.defs.cast.person(p).is_some_and(|p| &p.lineage == lineage),
            ),
            Condition::Date { from, to } => {
                from.is_none_or(|d| d <= self.cast_date()) && to.is_none_or(|d| self.cast_date() <= d)
            }
            Condition::Flag { flag, value } => self.state.story2.flags.contains(flag) == *value,
            Condition::At { at, person } => person
                .as_ref()
                .map_or_else(|| self.cast_player_place(), |p| self.person_place(p))
                .is_some_and(|p| self.defs.loc(p.loc).key == *at),
            Condition::Age { person, ge, le } => {
                let age = person.as_ref().map_or_else(
                    || self.state.protagonist.as_ref().and_then(|p| p.age_on(self.cast_date())),
                    |p| self.defs.cast.person(p).and_then(|p| p.age_on(self.cast_date())),
                );
                age.is_some_and(|age| ge.is_none_or(|v| age >= v) && le.is_none_or(|v| age <= v))
            }
            Condition::Affinity { person, ge } => self.affection(person).map_or(0, |a| a.affinity) >= *ge,
            Condition::Heart { person, ge } => {
                self.validate_romance(person, RomanceAction::Heart).is_ok()
                    && self.affection(person).map_or(0, |a| a.heart) >= *ge
            }
            Condition::Bond { person, level } => {
                self.affection(person).and_then(|a| a.bond).is_some_and(|b| b >= *level)
            }
            Condition::NotBondS { person } => self.affection(person).and_then(|a| a.bond) != Some(Bond::S),
            Condition::Wait { days } => self.day().saturating_sub(entered) >= *days,
            Condition::Season { season } => self.defs.calendar.season_of(self.day()).index() == *season as usize,
            // 数值门槛与掷骰（U02）共用同一套取值，见 `dice.rs` 的 `story2_numeric`。
            Condition::Attr { .. } | Condition::Growth { .. } | Condition::Skill { .. } => {
                self.story2_numeric(c).is_some_and(|(_, have, need)| have >= need)
            }
            Condition::Cash { ge } => self.state.agents.get(&OwnerId::Player).is_some_and(|a| a.cash >= *ge),
            Condition::Fame { ge } if self.upbringing_active() => {
                self.state.upbringing.as_ref().is_some_and(|s| s.fame >= *ge)
            }
            Condition::Fame { ge } => self.state.agents.get(&OwnerId::Player).is_some_and(|a| a.fame >= *ge),
            Condition::Reputation { faction, ge } => self
                .defs
                .factions
                .iter()
                .position(|f| f.key == *faction)
                .is_some_and(|i| self.reputation(OwnerId::Player, crate::FactionId::from_idx(i)) >= *ge),
            Condition::Item { item, qty } => self.item_quantity(OwnerId::Player, item) >= *qty,
            Condition::Equipped { item } => self.item_equipped(OwnerId::Player, item) > 0,
            Condition::Mate { mate } => self.defs.mates.iter().position(|m| m.key == *mate).is_some_and(|i| {
                self.state.mates.get(&crate::MateId::from_idx(i)).is_some_and(|m| m.owner == Some(OwnerId::Player))
            }),
            Condition::Relation { person, relation } => {
                self.affection(person).is_some_and(|a| a.relations.contains(relation))
            }
            Condition::Tie { a, b, relation } => self
                .active_ties()
                .iter()
                .any(|t| ((t.a == *a && t.b == *b) || (t.a == *b && t.b == *a)) && t.kind == *relation),
            Condition::Alive { person, value } => self.person_alive(person) == *value,
            Condition::Read { work } => self.has_read_work(OwnerId::Player, work),
            Condition::Books { ge, category } => self.books_read(OwnerId::Player, category.as_deref()) >= *ge as usize,
            Condition::Gifts { person, count, value, kinds, category, qty } => {
                count.is_none_or(|n| self.gift_count(OwnerId::Player, Some(person)) >= n)
                    && value.is_none_or(|n| self.gift_value(OwnerId::Player, Some(person)) >= n)
                    && kinds.is_none_or(|n| self.gift_kinds(OwnerId::Player, Some(person)) >= n as usize)
                    && category
                        .as_ref()
                        .is_none_or(|c| self.gift_category_count(OwnerId::Player, person, c) >= qty.unwrap_or(1))
            }
            Condition::Price { good, at, ge, le } => self
                .defs
                .goods
                .iter()
                .position(|g| g.key == *good)
                .zip(self.defs.locations.iter().position(|l| l.key == *at))
                .and_then(|(g, l)| self.state.locations.get(l).and_then(|m| m.market.get(&crate::GoodId::from_idx(g))))
                .is_some_and(|m| ge.is_none_or(|v| m.price >= v) && le.is_none_or(|v| m.price <= v)),
            Condition::Location { culture, port } => self.cast_player_place().is_some_and(|p| {
                let loc = self.defs.loc(p.loc);
                culture.as_ref().is_none_or(|c| loc.culture == *c) && port.is_none_or(|v| loc.is_port() == v)
            }),
            Condition::Visited { .. }
            | Condition::PortsKnown { .. }
            | Condition::HouseLevel { .. }
            | Condition::Warehouse { .. }
            | Condition::Industries { .. }
            | Condition::Ships { .. }
            | Condition::ShipTier { .. }
            | Condition::Mates { .. }
            | Condition::Post { .. }
            | Condition::Rank { .. }
            | Condition::Deed { .. } => {
                self.quest_condition_progress(c, entered, track).is_some_and(|(have, need)| have >= need)
            }
            Condition::Any { any } => {
                self.defs.rules.quests.enabled
                    && any.iter().any(|b| self.story2_conditions_in(std::slice::from_ref(b), entered, track))
            }
        })
    }

    pub fn story2_check_value(&self, key: &str) -> i64 {
        let value = self.story2_base_check_value(key);
        crate::fixed::mul_div(value, 100 - i64::from(self.state.lineages.strain), 100)
    }
    fn story2_base_check_value(&self, key: &str) -> i64 {
        if self.upbringing_active() {
            if self.defs.captain.attribute_index(key).is_some() {
                return self.upbringing_projected(key);
            }
            if self.defs.captain.ratings.iter().any(|r| r.key == key) {
                return self.upbringing_rating(key);
            }
        }
        if let Some(index) = self.defs.captain.check_index(key) {
            let attrs = self
                .state
                .agents
                .get(&OwnerId::Player)
                .and_then(|a| a.captain.as_ref())
                .map_or(&[][..], |c| c.attrs.as_slice());
            self.defs
                .captain
                .check_value(attrs, index)
                .saturating_add(self.equipment_bonus(OwnerId::Player, "captain").get(key).copied().unwrap_or(0))
        } else {
            self.inventory(OwnerId::Player).and_then(|i| i.skill_xp.get(key)).copied().unwrap_or(0)
        }
    }
    pub fn story2_check_pct(&self, check: &Check) -> i64 {
        check.base.saturating_add(self.story2_check_value(&check.attr).saturating_mul(check.per)).clamp(5, 95)
    }
    pub fn story2_variant<'a>(&self, chapter: &'a ChapterDef, entered: u32) -> Option<&'a Variant> {
        chapter.variants.iter().filter(|v| self.story2_conditions(&v.when, entered)).min_by_key(|v| &v.key)
    }
}

impl Condition {
    pub fn hides_choice(&self) -> bool {
        matches!(self, Self::Protagonist { .. } | Self::ProtagonistIn { .. } | Self::RomanceOpen { .. })
    }
}

/// proof 的条件种类词表与封闭的 serde 种类保持一致。
pub const CONDITION_KEYS: &[&str] = &[
    "date",
    "flag",
    "at",
    "age",
    "affinity",
    "heart",
    "bond",
    "not_bond_s",
    "wait",
    "season",
    "attr",
    "growth",
    "skill",
    "cash",
    "fame",
    "reputation",
    "item",
    "equipped",
    "mate",
    "relation",
    "tie",
    "alive",
    "read",
    "books",
    "gifts",
    "price",
    "location",
    "society",
    "spell",
    "lineage",
    "protagonist",
    "protagonist_in",
    "romance_open",
    "visited",
    "ports_known",
    "house_level",
    "warehouse",
    "industries",
    "ships",
    "ship_tier",
    "mates",
    "post",
    "rank",
    "deed",
    "any",
];

impl World {
    /// 三项都真时，原归属扫描必定找到同一条轨道；只借用本次调用传入的 key，不缓存状态。
    pub(crate) fn known_chapter_track<'a>(&self, key: &'a str, c: &ChapterDef, entered: u32) -> Option<&'a str> {
        self.state
            .story2
            .tracks
            .get(key)
            .filter(|s| {
                s.entered == entered
                    && self
                        .defs
                        .story2
                        .track(key)
                        .and_then(|t| t.chapter(&s.chapter))
                        .is_some_and(|at| std::ptr::eq(at, c))
            })
            .map(|_| key)
    }

    /// 旧接口没有轨道参数；优先按定义引用定位，克隆只在唯一匹配时回退，避免同日同名章串用基线。
    pub(crate) fn chapter_track(&self, chapter: &ChapterDef, entered: u32) -> Option<&str> {
        let mut matches = self
            .state
            .story2
            .tracks
            .iter()
            .filter(|(_, s)| s.entered == entered)
            .filter_map(|(k, s)| self.defs.story2.track(k)?.chapter(&s.chapter).map(|c| (k, c)))
            .filter(|(_, c)| *c == chapter);
        let first = matches.next()?;
        if std::ptr::eq(first.1, chapter) || matches.next().is_none() {
            Some(first.0)
        } else {
            self.state.story2.tracks.iter().find_map(|(k, s)| {
                let c = self.defs.story2.track(k)?.chapter(&s.chapter)?;
                (s.entered == entered && std::ptr::eq(c, chapter)).then_some(k.as_str())
            })
        }
    }

    pub(crate) fn conditions_track(&self, conditions: &[Condition], entered: u32) -> Option<&str> {
        if !conditions.iter().flat_map(super::deeds::condition_deeds).any(|(_, since)| since) {
            return None;
        }
        let mut matches = self
            .state
            .story2
            .tracks
            .iter()
            .filter(|(_, s)| s.entered == entered)
            .filter_map(|(k, s)| self.defs.story2.track(k)?.chapter(&s.chapter).map(|c| (k, c)))
            .filter(|(_, c)| {
                c.when == conditions
                    || c.choices.iter().any(|o| o.requires == conditions)
                    || c.variants.iter().any(|v| v.when == conditions)
            });
        let first = matches.next()?;
        if matches.next().is_none() {
            Some(first.0)
        } else {
            self.state.story2.tracks.iter().find_map(|(k, s)| {
                let c = self.defs.story2.track(k)?.chapter(&s.chapter)?;
                (s.entered == entered
                    && (std::ptr::eq(c.when.as_slice(), conditions)
                        || c.choices.iter().any(|o| std::ptr::eq(o.requires.as_slice(), conditions))
                        || c.variants.iter().any(|v| std::ptr::eq(v.when.as_slice(), conditions))))
                .then_some(k.as_str())
            })
        }
    }

    pub(crate) fn objective_track(&self, objective: &Objective, entered: u32) -> Option<&str> {
        if !super::deeds::objective_deeds(&objective.kind).iter().any(|(_, since)| *since)
            && !matches!(objective.kind, ObjectiveKind::Battle { .. })
        {
            return None;
        }
        let mut matches = self
            .state
            .story2
            .tracks
            .iter()
            .filter(|(_, s)| s.entered == entered)
            .filter_map(|(k, s)| self.defs.story2.track(k)?.chapter(&s.chapter).map(|c| (k, c)))
            .filter(|(_, c)| c.objectives.contains(objective));
        let first = matches.next()?;
        if first.1.objectives.iter().any(|o| std::ptr::eq(o, objective)) || matches.next().is_none() {
            Some(first.0)
        } else {
            self.state.story2.tracks.iter().find_map(|(k, s)| {
                let c = self.defs.story2.track(k)?.chapter(&s.chapter)?;
                (s.entered == entered && c.objectives.iter().any(|o| std::ptr::eq(o, objective))).then_some(k.as_str())
            })
        }
    }

    pub fn quest_post_filled(&self, post: &str) -> bool {
        use crate::mates::MateRole;
        self.state.mates.values().filter(|m| m.owner == Some(OwnerId::Player)).any(|m| match m.role {
            MateRole::Captain(_) => post == "captain",
            MateRole::Accountant => post == "accountant",
            MateRole::Trader => post == "trader",
            MateRole::CaravanLeader(_) => post == "caravan_leader",
            MateRole::IndustryManager(_) => post == "industry_manager",
            MateRole::Assigned { role, .. } => {
                self.defs.captain.roles.get(usize::from(role)).is_some_and(|r| r.key == post)
            }
            MateRole::None => false,
        })
    }

    /// 新条件判定与结构化目标行共用 have/need；地点、投资、商誉均调用已有内核公式。
    pub fn quest_condition_progress(&self, c: &Condition, entered: u32, track: Option<&str>) -> Option<(i64, i64)> {
        use Condition::*;
        let loc = |key: &str| self.defs.find_loc(key);
        let count = |n: usize| i64::try_from(n).unwrap_or(i64::MAX);
        Some(match c {
            Visited { at: Some(at), .. } => {
                (i64::from(loc(at).is_some_and(|id| self.state.explore.visited.contains(&id))), 1)
            }
            Visited { at: None, ge } => (
                count(
                    self.state
                        .explore
                        .visited
                        .iter()
                        .filter(|id| self.defs.locations.get(id.idx()).is_some_and(|l| l.is_port()))
                        .count(),
                ),
                i64::from(ge.unwrap_or(1)),
            ),
            PortsKnown { ge } => {
                (count(self.visible_locations().filter(|id| self.defs.loc(*id).is_port()).count()), i64::from(*ge))
            }
            HouseLevel { at, ge } => {
                let have = self
                    .defs
                    .locations
                    .iter()
                    .enumerate()
                    .filter(|(_, l)| at.as_ref().is_none_or(|key| key == &l.key))
                    .map(|(i, _)| self.house_level(OwnerId::Player, crate::LocId::from_idx(i)))
                    .max()
                    .unwrap_or(0);
                (count(have), i64::from(*ge))
            }
            Warehouse { at, ge } => {
                let have = self
                    .state
                    .locations
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| {
                        at.as_ref().is_none_or(|key| self.defs.locations.get(*i).is_some_and(|l| &l.key == key))
                    })
                    .filter(|(_, l)| {
                        l.warehouses.get(&OwnerId::Player).is_some_and(|w| w.rented.saturating_add(w.owned) > 0)
                    })
                    .count();
                (count(have), i64::from(ge.unwrap_or(1)))
            }
            Industries { at, industry, ge } => {
                let have = self
                    .state
                    .industries
                    .values()
                    .filter(|i| {
                        i.owner == OwnerId::Player
                            && at.as_ref().is_none_or(|key| &self.defs.loc(i.loc).key == key)
                            && industry.as_ref().is_none_or(|key| {
                                self.defs.industry_types.get(i.kind.idx()).is_some_and(|k| &k.key == key)
                            })
                    })
                    .count();
                (count(have), i64::from(*ge))
            }
            Ships { ge } => (count(self.fleets_of(OwnerId::Player).map(|f| f.ships.len()).sum()), i64::from(*ge)),
            ShipTier { ge } => {
                let have = self
                    .fleets_of(OwnerId::Player)
                    .flat_map(|f| &f.ships)
                    .map(|s| self.defs.rules.shipyard_growth.tier(self.defs.ship(s.kind).price))
                    .max()
                    .unwrap_or(0);
                (count(have), i64::from(*ge))
            }
            Mates { ge } => {
                (count(self.state.mates.values().filter(|m| m.owner == Some(OwnerId::Player)).count()), i64::from(*ge))
            }
            Post { post } => (i64::from(self.quest_post_filled(post)), 1),
            Rank { at, ge } => {
                let id = loc(at)?;
                let table = self.defs.rules.access.rank_table(crate::access::investable(&self.defs, id));
                let have = if !self.defs.rules.access.enabled {
                    table.len().saturating_sub(1)
                } else {
                    table.iter().rposition(|need| self.goodwill(OwnerId::Player, id) >= *need).unwrap_or(0)
                };
                (count(have), i64::from(*ge))
            }
            Deed { deed, ge, since_entered } => {
                (i64::from(self.deed_have(*deed, *since_entered, track, entered)), i64::from(*ge))
            }
            _ => return None,
        })
    }
}

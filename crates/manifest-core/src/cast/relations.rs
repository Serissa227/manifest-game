//! 所有恋爱数值、关系升级与配角关系共用的年龄门禁。
use super::*;
use crate::{error::CommandError, scenario::Gender, world::World};
use std::collections::BTreeSet;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Relation {
    Friends,
    Confidants,
    Sisters,
    Sworn,
    Mentor,
    Rivals,
    Enemies,
    Crush,
    Promise,
    Dating,
    Lovers,
    Partners,
}
impl Relation {
    pub fn romantic(self) -> bool {
        matches!(self, Self::Crush | Self::Dating | Self::Lovers | Self::Partners)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Bond {
    C,
    B,
    A,
    S,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RomanceAction {
    Heart,
    Dating,
    Lovers,
    Partners,
}

#[derive(Clone, Debug)]
pub struct RomanceActor<'a> {
    pub age: Option<u32>,
    /// 实际出生日期；旧的纯年龄调用可不提供。
    pub born: Option<WorldDate>,
    pub gender: Gender,
    pub historical: bool,
    pub authority: bool,
    /// None 表示自创主角；人物必须显式开放 romance。
    pub with: Option<&'a [String]>,
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum RomanceError {
    #[error("出生日期未知或尚未出生")]
    UnknownAge,
    #[error("历史人物不开放恋爱互动")]
    Historical,
    #[error("双方必须是年龄相差不超过三岁的同辈")]
    NotPeers,
    #[error("成年人与未成年人之间只能有情谊和师徒关系")]
    AdultMinor,
    #[error("导师、长辈和雇主不能对未成年人开放恋爱互动")]
    Authority,
    #[error("人物不对该性别开放恋爱互动")]
    Orientation,
    #[error("交往必须双方年满十六岁")]
    UnderSixteen,
    #[error("恋人与伴侣关系必须双方年满十八岁")]
    UnderEighteen,
    #[error("学院期不能建立成年恋人或伴侣关系")]
    Academy,
}

/// 加载与运行共同调用。数据、默认分支和 AI 都不能选择宽松模式。
pub fn romance_gate(
    a: &RomanceActor<'_>,
    b: &RomanceActor<'_>,
    action: RomanceAction,
    academy: bool,
) -> Result<(), RomanceError> {
    let (Some(age_a), Some(age_b)) = (a.age, b.age) else {
        return Err(RomanceError::UnknownAge);
    };
    if a.historical || b.historical {
        return Err(RomanceError::Historical);
    }
    if (age_a < 18) != (age_b < 18) {
        return Err(RomanceError::AdultMinor);
    }
    if (age_a < 18 || age_b < 18) && (a.authority || b.authority) {
        return Err(RomanceError::Authority);
    }
    let peers = match (a.born, b.born) {
        (Some(a), Some(b)) => {
            let (older, younger) = if a <= b { (a, b) } else { (b, a) };
            younger <= [older[0].saturating_add(3), older[1], older[2]]
        }
        _ => age_a.abs_diff(age_b) <= 3,
    };
    if !peers {
        return Err(RomanceError::NotPeers);
    }
    let accepts = |actor: &RomanceActor<'_>, gender: Gender| {
        actor.with.is_none_or(|with| {
            with.iter().any(|v| v == "any" || (v == "f" && gender == Gender::F) || (v == "m" && gender == Gender::M))
        })
    };
    if !accepts(a, b.gender) || !accepts(b, a.gender) {
        return Err(RomanceError::Orientation);
    }
    if academy && matches!(action, RomanceAction::Lovers | RomanceAction::Partners) {
        return Err(RomanceError::Academy);
    }
    match action {
        RomanceAction::Dating if age_a < 16 || age_b < 16 => Err(RomanceError::UnderSixteen),
        RomanceAction::Lovers | RomanceAction::Partners if age_a < 18 || age_b < 18 => Err(RomanceError::UnderEighteen),
        _ => Ok(()),
    }
}

pub fn actor(person: &PersonDef, date: WorldDate) -> RomanceActor<'_> {
    RomanceActor {
        age: person.age_on(date),
        born: Some(person.born),
        gender: person.gender,
        historical: person.kind == PersonKind::Historical,
        authority: person.tags.iter().any(|tag| ["mentor", "elder", "employer"].contains(&tag.as_str())),
        with: Some(&person.romance.with),
    }
}

pub fn action(relation: Relation) -> Option<RomanceAction> {
    match relation {
        Relation::Crush => Some(RomanceAction::Heart),
        Relation::Dating => Some(RomanceAction::Dating),
        Relation::Lovers => Some(RomanceAction::Lovers),
        Relation::Partners => Some(RomanceAction::Partners),
        _ => None,
    }
}

/// 有出处的历史家庭关系可以按史料展示，但不能开放新的恋爱互动。
pub fn initial_tie_gate(tie: &TieDef, a: &PersonDef, b: &PersonDef, date: WorldDate) -> Result<(), RomanceError> {
    let Some(action) = action(tie.kind) else {
        return Ok(());
    };
    if a.kind == PersonKind::Historical
        && b.kind == PersonKind::Historical
        && tie.kind == Relation::Partners
        && tie.basis == "historical"
        && !tie.sources.is_empty()
    {
        // 这里只展示双方已有出处的历史婚姻；新的恋爱效果仍统一走门禁。
        return Ok(());
    }
    romance_gate(&actor(a, date), &actor(b, date), action, false)
}

/// 已确立的师徒身份是关系门禁的共同依据，不取决于可翻译的角色说明。
pub fn declared_mentor(defs: &CastDefs, a: &str, b: &str, date: WorldDate) -> bool {
    defs.ties.iter().any(|t| t.kind == Relation::Mentor && same_pair(&t.a, &t.b, a, b) && t.since <= date)
}

pub fn initial_tie_gate_in(tie: &TieDef, defs: &CastDefs, date: WorldDate) -> Result<(), RomanceError> {
    let (Some(a), Some(b)) = (defs.person(&tie.a), defs.person(&tie.b)) else {
        return Err(RomanceError::UnknownAge);
    };
    initial_tie_gate(tie, a, b, date)?;
    let Some(action) = action(tie.kind) else {
        return Ok(());
    };
    if a.kind == PersonKind::Historical && b.kind == PersonKind::Historical && tie.kind == Relation::Partners {
        return Ok(());
    }
    let mut left = actor(a, date);
    left.authority |= declared_mentor(defs, &a.key, &b.key, date);
    romance_gate(&left, &actor(b, date), action, false)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RelationCondition {
    NotBondS {
        person: String,
    },
    Bond {
        person: String,
        level: Bond,
    },
    Date {
        from: Option<WorldDate>,
        to: Option<WorldDate>,
    },
    Flag {
        flag: String,
        #[serde(default = "yes")]
        value: bool,
    },
}
fn yes() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TieDef {
    pub a: String,
    pub b: String,
    pub kind: Relation,
    pub since: WorldDate,
    #[serde(default)]
    pub to: Option<WorldDate>,
    #[serde(default)]
    pub when: Vec<RelationCondition>,
    #[serde(default)]
    pub basis: String,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub story: Option<String>,
    #[serde(default)]
    pub open: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TieState {
    pub a: String,
    pub b: String,
    pub kind: Relation,
    pub since: WorldDate,
    pub open: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Affection {
    pub affinity: i64,
    pub heart: i64,
    pub relations: BTreeSet<Relation>,
    pub experiences: u32,
    pub bond: Option<Bond>,
}

impl World {
    pub fn affection(&self, person: &str) -> Option<&Affection> {
        self.state.cast.persons.get(person).map(|p| &p.affection)
    }

    pub fn validate_romance(&self, person: &str, action: RomanceAction) -> Result<(), CommandError> {
        let target = self.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
        let identity =
            self.state.protagonist.as_ref().ok_or_else(|| CommandError::Precondition("缺少确定性的主角身份".into()))?;
        if identity.protagonist.as_deref() == Some(person) || !self.person_alive(person) {
            return Err(CommandError::Precondition("不能与自己或已故人物进行恋爱互动".into()));
        }
        let protagonist = identity.protagonist.as_deref().and_then(|p| self.defs.cast.person(p));
        let player = RomanceActor {
            age: identity.age_on(self.cast_date()),
            born: Some(identity.born),
            gender: identity.gender,
            historical: false,
            authority: false,
            with: protagonist.map(|p| p.romance.with.as_slice()),
        };
        let target = actor(target, self.cast_date());
        let academy = self.state.cast.academy;
        let has_authority = self.affection(person).is_some_and(|v| v.relations.contains(&Relation::Mentor))
            || protagonist.is_some_and(|p| {
                declared_mentor(&self.defs.cast, &p.key, person, self.cast_date())
                    || self
                        .state
                        .cast
                        .ties
                        .iter()
                        .any(|t| t.kind == Relation::Mentor && same_pair(&t.a, &t.b, &p.key, person))
            });
        let target = RomanceActor { authority: target.authority || has_authority, ..target };
        romance_gate(&player, &target, action, academy).map_err(|e| CommandError::Precondition(e.to_string()))
    }

    pub fn visible_relations(&self, person: &str) -> Vec<Relation> {
        self.affection(person)
            .into_iter()
            .flat_map(|a| a.relations.iter().copied())
            .filter(|r| action(*r).is_none_or(|a| self.validate_romance(person, a).is_ok()))
            .collect()
    }

    pub fn change_affinity(&mut self, person: &str, value: i64) -> Result<(), CommandError> {
        if self.defs.cast.person(person).is_none() {
            return Err(CommandError::NotFound(person.into()));
        }
        let a = &mut self.state.cast.persons.entry(person.into()).or_default().affection;
        a.affinity = a.affinity.saturating_add(value).clamp(0, 100);
        Self::refresh_bond(a);
        Ok(())
    }

    pub(crate) fn refresh_bond(a: &mut Affection) {
        if a.bond == Some(Bond::S) {
            return;
        }
        a.bond = if a.affinity >= 80 && a.experiences >= 3 {
            Some(Bond::A)
        } else if a.affinity >= 50 && a.experiences >= 2 {
            Some(Bond::B)
        } else if a.affinity >= 20 && a.experiences >= 1 {
            Some(Bond::C)
        } else {
            None
        };
    }

    pub fn remember_experience(&mut self, person: &str) -> Result<(), CommandError> {
        if self.defs.cast.person(person).is_none() {
            return Err(CommandError::NotFound(person.into()));
        }
        let a = &mut self.state.cast.persons.entry(person.into()).or_default().affection;
        a.experiences = a.experiences.saturating_add(1);
        Self::refresh_bond(a);
        Ok(())
    }

    pub fn change_heart(&mut self, person: &str, value: i64) -> Result<(), CommandError> {
        self.validate_romance(person, RomanceAction::Heart)?;
        let a = &mut self.state.cast.persons.entry(person.into()).or_default().affection;
        a.heart = a.heart.saturating_add(value).clamp(0, 100);
        Ok(())
    }

    pub fn change_relation(&mut self, person: &str, relation: Relation, remove: bool) -> Result<(), CommandError> {
        if self.defs.cast.person(person).is_none() {
            return Err(CommandError::NotFound(person.into()));
        }
        if !remove {
            if let Some(action) = action(relation) {
                self.validate_romance(person, action)?;
            }
            if relation == Relation::Promise {
                return self.promise_to(person);
            }
        }
        let a = &mut self.state.cast.persons.entry(person.into()).or_default().affection;
        if remove {
            a.relations.remove(&relation);
        } else {
            a.relations.insert(relation);
        }
        Ok(())
    }

    pub fn promise_to(&mut self, person: &str) -> Result<(), CommandError> {
        if self.defs.cast.person(person).is_none() || !self.person_alive(person) {
            return Err(CommandError::NotFound(person.into()));
        }
        if self.state.cast.promise.as_deref() == Some(person) {
            return Ok(());
        }
        if self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(person) {
            return Err(CommandError::Precondition("不能与自己许下约定".into()));
        }
        if self.state.cast.promise.is_some()
            || self.state.cast.promises.contains_key(person)
            || self.declared_promise(person).is_some()
            || self.affection(person).and_then(|p| p.bond) != Some(Bond::A)
        {
            return Err(CommandError::Precondition("约定需要 A 级羁绊，每人一生只能有一位 S 级约定".into()));
        }
        self.state.cast.promise = Some(person.into());
        self.state.cast.promises.insert(person.into(), "$captain".into());
        let a = &mut self.state.cast.persons.entry(person.into()).or_default().affection;
        a.bond = Some(Bond::S);
        a.relations.insert(Relation::Promise);
        Ok(())
    }

    pub fn relation_conditions(&self, conditions: &[RelationCondition]) -> bool {
        conditions.iter().all(|c| match c {
            RelationCondition::NotBondS { person } => self.affection(person).and_then(|a| a.bond) != Some(Bond::S),
            RelationCondition::Bond { person, level } => {
                self.affection(person).and_then(|a| a.bond).is_some_and(|b| b >= *level)
            }
            RelationCondition::Date { from, to } => {
                from.is_none_or(|d| d <= self.cast_date()) && to.is_none_or(|d| self.cast_date() <= d)
            }
            RelationCondition::Flag { flag, value } => self.state.cast.flags.contains(flag) == *value,
        })
    }

    fn declared_promise(&self, person: &str) -> Option<&str> {
        self.defs.cast.ties.iter().find_map(|t| {
            (t.kind == Relation::Promise && t.since <= self.cast_date() && self.relation_conditions(&t.when))
                .then(|| {
                    if t.a == person {
                        Some(t.b.as_str())
                    } else if t.b == person {
                        Some(t.a.as_str())
                    } else {
                        None
                    }
                })
                .flatten()
        })
    }

    pub(crate) fn remember_cast_promises(&mut self) {
        let pairs: Vec<_> = self
            .defs
            .cast
            .ties
            .iter()
            .filter(|t| t.kind == Relation::Promise && t.since <= self.cast_date() && self.relation_conditions(&t.when))
            .map(|t| (t.a.clone(), t.b.clone()))
            .collect();
        for (a, b) in pairs {
            if self.state.cast.promises.get(&a).is_none_or(|p| p == &b)
                && self.state.cast.promises.get(&b).is_none_or(|p| p == &a)
            {
                self.state.cast.promises.insert(a.clone(), b.clone());
                self.state.cast.promises.insert(b, a);
            }
        }
    }

    pub fn active_ties(&self) -> Vec<TieState> {
        let mut ties: Vec<_> = self
            .defs
            .cast
            .ties
            .iter()
            .filter(|t| {
                !self.state.story2.removed_ties.contains(&(t.a.clone().min(t.b.clone()), t.a.clone().max(t.b.clone())))
                    && t.since <= self.cast_date()
                    && t.to.is_none_or(|to| self.cast_date() <= to)
                    && self.relation_conditions(&t.when)
                    && self.person_alive(&t.a)
                    && self.person_alive(&t.b)
                    && !self.state.cast.ties.iter().any(|s| same_pair(&t.a, &t.b, &s.a, &s.b))
                    && self.defs.cast.person(&t.a).zip(self.defs.cast.person(&t.b)).is_some_and(|(a, b)| {
                        initial_tie_gate_in(t, &self.defs.cast, self.cast_date()).is_ok()
                            && (a.kind == PersonKind::Historical
                                && b.kind == PersonKind::Historical
                                && t.kind == Relation::Partners
                                && t.basis == "historical"
                                && !t.sources.is_empty()
                                || action(t.kind)
                                    .is_none_or(|action| self.validate_tie_romance(&t.a, &t.b, action).is_ok()))
                    })
            })
            .map(|t| TieState { a: t.a.clone(), b: t.b.clone(), kind: t.kind, since: t.since, open: t.open })
            .collect();
        ties.extend(
            self.state
                .cast
                .ties
                .iter()
                .filter(|t| {
                    self.person_alive(&t.a)
                        && self.person_alive(&t.b)
                        && action(t.kind).is_none_or(|a| self.validate_tie_romance(&t.a, &t.b, a).is_ok())
                })
                .cloned(),
        );
        let graduated = self.graduated_ties();
        ties.retain(|t| !graduated.iter().any(|g| same_pair(&t.a, &t.b, &g.a, &g.b)));
        ties.extend(graduated);
        ties.sort_by(|a, b| (&a.a, &a.b, a.kind, a.since).cmp(&(&b.a, &b.b, b.kind, b.since)));
        ties
    }

    pub fn validate_tie_romance(&self, a: &str, b: &str, action: RomanceAction) -> Result<(), CommandError> {
        let a = self.defs.cast.person(a).ok_or_else(|| CommandError::NotFound(a.into()))?;
        let b = self.defs.cast.person(b).ok_or_else(|| CommandError::NotFound(b.into()))?;
        if a.key == b.key {
            return Err(CommandError::Precondition("人物关系不能指向自己".into()));
        }
        let mentor = declared_mentor(&self.defs.cast, &a.key, &b.key, self.cast_date())
            || self.state.cast.ties.iter().any(|t| t.kind == Relation::Mentor && same_pair(&t.a, &t.b, &a.key, &b.key));
        let mut left = actor(a, self.cast_date());
        left.authority |= mentor;
        romance_gate(&left, &actor(b, self.cast_date()), action, self.state.cast.academy)
            .map_err(|e| CommandError::Precondition(e.to_string()))
    }

    pub fn change_tie(&mut self, a: &str, b: &str, kind: Relation) -> Result<(), CommandError> {
        if a == b || !self.person_alive(a) || !self.person_alive(b) {
            return Err(CommandError::Precondition("关系双方必须是不同的在世人物".into()));
        }
        if let Some(action) = action(kind) {
            self.validate_tie_romance(a, b, action)?;
        }
        if kind == Relation::Promise {
            if self.state.cast.promises.get(a).is_some_and(|p| p != b)
                || self.state.cast.promises.get(b).is_some_and(|p| p != a)
                || self.declared_promise(a).is_some_and(|p| p != b)
                || self.declared_promise(b).is_some_and(|p| p != a)
            {
                return Err(CommandError::Precondition("每人一生只能有一位约定对象".into()));
            }
            self.state.cast.promises.insert(a.into(), b.into());
            self.state.cast.promises.insert(b.into(), a.into());
        }
        let since = self.cast_date();
        self.state.cast.ties.retain(|t| !same_pair(a, b, &t.a, &t.b));
        self.state.cast.ties.push(TieState { a: a.into(), b: b.into(), kind, since, open: false });
        self.state.cast.ties.sort_by(|a, b| (&a.a, &a.b).cmp(&(&b.a, &b.b)));
        Ok(())
    }

    pub(crate) fn valid_relations_snapshot(&self) -> bool {
        let cast = &self.state.cast;
        let pair_known = |a: &str, b: &str| !a.is_empty() && !b.is_empty() && a != b;
        if cast.graduation_day.is_some_and(|day| day > self.day())
            || (!cast.graduation_ties.is_empty() && cast.graduation_day.is_none())
        {
            return false;
        }
        if cast
            .persons
            .values()
            .any(|p| !(0..=100).contains(&p.affection.affinity) || !(0..=100).contains(&p.affection.heart))
            || cast.promise.as_ref().is_some_and(|p| {
                self.affection(p).and_then(|a| a.bond) != Some(Bond::S)
                    || cast.promises.get(p).map(String::as_str) != Some("$captain")
            })
            || cast.persons.iter().any(|(p, s)| s.affection.bond == Some(Bond::S) && cast.promise.as_ref() != Some(p))
            || cast.promises.iter().any(|(a, b)| {
                if b == "$captain" {
                    cast.promise.as_ref() != Some(a)
                } else {
                    !pair_known(a, b) || cast.promises.get(b) != Some(a)
                }
            })
        {
            return false;
        }
        let mut pairs = BTreeSet::new();
        cast.ties.iter().all(|t| {
            pair_known(&t.a, &t.b)
                && t.since <= self.cast_date()
                && self
                    .defs
                    .calendar
                    .day_of(crate::calendar::Date { year: t.since[0], month: t.since[1], day: t.since[2] })
                    .is_ok()
                && pairs.insert(if t.a < t.b { (&t.a, &t.b) } else { (&t.b, &t.a) })
        })
    }
}

fn same_pair(a: &str, b: &str, c: &str, d: &str) -> bool {
    (a == c && b == d) || (a == d && b == c)
}

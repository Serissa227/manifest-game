//! 目标只检查状态；交货在原子回应计划中扣除，超时与默认结算不收取玩家资源。
use super::{ChapterDef, Condition};
use crate::{World, calendar::Date, error::CommandError, ids::*, scenario::WorldDate};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Objective {
    pub text: Option<String>,
    #[serde(flatten)]
    pub kind: ObjectiveKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ObjectiveKind {
    Goods {
        good: String,
        qty: i64,
        at: String,
    },
    Item {
        item: String,
        qty: i64,
    },
    At {
        at: String,
    },
    Person {
        person: String,
    },
    Affinity {
        person: String,
        ge: i64,
    },
    Cash {
        ge: i64,
    },
    Fame {
        ge: i64,
    },
    Wait {
        days: u32,
    },
    Battle {
        wins: u32,
    },
    Discovery {
        discovery: String,
        #[serde(default)]
        reported: bool,
    },
    /// U04 工作包 5：属性档位（养成期为投影值；评价键也可）达到。
    Attr {
        attr: String,
        ge: i64,
    },
    /// U04 工作包 5：养成成长点达到。
    Growth {
        attr: String,
        ge: i64,
    },
    /// U04 工作包 5：技能经验达到。
    Skill {
        skill: String,
        ge: i64,
    },
    /// U04 工作包 5：与某人的羁绊到某级。
    Bond {
        person: String,
        level: crate::cast::relations::Bond,
    },
    Visited {
        at: Option<String>,
        ge: Option<u32>,
    },
    PortsKnown {
        ge: u32,
    },
    HouseLevel {
        at: Option<String>,
        ge: u32,
    },
    Warehouse {
        at: Option<String>,
        ge: Option<u32>,
    },
    Industries {
        at: Option<String>,
        industry: Option<String>,
        ge: u32,
    },
    Ships {
        ge: u32,
    },
    ShipTier {
        ge: u32,
    },
    Mates {
        ge: u32,
    },
    Post {
        post: String,
    },
    Rank {
        at: String,
        ge: u32,
    },
    Deed {
        deed: super::deeds::Deed,
        ge: u32,
        #[serde(default)]
        since_entered: bool,
    },
    Any {
        #[serde(deserialize_with = "deserialize_any")]
        any: Vec<ObjectiveKind>,
    },
}

// 白名单之外还包括目标枚举本身不接受的种类；在加载错误里保留 any 上下文。
fn deserialize_any<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Vec<ObjectiveKind>, D::Error> {
    Vec::<ObjectiveKind>::deserialize(deserializer)
        .map_err(|e| serde::de::Error::custom(format!("any 目标分支种类须在白名单内且结构有效：{e}")))
}

impl ObjectiveKind {
    /// 能写成通用条件的目标；交货、找人、海战、发现物等由目标检查自己处理，返回 None。
    pub fn condition(&self) -> Option<Condition> {
        use ObjectiveKind::*;
        Some(match self {
            Item { item, qty } => Condition::Item { item: item.clone(), qty: *qty },
            At { at } => Condition::At { at: at.clone(), person: None },
            Affinity { person, ge } => Condition::Affinity { person: person.clone(), ge: *ge },
            Cash { ge } => Condition::Cash { ge: *ge },
            Fame { ge } => Condition::Fame { ge: *ge },
            Wait { days } => Condition::Wait { days: *days },
            Attr { attr, ge } => Condition::Attr { attr: attr.clone(), ge: *ge },
            Growth { attr, ge } => Condition::Growth { attr: attr.clone(), ge: *ge },
            Skill { skill, ge } => Condition::Skill { skill: skill.clone(), ge: *ge },
            Bond { person, level } => Condition::Bond { person: person.clone(), level: *level },
            Visited { at, ge } => Condition::Visited { at: at.clone(), ge: *ge },
            PortsKnown { ge } => Condition::PortsKnown { ge: *ge },
            HouseLevel { at, ge } => Condition::HouseLevel { at: at.clone(), ge: *ge },
            Warehouse { at, ge } => Condition::Warehouse { at: at.clone(), ge: *ge },
            Industries { at, industry, ge } => {
                Condition::Industries { at: at.clone(), industry: industry.clone(), ge: *ge }
            }
            Ships { ge } => Condition::Ships { ge: *ge },
            ShipTier { ge } => Condition::ShipTier { ge: *ge },
            Mates { ge } => Condition::Mates { ge: *ge },
            Post { post } => Condition::Post { post: post.clone() },
            Rank { at, ge } => Condition::Rank { at: at.clone(), ge: *ge },
            Deed { deed, ge, since_entered } => Condition::Deed { deed: *deed, ge: *ge, since_entered: *since_entered },
            Any { any } => Condition::Any { any: any.iter().map(Self::condition).collect::<Option<Vec<_>>>()? },
            Goods { .. } | Person { .. } | Battle { .. } | Discovery { .. } => return None,
        })
    }
}

impl World {
    pub fn story2_day(&self, date: WorldDate) -> Option<u32> {
        let year = i64::from(date[0]) - self.defs.rules.world.start_year + 1;
        self.defs.calendar.day_of(Date { year: u32::try_from(year).ok()?, month: date[1], day: date[2] }).ok()
    }

    pub fn story2_deadline(&self, chapter: &ChapterDef, entered: u32) -> Option<u32> {
        chapter
            .deadline
            .and_then(|d| self.story2_day(d))
            .or_else(|| chapter.deadline_days.map(|d| entered.saturating_add(d)))
    }

    pub fn story2_objective_done(&self, objective: &Objective, entered: u32) -> bool {
        let track = self.objective_track(objective, entered);
        self.story2_objective_done_in(objective, entered, track)
    }

    pub fn story2_objective_done_in(&self, objective: &Objective, entered: u32, track: Option<&str>) -> bool {
        use ObjectiveKind::*;
        let condition =
            match &objective.kind {
                Goods { good, qty, at } => {
                    return self.defs.goods.iter().position(|g| g.key == *good).is_some_and(|i| {
                        self.fleets_of(OwnerId::Player)
                            .filter(|f| f.docked_at().is_some_and(|l| self.defs.loc(l).key == *at))
                            .fold(0i64, |sum, f| {
                                sum.saturating_add(f.cargo.get(&GoodId::from_idx(i)).copied().unwrap_or(0))
                            })
                            >= *qty
                    });
                }
                Item { item, qty } => Condition::Item { item: item.clone(), qty: *qty },
                At { at } => Condition::At { at: at.clone(), person: None },
                Person { person } => return self.person_here(person),
                Affinity { person, ge } => Condition::Affinity { person: person.clone(), ge: *ge },
                Cash { ge } => Condition::Cash { ge: *ge },
                Fame { ge } => Condition::Fame { ge: *ge },
                Wait { days } => Condition::Wait { days: *days },
                Attr { .. } | Growth { .. } | Skill { .. } | Bond { .. } => {
                    return objective.kind.condition().is_some_and(|c| self.story2_conditions(&[c], entered));
                }
                Visited { .. }
                | PortsKnown { .. }
                | HouseLevel { .. }
                | Warehouse { .. }
                | Industries { .. }
                | Ships { .. }
                | ShipTier { .. }
                | Mates { .. }
                | Post { .. }
                | Rank { .. }
                | Deed { .. }
                | Any { .. } => {
                    return objective.kind.condition().is_some_and(|c| self.story2_conditions_in(&[c], entered, track));
                }
                Battle { wins } => {
                    if self.defs.rules.quests.enabled {
                        return self.deed_have(super::deeds::Deed::BattleWin, true, track, entered) >= *wins;
                    }
                    return self
                        .state
                        .log
                        .iter()
                        .filter(|e| {
                            e.day >= entered
                                && matches!(
                                    e.kind,
                                    crate::log::LogKind::NavalBattle {
                                        owner: OwnerId::Player,
                                        result: crate::battle::BattleResult::Won,
                                        ..
                                    }
                                )
                        })
                        .count()
                        >= *wins as usize;
                }
                Discovery { discovery, reported } => {
                    return self.defs.discoveries.iter().position(|d| d.key == *discovery).is_some_and(|i| {
                        self.state.explore.discovered.get(&DiscoveryId::from_idx(i)).is_some_and(|_| {
                            !*reported || self.state.explore.reported.contains(&DiscoveryId::from_idx(i))
                        })
                    });
                }
            };
        self.story2_conditions(&[condition], entered)
    }

    pub fn story2_objectives_done(&self, chapter: &ChapterDef, entered: u32) -> bool {
        self.story2_objectives_done_in(chapter, entered, self.chapter_track(chapter, entered))
    }

    pub fn story2_objectives_done_in(&self, chapter: &ChapterDef, entered: u32, track: Option<&str>) -> bool {
        chapter.objectives.iter().all(|o| self.story2_objective_done_in(o, entered, track))
            && self.story2_delivery_plan(chapter).is_ok()
    }

    fn story2_delivery_plan(&self, chapter: &ChapterDef) -> Result<Vec<(FleetId, GoodId, i64)>, CommandError> {
        let mut required = BTreeMap::<(String, String), i64>::new();
        for o in &chapter.objectives {
            if let ObjectiveKind::Goods { good, qty, at } = &o.kind {
                if *qty <= 0 {
                    return Err(CommandError::InvalidQuantity);
                }
                let value = required.entry((at.clone(), good.clone())).or_default();
                *value = value.checked_add(*qty).ok_or(CommandError::InvalidQuantity)?;
            }
        }
        let mut result = Vec::new();
        for ((at, good), mut qty) in required {
            let good = self
                .defs
                .goods
                .iter()
                .position(|g| g.key == good)
                .map(GoodId::from_idx)
                .ok_or_else(|| CommandError::NotFound(good.clone()))?;
            let mut fleets: Vec<_> = self.fleets_of(OwnerId::Player).collect();
            fleets.sort_by_key(|f| f.id);
            for f in fleets.into_iter().filter(|f| f.docked_at().is_some_and(|l| self.defs.loc(l).key == at)) {
                let take = qty.min(f.cargo.get(&good).copied().unwrap_or(0));
                if take > 0 {
                    result.push((f.id, good, take));
                    qty -= take;
                }
            }
            if qty > 0 {
                return Err(CommandError::Precondition("交货目标的货物不足".into()));
            }
        }
        Ok(result)
    }

    pub(super) fn deliver_story2_objectives(&mut self, chapter: &ChapterDef) -> Result<(), CommandError> {
        for (fleet, good, qty) in self.story2_delivery_plan(chapter)? {
            crate::story::take_cargo(self, fleet, good, qty)?;
        }
        Ok(())
    }
}

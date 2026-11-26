//! 历史自己的条件扩展，避免改动人物与养成共用的故事枚举。
use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum Condition {
    History(HistoryCondition),
    Story(story2::Condition),
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HistoryCondition {
    History { event: String, outcome: Option<String> },
    CampaignVar { campaign: String, var: String, ge: Option<i64>, le: Option<i64> },
    CampaignVarHeld { campaign: String, var: String, ge: Option<i64>, le: Option<i64>, days: u32 },
    Any { conditions: Vec<Condition> },
}
impl Condition {
    pub(super) fn events(&self) -> Vec<&str> {
        match self {
            Self::History(HistoryCondition::History { event, .. }) => vec![event],
            Self::History(HistoryCondition::Any { conditions }) => conditions.iter().flat_map(Self::events).collect(),
            _ => Vec::new(),
        }
    }
}
impl crate::World {
    pub fn history_conditions(&self, event: &EventDef, conditions: &[Condition]) -> bool {
        let entered = event.window.and_then(|w| crate::scenario::day_of(&self.defs, w[0]).ok()).unwrap_or(0);
        conditions.iter().all(|c| match c {
            Condition::Story(c) => self.story2_conditions(std::slice::from_ref(c), entered),
            Condition::History(HistoryCondition::History { event, outcome }) => {
                self.history_outcome(event).is_some_and(|o| outcome.as_ref().is_none_or(|v| v == o))
            }
            Condition::History(HistoryCondition::CampaignVar { campaign, var, ge, le }) => self
                .campaign_value(campaign, var)
                .is_some_and(|v| ge.is_none_or(|n| v >= n) && le.is_none_or(|n| v <= n)),
            Condition::History(HistoryCondition::CampaignVarHeld { campaign, var, ge, le, days }) => {
                self.state
                    .history
                    .campaigns
                    .get(campaign)
                    .and_then(|s| s.held_since.get(&held_key(var, *ge, *le)))
                    .is_some_and(|start| self.day().saturating_sub(*start) >= *days)
                    && self
                        .campaign_value(campaign, var)
                        .is_some_and(|v| ge.is_none_or(|n| v >= n) && le.is_none_or(|n| v <= n))
            }
            Condition::History(HistoryCondition::Any { conditions }) => {
                conditions.iter().any(|c| self.history_conditions(event, std::slice::from_ref(c)))
            }
        })
    }
}
pub(super) fn valid(d: &crate::StaticData, c: &Condition) -> bool {
    valid_at(d, c, 0)
}
fn valid_at(d: &crate::StaticData, c: &Condition, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    match c {
        Condition::Story(c) => story2::validation::condition_error(d, c).is_none(),
        Condition::History(HistoryCondition::History { event, outcome }) => d
            .history
            .event(event)
            .is_some_and(|e| outcome.as_ref().is_none_or(|o| e.outcomes.iter().any(|v| &v.key == o))),
        Condition::History(
            HistoryCondition::CampaignVar { campaign, var, ge, le }
            | HistoryCondition::CampaignVarHeld { campaign, var, ge, le, .. },
        ) => {
            d.history.campaign(campaign).is_some_and(|c| c.vars.iter().any(|v| &v.key == var))
                && (ge.is_some() || le.is_some())
                && ge.iter().chain(le).all(|v| (0..=100).contains(v))
                && ge.zip(*le).is_none_or(|(lo, hi)| lo <= hi)
                && !matches!(c, Condition::History(HistoryCondition::CampaignVarHeld { days, .. }) if !(1..=36500).contains(days))
        }
        Condition::History(HistoryCondition::Any { conditions }) => {
            !conditions.is_empty() && conditions.len() <= 64 && conditions.iter().all(|c| valid_at(d, c, depth + 1))
        }
    }
}

pub(super) fn held_key(var: &str, ge: Option<i64>, le: Option<i64>) -> String {
    format!(
        "{var}:{}:{}",
        ge.map_or_else(|| "_".into(), |v| v.to_string()),
        le.map_or_else(|| "_".into(), |v| v.to_string())
    )
}

type HeldTests = BTreeMap<(String, String), (String, Option<i64>, Option<i64>)>;
/// 仅为实际用到的持续条件保存起点；旧世界不会增加序列化字段。
pub(super) fn held_tests(d: &crate::StaticData) -> HeldTests {
    fn visit(c: &Condition, out: &mut HeldTests) {
        match c {
            Condition::History(HistoryCondition::CampaignVarHeld { campaign, var, ge, le, .. }) => {
                out.insert((campaign.clone(), held_key(var, *ge, *le)), (var.clone(), *ge, *le));
            }
            Condition::History(HistoryCondition::Any { conditions }) => {
                for c in conditions {
                    visit(c, out);
                }
            }
            _ => {}
        }
    }
    let mut out = BTreeMap::new();
    for e in &d.history.events {
        for c in e
            .trigger
            .iter()
            .chain(e.outcome_rules.iter().flat_map(|r| &r.when))
            .chain(e.levers.iter().flat_map(|l| &l.requires))
        {
            visit(c, &mut out);
        }
    }
    out
}

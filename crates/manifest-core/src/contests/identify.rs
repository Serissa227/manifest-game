//! 辨识答案存于私有评分表，公开视图只有样品线索与候选名称。
use crate::CommandError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
    pub key: String,
    pub clues: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub key: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub samples: Vec<Sample>,
    pub answers: Vec<Answer>,
}
impl Params {
    pub fn validate(&self, correct: &BTreeMap<String, String>) -> bool {
        let text = |s: &str| !s.trim().is_empty() && s.len() <= 4096;
        (1..=64).contains(&self.samples.len())
            && (1..=64).contains(&self.answers.len())
            && self.samples.iter().map(|s| &s.key).collect::<BTreeSet<_>>().len() == self.samples.len()
            && self.answers.iter().map(|s| &s.key).collect::<BTreeSet<_>>().len() == self.answers.len()
            && self.answers.iter().all(|a| text(&a.key) && text(&a.name))
            && correct.len() == self.samples.len()
            && self.samples.iter().all(|s| {
                text(&s.key)
                    && (1..=16).contains(&s.clues.len())
                    && s.clues.iter().all(|c| text(c))
                    && correct.get(&s.key).is_some_and(|k| self.answers.iter().any(|a| &a.key == k))
            })
    }
    pub fn score(&self, correct: &BTreeMap<String, String>, moves: &[String]) -> Result<i64, CommandError> {
        if !self.validate(correct)
            || moves.len() != self.samples.len()
            || moves.iter().any(|k| !self.answers.iter().any(|a| &a.key == k))
        {
            return Err(CommandError::Precondition("辨识须为每个样品选择一个已知答案".into()));
        }
        let hits = self.samples.iter().zip(moves).filter(|(s, k)| correct.get(&s.key) == Some(*k)).count();
        Ok(100 * hits as i64 / self.samples.len() as i64)
    }
}

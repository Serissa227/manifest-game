//! 辩论按数据给出的克制表判分，每张论点牌只能打出一次。
use crate::CommandError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Argument {
    pub text: String,
    pub kind: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Round {
    pub opponent: Argument,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Card {
    pub key: String,
    pub text: String,
    pub kind: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub topic: String,
    pub rounds: Vec<Round>,
    pub hand: Vec<Card>,
    pub beats: Vec<[String; 2]>,
}
impl Params {
    pub fn validate(&self) -> bool {
        let text = |s: &str| !s.trim().is_empty() && s.len() <= 4096;
        let kinds = self
            .hand
            .iter()
            .map(|c| &c.kind)
            .chain(self.rounds.iter().map(|r| &r.opponent.kind))
            .collect::<BTreeSet<_>>();
        text(&self.topic)
            && (1..=32).contains(&self.rounds.len())
            && (self.rounds.len()..=64).contains(&self.hand.len())
            && self.hand.iter().map(|c| &c.key).collect::<BTreeSet<_>>().len() == self.hand.len()
            && self.hand.iter().all(|c| text(&c.key) && text(&c.text) && text(&c.kind))
            && self.rounds.iter().all(|r| text(&r.opponent.text) && text(&r.opponent.kind))
            && self.beats.len() <= 256
            && self.beats.iter().collect::<BTreeSet<_>>().len() == self.beats.len()
            && self.beats.iter().all(|[a, b]| {
                a != b && kinds.contains(a) && kinds.contains(b) && !self.beats.contains(&[b.clone(), a.clone()])
            })
    }
    pub fn score(&self, moves: &[String]) -> Result<i64, CommandError> {
        if !self.validate()
            || moves.len() != self.rounds.len()
            || moves.iter().collect::<BTreeSet<_>>().len() != moves.len()
        {
            return Err(CommandError::Precondition("辩论须每轮选择一张未使用的论点牌".into()));
        }
        let mut points = 0;
        for (round, key) in self.rounds.iter().zip(moves) {
            let card = self
                .hand
                .iter()
                .find(|c| &c.key == key)
                .ok_or_else(|| CommandError::Precondition("未知论点牌".into()))?;
            points += if self.beats.contains(&[card.kind.clone(), round.opponent.kind.clone()]) {
                100
            } else if self.beats.contains(&[round.opponent.kind.clone(), card.kind.clone()]) {
                0
            } else {
                50
            };
        }
        Ok(points / self.rounds.len() as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counters_ties_and_single_use_are_deterministic() {
        let p = Params {
            topic: "占位题目".into(),
            rounds: vec![Round { opponent: Argument { text: "占位论点".into(), kind: "a".into() } }; 2],
            hand: ["a", "b", "c"]
                .iter()
                .map(|k| Card { key: (*k).into(), text: "占位论点".into(), kind: (*k).into() })
                .collect(),
            beats: vec![["b".into(), "a".into()], ["a".into(), "c".into()]],
        };
        assert_eq!(p.score(&["b".into(), "a".into()]).unwrap(), 75);
        assert_eq!(p.score(&["c".into(), "a".into()]).unwrap(), 25);
        for bad in [vec![], vec!["b".into(); 2], vec!["b".into(), "missing".into()]] {
            assert!(p.score(&bad).is_err());
        }
        let mut bad = p.clone();
        bad.beats.push(["a".into(), "b".into()]);
        assert!(!bad.validate());
        let mut bad = p;
        bad.beats.push(["unknown".into(), "a".into()]);
        assert!(!bad.validate());
    }
}

//! 配对牌面使用独立随机流洗牌；已配对的牌不能重复得分。
use crate::{CommandError, rng::Rng};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub cols: u32,
    pub rows: u32,
    pub faces: Vec<String>,
    pub flips: u32,
}
impl Params {
    pub fn validate(&self) -> bool {
        let mut counts = BTreeMap::new();
        for face in &self.faces {
            *counts.entry(face).or_insert(0u32) += 1;
        }
        (1..=8).contains(&self.cols)
            && (1..=8).contains(&self.rows)
            && (2..=64).contains(&self.faces.len())
            && self.faces.len() == (self.cols * self.rows) as usize
            && counts.values().all(|n| *n == 2)
            && counts.keys().all(|s| !s.trim().is_empty() && s.len() <= 256)
            && (1..=256).contains(&self.flips)
    }
    pub fn shuffled(&self, rng: &mut Rng) -> Self {
        let mut params = self.clone();
        for i in (1..params.faces.len()).rev() {
            let j = rng.below(i as u64 + 1) as usize;
            params.faces.swap(i, j);
        }
        params
    }
    pub fn score(&self, moves: &[[u32; 2]]) -> Result<i64, CommandError> {
        if !self.validate() || moves.len() > self.flips as usize {
            return Err(CommandError::Precondition("配对牌面或翻牌次数无效".into()));
        }
        let mut solved = BTreeSet::new();
        for [a, b] in moves {
            if a == b || solved.contains(a) || solved.contains(b) {
                return Err(CommandError::Precondition("不能翻同一张牌或已经配对的牌".into()));
            }
            let (Some(left), Some(right)) = (self.faces.get(*a as usize), self.faces.get(*b as usize)) else {
                return Err(CommandError::Precondition("翻牌下标越界".into()));
            };
            if left == right {
                solved.extend([*a, *b]);
            }
        }
        Ok(100 * solved.len() as i64 / self.faces.len() as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Domain;
    fn params() -> Params {
        Params { cols: 2, rows: 2, faces: ["甲", "甲", "乙", "乙"].map(str::to_owned).to_vec(), flips: 3 }
    }
    #[test]
    fn shuffle_and_input_are_deterministic_and_each_pair_scores_once() {
        let a = params().shuffled(&mut Rng::derive(42, 9, Domain::Upbringing, 1, 0));
        let b = params().shuffled(&mut Rng::derive(42, 9, Domain::Upbringing, 1, 0));
        assert_eq!(a, b);
        assert!(a.validate());
        assert_eq!(params().score(&[[0, 2], [0, 1], [2, 3]]).unwrap(), 100);
        assert_eq!(params().score(&[[0, 1]]).unwrap(), 50);
        assert_eq!(params().score(&[]).unwrap(), 0);
        for bad in [vec![[0, 0]], vec![[0, 4]], vec![[0, 1], [0, 1]], vec![[0, 2]; 4]] {
            assert!(params().score(&bad).is_err());
        }
    }
    #[test]
    fn malformed_boards_are_rejected() {
        let mut p = params();
        p.faces.pop();
        assert!(!p.validate());
        let mut p = params();
        p.faces[0] = "丙".into();
        assert!(!p.validate());
        let mut p = params();
        p.cols = u32::MAX;
        assert!(!p.validate());
    }
}

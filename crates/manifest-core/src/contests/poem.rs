//! 作诗只记录每句选择的下标；评语词表和私有分值由数据明确给出。
use crate::CommandError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub prompt: String,
    pub options: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub theme: String,
    pub lines: Vec<Line>,
    pub hints: Vec<String>,
}
impl Params {
    pub fn validate(&self, points: &[Vec<i64>]) -> bool {
        let text = |s: &str| !s.trim().is_empty() && s.len() <= 4096;
        text(&self.theme)
            && (1..=32).contains(&self.lines.len())
            && self.hints.len() <= 32
            && self.hints.iter().all(|s| text(s))
            && points.len() == self.lines.len()
            && self.lines.iter().zip(points).all(|(line, points)| {
                text(&line.prompt)
                    && (1..=32).contains(&line.options.len())
                    && line.options.iter().all(|s| text(s))
                    && points.len() == line.options.len()
                    && points.iter().all(|p| (0..=100).contains(p))
                    && points.iter().any(|p| *p > 0)
            })
    }
    pub fn score(&self, points: &[Vec<i64>], moves: &[u32]) -> Result<i64, CommandError> {
        if !self.validate(points) || moves.len() != self.lines.len() {
            return Err(CommandError::Precondition("作诗须为每句选择一个词语".into()));
        }
        let mut earned = 0;
        let mut possible = 0;
        for (options, choice) in points.iter().zip(moves) {
            earned +=
                options.get(*choice as usize).ok_or_else(|| CommandError::Precondition("诗句选项下标越界".into()))?;
            possible += options.iter().copied().max().unwrap_or(1);
        }
        Ok(100 * earned / possible.max(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn form_score_is_bounded_and_input_covers_exactly_every_line() {
        let p = Params {
            theme: "占位".into(),
            hints: vec![],
            lines: vec![Line { prompt: "占位".into(), options: vec!["甲".into(), "乙".into()] }; 2],
        };
        let points = vec![vec![1, 4], vec![2, 6]];
        assert_eq!(p.score(&points, &[1, 1]).unwrap(), 100);
        assert_eq!(p.score(&points, &[0, 0]).unwrap(), 30);
        assert_eq!(p.score(&points, &[1, 0]).unwrap(), 60);
        for bad in [vec![], vec![1], vec![0, 2], vec![0, 1, 0], vec![u32::MAX, 0]] {
            assert!(p.score(&points, &bad).is_err());
        }
        assert!(!p.validate(&[vec![1], vec![1, 2]]));
        assert!(!p.validate(&[vec![0, 0], vec![1, 2]]));
    }
}

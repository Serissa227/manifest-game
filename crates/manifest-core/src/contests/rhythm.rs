//! 节奏输入是开始后的毫秒数；纯整数匹配，不读取现实时间。
use crate::CommandError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub bpm: u32,
    pub beats: Vec<u32>,
    pub window: u32,
}
impl Params {
    pub fn validate(&self) -> bool {
        (20..=300).contains(&self.bpm)
            && (1..=256).contains(&self.beats.len())
            && self.beats.windows(2).all(|p| p[0] < p[1])
            && self.beats.last().is_some_and(|last| *last <= 300_000)
            && (1..=1000).contains(&self.window)
    }
    pub fn score(&self, moves: &[u32]) -> Result<i64, CommandError> {
        if !self.validate() || moves.len() > 32_768 || moves.windows(2).any(|p| p[0] > p[1]) {
            return Err(CommandError::Precondition("节奏输入须按时间排列且不超过32768次按键".into()));
        }
        // 从早到晚配对，保证一次按键至多命中一个拍点；空拍也计入分母。
        let mut beat = 0;
        let mut hits = 0;
        for (index, time) in moves.iter().enumerate() {
            // 界面按整数毫秒记录；同毫秒的重复输入与收尾按键都算空拍。
            if index > 0 && moves[index - 1] == *time {
                continue;
            }
            while self.beats.get(beat).is_some_and(|b| b.saturating_add(self.window) < *time) {
                beat += 1;
            }
            if self.beats.get(beat).is_some_and(|b| b.abs_diff(*time) <= self.window) {
                hits += 1;
                beat += 1;
            }
        }
        Ok(100 * hits / (self.beats.len().max(moves.len()) as i64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_are_inclusive_and_extra_taps_cannot_farm_points() {
        let p = Params { bpm: 120, beats: vec![1000, 1500, 2000], window: 100 };
        assert_eq!(p.score(&[900, 1600, 2000]).unwrap(), 100);
        assert_eq!(p.score(&[899, 1601]).unwrap(), 0);
        assert_eq!(p.score(&[900, 1000, 1500, 2000]).unwrap(), 75);
        assert_eq!(p.score(&[1000]).unwrap(), 33);
        assert_eq!(p.score(&[]).unwrap(), 0);
        assert_eq!(p.score(&[1000, 1000]).unwrap(), 33);
        assert_eq!(p.score(&[900, 1600, 2000, 3200]).unwrap(), 75);
        assert_eq!(p.score(&[2101, u32::MAX]).unwrap(), 0);
        for bad in [vec![1500, 1000], vec![1000; 32_769]] {
            assert!(p.score(&bad).is_err());
        }
    }
    #[test]
    fn overlapping_windows_match_each_note_at_most_once() {
        let p = Params { bpm: 300, beats: vec![100, 200], window: 100 };
        assert_eq!(p.score(&[150]).unwrap(), 50);
        assert_eq!(p.score(&[150, 200]).unwrap(), 100);
        assert_eq!(p.score(&[150, 150]).unwrap(), 50);
        let mut invalid = p;
        invalid.beats = vec![100, 100];
        assert!(!invalid.validate());
    }
}

//! 题意分由作者给定，季语与韵脚按词表检查；总分归一到比赛的小游戏上限。
//!
//! 每句的分值 = 题意分 + 合季 2 + 押韵 2，再减去本句候选里的最低分（只有一个候选、或分值全同的句子不减）：
//! 一句里所有候选都合季、都押韵时，季语和韵脚分人人都有，不该把乱选的得分比例抬高；
//! 减去最低分以后，最差的候选得 0，归一后乱选的期望约为满分的一半。
use super::ContestDef;
use crate::{World, scenario::WorldDate};

impl World {
    pub fn contest_poem_points(&self, contest: &ContestDef, date: WorldDate) -> Vec<Vec<i64>> {
        let Some(poem) = &contest.poem else { return contest.scoring.line_points.clone() };
        if !poem.score_tags {
            return contest.scoring.line_points.clone();
        }
        let Some(lexicon) = self.defs.upbringing.poem_lexicons.iter().find(|l| l.key == poem.lexicon) else {
            return contest.scoring.line_points.clone();
        };
        let season = match date[1] {
            3..=5 => "spring",
            6..=8 => "summer",
            9..=11 => "autumn",
            _ => "winter",
        };
        contest
            .scoring
            .line_points
            .iter()
            .enumerate()
            .map(|(line, scores)| {
                let raw: Vec<i64> = scores
                    .iter()
                    .enumerate()
                    .map(|(index, theme)| {
                        let word = poem
                            .word_choices
                            .get(line)
                            .and_then(|v| v.get(index))
                            .and_then(|key| lexicon.words.iter().find(|w| &w.key == key));
                        let Some(word) = word else { return *theme };
                        let wanted_season = poem.scoring_seasons.get(line).map_or(season, String::as_str);
                        let wanted_rhyme = poem.scoring_rhymes.get(line).map(String::as_str).unwrap_or("");
                        theme
                            + if word.season == wanted_season { 2 } else { 0 }
                            + if !wanted_rhyme.is_empty() && word.rhyme == wanted_rhyme { 2 } else { 0 }
                    })
                    .collect();
                let floor = raw.iter().copied().min().unwrap_or(0);
                // 只有一个候选、或候选分值全相同的句子没有优劣可言，保留原值（校验要求每句至少一个正分）。
                if raw.len() < 2 || raw.iter().all(|p| *p == floor) {
                    return raw;
                }
                raw.into_iter().map(|p| p - floor).collect()
            })
            .collect()
    }
}

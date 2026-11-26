//! 作诗词表逐下标翻译，只覆盖文本，不改变选项位置或评分。
use super::{FileSpec, Slot, entry};
use manifest_core::{contests::Params, upbringing::UpbringingDefs};
pub(super) fn fields(spec: FileSpec, defs: &UpbringingDefs, source: &str) -> FileSpec {
    let mut texts = Vec::new();
    for (i, c) in defs.contests.iter().enumerate().filter(|(_, c)| c.source == source) {
        let Params::Poem(p) = &c.params else { continue };
        texts.push(entry(&format!("{}:theme", c.key), Slot::ContestPoemTheme(i), &[("text", &p.theme)]));
        for (j, hint) in p.hints.iter().enumerate() {
            texts.push(entry(&format!("{}:hint:{j}", c.key), Slot::ContestPoemHint(i, j), &[("text", hint)]));
        }
        for (j, line) in p.lines.iter().enumerate() {
            texts.push(entry(&format!("{}:line:{j}", c.key), Slot::ContestPoemPrompt(i, j), &[("text", &line.prompt)]));
            for (k, option) in line.options.iter().enumerate() {
                texts.push(entry(
                    &format!("{}:line:{j}:option:{k}", c.key),
                    Slot::ContestPoemOption(i, j, k),
                    &[("text", option)],
                ));
            }
        }
    }
    let mut debate = Vec::new();
    for (i, c) in defs.contests.iter().enumerate().filter(|(_, c)| c.source == source) {
        let Params::Debate(p) = &c.params else { continue };
        debate.push(entry(&format!("{}:topic", c.key), Slot::ContestDebateTopic(i), &[("text", &p.topic)]));
        for (j, r) in p.rounds.iter().enumerate() {
            debate.push(entry(
                &format!("{}:round:{j}", c.key),
                Slot::ContestDebateOpponent(i, j),
                &[("text", &r.opponent.text)],
            ));
        }
        for (j, c0) in p.hand.iter().enumerate() {
            debate.push(entry(
                &format!("{}:card:{}", c.key, c0.key),
                Slot::ContestDebateCard(i, j),
                &[("text", &c0.text)],
            ));
        }
    }
    let mut race = Vec::new();
    for (i, c) in defs.contests.iter().enumerate().filter(|(_, c)| c.source == source) {
        let Params::Race(p) = &c.params else { continue };
        for (j, l) in p.legs.iter().enumerate() {
            race.push(entry(&format!("{}:leg:{j}", c.key), Slot::ContestRaceLeg(i, j), &[("text", &l.text)]));
            for (k, o) in l.options.iter().enumerate() {
                race.push(entry(
                    &format!("{}:leg:{j}:option:{}", c.key, o.key),
                    Slot::ContestRaceOption(i, j, k),
                    &[("text", &o.text)],
                ));
            }
        }
    }
    let mut identify = Vec::new();
    for (i, c) in defs.contests.iter().enumerate().filter(|(_, c)| c.source == source) {
        let Params::Identify(p) = &c.params else { continue };
        for (j, s) in p.samples.iter().enumerate() {
            for (k, clue) in s.clues.iter().enumerate() {
                identify.push(entry(
                    &format!("{}:sample:{}:clue:{k}", c.key, s.key),
                    Slot::ContestIdentifyClue(i, j, k),
                    &[("text", clue)],
                ));
            }
        }
        for (j, a) in p.answers.iter().enumerate() {
            identify.push(entry(
                &format!("{}:answer:{}", c.key, a.key),
                Slot::ContestIdentifyAnswer(i, j),
                &[("name", &a.name)],
            ));
        }
    }
    spec.table("identify_texts", identify)
        .table("poem_texts", texts)
        .table("debate_texts", debate)
        .table("race_texts", race)
}

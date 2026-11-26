//! 作者的计分与诗词附表；这些字段不投影到 I6 的公开参数。
use super::*;
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub at: String,
    pub dates: Vec<WorldDate>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ContestUnlock {
    pub weather: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoemLexicon {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub words: Vec<PoemWord>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoemWord {
    pub key: String,
    pub text: String,
    pub source: String,
    pub image: String,
    pub rhyme: String,
    pub season: String,
    #[serde(default)]
    pub syllables: Option<u32>,
    #[serde(default)]
    pub mora: Option<u32>,
    #[serde(default)]
    pub tone: Option<String>,
    #[serde(default)]
    pub line_group: Option<u32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoemMetadata {
    #[serde(default)]
    pub score_tags: bool,
    #[serde(default)]
    pub scoring_seasons: Vec<String>,
    #[serde(default)]
    pub scoring_rhymes: Vec<String>,
    pub lexicon: String,
    pub word_choices: Vec<Vec<String>>,
    #[serde(default)]
    pub compose: PoemCompose,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PoemCompose {
    pub source: String,
    pub line_syllables: Vec<u32>,
    pub rhyme: Option<PoemRhyme>,
    pub rhyme_lines: Vec<u32>,
    pub source_suffixes: Vec<String>,
    pub tone_check: bool,
    pub mora: Vec<u32>,
    pub note: Option<String>,
    pub qafia: Vec<String>,
    pub radif: Option<String>,
    pub stock: Option<String>,
    pub roles: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum PoemRhyme {
    One(String),
    Lines(Vec<String>),
}

pub(super) fn validate(d: &crate::StaticData) -> Vec<String> {
    use std::collections::BTreeSet;
    let mut errors = Vec::new();
    let mut lexicons = BTreeSet::new();
    for l in &d.upbringing.poem_lexicons {
        let mut words = BTreeSet::new();
        if l.key.is_empty()
            || !lexicons.insert(&l.key)
            || l.words.is_empty()
            || l.words.iter().any(|w| w.key.is_empty() || !words.insert(&w.key) || w.text.is_empty())
        {
            errors.push(format!("{}: 诗词表为空或键重复", l.key));
        }
    }
    for c in &d.upbringing.contests {
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("{}: {message}", c.key));
            }
        };
        let mut places = BTreeSet::new();
        check(
            c.bindings.iter().all(|b| {
                places.insert(&b.at)
                    && d.locations.iter().any(|l| l.key == b.at)
                    && !b.dates.is_empty()
                    && b.dates.windows(2).all(|w| w[0] < w[1])
                    && b.dates.iter().all(|v| c.dates.contains(v))
            }),
            "比赛地点排期重复或悬空",
        );
        check(
            c.bindings.is_empty() || c.dates.iter().all(|v| c.bindings.iter().any(|b| b.dates.contains(v))),
            "比赛日期没有地点",
        );
        check(c.unlock.weather.as_deref().is_none_or(|w| w == "safe_ice"), "未知天气门槛");
        if let Some(kind) = &c.scoring.authored_kind {
            let expected = match c.kind {
                Kind::Match => "pairs",
                Kind::Poem => "theme_and_form",
                Kind::Rhythm => "nearest_unused_beat",
                Kind::Debate => "beats_table",
                Kind::Race => "seeded_risk",
                Kind::Identify => "answer_key",
            };
            check(kind == expected, "作者计分种类与小游戏不符");
            let points = [
                &c.scoring.points_per_pair,
                &c.scoring.points_per_hit,
                &c.scoring.points_per_win,
                &c.scoring.points_per_correct,
            ];
            check(points.iter().all(|p| p.is_none_or(|v| (1..=30).contains(&v))), "命中分值越界");
            let selected = match c.kind {
                Kind::Match => c.scoring.points_per_pair,
                Kind::Rhythm => c.scoring.points_per_hit,
                Kind::Debate => c.scoring.points_per_win,
                Kind::Identify => c.scoring.points_per_correct,
                _ => Some(1),
            };
            check(selected.is_some(), "作者计分缺少命中分值");
            if let (Params::Race(p), Some(t)) = (&c.params, &c.scoring.race) {
                check(
                    p.legs.iter().flat_map(|l| &l.options).map(|o| &o.key).collect::<BTreeSet<_>>()
                        == t.option_points.keys().collect::<BTreeSet<_>>()
                        && t.option_points.values().all(|v| (0..=30).contains(v))
                        && (0..=30).contains(&t.failed_leg_points),
                    "竞渡选项计分无效",
                );
            }
        }
        if let Some(poem) = &c.poem {
            check(
                !poem.score_tags || c.scoring.line_points.iter().flatten().all(|p| *p <= 96),
                "题意分须为季语和韵脚预留四分",
            );
            check(
                poem.scoring_seasons.is_empty() || poem.scoring_seasons.len() == poem.word_choices.len(),
                "诗会季语规则行数不符",
            );
            check(
                poem.scoring_rhymes.is_empty() || poem.scoring_rhymes.len() == poem.word_choices.len(),
                "诗会韵脚规则行数不符",
            );
            check(
                matches!(&c.params, Params::Poem(p) if p.lines.len() == poem.word_choices.len()
                && p.lines.iter().zip(&poem.word_choices).enumerate().all(|(i,(l,w))|
                    l.options.len() == w.len()
                    || i + 1 == p.lines.len() && w.is_empty() && l.options.len() == 1
                        && poem.compose.stock.as_ref().is_some_and(|stock| !stock.trim().is_empty()
                            && l.options.first().is_some_and(|option| option.contains(stock))))),
                "诗词选项行数不匹配",
            );
            check(
                d.upbringing
                    .poem_lexicons
                    .iter()
                    .find(|l| l.key == poem.lexicon)
                    .is_some_and(|l| poem.word_choices.iter().flatten().all(|k| l.words.iter().any(|w| &w.key == k))),
                "诗词表或词条不存在",
            );
        }
    }
    errors
}

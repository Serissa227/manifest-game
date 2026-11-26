//! I6 追加：比赛小游戏的预估（照现在的输入能加几分、约多少能赢）与结算后的讲解（名次是怎么来的）。
//! 预估与 `PlayContest` 结算同一套算法：输入完整时加分直接取内核的 `contest_play`，胜算用与“按实力约 N% 能赢”同一个公式
//! （实力分加上小游戏的加分，对手按本场的年龄组区间取分）；输入还不完整时，没选的那几步按 0 分算，选齐时与结算一致。
//! 作诗的每句分值取内核的 `contest_poem_points`（启用季语、韵脚计分的诗会按本场日期算，与结算相同）。
//! 结算前不给的：辨识的答案（私有评分表）、竞渡每一程失不失手（由比赛实例的种子决定）——竞渡按失手的概率算期望与胜算。
use super::contest::{SCALE, auto_win_pct, win_sum};
use super::*;
use manifest_core::contests::{ContestDef, Moves, Params, race};
use std::collections::BTreeMap;

fn bad() -> CommandError {
    CommandError::Precondition("小游戏输入形状与比赛种类不符".into())
}

/// 前端送来的输入：每一步一个 JSON 值（作诗是下标、辩论 / 竞渡 / 辨识是 key，没选的一步是 null；配对是两张牌的下标、节奏是毫秒）。
fn parse<T: serde::de::DeserializeOwned>(moves: &[Value]) -> Result<Vec<T>, CommandError> {
    moves.iter().map(|m| serde_json::from_value(m.clone()).map_err(|_| bad())).collect()
}

/// 每一步（作诗的一句、辩论的一回合、竞渡的一程）的加分：got 是这一步拿到的，best 是这一步最多能拿的（都按加在实力上的分计）。
fn step(got: i64, best: i64) -> Value {
    json!({"got":got,"best":best})
}

/// 辩论：我的论点压过对方 → 1，被对方压过 → −1，其余 0（内核 debate::Params::score 的同一张克制表）。
fn edge(p: &manifest_core::contests::debate::Params, mine: &str, theirs: &str) -> i64 {
    if p.beats.contains(&[mine.to_owned(), theirs.to_owned()]) {
        1
    } else if p.beats.contains(&[theirs.to_owned(), mine.to_owned()]) {
        -1
    } else {
        0
    }
}

/// 竞渡怎么折成加分：作者给了每种走法的分（成功拿走法分、失手拿失手分，都乘这一程走了几成）；
/// 作者计分但没给走法分（恒为 0）；不是作者计分（各程成绩平均后按比例折算，失手的一程成绩减半）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum RaceMode {
    Points,
    Zero,
    Share,
}

/// 竞渡的一程：成功与失手时“原始值”（Points 是加分，Share 是这一程的成绩）与失手的概率（万分之几）。
struct RaceLeg {
    win: i64,
    lose: i64,
    risk: i64,
}

fn race_mode(c: &ContestDef, track: &race::Track) -> RaceMode {
    match (c.scoring.authored_kind.is_some(), track.option_points.is_empty()) {
        (true, false) => RaceMode::Points,
        (true, true) => RaceMode::Zero,
        (false, _) => RaceMode::Share,
    }
}

/// 一程的成功 / 失手原始值（与 race::Params::run 的累计方式相同）。
fn race_leg(mode: RaceMode, track: &race::Track, option: &race::OptionDef, course: i64) -> RaceLeg {
    let (win, lose) = match mode {
        RaceMode::Points => (
            track.option_points.get(&option.key).copied().unwrap_or(0) * course / 100,
            track.failed_leg_points * course / 100,
        ),
        RaceMode::Zero => (0, 0),
        RaceMode::Share => (course, course / 2),
    };
    RaceLeg { win, lose, risk: option.risk.clamp(0, 10_000) }
}

/// 原始值折成加分（Share 的每一程大约占多少加分，只用来显示；总的加分照内核的公式算）。
fn race_show(mode: RaceMode, raw: i64, legs: i64, max: i64) -> i64 {
    match mode {
        RaceMode::Points => raw,
        RaceMode::Zero => 0,
        RaceMode::Share => raw * max / (100 * legs.max(1)),
    }
}

/// 各程成功或失手的所有组合：加分 → 概率。没选的一程不计（按 0 分）。
fn race_bonus(mode: RaceMode, legs: &[RaceLeg], count: i64, max: i64) -> BTreeMap<i64, f64> {
    let mut sums = BTreeMap::from([(0_i64, 1.0_f64)]);
    for leg in legs {
        let fail = leg.risk as f64 / 10_000.0;
        let mut next = BTreeMap::new();
        for (sum, p) in sums {
            *next.entry(sum + leg.win).or_insert(0.0) += p * (1.0 - fail);
            *next.entry(sum + leg.lose).or_insert(0.0) += p * fail;
        }
        sums = next.into_iter().filter(|(_, p)| *p > 0.0).collect();
    }
    let mut bonus = BTreeMap::new();
    for (sum, p) in sums {
        let b = match mode {
            RaceMode::Points => sum.clamp(0, max),
            RaceMode::Zero => 0,
            RaceMode::Share => sum / count.max(1) * max / 100,
        };
        *bonus.entry(b).or_insert(0.0) += p;
    }
    bonus
}

/// 照现在的输入：加分、胜算、每一步的加分（I6 追加 `contest_preview`）。只读，不结算、不推进随机数。
pub fn contest_preview(_ctx: Ctx<'_>, w: &World, key: &str, moves: &[Value]) -> Result<Value, CommandError> {
    let (c, date) = w.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
    if !w.contest_open(c, date) {
        return Err(CommandError::Precondition("比赛尚未开放、地点不符或已经结算".into()));
    }
    let strength = w.contest_strength(c);
    let rivals = c.rivals.len();
    let range = w.contest_rival_range(c, date);
    let max = c.scoring.max_bonus;
    // 与内核 authored_contest_bonus 相同：启用季语、韵脚计分的诗会不走作者逐项计分，按得分比例折成加分
    let authored = c.scoring.authored_kind.is_some() && !c.poem.as_ref().is_some_and(|p| p.score_tags);
    let pct = |bonus: i64| auto_win_pct(strength + bonus, rivals, range);
    let mut steps: Vec<Value> = Vec::new();
    let mut options: Vec<Value> = Vec::new();
    let mut unit = None;
    // （加分, 胜算, 小游戏拿满时的加分, 能不能交卷）；辨识的加分与胜算结算前不给
    let (bonus, chance, best, ready) = match w.contest_params(key)? {
        Params::Match(p) => {
            let pairs = parse::<[u32; 2]>(moves)?;
            unit = c.scoring.points_per_pair.filter(|_| authored);
            let most = (p.faces.len() / 2).min(p.flips as usize) as i64;
            let best = unit.map_or(max, |u| (u * most).min(max));
            let b = w.contest_play(key, &Moves::Pairs(pairs.clone()))?.bonus;
            (Some(b), Some(pct(b)), best, !pairs.is_empty())
        }
        Params::Rhythm(p) => {
            let taps = parse::<u32>(moves)?;
            unit = c.scoring.points_per_hit.filter(|_| authored);
            let best = unit.map_or(max, |u| (u * p.beats.len() as i64).min(max));
            let b = w.contest_play(key, &Moves::Choices(taps))?.bonus;
            (Some(b), Some(pct(b)), best, true)
        }
        Params::Poem(p) => {
            let picks = parse::<Option<u32>>(moves)?;
            if picks.len() != p.lines.len() {
                return Err(bad());
            }
            let points = w.contest_poem_points(c, date);
            let line = |i: usize| points.get(i).map_or(&[][..], Vec::as_slice);
            // 与 poem::Params::score 相同：满分是每句最高分之和
            let possible = (0..p.lines.len()).map(|i| line(i).iter().copied().max().unwrap_or(1)).sum::<i64>().max(1);
            let show = |raw: i64| if authored { raw } else { raw * max / possible };
            let mut earned = 0;
            for (i, pick) in picks.iter().enumerate() {
                let top = line(i).iter().copied().max().unwrap_or(0);
                steps.push(match pick {
                    Some(j) => {
                        let got = *line(i).get(*j as usize).ok_or_else(bad)?;
                        earned += got;
                        step(show(got), show(top))
                    }
                    None => Value::Null,
                });
            }
            let ready = picks.iter().all(Option::is_some);
            let b = if ready {
                w.contest_play(key, &Moves::Choices(picks.iter().flatten().copied().collect()))?.bonus
            } else if authored {
                earned.clamp(0, max)
            } else {
                100 * earned / possible * max / 100
            };
            (Some(b), Some(pct(b)), if authored { possible.min(max) } else { max }, ready)
        }
        Params::Debate(p) => {
            let plays = parse::<Option<String>>(moves)?;
            if plays.len() != p.rounds.len() {
                return Err(bad());
            }
            let rounds = p.rounds.len().max(1) as i64;
            unit = c.scoring.points_per_win.filter(|_| authored);
            let per_win = c.scoring.points_per_win.unwrap_or(0);
            let (mut raw, mut wins) = (0, 0);
            for (round, play) in p.rounds.iter().zip(&plays) {
                let Some(card) = play else {
                    steps.push(Value::Null);
                    continue;
                };
                let card = p.hand.iter().find(|h| &h.key == card).ok_or_else(bad)?;
                let e = edge(&p, &card.kind, &round.opponent.kind);
                let points = match e {
                    1 => 100,
                    0 => 50,
                    _ => 0,
                };
                raw += points;
                wins += i64::from(e == 1);
                let (got, top) = if authored {
                    (if e == 1 { per_win } else { 0 }, per_win)
                } else {
                    (points * max / (100 * rounds), max / rounds)
                };
                steps.push(json!({"got":got,"best":top,"edge":e}));
            }
            let ready = plays.iter().all(Option::is_some);
            let b = if ready {
                w.contest_play(key, &Moves::Keys(plays.iter().flatten().cloned().collect()))?.bonus
            } else if authored {
                (wins * per_win).clamp(0, max)
            } else {
                raw / rounds * max / 100
            };
            (Some(b), Some(pct(b)), if authored { (per_win * rounds).min(max) } else { max }, ready)
        }
        Params::Identify(p) => {
            let answers = parse::<Option<String>>(moves)?;
            if answers.len() != p.samples.len()
                || answers.iter().flatten().any(|k| !p.answers.iter().any(|a| &a.key == k))
            {
                return Err(bad());
            }
            unit = c.scoring.points_per_correct.filter(|_| authored);
            let best = unit.map_or(max, |u| (u * p.samples.len() as i64).min(max));
            steps = answers.iter().map(|_| Value::Null).collect();
            (None, None, best, answers.iter().all(Option::is_some))
        }
        Params::Race(p) => {
            let picks = parse::<Option<String>>(moves)?;
            if picks.len() != p.legs.len() {
                return Err(bad());
            }
            let track = c.scoring.race.as_ref().ok_or_else(|| CommandError::Precondition("竞渡缺少赛道".into()))?;
            let mode = race_mode(c, track);
            let count = p.legs.len() as i64;
            let seed = w.contest_seed(key);
            // 航迹只由走法决定：没选的一程先用第一种走法补上（只影响它自己和后面的程，不影响已经选了的前几程）
            let course = |extra: Option<(usize, &str)>| -> Result<Vec<i64>, CommandError> {
                let moves = p
                    .legs
                    .iter()
                    .enumerate()
                    .map(|(i, leg)| match extra {
                        Some((k, o)) if k == i => Ok(o.to_owned()),
                        _ => picks[i].clone().or_else(|| leg.options.first().map(|o| o.key.clone())).ok_or_else(bad),
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(p.run(track, w, seed, &moves)?.legs.iter().map(|l| l.score).collect())
            };
            let scores = course(None)?;
            let mut chosen = Vec::new();
            for (i, (leg, pick)) in p.legs.iter().zip(&picks).enumerate() {
                let top = leg
                    .options
                    .iter()
                    .map(|o| race_show(mode, race_leg(mode, track, o, 100).win, count, max))
                    .max()
                    .unwrap_or(0);
                let Some(pick) = pick else {
                    steps.push(Value::Null);
                    continue;
                };
                let option = leg.options.iter().find(|o| &o.key == pick).ok_or_else(bad)?;
                let l = race_leg(mode, track, option, scores.get(i).copied().unwrap_or(0));
                let (win, lose) = (race_show(mode, l.win, count, max), race_show(mode, l.lose, count, max));
                let expect = (win * (10_000 - l.risk) + lose * l.risk + 5_000) / 10_000;
                steps.push(json!({"got":expect,"best":top,"win":win,"lose":lose,"risk":l.risk}));
                chosen.push(l);
            }
            // 正在选的这一程：每种走法成功 / 失手各加几分（各自的航迹分别算）
            if let Some(k) = picks.iter().position(Option::is_none) {
                for o in &p.legs[k].options {
                    let s = course(Some((k, &o.key)))?.get(k).copied().unwrap_or(0);
                    let l = race_leg(mode, track, o, s);
                    options.push(json!({"key":o.key,"win":race_show(mode,l.win,count,max),
                        "lose":race_show(mode,l.lose,count,max),"risk":l.risk}));
                }
            }
            let outcomes = race_bonus(mode, &chosen, count, max);
            let (b, chance) = if outcomes.len() == 1 {
                let b = outcomes.keys().next().copied().unwrap_or(0);
                (b, pct(b))
            } else {
                let expect = outcomes.iter().map(|(b, p)| *b as f64 * p).sum::<f64>();
                let win = outcomes.iter().map(|(b, p)| win_sum(strength + b, rivals, range) as f64 * p).sum::<f64>();
                (expect.round() as i64, (win * 100.0 / (SCALE as f64 * 21.0)).round() as i64)
            };
            let best = match mode {
                RaceMode::Points => p
                    .legs
                    .iter()
                    .map(|l| {
                        l.options
                            .iter()
                            .map(|o| track.option_points.get(&o.key).copied().unwrap_or(0))
                            .max()
                            .unwrap_or(0)
                    })
                    .sum::<i64>()
                    .min(max),
                RaceMode::Zero => 0,
                RaceMode::Share => max,
            };
            (Some(b), Some(chance), best, picks.iter().all(Option::is_some))
        }
    };
    Ok(json!({"strength":strength,"max_bonus":max,"best_bonus":best,"unit":unit,"bonus":bonus,"pct":chance,
        "base_pct":pct(0),"best_pct":pct(best),"ready":ready,"steps":steps,"options":options}))
}

/// 交卷时的输入（完整的）换成内核的 Moves。
fn to_moves(params: &Params, moves: &[Value]) -> Result<Moves, CommandError> {
    Ok(match params {
        Params::Match(_) => Moves::Pairs(parse(moves)?),
        Params::Poem(_) | Params::Rhythm(_) => Moves::Choices(parse(moves)?),
        Params::Debate(_) | Params::Race(_) | Params::Identify(_) => Moves::Keys(parse(moves)?),
    })
}

/// 已经结算的比赛：各人的分（与结算同一串随机数重算）、主角的临场发挥、小游戏的加分；
/// 给了交卷时的输入，再讲到每一步（辨识每份认得对不对、竞渡每一程失没失手）。
pub fn contest_outcome(ctx: Ctx<'_>, w: &World, key: &str, moves: Option<&[Value]>) -> Result<Value, CommandError> {
    let (c, date) = w.contest_occurrence(key).ok_or_else(|| CommandError::NotFound(key.into()))?;
    let result = w
        .state
        .upbringing
        .as_ref()
        .and_then(|s| s.contest_results.get(key))
        .ok_or_else(|| CommandError::Precondition("比赛还没有结算".into()))?;
    let draws = w.contest_draws(c, date, key);
    // 名次表：与 settle_contest 同样的排法（分高在前，同分看随机先后，再按键）
    let mut field = vec![(result.score, draws.tiebreak, "$captain".to_owned())];
    field.extend(draws.rivals.iter().map(|(k, s, t)| (*s, *t, k.clone())));
    field.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)).then_with(|| a.2.cmp(&b.2)));
    let field = field
        .iter()
        .map(|(score, _, who)| {
            let you = who == "$captain";
            let name = (!you).then(|| ctx.names.cast.person(who).map_or(who.as_str(), |p| p.name.as_str()));
            json!({"key":who,"name":name,"score":score,"you":you})
        })
        .collect::<Vec<_>>();
    let mut steps = Vec::new();
    let bonus = match (result.game_score, moves) {
        // 按实力结算：没有小游戏的加分
        (None, _) => Some(0),
        (Some(_), Some(moves)) => {
            let params = w.contest_params(key)?;
            let mv = to_moves(&params, moves)?;
            let play = w.contest_play(key, &mv)?;
            match (&params, &mv) {
                (Params::Identify(p), Moves::Keys(answers)) => {
                    for (s, a) in p.samples.iter().zip(answers) {
                        let right = c.scoring.answers.get(&s.key);
                        steps.push(json!({"correct":right == Some(a),"answer":right}));
                    }
                }
                (Params::Race(p), Moves::Keys(choices)) => {
                    let track =
                        c.scoring.race.as_ref().ok_or_else(|| CommandError::Precondition("竞渡缺少赛道".into()))?;
                    for leg in p.run(track, w, w.contest_seed(key), choices)?.legs {
                        steps.push(json!({"failed":leg.failed,"course":leg.score}));
                    }
                }
                _ => {}
            }
            Some(play.bonus)
        }
        (Some(_), None) => None,
    };
    // 实力分 = 总分 − 小游戏加分 − 临场；总分碰到 0 或 125 的边时可能被截过，不倒推
    let strength = bonus.map(|b| result.score - b - draws.jitter).filter(|_| (1..125).contains(&result.score));
    Ok(json!({"rank":result.rank,"total":result.total,"score":result.score,"game_score":result.game_score,
        "jitter":draws.jitter,"bonus":bonus,"strength":strength,"field":field,"steps":steps}))
}

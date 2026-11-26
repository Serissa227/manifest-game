//! I6 追加的比赛预估与结算讲解：预估的加分、胜算与真实结算同一套算法；查询只读；结算前不泄露辨识答案与竞渡的失手。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    Cell, Command, OwnerId, ScenarioId, StaticData, World,
    contests::{ContestDef, Kind, Moves, Params, occurrence_key, race},
    navigation::Sail,
    upbringing::{AfterChoice, PlanSlot},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc};

/// 统计检查换多少个种子（样本标准差约 1 个百分点）
const N: u64 = 2048;

/// 占位比赛 test_match 这一场的日期（结算的抽签按它取本场的对手区间）
const DATE: [u32; 3] = [1553, 1, 5];

fn key() -> String {
    occurrence_key("test_match", DATE)
}

/// testbed 的养成剧本，把占位比赛 test_match 改成要测的样子（实力抬到中段，胜算才看得出差别）。数据只读一次，换种子时共用。
fn defs(edit: impl Fn(&mut ContestDef)) -> (Arc<StaticData>, ScenarioId) {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let c = Arc::make_mut(&mut d).upbringing.contests.iter_mut().find(|c| c.key == "test_match").unwrap();
    c.check.base = 60;
    edit(c);
    let errors = manifest_core::contests::validation::validate(&d);
    assert!(errors.is_empty(), "{errors:?}");
    (d, sid)
}

fn world(seed: u64, edit: impl Fn(&mut ContestDef)) -> World {
    let (d, sid) = defs(edit);
    World::new(d, sid, seed).unwrap()
}

fn preview(w: &World, moves: Value) -> Value {
    let before = w.state.clone();
    let v = upbringing_view::contest_preview(Ctx::plain(&w.defs), w, &key(), moves.as_array().unwrap()).unwrap();
    assert_eq!(w.state, before, "预估不能改状态");
    v
}

/// 交卷、结算，返回结算后的世界与主角的总分。
fn play(w: &World, moves: Moves) -> (World, i64) {
    let mut after = w.clone();
    Command::PlayContest { owner: OwnerId::Player, contest: key(), moves }.apply(&mut after).unwrap();
    let score = after.state.upbringing.as_ref().unwrap().contest_results[&key()].score;
    (after, score)
}

/// 预估的实力分 + 加分 + 结算那串随机数里的临场扰动 = 结算的总分；讲解里的名次表与结算的名次一致。
fn agrees(w: &World, json_moves: Value, moves: Moves) -> Value {
    let p = preview(w, json_moves.clone());
    assert_eq!(p["ready"], true);
    let c = w.defs.upbringing.contests.iter().find(|c| c.key == "test_match").unwrap();
    let jitter = w.contest_draws(c, DATE, &key()).jitter;
    let (after, score) = play(w, moves);
    let strength = p["strength"].as_i64().unwrap();
    let bonus = p["bonus"].as_i64().unwrap();
    assert_eq!(score, (strength + bonus + jitter).clamp(0, 125), "预估的加分与结算不一致：{p}");
    let o = upbringing_view::contest_outcome(
        Ctx::plain(&after.defs),
        &after,
        &key(),
        json_moves.as_array().map(Vec::as_slice),
    )
    .unwrap();
    let result = &after.state.upbringing.as_ref().unwrap().contest_results[&key()];
    let field = o["field"].as_array().unwrap();
    assert_eq!(field.len() as u32, result.total);
    let me = field.iter().position(|f| f["you"] == true).unwrap();
    assert_eq!(me as u32 + 1, result.rank, "讲解的名次表与结算不一致：{o}");
    assert_eq!(field[me]["score"], score);
    assert_eq!(o["jitter"], jitter);
    assert_eq!(o["bonus"], bonus);
    if (1..125).contains(&score) {
        assert_eq!(o["strength"], strength);
    }
    assert!(field.windows(2).all(|f| f[0]["score"].as_i64() >= f[1]["score"].as_i64()));
    p
}

fn poem(authored: bool) -> impl Fn(&mut ContestDef) {
    move |c: &mut ContestDef| {
        c.kind = Kind::Poem;
        c.params = serde_json::from_value(json!({"theme":"占位","hints":["占位"],"lines":[
            {"prompt":"占位＿","options":["甲","乙"]},{"prompt":"＿占位","options":["丙","丁"]}]}))
        .unwrap();
        c.scoring.line_points = vec![vec![1, 4], vec![2, 6]];
        c.scoring.authored_kind = authored.then(|| "theme_and_form".to_owned());
    }
}

#[test]
fn poem_preview_matches_settlement_for_every_choice_and_counts_unpicked_lines_as_zero() {
    for authored in [false, true] {
        let w = world(42, poem(authored));
        let view = upbringing_view::contest(Ctx::plain(&w.defs), &w, &key()).unwrap();
        // 一句没选：加分 0，胜算就是“按实力”的那个数
        let empty = preview(&w, json!([null, null]));
        assert_eq!(empty["bonus"], 0);
        assert_eq!(empty["pct"], view["auto_pct"]);
        assert_eq!(empty["base_pct"], view["auto_pct"]);
        assert_eq!(empty["ready"], false);
        assert_eq!(empty["steps"], json!([null, null]));
        // 只选了第一句的“乙”：这一句拿满；作者计分直接是 4 分，否则按 4 / 10 折成 15 分里的 6 分
        let one = preview(&w, json!([1, null]));
        let (got, best) = if authored { (4, 4) } else { (6, 6) };
        assert_eq!(one["steps"][0], json!({"got":got,"best":best}));
        assert_eq!(one["bonus"], got);
        assert!(one["pct"].as_i64() >= empty["pct"].as_i64());
        assert_eq!(one["best_bonus"], if authored { 10 } else { 15 });
        let mut pcts = Vec::new();
        for a in 0..2u32 {
            for b in 0..2u32 {
                let p = agrees(&w, json!([a, b]), Moves::Choices(vec![a, b]));
                pcts.push((p["bonus"].as_i64().unwrap(), p["pct"].as_i64().unwrap()));
            }
        }
        // 加分越多，胜算不会越少；选满时到“满分时的胜算”
        pcts.sort();
        assert!(pcts.windows(2).all(|p| p[0].1 <= p[1].1), "{pcts:?}");
        assert_eq!(pcts.last().unwrap().1, one["best_pct"].as_i64().unwrap());
    }
}

#[test]
fn displayed_win_chance_with_the_minigame_bonus_matches_seeded_rankings() {
    // 同一组选法换 2048 个种子结算：赢的比例与预估的胜算相差不超过 3 个百分点（只换 512 个时，这一段种子对手的分恰好偏低，会差到 4–6 点）
    let (d, sid) = defs(poem(true));
    for (moves, json_moves) in [(vec![0, 0], json!([0, 0])), (vec![1, 1], json!([1, 1]))] {
        let sample = World::new(d.clone(), sid, 0).unwrap();
        let estimate = preview(&sample, json_moves.clone())["pct"].as_i64().unwrap();
        let mut wins = 0;
        for seed in 0..N {
            let w = World::new(d.clone(), sid, seed).unwrap();
            let (after, _) = play(&w, Moves::Choices(moves.clone()));
            wins += i64::from(after.state.upbringing.as_ref().unwrap().contest_results[&key()].rank == 1);
        }
        assert!((wins * 100 / N as i64 - estimate).abs() <= 3, "moves={moves:?}, estimate={estimate}, wins={wins}/{N}");
    }
}

#[test]
fn match_rhythm_and_debate_previews_use_the_kernel_bonus() {
    // 配对：牌面按种子洗过，用查询给的牌面找出一对
    let w = world(42, |_| {});
    let Params::Match(m) = w.contest_params(&key()).unwrap() else { unreachable!() };
    let a = 0;
    let b = (1..m.faces.len()).find(|i| m.faces[*i] == m.faces[0]).unwrap() as u32;
    let other = (1..m.faces.len() as u32).find(|i| *i != b).unwrap();
    assert_eq!(preview(&w, json!([]))["ready"], false);
    agrees(&w, json!([[a, other]]), Moves::Pairs(vec![[a, other]]));
    let p = agrees(&w, json!([[a, b]]), Moves::Pairs(vec![[a, b]]));
    assert!(p["bonus"].as_i64().unwrap() > 0);
    // 作者计分：每对 3 分，满分上限 6
    let w = world(42, |c| {
        c.scoring.authored_kind = Some("pairs".into());
        c.scoring.points_per_pair = Some(3);
        c.scoring.max_bonus = 6;
    });
    let Params::Match(m) = w.contest_params(&key()).unwrap() else { unreachable!() };
    let b = (1..m.faces.len()).find(|i| m.faces[*i] == m.faces[0]).unwrap() as u32;
    let p = agrees(&w, json!([[0, b]]), Moves::Pairs(vec![[0, b]]));
    assert_eq!((p["bonus"].as_i64(), p["unit"].as_i64(), p["best_bonus"].as_i64()), (Some(3), Some(3), Some(6)));

    // 节奏：多按的扣分照内核算
    let rhythm = |c: &mut ContestDef| {
        c.kind = Kind::Rhythm;
        c.params = serde_json::from_value(json!({"bpm":120,"beats":[1000,1500,2000],"window":100})).unwrap();
    };
    let w = world(42, rhythm);
    for taps in [vec![], vec![1000], vec![900, 1600, 2000], vec![900, 1000, 1500, 2000]] {
        agrees(&w, json!(taps), Moves::Choices(taps.clone()));
    }

    // 辩论：每回合的克制、作者计分的每胜加分
    let debate = |authored: bool| {
        move |c: &mut ContestDef| {
            c.kind = Kind::Debate;
            c.params = serde_json::from_value(json!({"topic":"占位题目","beats":[["b","a"],["a","c"]],
                "rounds":[{"opponent":{"text":"占位","kind":"a"}},{"opponent":{"text":"占位","kind":"a"}}],
                "hand":[{"key":"ka","text":"占位","kind":"a"},{"key":"kb","text":"占位","kind":"b"},{"key":"kc","text":"占位","kind":"c"}]}))
            .unwrap();
            if authored {
                c.scoring.authored_kind = Some("beats_table".into());
                c.scoring.points_per_win = Some(5);
            }
        }
    };
    for authored in [false, true] {
        let w = world(42, debate(authored));
        let half = preview(&w, json!(["kb", null]));
        assert_eq!(half["steps"][0]["edge"], 1);
        assert_eq!(half["steps"][1], Value::Null);
        assert_eq!(half["ready"], false);
        let p = agrees(&w, json!(["kb", "kc"]), Moves::Keys(vec!["kb".into(), "kc".into()]));
        assert_eq!(p["steps"][1]["edge"], -1);
        if authored {
            assert_eq!(
                (p["bonus"].as_i64(), p["steps"][0]["got"].as_i64(), p["steps"][1]["got"].as_i64()),
                (Some(5), Some(5), Some(0))
            );
            assert_eq!(p["best_bonus"], 10);
        }
        agrees(&w, json!(["ka", "kb"]), Moves::Keys(vec!["ka".into(), "kb".into()]));
    }
}

#[test]
fn identify_preview_hides_answers_until_the_outcome_explains_them() {
    let w = world(42, |c| {
        c.kind = Kind::Identify;
        c.params =
            serde_json::from_value(json!({"samples":[{"key":"s1","clues":["占位"]},{"key":"s2","clues":["占位"]}],
            "answers":[{"key":"x","name":"占位"},{"key":"y","name":"占位"}]}))
            .unwrap();
        c.scoring.answers = BTreeMap::from([("s1".into(), "x".into()), ("s2".into(), "y".into())]);
        c.scoring.authored_kind = Some("answer_key".into());
        c.scoring.points_per_correct = Some(5);
    });
    // 认对认错，预估都一样：不给加分与胜算，只给“全认对时”
    let right = preview(&w, json!(["x", "y"]));
    let wrong = preview(&w, json!(["y", "x"]));
    assert_eq!(right, wrong);
    assert_eq!((right["bonus"].clone(), right["pct"].clone()), (Value::Null, Value::Null));
    assert_eq!(right["steps"], json!([null, null]));
    assert_eq!(right["best_bonus"], 10);
    assert_eq!(right["ready"], true);
    assert_eq!(preview(&w, json!(["x", null]))["ready"], false);
    // 结算之后讲清楚：第一份认对、第二份认错（答案是 y）
    let (after, _) = play(&w, Moves::Keys(vec!["x".into(), "x".into()]));
    let o = upbringing_view::contest_outcome(Ctx::plain(&after.defs), &after, &key(), Some(&[json!("x"), json!("x")]))
        .unwrap();
    assert_eq!(o["steps"], json!([{"correct":true,"answer":"x"},{"correct":false,"answer":"y"}]));
    assert_eq!(o["bonus"], 5);
    // 还没结算的比赛不给讲解
    assert!(upbringing_view::contest_outcome(Ctx::plain(&w.defs), &w, &key(), None).is_err());
}

/// 竞渡：两程，每程“稳”（不失手）与“抢”（失手 40%），作者给了走法分。
fn race_defs() -> (Arc<StaticData>, ScenarioId) {
    defs(|c| {
        let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
        let start = (0..d.map.height)
            .flat_map(|y| (0..d.map.width - 2).map(move |x| [x, y]))
            .find(|p| (0..3).all(|dx| d.map.is_sea_in_bounds(Cell::new(p[0] + dx, p[1]))))
            .unwrap();
        c.kind = Kind::Race;
        let leg = |n: u16| race::Leg {
            text: "占位航段".into(),
            options: vec![
                race::OptionDef { key: format!("safe{n}"), text: "占位".into(), risk: 0 },
                race::OptionDef { key: format!("bold{n}"), text: "占位".into(), risk: 4000 },
            ],
        };
        c.params = Params::Race(race::Params { legs: vec![leg(0), leg(1)] });
        let course = |n: u16| race::CourseLeg {
            minutes: 120,
            target: [start[0] + 1 + n, start[1]],
            options: BTreeMap::from([
                (format!("safe{n}"), race::Helm { heading: 90, sail: Sail::Half }),
                (format!("bold{n}"), race::Helm { heading: 90, sail: Sail::Full }),
            ]),
        };
        c.scoring.race = Some(race::Track {
            ship: d.ships[0].key.clone(),
            start,
            legs: vec![course(0), course(1)],
            option_points: BTreeMap::from([
                ("safe0".into(), 3),
                ("bold0".into(), 6),
                ("safe1".into(), 3),
                ("bold1".into(), 6),
            ]),
            failed_leg_points: 1,
        });
        c.scoring.authored_kind = Some("seeded_risk".into());
        c.scoring.max_bonus = 15;
    })
}

#[test]
fn race_preview_prices_risk_by_expectation_without_revealing_the_seeded_failures() {
    let (d, sid) = race_defs();
    let w = World::new(d.clone(), sid, 42).unwrap();
    // 还没选：给出第一程两种走法各自顺利 / 失手的分与风险
    let start = preview(&w, json!([null, null]));
    let options = start["options"].as_array().unwrap();
    assert_eq!(options.len(), 2);
    assert_eq!(options[0]["risk"], 0);
    assert_eq!(options[1]["risk"], 4000);
    assert_eq!(start["bonus"], 0);
    // 两程都稳：没有失手，预估与结算完全一致
    agrees(&w, json!(["safe0", "safe1"]), Moves::Keys(vec!["safe0".into(), "safe1".into()]));
    // 都抢：预估的是期望
    let bold = preview(&w, json!(["bold0", "bold1"]));
    let step = &bold["steps"][0];
    let (win, lose) = (step["win"].as_i64().unwrap(), step["lose"].as_i64().unwrap());
    assert!(win > lose);
    assert_eq!(step["got"].as_i64().unwrap(), (win * 6000 + lose * 4000 + 5000) / 10_000);
    // 换 2048 个种子（天气、失手、对手都跟着变）：每个种子先问预估、再结算——平均的预估加分与胜算贴近实际
    let (mut expect, mut chance, mut actual, mut wins, mut counted) = (0.0, 0, 0, 0, 0);
    for seed in 0..N {
        let w = World::new(d.clone(), sid, seed).unwrap();
        let p = preview(&w, json!(["bold0", "bold1"]));
        let c = w.defs.upbringing.contests.iter().find(|c| c.key == "test_match").unwrap();
        let jitter = w.contest_draws(c, DATE, &key()).jitter;
        let s = w.contest_strength(c);
        assert_eq!(p["strength"], s);
        let (after, score) = play(&w, Moves::Keys(vec!["bold0".into(), "bold1".into()]));
        if (1..125).contains(&score) {
            expect += p["bonus"].as_f64().unwrap();
            actual += score - s - jitter;
            counted += 1;
        }
        chance += p["pct"].as_i64().unwrap();
        wins += i64::from(after.state.upbringing.as_ref().unwrap().contest_results[&key()].rank == 1);
    }
    let (expect, actual) = (expect / f64::from(counted), actual as f64 / f64::from(counted));
    assert!((expect - actual).abs() <= 0.8, "平均预估加分 {expect}，实际 {actual}");
    assert!((wins * 100 / N as i64 - chance / N as i64).abs() <= 3, "赢 {wins}/{N}，平均预估 {}%", chance / N as i64);
    // 结算之后的讲解说出每一程失没失手
    let (after, _) = play(&w, Moves::Keys(vec!["bold0".into(), "bold1".into()]));
    let o = upbringing_view::contest_outcome(
        Ctx::plain(&after.defs),
        &after,
        &key(),
        Some(&[json!("bold0"), json!("bold1")]),
    )
    .unwrap();
    assert_eq!(o["steps"].as_array().unwrap().len(), 2);
    assert!(o["steps"][0]["failed"].is_boolean());
}

#[test]
fn preview_rejects_malformed_moves_and_closed_contests() {
    let w = world(42, poem(true));
    let bad =
        |m: Value| upbringing_view::contest_preview(Ctx::plain(&w.defs), &w, &key(), m.as_array().unwrap()).is_err();
    assert!(bad(json!([0])));
    assert!(bad(json!([0, 0, 0])));
    assert!(bad(json!([5, null])));
    assert!(bad(json!(["甲", null])));
    let (after, _) = play(&w, Moves::Choices(vec![0, 0]));
    assert!(upbringing_view::contest_preview(Ctx::plain(&after.defs), &after, &key(), &[json!(0), json!(0)]).is_err());
    // 按实力结算的比赛（到日子由后端结算）也能讲：小游戏加分为 0。排一个月休息，照 upbringing_i6 的做法一天天过
    let mut auto = world(42, poem(true));
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut auto)
    .unwrap();
    for _ in 0..20 {
        if auto.state.upbringing.as_ref().is_some_and(|s| s.contest_results.contains_key(&key())) {
            break;
        }
        while auto.pending_story2().is_some() {
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut auto).unwrap();
        }
        auto.end_day().unwrap();
    }
    let r = auto.state.upbringing.as_ref().unwrap().contest_results[&key()].clone();
    let o = upbringing_view::contest_outcome(Ctx::plain(&auto.defs), &auto, &key(), None).unwrap();
    assert_eq!(o["bonus"], 0);
    assert_eq!(o["game_score"], Value::Null);
    assert_eq!(o["rank"], r.rank);
    let me = o["field"].as_array().unwrap().iter().position(|f| f["you"] == true).unwrap();
    assert_eq!(me as u32 + 1, r.rank);
}

/// U04 的比赛定义：按年龄分组取对手分、要先报名（作诗、作者计分，与 `poem(true)` 相同）。
fn grouped(c: &mut ContestDef) {
    poem(true)(c);
    c.age_groups = true;
    c.registration_required = true;
}

#[test]
fn age_group_rivals_share_one_range_across_preview_settlement_and_outcome() {
    // 先看本场的年龄组区间，把实力挪到区间中段，胜算才看得出差别
    let probe = world(0, grouped);
    let c = probe.defs.upbringing.contests.iter().find(|c| c.key == "test_match").unwrap();
    let [low, high] = probe.contest_rival_range(c, DATE);
    assert_ne!([low, high], [35, 100], "要测的是年龄组区间");
    let shift = (low + high) / 2 - probe.contest_strength(c);
    let (d, sid) = defs(move |c| {
        grouped(c);
        c.check.base += shift;
    });
    let sample = World::new(d.clone(), sid, 0).unwrap();
    let c = sample.defs.upbringing.contests.iter().find(|c| c.key == "test_match").unwrap();
    assert_eq!(sample.contest_rival_range(c, DATE), [low, high]);
    // “按实力约 N%”与没选时的预估是同一个数（同一个区间）
    let view = upbringing_view::contest(Ctx::plain(&sample.defs), &sample, &key()).unwrap();
    assert_eq!(preview(&sample, json!([null, null]))["pct"], view["auto_pct"]);
    // 交卷即报名并结算；讲解的名次表与结算一致，对手的分都在本场区间里
    let p = agrees(&sample, json!([1, 1]), Moves::Choices(vec![1, 1]));
    let (after, _) = play(&sample, Moves::Choices(vec![1, 1]));
    assert!(after.contest_registered(&key()));
    let o =
        upbringing_view::contest_outcome(Ctx::plain(&after.defs), &after, &key(), Some(&[json!(1), json!(1)])).unwrap();
    let rivals = o["field"].as_array().unwrap().iter().filter(|f| f["you"] == false).collect::<Vec<_>>();
    assert_eq!(rivals.len(), c.rivals.len());
    assert!(rivals.iter().all(|f| (low..=high).contains(&f["score"].as_i64().unwrap())), "{o}");
    // 换 2048 个种子结算：赢的比例与预估的胜算相差不超过 3 个百分点
    let estimate = p["pct"].as_i64().unwrap();
    assert!((5..=95).contains(&estimate), "胜算 {estimate}% 太靠边，测不出区间");
    let mut wins = 0;
    for seed in 0..N {
        let w = World::new(d.clone(), sid, seed).unwrap();
        let (after, _) = play(&w, Moves::Choices(vec![1, 1]));
        wins += i64::from(after.state.upbringing.as_ref().unwrap().contest_results[&key()].rank == 1);
    }
    assert!((wins * 100 / N as i64 - estimate).abs() <= 3, "estimate={estimate}, wins={wins}/{N}");
}

#[test]
fn tagged_poem_preview_uses_the_kernel_line_points_and_matches_settlement() {
    // 寰宇的歌合：季语、韵脚进分值（score_tags），按年龄分组，要报名
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "mio_1553").unwrap());
    let w = World::new(d, sid, 42).unwrap();
    let c = w.defs.upbringing.contests.iter().find(|c| c.key == "contest_waka").unwrap();
    assert!(c.poem.as_ref().is_some_and(|p| p.score_tags) && c.age_groups && c.registration_required);
    let date = *c.dates.iter().find(|date| w.contest_open(c, **date)).unwrap();
    let key = occurrence_key(&c.key, date);
    let ctx = Ctx::plain(&w.defs);
    let points = w.contest_poem_points(c, date);
    let possible = points.iter().map(|l| l.iter().copied().max().unwrap_or(1)).sum::<i64>().max(1);
    let max = c.scoring.max_bonus;
    let view = upbringing_view::contest(ctx, &w, &key).unwrap();
    let empty = vec![Value::Null; points.len()];
    let before = w.state.clone();
    let p = upbringing_view::contest_preview(ctx, &w, &key, &empty).unwrap();
    assert_eq!(p["pct"], view["auto_pct"]);
    assert_eq!(p["best_bonus"], max);
    // 只选第一句：每个候选的分按本场的分值表（与视图的 line_points 同一张）折算
    let top = points[0].iter().copied().max().unwrap();
    for (j, got) in points[0].iter().enumerate() {
        let mut moves = empty.clone();
        moves[0] = json!(j);
        let p = upbringing_view::contest_preview(ctx, &w, &key, &moves).unwrap();
        assert_eq!(p["steps"][0], json!({"got":got * max / possible,"best":top * max / possible}), "第 {j} 个候选");
    }
    assert_eq!(w.state, before, "预估不能改状态");
    // 选满（每句最好 / 最差）：加分与结算一致，交卷即报名，对手的分在本场区间里
    let [low, high] = w.contest_rival_range(c, date);
    let pick = |best: bool| -> Vec<u32> {
        points
            .iter()
            .map(|l| {
                let m = if best { l.iter().max() } else { l.iter().min() };
                l.iter().position(|v| Some(v) == m).unwrap() as u32
            })
            .collect()
    };
    for choices in [pick(true), pick(false)] {
        let moves = choices.iter().map(|j| json!(j)).collect::<Vec<_>>();
        let p = upbringing_view::contest_preview(ctx, &w, &key, &moves).unwrap();
        assert_eq!(p["ready"], true);
        let draws = w.contest_draws(c, date, &key);
        let mut after = w.clone();
        Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Choices(choices.clone()) }
            .apply(&mut after)
            .unwrap();
        assert!(after.contest_registered(&key));
        let result = &after.state.upbringing.as_ref().unwrap().contest_results[&key];
        let (strength, bonus) = (p["strength"].as_i64().unwrap(), p["bonus"].as_i64().unwrap());
        assert_eq!(result.score, (strength + bonus + draws.jitter).clamp(0, 125), "{choices:?}: {p}");
        assert!(draws.rivals.iter().all(|(_, s, _)| (low..=high).contains(s)));
        let o = upbringing_view::contest_outcome(Ctx::plain(&after.defs), &after, &key, Some(&moves)).unwrap();
        assert_eq!(o["bonus"], bonus);
        let me = o["field"].as_array().unwrap().iter().position(|f| f["you"] == true).unwrap();
        assert_eq!(me as u32 + 1, result.rank);
    }
}

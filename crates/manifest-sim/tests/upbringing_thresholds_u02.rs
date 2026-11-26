//! U02 工作包 2：养成期门槛由中位成长曲线一次生成。断言用同一条曲线：数据与生成结果一致、每年超出中位的
//! 门槛条数有上限、事件链后段不比前段容易、不超过上界与跳过缺省、开局头两个月压低、14 岁至少一条志向可选。
use manifest_core::{
    StaticData,
    upbringing::{RatingRequirement, growth::annual_cap_at},
};
use manifest_sim::{
    upbringing_curve::{GrowthCurve, MONTHS, Measure},
    upbringing_thresholds::{Locator, Threshold, curves, generate, route_of},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn plan() -> &'static (BTreeMap<String, GrowthCurve>, Vec<Threshold>) {
    static PLAN: OnceLock<(BTreeMap<String, GrowthCurve>, Vec<Threshold>)> = OnceLock::new();
    PLAN.get_or_init(|| {
        let d = terra();
        let c = curves(&d);
        let items = generate(&d, &c);
        (c, items)
    })
}

/// 档位门槛按档位比，其余按原刻度比。
fn median_for(c: &GrowthCurve, t: &Threshold) -> i64 {
    t.key.split('+').map(|k| c.median(t.measure, k, t.date)).sum()
}

#[test]
fn curve_starts_at_the_three_layer_opening_and_respects_the_annual_cap() {
    let d = terra();
    let (curves, _) = plan();
    assert_eq!(curves.len(), d.upbringing.families.len());
    for (key, c) in curves {
        let f = d.upbringing.family(key).unwrap();
        let opening = manifest_core::upbringing::growth::opening_growth(&d, f);
        for a in &d.captain.attributes {
            assert_eq!(c.median_at(Measure::Growth, &a.key, 0), opening[&a.key], "{key}/{}", a.key);
            let mut previous = opening[&a.key];
            for m in 1..=MONTHS {
                let v = c.median_at(Measure::Growth, &a.key, m);
                assert!(v >= previous, "{key}/{} 第 {m} 月倒退", a.key);
                previous = v;
            }
            for year in 0..4 {
                let gain = c.median_at(Measure::Growth, &a.key, year * 12 + 12)
                    - c.median_at(Measure::Growth, &a.key, year * 12);
                // 上限按年龄递增（工作包 4）：取这一年里最高的那一档。
                let age = 1553 + year as i64 - i64::from(f.born[0]);
                let cap = annual_cap_at(&d.upbringing.rules, Some(age))
                    .max(annual_cap_at(&d.upbringing.rules, Some(age - 1)));
                assert!(gain <= cap, "{key}/{} 第 {year} 年成长 {gain} 超过上限 {cap}", a.key);
            }
            assert!(c.median_at(Measure::Growth, &a.key, MONTHS) <= c.upper(Measure::Growth, &a.key, [1557, 1, 1]));
        }
        assert!(c.total_growth([1557, 1, 1]) > 0, "{key} 四年没有成长");
    }
}

#[test]
fn data_thresholds_are_exactly_what_the_curve_generates() {
    let d = terra();
    let (_, items) = plan();
    assert!(items.len() > 2000, "门槛 {} 条", items.len());
    // U06K2 裁决 6：行动制家庭的旧门槛本轮不重跑；其余家庭及共用门槛仍须严格对齐。
    let drift: Vec<String> = items
        .iter()
        .filter(|t| t.families.iter().any(|key| !d.upbringing.family(key).unwrap().act))
        .filter(|t| t.new != t.old)
        .take(20)
        .map(|t| format!("{} {} → {}", t.id(), t.old, t.new))
        .collect();
    assert!(drift.is_empty(), "数据与曲线生成的门槛不一致（改了曲线参数或活动数值后要重新生成）：{drift:#?}");
}

#[test]
fn only_a_few_stretch_thresholds_per_year_exceed_the_median() {
    let d = terra();
    let (curves, items) = plan();
    let p = &d.upbringing.rules.curve;
    // 改投学院（11-04）：路线版事件与原版不同局出现，生成器各挑各的，这里也按（家庭、年份、路线）分开数。
    let mut over: BTreeMap<(String, u32, Option<String>), usize> = BTreeMap::new();
    for t in items {
        for fk in &t.families {
            let med = median_for(&curves[fk], t);
            if t.new > med {
                assert!(
                    t.chain.is_some() && t.stretch,
                    "{} 不是“够一够”却高出 {fk} 的中位（{} > {med}）",
                    t.id(),
                    t.new
                );
                *over.entry((fk.clone(), t.date[0], route_of(&d, t))).or_default() += 1;
            }
        }
    }
    for ((fk, year, route), n) in over {
        assert!(n <= p.stretch_per_year, "{fk} 在 {year} 年（路线 {route:?}）有 {n} 道门槛高出中位");
    }
}

#[test]
fn later_steps_of_a_chain_are_never_easier() {
    let (curves, items) = plan();
    let mut chains: BTreeMap<&str, Vec<&Threshold>> = BTreeMap::new();
    for t in items.iter().filter(|t| !t.stretch) {
        if let Some(c) = &t.chain {
            chains.entry(c).or_default().push(t);
        }
    }
    for (chain, mut list) in chains {
        list.sort_by_key(|t| (t.rank, t.date));
        let c = &curves[&list[0].families[0]];
        let mut previous: Option<(i64, &Threshold)> = None;
        for t in list {
            let med =
                if t.measure == Measure::Level { c.median(Measure::Growth, &t.key, t.date) } else { median_for(c, t) };
            if med <= 0 {
                continue;
            }
            let value = if t.measure == Measure::Level { d_level_floor(t.new) } else { t.new };
            let ratio = value * 10_000 / med;
            if let Some((r, p)) = previous {
                let capped = t.new >= t.cap;
                assert!(
                    ratio >= r || capped || t.measure == Measure::Level,
                    "{chain}: {} 的难度 {ratio} 低于前一步 {} 的 {r}",
                    t.id(),
                    p.id()
                );
            }
            previous = Some((ratio.max(previous.map_or(0, |p| p.0)), t));
        }
    }
}

fn d_level_floor(level: i64) -> i64 {
    (level - 1).max(0) * 100
}

#[test]
fn thresholds_stay_under_the_upper_curve_and_the_skip_defaults() {
    let d = terra();
    let (curves, items) = plan();
    for t in items {
        assert!(t.new >= 0, "{}", t.id());
        for fk in &t.families {
            let c = &curves[fk];
            let up: i64 = t.key.split('+').map(|k| c.upper(t.measure, k, t.date)).sum();
            assert!(t.new <= up.max(t.measure_floor()), "{} = {} 超过 {fk} 的上界 {up}", t.id(), t.new);
            let f = d.upbringing.family(fk).unwrap();
            let defaults = &f.completion.as_ref().unwrap().defaults;
            if t.measure == Measure::Growth {
                let bound = c.opening(&t.key).max(defaults.growth.get(&t.key).copied().unwrap_or(0));
                assert!(t.new <= bound, "{} = {} 超过 {fk} 跳过养成的 {bound}", t.id(), t.new);
            }
            if t.measure == Measure::Skill
                && let Some(bound) = defaults.skills.get(&t.key)
            {
                assert!(t.new <= *bound, "{} = {} 超过 {fk} 跳过养成的 {bound}", t.id(), t.new);
            }
        }
    }
}

trait Floor {
    fn measure_floor(&self) -> i64;
}
impl Floor for Threshold {
    /// 档位最低是 1；其余刻度最低为 0。
    fn measure_floor(&self) -> i64 {
        i64::from(self.measure == Measure::Level)
    }
}

#[test]
fn the_first_two_months_are_light() {
    let d = terra();
    let (curves, items) = plan();
    let p = &d.upbringing.rules.curve;
    for t in items.iter().filter(|t| (i64::from(t.date[0]) - 1553) * 12 + i64::from(t.date[1]) - 1 < p.opening_months) {
        assert!(!t.stretch, "{}", t.id());
        assert!(t.coef_pct <= p.chain_tail_pct * (100 + p.jitter_pct) / 100 * p.opening_pct / 100, "{}", t.id());
        for fk in &t.families {
            assert!(t.new <= median_for(&curves[fk], t).max(t.measure_floor()), "{}", t.id());
        }
    }
}

#[test]
fn every_protagonist_has_an_aspiration_open_at_fourteen() {
    let d = terra();
    let (curves, _) = plan();
    for f in &d.upbringing.families {
        let c = f.completion.as_ref().unwrap();
        let at = [f.born[0] + c.choose_age, f.born[1], f.born[2]];
        let curve = &curves[&f.key];
        let open = c.paths.iter().filter_map(|k| d.upbringing.paths.iter().find(|p| &p.key == k)).any(|p| {
            !p.hidden
                && p.requirements.year.is_none_or(|y| y <= 1)
                && match &p.requirements.rating {
                    Some(RatingRequirement::Threshold(t)) => curve.median(Measure::Rating, &t.key, at) >= t.min,
                    Some(RatingRequirement::Key(k)) => {
                        curve.median(Measure::Rating, k, at) >= p.requirements.min.unwrap_or(0)
                    }
                    None => true,
                }
        });
        assert!(open, "{} 在 {at:?} 没有一条志向可选", f.key);
    }
}

#[test]
fn the_plan_covers_every_threshold_kind() {
    let (_, items) = plan();
    let has = |f: &dyn Fn(&Threshold) -> bool| items.iter().any(f);
    assert!(has(&|t| matches!(t.locator, Locator::Story { choice: Some(_), .. })));
    assert!(has(&|t| matches!(t.locator, Locator::Story { choice: None, .. })));
    assert!(has(&|t| matches!(&t.locator, Locator::Requirement { owner, .. } if owner == "path")));
    assert!(has(&|t| matches!(&t.locator, Locator::Requirement { owner, .. } if owner == "exam")));
    assert!(has(&|t| matches!(t.locator, Locator::Unlock { .. })));
}

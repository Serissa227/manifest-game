//! U02 工作包 2：整个养成期的数值门槛按中位成长曲线一次生成（排序 + 轻微随机），不手调单个门槛。
//!
//! 门槛 = 曲线(出现日期) × 系数。系数按它在同一条事件链里的名次从链首 `chain_head_pct` 递增到链尾
//! `chain_tail_pct`；每家每年按键哈希挑 `stretch_per_year` 条“够一够”，系数 `stretch_pct`；再按键哈希
//! 抖动 ±`jitter_pct`。非“够一够”的门槛不高于当日中位；抖完后在链内按“难度 = 门槛 ÷ 当日中位”强制不减。
//! 上界：不高于上界曲线，也不高于跳过养成的缺省成长（属性、评价，以及缺省里给了的技能）。开局头
//! `opening_months` 个月再乘 `opening_pct`。几位主角共用的门槛（日常池、节庆池、公共考试与打工）取各人结果的最小值。
use crate::upbringing_curve::{GrowthCurve, Measure, measure_of};
use manifest_core::{
    Command, LocId, OwnerId, ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest, WorldDate},
    story2::{Condition, Effect, TrackDef},
    upbringing::{ActivityDef, ActivityKind, FamilyDef, RatingRequirement, Requirements, Stage},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

/// 门槛在数据里的位置。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Locator {
    /// 故事章节的 `when`（`choice` 为空）或选项 `requires` 的第 `index` 项。
    Story { track: String, chapter: String, choice: Option<String>, index: usize },
    /// 志向或考试的门槛树：`path` 形如 `all.0`，空串为根；`field` 为 `attr` / `rating` / `rating_check`。
    Requirement { owner: String, key: String, path: String, field: String, attr: String },
    /// 活动的 `unlock.attrs`。
    Unlock { activity: String, attr: String },
}

/// 一道门槛。
#[derive(Clone, Debug, Serialize)]
pub struct Threshold {
    pub file: String,
    pub locator: Locator,
    pub measure: Measure,
    pub key: String,
    pub old: i64,
    pub date: WorldDate,
    pub families: Vec<String>,
    /// 同一条事件链（家庭:类别:选项:条件种类）；共用门槛没有链。
    pub chain: Option<String>,
    pub hard: bool,
    // 以下由生成填写
    pub new: i64,
    pub rank: usize,
    pub chain_len: usize,
    pub coef_pct: i64,
    pub stretch: bool,
    /// 第一位适用主角当日的中位预期与上界（共用门槛取最小的那位）。
    pub median: i64,
    pub upper: i64,
    /// 本条门槛的封顶：上界曲线与跳过养成缺省二者取小。
    pub cap: i64,
}

/// 按键的确定性哈希（FNV-1a 64 位）：同一份数据每次生成都一样。
fn hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}

impl Threshold {
    pub fn id(&self) -> String {
        match &self.locator {
            Locator::Story { track, chapter, choice, index } => {
                format!("{track}:{chapter}:{}:{index}", choice.as_deref().unwrap_or("when"))
            }
            Locator::Requirement { owner, key, path, field, attr } => format!("{owner}:{key}:{path}:{field}:{attr}"),
            Locator::Unlock { activity, attr } => format!("unlock:{activity}:{attr}"),
        }
    }
}

/// 家庭键 → 故事前缀；长的先比，避免 `custom_x` 被 `x` 吞掉。
fn family_keys(defs: &StaticData) -> Vec<String> {
    let mut keys: Vec<String> = defs.upbringing.families.iter().map(|f| f.key.clone()).collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    keys
}

/// 各家开场事件里发的日常池旗标（`c9_pool_<文化>`）→ 家庭。
fn pool_families(defs: &StaticData, keys: &[String]) -> BTreeMap<String, BTreeSet<String>> {
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for t in &defs.upbringing.tracks {
        let Some(fk) = keys.iter().find(|k| t.key.starts_with(&format!("c9_{k}_"))) else { continue };
        for c in &t.chapters {
            let effects = c.choices.iter().flat_map(|o| &o.effects).chain(c.default.iter().flat_map(|b| &b.effects));
            for e in effects {
                if let Effect::Flag { flag, value: true } = e
                    && flag.starts_with("c9_pool_")
                {
                    out.entry(flag.clone()).or_default().insert(fk.clone());
                }
            }
        }
    }
    out
}

fn academy_families(defs: &StaticData, academy: &str) -> Vec<String> {
    defs.upbringing
        .families
        .iter()
        // 改投路线去得了的学院也归这一家（11-04：能岛归澪、印书圈归莉芙）。
        .filter(|f| {
            f.stages.iter().any(|s| s.academy.as_deref() == Some(academy))
                || f.routes.iter().any(|r| r.academy == academy)
        })
        .map(|f| f.key.clone())
        .collect()
}

/// 轨道属于哪些家庭、家庭内的类别（`critical`、`side`、`rare` ……）。
fn owners(
    defs: &StaticData,
    keys: &[String],
    pools: &BTreeMap<String, BTreeSet<String>>,
    t: &TrackDef,
) -> (Vec<String>, Option<(String, String)>) {
    if let Some(fk) = keys.iter().find(|k| t.key.starts_with(&format!("c9_{k}_"))) {
        let rest = &t.key[fk.len() + 4..];
        let mut cat: &str = rest.trim_end_matches(|c: char| c.is_ascii_digit() || c == '_');
        if cat.starts_with("side") {
            cat = "side";
        }
        return (vec![fk.clone()], Some((fk.clone(), cat.to_owned())));
    }
    if let Some(rest) = t.key.strip_prefix("c9_pool_") {
        let flag = pools.keys().find(|p| rest.starts_with(&format!("{}_", &p["c9_pool_".len()..])));
        return (flag.map(|p| pools[p].iter().cloned().collect()).unwrap_or_default(), None);
    }
    for prefix in ["c9_academy_", "c9_club_"] {
        if let Some(rest) = t.key.strip_prefix(prefix) {
            let mut academies: Vec<&str> = defs.upbringing.academies.iter().map(|a| a.key.as_str()).collect();
            academies.sort_by_key(|k| std::cmp::Reverse(k.len()));
            if let Some(a) = academies.into_iter().find(|a| rest.starts_with(&format!("{a}_"))) {
                return (academy_families(defs, a), None);
            }
        }
    }
    (defs.upbringing.families.iter().map(|f| f.key.clone()).collect(), None)
}

fn chapter_date(defs: &StaticData, t: &TrackDef, c: &manifest_core::story2::ChapterDef) -> WorldDate {
    let mut d: Option<WorldDate> = None;
    let mut bump = |x: WorldDate| d = Some(d.map_or(x, |d| d.max(x)));
    for w in &c.when {
        if let Condition::Date { from: Some(from), .. } = w {
            bump(*from);
        }
    }
    if let Some(from) = defs.upbringing.event_gates.get(&t.key).and_then(|g| g.from) {
        bump(from);
    }
    if let Some(w) = c.window {
        bump(w[0]);
    }
    d.unwrap_or([1553, 1, 1])
}

/// 学院第 `year` 学年开始的那一天（按家庭阶段累计学院月数）。
fn academy_year_start(f: &FamilyDef, year: u32) -> WorldDate {
    let mut months = 0u32;
    let mut date = [1553u32, 1, 1];
    for m in 0..crate::upbringing_curve::MONTHS as u32 {
        date = [1553 + m / 12, m % 12 + 1, 15];
        let stage = f.stages.iter().rev().find(|s| s.from <= date);
        if stage.is_some_and(|s| s.stage == Stage::Academy) {
            if months == (year.max(1) - 1) * 12 {
                return [date[0], date[1], 1];
            }
            months += 1;
        }
    }
    [date[0], date[1], 1]
}

fn requirement_items(
    defs: &StaticData,
    r: &Requirements,
    path: &str,
    out: &mut Vec<(String, String, String, i64, Measure)>,
) {
    if let (Some(attr), Some(min)) = (&r.attr, r.min) {
        out.push((path.into(), "attr".into(), attr.clone(), min, measure_of(defs, "attr", attr)));
    }
    match &r.rating {
        Some(RatingRequirement::Threshold(t)) => {
            out.push((path.into(), "rating".into(), t.key.clone(), t.min, Measure::Rating));
        }
        Some(RatingRequirement::Key(k)) if r.min.is_some() => {
            out.push((path.into(), "rating".into(), k.clone(), r.min.unwrap_or(0), Measure::Rating));
        }
        _ => {}
    }
    for (name, list) in [("all", &r.all), ("any", &r.any)] {
        for (i, sub) in list.iter().enumerate() {
            let p = if path.is_empty() { format!("{name}.{i}") } else { format!("{path}.{name}.{i}") };
            requirement_items(defs, sub, &p, out);
        }
    }
}

/// 收集寰宇养成期的全部数值门槛（还未生成新值）。
pub fn collect(defs: &StaticData) -> Vec<Threshold> {
    let keys = family_keys(defs);
    let pools = pool_families(defs, &keys);
    let all: Vec<String> = defs.upbringing.families.iter().map(|f| f.key.clone()).collect();
    let mut out = Vec::new();
    let blank = |file: &str, locator, measure, key: &str, old, date, families: Vec<String>, chain, hard| Threshold {
        file: file.into(),
        locator,
        measure,
        key: key.into(),
        old,
        date,
        families,
        chain,
        hard,
        new: old,
        rank: 0,
        chain_len: 1,
        coef_pct: 0,
        stretch: false,
        median: 0,
        upper: 0,
        cap: 0,
    };
    for t in &defs.upbringing.tracks {
        let (families, owner) = owners(defs, &keys, &pools, t);
        if families.is_empty() {
            continue;
        }
        for c in &t.chapters {
            let date = chapter_date(defs, t, c);
            let mut conds: Vec<(Option<String>, usize, &Condition, bool)> =
                c.when.iter().enumerate().map(|(i, w)| (None, i, w, false)).collect();
            for o in &c.choices {
                conds.extend(
                    o.requires.iter().enumerate().map(|(i, r)| (Some(o.key.clone()), i, r, o.hard.contains(&i))),
                );
            }
            for (choice, index, cond, hard) in conds {
                let (kind, key, old) = match cond {
                    Condition::Attr { attr, ge } => ("attr", attr, *ge),
                    Condition::Growth { attr, ge } => ("growth", attr, *ge),
                    Condition::Skill { skill, ge } => ("skill", skill, *ge),
                    _ => continue,
                };
                let chain = owner
                    .as_ref()
                    .map(|(fk, cat)| format!("{fk}:{cat}:{}:{kind}", choice.as_deref().unwrap_or("when")));
                out.push(blank(
                    &t.source,
                    Locator::Story { track: t.key.clone(), chapter: c.key.clone(), choice, index },
                    measure_of(defs, kind, key),
                    key,
                    old,
                    date,
                    families.clone(),
                    chain,
                    hard,
                ));
            }
        }
    }
    // 志向：选志向的年龄那天；隐藏志向另受学年限制。一家的志向按 1→4 成链。
    for f in &defs.upbringing.families {
        let Some(c) = &f.completion else { continue };
        let choose = [f.born[0] + c.choose_age, f.born[1], f.born[2]];
        for key in &c.paths {
            let Some(p) = defs.upbringing.paths.iter().find(|p| &p.key == key) else { continue };
            let date = p.requirements.year.map_or(choose, |y| choose.max(academy_year_start(f, y)));
            let mut items = Vec::new();
            requirement_items(defs, &p.requirements, "", &mut items);
            for (path, field, attr, old, measure) in items {
                out.push(blank(
                    &p.source,
                    Locator::Requirement { owner: "path".into(), key: key.clone(), path, field, attr: attr.clone() },
                    measure,
                    &attr,
                    old,
                    date,
                    vec![f.key.clone()],
                    Some(format!("{}:path", f.key)),
                    false,
                ));
            }
        }
    }
    // 考试：按学年（或考期）定日期；公共考试人人可考，学院考试只给本学院。
    for e in &defs.upbringing.exams {
        let families = e.academy.as_ref().map_or_else(|| all.clone(), |a| academy_families(defs, a));
        let year = e.requirements.year.or_else(|| e.requirements.all.iter().find_map(|r| r.year)).unwrap_or(1);
        let Some(first) = families.first().and_then(|k| defs.upbringing.family(k)) else { continue };
        let mut date = academy_year_start(first, year);
        if let Some(d) = e.dates.iter().find(|d| **d >= date) {
            date = *d;
        }
        let mut items = Vec::new();
        requirement_items(defs, &e.requirements, "", &mut items);
        if let Some(rc) = &e.rating_check {
            items.push(("".into(), "rating_check".into(), rc.ratings.join("+"), rc.min_total, Measure::Rating));
        }
        for (path, field, attr, old, measure) in items {
            out.push(blank(
                &e.source,
                Locator::Requirement { owner: "exam".into(), key: e.key.clone(), path, field, attr: attr.clone() },
                measure,
                &attr,
                old,
                date,
                families.clone(),
                None,
                false,
            ));
        }
    }
    // 打工的高段解锁：按做满前置次数（每月一次）定日期。
    for a in &defs.upbringing.activities {
        let after = a.tier.as_ref().map_or(0, |t| t.after);
        let families = match &a.unlock.flag {
            Some(flag) => all.iter().filter(|k| *flag == format!("c9_family_{k}")).cloned().collect(),
            None => all.clone(),
        };
        if families.is_empty() {
            continue;
        }
        let m = after.min(47);
        for (attr, old) in &a.unlock.attrs {
            out.push(blank(
                &a.source,
                Locator::Unlock { activity: a.key.clone(), attr: attr.clone() },
                measure_of(defs, "attr", attr),
                attr,
                *old,
                [1553 + m / 12, m % 12 + 1, 1],
                families.clone(),
                None,
                false,
            ));
        }
    }
    out
}

/// 跳过养成时的结果（缺省成长与开局取大）：门槛的另一条上界。
fn skip_bound(defs: &StaticData, curve: &GrowthCurve, f: &FamilyDef, t: &Threshold) -> Option<i64> {
    let d = f.completion.as_ref().map(|c| &c.defaults)?;
    let growth = |k: &str| curve.opening(k).max(d.growth.get(k).copied().unwrap_or(0));
    match t.measure {
        Measure::Growth | Measure::Conduct => Some(growth(&t.key)),
        Measure::Level => Some(curve.level_of(growth(&t.key))),
        Measure::Rating => {
            let mut total = 0;
            for key in t.key.split('+') {
                let r = defs.captain.ratings.iter().find(|r| r.key == key)?;
                let (mut sum, mut weight) = (0i64, 0i64);
                for (i, w) in &r.weights {
                    let a = &defs.captain.attributes.get(*i)?.key;
                    let conduct = defs.captain.group(*i).is_some_and(|g| g.key == "conduct");
                    let v = if conduct {
                        growth(a) * 10
                    } else if a == "arcana" {
                        0
                    } else {
                        curve.level_of(growth(a)) * 100
                    };
                    sum += v * w;
                    weight += w;
                }
                total += if weight > 0 { sum / weight } else { 0 };
            }
            Some(total)
        }
        Measure::Skill => d.skills.get(&t.key).copied(),
    }
}

fn curve_value(curve: &GrowthCurve, t: &Threshold, upper: bool) -> i64 {
    t.key
        .split('+')
        .map(|k| if upper { curve.upper(t.measure, k, t.date) } else { curve.median(t.measure, k, t.date) })
        .sum()
}

/// 档位门槛在成长点上计算：中位与上界都换成成长点，最后再换回档位。
fn growth_space(curve: &GrowthCurve, t: &Threshold, upper: bool) -> i64 {
    if t.measure == Measure::Level {
        if upper { curve.upper(Measure::Growth, &t.key, t.date) } else { curve.median(Measure::Growth, &t.key, t.date) }
    } else {
        curve_value(curve, t, upper)
    }
}

/// 按曲线为全部门槛生成新值；返回的列表与 [`collect`] 同序。
pub fn generate(defs: &Arc<StaticData>, curves: &BTreeMap<String, GrowthCurve>) -> Vec<Threshold> {
    let p = &defs.upbringing.rules.curve;
    // U01 的硬规矩：关键事件 00–09 起始章的数值门槛不高于“两格练习路线”的最好结果（刻度同门槛）。
    let routes = critical_route_bounds(defs);
    let mut items = collect(defs);
    // 没有日期、四年里随机出现的日常池与节庆池，按养成期中点定门槛。
    for t in &mut items {
        if t.chain.is_none() && matches!(t.locator, Locator::Story { .. }) && t.date <= [1553, 1, 31] {
            t.date = p.pool_date;
        }
    }
    let month = |t: &Threshold| (i64::from(t.date[0]) - 1553) * 12 + i64::from(t.date[1]) - 1;
    // 链内名次
    let mut chains: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, t) in items.iter().enumerate() {
        if let Some(c) = &t.chain {
            chains.entry(c.clone()).or_default().push(i);
        }
    }
    for idx in chains.values_mut() {
        idx.sort_by(|a, b| (items[*a].date, items[*a].id()).cmp(&(items[*b].date, items[*b].id())));
        let n = idx.len();
        for (r, i) in idx.iter().enumerate() {
            items[*i].rank = r;
            items[*i].chain_len = n;
        }
    }
    for t in &mut items {
        t.coef_pct = if t.chain_len > 1 {
            p.chain_head_pct + (p.chain_tail_pct - p.chain_head_pct) * t.rank as i64 / (t.chain_len as i64 - 1)
        } else {
            (p.chain_head_pct + p.chain_tail_pct) / 2
        };
    }
    // 每家每年挑少量“够一够”：只在本家庭的门槛里挑，开局月份与硬门槛不挑。
    // 隐藏志向（第四条）一律是“够一够”（工作包 4），也算在这一年的条数里。
    let hidden_path = |t: &Threshold| {
        matches!(&t.locator, Locator::Requirement { owner, key, .. }
            if owner == "path" && defs.upbringing.paths.iter().any(|p| &p.key == key && p.hidden))
    };
    // 改投学院（11-04）：路线版事件与原版不会同局出现，各挑各的，加了路线不改原版的门槛。
    let mut by_year: BTreeMap<YearRoute, (usize, Vec<usize>)> = BTreeMap::new();
    for (i, t) in items.iter().enumerate() {
        if t.chain.is_some() && !t.hard && month(t) >= p.opening_months {
            let entry = by_year.entry((t.families[0].clone(), t.date[0], route_of(defs, t))).or_default();
            if hidden_path(t) {
                entry.0 += 1;
            } else {
                entry.1.push(i);
            }
        }
    }
    for t in &mut items {
        if hidden_path(t) && month(t) >= p.opening_months {
            t.stretch = true;
            t.coef_pct = p.stretch_pct;
        }
    }
    for (forced, lst) in by_year.values_mut() {
        lst.sort_by_key(|i| (hash(&format!("stretch:{}", items[*i].id())), *i));
        for i in lst.iter().take(p.stretch_per_year.saturating_sub(*forced)) {
            items[*i].stretch = true;
            items[*i].coef_pct = p.stretch_pct;
        }
    }
    // 目标值（在成长点／经验／评价的刻度上，千分精度）
    let mut target: Vec<i64> = vec![0; items.len()];
    for (i, t) in items.iter_mut().enumerate() {
        let spread = p.jitter_pct * 100;
        let jitter = 10_000 + (hash(&format!("jitter:{}", t.id())) % (2 * spread as u64 + 1)) as i64 - spread;
        let mut coef = t.coef_pct * jitter / 100; // 万分点
        if month(t) < p.opening_months {
            coef = coef * p.opening_pct / 100;
        }
        if !t.stretch {
            coef = coef.min(10_000);
        }
        t.coef_pct = coef / 100;
        let mut best: Option<(i64, i64, i64, i64)> = None;
        for fk in &t.families {
            let (Some(curve), Some(f)) = (curves.get(fk), defs.upbringing.family(fk)) else { continue };
            let med = growth_space(curve, t, false);
            let up = growth_space(curve, t, true);
            let mut cap = up;
            if let Some(b) = skip_bound(defs, curve, f, t) {
                let b = if t.measure == Measure::Level {
                    defs.upbringing.rules.growth_table.iter().find(|g| g.value == b).map_or(b * 100, |g| g.to)
                } else {
                    b
                };
                cap = cap.min(b);
            }
            if let Some(r) = routes.get(&t.id()) {
                cap = cap.min(if t.measure == Measure::Level {
                    defs.upbringing.rules.growth_table.iter().find(|g| g.value == *r).map_or(r * 100, |g| g.to)
                } else {
                    *r
                });
            }
            let v = (med * coef).min(cap * 10_000); // 万分刻度
            if best.is_none_or(|(bv, ..)| v < bv) {
                best = Some((v, med, up, cap));
            }
        }
        let (v, med, up, cap) = best.unwrap_or((t.old * 10_000, 0, 0, 0));
        target[i] = v;
        t.median = med;
        t.upper = up;
        t.cap = cap;
    }
    // 链内难度不减（“够一够”的门槛不参与：它本就比前后都难一截）
    for idx in chains.values() {
        let mut ratio = 0i64; // 万分点
        for i in idx {
            let t = &items[*i];
            if t.stretch || t.median <= 0 {
                continue;
            }
            let need = ratio * t.median; // 万分刻度
            if target[*i] < need {
                target[*i] = need.min(t.cap * 10_000).min(10_000 * t.median);
            }
            ratio = ratio.max(target[*i] / t.median);
        }
    }
    // 落回整数：非“够一够”向下取整（不超过中位），“够一够”向上取整
    let level =
        |v: i64| defs.upbringing.rules.growth_table.iter().find(|b| b.from <= v && v <= b.to).map_or(1, |b| b.value);
    for (i, t) in items.iter_mut().enumerate() {
        let v = if t.stretch { (target[i] + 9_999) / 10_000 } else { target[i] / 10_000 };
        t.new = v.max(0);
    }
    // 取整以后在整数上再保证一次链内不减
    for idx in chains.values() {
        let mut ratio = 0i64;
        for i in idx {
            let t = &mut items[*i];
            if t.stretch || t.median <= 0 {
                continue;
            }
            let need = (ratio * t.median + 9_999) / 10_000;
            if t.new < need {
                t.new = need.min(t.cap).min(t.median);
            }
            ratio = ratio.max(t.new * 10_000 / t.median);
        }
    }
    for t in &mut items {
        if t.measure == Measure::Level {
            t.new = level(t.new);
            t.median = level(t.median);
            t.upper = level(t.upper);
            t.cap = level(t.cap);
        }
    }
    items
}

/// 挑“够一够”的分组：家庭、年份、改投路线的旗标（原版为 None）。
type YearRoute = (String, u32, Option<String>);

/// 门槛所在的轨道只在某条改投路线里出现时（起始章条件带本家路线的选择旗标），返回那个旗标。
pub fn route_of(defs: &StaticData, t: &Threshold) -> Option<String> {
    let Locator::Story { track, .. } = &t.locator else { return None };
    let flags: Vec<&str> = t
        .families
        .iter()
        .filter_map(|k| defs.upbringing.family(k))
        .flat_map(|f| f.routes.iter().map(|r| r.flag.as_str()))
        .collect();
    let start = defs.story2.track(track).and_then(|t| t.chapter(&t.start))?;
    start.when.iter().find_map(|c| match c {
        Condition::Flag { flag, value: true } if flags.contains(&flag.as_str()) => Some(flag.clone()),
        _ => None,
    })
}

/// 全部家庭的曲线。
pub fn curves(defs: &StaticData) -> BTreeMap<String, GrowthCurve> {
    defs.upbringing
        .families
        .iter()
        .filter_map(|f| GrowthCurve::new(defs, &f.key).ok().map(|c| (f.key.clone(), c)))
        .collect()
}

/// 门槛方案（JSON 数组）；`tools/u02/apply_thresholds.py` 按它写回数据。
pub fn plan_json(items: &[Threshold]) -> String {
    serde_json::to_string_pretty(items).unwrap_or_default()
}

/// 与 U01 测试 `upbringing_thresholds_u01::start` 相同的开局：开局请求、确认家乡日程（选项 0）。
fn route_world(defs: &Arc<StaticData>, f: &FamilyDef) -> Option<World> {
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == f.scenario)?);
    let mut p = StartParams::new(sid, 42);
    p.opening = Some(NewGameRequest {
        world: defs.world_key.clone(),
        scenario: f.scenario.clone(),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U01".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    let mut w = World::from_start(defs.clone(), &p, |_| {}).ok()?;
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).ok()?;
    Some(w)
}

/// 当时当地能排的课程、训练与打工（另加“不排”）：与 U01 测试的 `courses` 相同。
fn route_courses(w: &World) -> Vec<Option<ActivityDef>> {
    std::iter::once(None)
        .chain(
            w.defs
                .upbringing
                .activities
                .iter()
                .filter(|a| {
                    matches!(a.kind, ActivityKind::Lesson | ActivityKind::Training | ActivityKind::Job)
                        && w.upbringing_risk(a) < 10_000
                        && a.needs.is_empty()
                        && w.upbringing_activity_available(a, w.cast_date()).is_ok()
                })
                .cloned()
                .map(Some),
        )
        .collect()
}

/// 每阶段专练一门、每格取收益下限、受固定年度上限的预测值：与 U01 测试的 `forecast` 相同。
fn route_forecast(w: &World, condition: &Condition, route: [(Option<&ActivityDef>, i64); 2]) -> i64 {
    let Some(s) = w.state.upbringing.as_ref() else { return 0 };
    let defs = &w.defs;
    let mut growth = s.growth.clone();
    let mut xp = match condition {
        Condition::Skill { skill, .. } => w.upbringing_skill_xp(skill),
        _ => 0,
    };
    let conduct = |i: usize| defs.captain.group(i).is_some_and(|g| g.key == "conduct");
    for (activity, slots) in route {
        let Some(a) = activity else { continue };
        for (key, range) in &a.gains {
            if key == "fortune" || key == "arcana" {
                continue;
            }
            let Some(i) = defs.captain.attribute_index(key) else { continue };
            let cap = if conduct(i) { 100 } else { 1000 };
            let gain = range[0].saturating_mul(slots).min(defs.upbringing.rules.annual_growth_cap);
            let v = growth.entry(key.clone()).or_default();
            *v = (*v + gain).clamp(0, cap);
        }
        if let Condition::Skill { skill, .. } = condition {
            xp += slots * a.skills.iter().filter(|s| &s.skill == skill).map(|s| s.xp).sum::<i64>();
        }
    }
    let projected = |i: usize| {
        let key = &defs.captain.attributes[i].key;
        let value = growth.get(key).copied().unwrap_or(0);
        if key == "arcana" {
            0
        } else if key == "fortune" || conduct(i) {
            value
        } else {
            defs.upbringing.rules.growth_table.iter().find(|b| (b.from..=b.to).contains(&value)).map_or(1, |b| b.value)
        }
    };
    match condition {
        Condition::Growth { attr, .. } => growth.get(attr).copied().unwrap_or(0),
        Condition::Skill { .. } => xp,
        Condition::Attr { attr, .. } => {
            if let Some(i) = defs.captain.attribute_index(attr) {
                return projected(i);
            }
            let Some(rating) = defs.captain.ratings.iter().find(|r| &r.key == attr) else { return 0 };
            let total: i64 = rating.weights.iter().map(|(_, w)| w).sum();
            if total == 0 {
                return 0;
            }
            rating
                .weights
                .iter()
                .map(|(i, weight)| projected(*i) * if conduct(*i) { 10 } else { 100 } * weight)
                .sum::<i64>()
                / total
        }
        _ => 0,
    }
}

/// U01 的硬规矩（`upbringing_thresholds_u01::early_critical_gates_have_routes_with_two_training_slots_per_month`）：
/// 每家关键事件 00–09 起始章选项的 attr／growth／skill 门槛，不高于“家乡专练一门 × 家乡格数 + 学院专练一门 ×
/// 学院格数”的最好结果——每月两格、每格取收益下限、受固定年度上限，评价按权重折算。键为门槛的 [`Threshold::id`]。
pub fn critical_route_bounds(defs: &Arc<StaticData>) -> BTreeMap<String, i64> {
    let mut out = BTreeMap::new();
    for f in &defs.upbringing.families {
        let (Some(w), Some(stage)) = (route_world(defs, f), f.stages.iter().find(|s| s.stage == Stage::Academy)) else {
            continue;
        };
        let mut school = w.clone();
        if let Ok(day) = manifest_core::scenario::day_of(defs, stage.from) {
            school.state.day = day;
        }
        if let (Some(place), Some(loc)) =
            (school.state.cast.place.as_mut(), defs.locations.iter().position(|l| l.key == stage.at))
        {
            place.loc = LocId::from_idx(loc);
        }
        if let (Some(flag), Some(s)) = (&stage.entry_flag, school.state.upbringing.as_mut()) {
            s.flags.insert(flag.clone());
        }
        let home = route_courses(&w);
        let schooling = route_courses(&school);
        for index in 0..10 {
            let key = format!("c9_{}_critical_{index:02}", f.key);
            let Some(chapter) = defs.story2.track(&key).and_then(|t| t.chapters.first()) else { continue };
            let Some(date) = chapter
                .when
                .iter()
                .filter_map(|c| match c {
                    Condition::Date { from, .. } => *from,
                    _ => None,
                })
                .max()
            else {
                continue;
            };
            let within = i64::from(date[2] >= 11) + i64::from(date[2] >= 21);
            let home_slots = if date[0] == 1553 { 2 * i64::from(date[1].saturating_sub(1)) + within } else { 24 };
            let school_slots = if date[0] == 1554 && date[1] > stage.from[1] {
                2 * i64::from(date[1] - stage.from[1] - 1) + within
            } else {
                0
            };
            for o in &chapter.choices {
                for (i, c) in o.requires.iter().enumerate() {
                    if !matches!(c, Condition::Attr { .. } | Condition::Growth { .. } | Condition::Skill { .. }) {
                        continue;
                    }
                    let mut best = 0;
                    for h in &home {
                        for s in &schooling {
                            best =
                                best.max(route_forecast(&w, c, [(h.as_ref(), home_slots), (s.as_ref(), school_slots)]));
                        }
                    }
                    out.insert(format!("{key}:{}:{}:{i}", chapter.key, o.key), best);
                }
            }
        }
    }
    out
}

//! 统一的条件约束（U03 / A3）：故事的 when / requires、活动与场所的解锁、短事件门槛、远足节点、考试与志向门槛
//! 都转成同一种 [`Constraint`]。两种用法：
//! - 静态：[`Reachability`] 对世界数据做不动点，求每个旗标、章节最早可能出现的日期，判断一组约束能否满足，
//!   不能时给出原因；`validate-data` 据此把永远出不来的内容判死。
//! - 动态：[`World::constraint_gaps`] 按当前状态列出没满足的项（键、显示名、现有、需要）。
//!
//! 静态判断只往宽里估（上界）：拿不准的条件一律当作可能满足，只有确定不可能时才报不可达。
use super::*;
use crate::{
    StaticData, World,
    cast::relations::Bond,
    story2::{Branch, ChapterDef, Choice, Condition, Effect},
};

/// 一条约束。`hard = false` 的属性、成长、技能门槛是软门槛（开了软门槛的世界里改为掷骰），静态判断不拿它判死。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Constraint {
    Flag {
        flag: String,
        value: bool,
    },
    /// `person` 为空时指主角。
    Age {
        person: Option<String>,
        ge: Option<u32>,
        le: Option<u32>,
    },
    Date {
        from: Option<WorldDate>,
        to: Option<WorldDate>,
    },
    Stage {
        stage: Stage,
    },
    Academy {
        academy: String,
    },
    /// 当前养成阶段的第几年（从 1 起算）。
    SchoolYear {
        year: u32,
    },
    /// 投影后的属性等级（品行与运气用原值）；评价键也走这里。
    Attr {
        attr: String,
        ge: i64,
        hard: bool,
    },
    Growth {
        attr: String,
        ge: i64,
        hard: bool,
    },
    Rating {
        rating: String,
        ge: i64,
    },
    Skill {
        skill: String,
        ge: i64,
        hard: bool,
    },
    Cash {
        ge: i64,
    },
    Affinity {
        person: String,
        ge: i64,
    },
    Bond {
        person: String,
        level: Bond,
    },
    /// 任选一组满足即可。
    Any {
        any: Vec<Vec<Constraint>>,
    },
    /// 内核另行检查的条件（地点、物品、结社、节日等）；静态视为可能满足，动态不列差项。
    Opaque {
        what: String,
    },
}

/// 没满足的一项：`key` 稳定，`label` 取数据里的显示名。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Gap {
    pub key: String,
    pub label: String,
    pub have: i64,
    pub need: i64,
}

fn opaque(what: &str) -> Constraint {
    Constraint::Opaque { what: what.into() }
}

pub fn constraint_of_condition(c: &Condition, hard: bool) -> Constraint {
    match c {
        Condition::Flag { flag, value } => Constraint::Flag { flag: flag.clone(), value: *value },
        Condition::Date { from, to } => Constraint::Date { from: *from, to: *to },
        Condition::Age { person, ge, le } => Constraint::Age { person: person.clone(), ge: *ge, le: *le },
        Condition::Attr { attr, ge } => Constraint::Attr { attr: attr.clone(), ge: *ge, hard },
        Condition::Growth { attr, ge } => Constraint::Growth { attr: attr.clone(), ge: *ge, hard },
        Condition::Skill { skill, ge } => Constraint::Skill { skill: skill.clone(), ge: *ge, hard },
        Condition::Cash { ge } => Constraint::Cash { ge: *ge },
        Condition::Affinity { person, ge } => Constraint::Affinity { person: person.clone(), ge: *ge },
        Condition::Bond { person, level } => Constraint::Bond { person: person.clone(), level: *level },
        Condition::Any { any } => {
            Constraint::Any { any: any.iter().map(|c| vec![constraint_of_condition(c, hard)]).collect() }
        }
        other => opaque(&format!("{other:?}").split([' ', '{', '(']).next().unwrap_or("condition").to_lowercase()),
    }
}

/// 章节条件：`when` 加窗口。
pub fn constraints_of_chapter(c: &ChapterDef) -> Vec<Constraint> {
    let mut out: Vec<_> = c.when.iter().map(|c| constraint_of_condition(c, true)).collect();
    if let Some(w) = c.window {
        out.push(Constraint::Date { from: Some(w[0]), to: Some(w[1]) });
    }
    out
}

/// 选项门槛；`soft_requires` 打开时属性、成长、技能门槛按软门槛处理（U02 的掷骰门槛合并后由规则开关与 hard 标记决定）。
pub fn constraints_of_choice(o: &Choice, soft_requires: bool) -> Vec<Constraint> {
    o.requires.iter().map(|c| constraint_of_condition(c, !soft_requires)).collect()
}

pub fn constraints_of_unlock(u: &Unlock) -> Vec<Constraint> {
    let mut out = Vec::new();
    out.extend(u.flag.iter().map(|f| Constraint::Flag { flag: f.clone(), value: true }));
    out.extend(u.year.map(|year| Constraint::SchoolYear { year }));
    out.extend(u.attrs.iter().map(|(a, v)| Constraint::Attr { attr: a.clone(), ge: *v, hard: true }));
    out.extend(u.growth.iter().map(|(a, v)| Constraint::Growth { attr: a.clone(), ge: *v, hard: true }));
    out.extend(u.rating.iter().map(|(a, v)| Constraint::Rating { rating: a.clone(), ge: *v }));
    out.extend(u.skills.iter().map(|(s, v)| Constraint::Skill { skill: s.clone(), ge: *v, hard: true }));
    out
}

pub fn constraints_of_requirements(r: &Requirements) -> Vec<Constraint> {
    let mut out = Vec::new();
    if let Some(flag) = &r.flag {
        out.push(Constraint::Flag { flag: flag.clone(), value: r.flag_value.unwrap_or(true) });
    }
    if let Some(attr) = &r.attr {
        out.extend(r.min.map(|ge| Constraint::Attr { attr: attr.clone(), ge, hard: true }));
        if r.max.is_some() {
            out.push(opaque("attr_max"));
        }
    }
    if let Some(RatingRequirement::Threshold(t)) = &r.rating {
        out.push(Constraint::Rating { rating: t.key.clone(), ge: t.min });
    }
    out.extend(r.year.map(|year| Constraint::SchoolYear { year }));
    for (set, what) in [
        (r.activity.is_some(), "activity"),
        (r.skill.is_some(), "skill_level"),
        (r.exam_passed.is_some(), "exam_passed"),
        (r.contest.is_some(), "contest"),
        (r.aspiration.is_some(), "aspiration"),
        (r.person.is_some() || r.bond_grade.is_some(), "bond_grade"),
        (r.fame_min.is_some() || r.fame_max.is_some(), "fame"),
        (r.cash_max.is_some(), "cash_max"),
        (r.lessons.is_some() || r.completed_slots.is_some(), "slots"),
        (r.languages_at_level.is_some(), "languages"),
        (r.academy_exam_passed.is_some() || r.exams_attempted_min.is_some() || r.exams_passed_max.is_some(), "exams"),
    ] {
        if set {
            out.push(opaque(what));
        }
    }
    for r in &r.all {
        out.extend(constraints_of_requirements(r));
    }
    if !r.any.is_empty() {
        out.push(Constraint::Any { any: r.any.iter().map(constraints_of_requirements).collect() });
    }
    out
}

/// 短事件门槛：阶段、年份、学院、起始日期、反向旗标；其余（在场、节日、来信、最近活动）交给内核。
pub fn constraints_of_gate(g: &EventGate) -> Vec<Constraint> {
    let mut out = Vec::new();
    match g.stage {
        ActivityStage::Home => out.push(Constraint::Stage { stage: Stage::Home }),
        ActivityStage::Academy => out.push(Constraint::Stage { stage: Stage::Academy }),
        ActivityStage::Any => {}
    }
    if let (Some(lo), Some(hi)) = (g.years.iter().min(), g.years.iter().max()) {
        out.push(Constraint::Date { from: Some([*lo, 1, 1]), to: Some([*hi, 12, 31]) });
    }
    out.extend(g.academy.iter().map(|a| Constraint::Academy { academy: a.clone() }));
    out.extend(g.from.map(|d| Constraint::Date { from: Some(d), to: None }));
    out.extend(g.not_flag.iter().map(|f| Constraint::Flag { flag: f.clone(), value: false }));
    if g.actors_present || g.festival.is_some() || g.letter_received || g.activity.is_some() || g.months.is_some() {
        out.push(opaque("gate_runtime"));
    }
    out
}

fn constraints_of_stage(stage: ActivityStage) -> Option<Constraint> {
    match stage {
        ActivityStage::Home => Some(Constraint::Stage { stage: Stage::Home }),
        ActivityStage::Academy => Some(Constraint::Stage { stage: Stage::Academy }),
        ActivityStage::Any => None,
    }
}

pub fn constraints_of_activity(a: &ActivityDef) -> Vec<Constraint> {
    let mut out = constraints_of_unlock(&a.unlock);
    out.extend(a.age.map(|[ge, le]| Constraint::Age { person: None, ge: Some(ge), le: Some(le) }));
    out.extend(constraints_of_stage(a.stage));
    out.extend(a.place.academy.iter().map(|k| Constraint::Academy { academy: k.clone() }));
    out
}

pub fn constraints_of_node(e: &ExcursionDef, n: &ExcursionNode) -> Vec<Constraint> {
    let mut out = constraints_of_unlock(&n.unlock);
    out.extend(n.age.map(|[ge, le]| Constraint::Age { person: None, ge: Some(ge), le: Some(le) }));
    out.extend(constraints_of_stage(e.place.stage));
    if e.place.stage == ActivityStage::Academy && !e.place.academies.is_empty() {
        out.push(Constraint::Any {
            any: e.place.academies.iter().map(|k| vec![Constraint::Academy { academy: k.clone() }]).collect(),
        });
    }
    out
}

/// story2 目标（U04 年度目标卡也用）：能写成通用条件的照条件转，其余（交货、找人、海战、发现物）记为 Opaque。
pub fn constraints_of_objective(o: &crate::story2::Objective) -> Vec<Constraint> {
    vec![o.kind.condition().map_or_else(|| opaque("objective"), |c| constraint_of_condition(&c, true))]
}

pub fn constraints_of_exam(e: &ExamDef) -> Vec<Constraint> {
    let mut out = constraints_of_requirements(&e.requirements);
    out.extend(e.academy.iter().map(|k| Constraint::Academy { academy: k.clone() }));
    out
}

// ───────────────────────── 静态可达 ─────────────────────────

/// 一个家庭（或所有家庭的并）的时间轮廓：出生、各阶段的起止、成长起点。
#[derive(Clone, Debug)]
struct Profile {
    born: (u32, u32),
    born_dates: (WorldDate, WorldDate),
    home: Option<(u32, u32)>,
    academy: Option<(u32, u32)>,
    academies: BTreeMap<String, (u32, u32)>,
    first_year: u32,
    initial: BTreeMap<String, i64>,
    act: bool,
}

/// 不动点的结果：每个旗标、轨道入口与章节最早可能出现的日子。
pub struct Reachability<'a> {
    defs: &'a StaticData,
    start: u32,
    end: Option<u32>,
    global: Option<Profile>,
    families: BTreeMap<String, Profile>,
    /// 家庭键 → `families` 里的键（第一阶段的进门旗标，没有就是家庭键）。
    family_keys: BTreeMap<String, String>,
    /// 各阶段进门旗标 → 用到它的家庭。
    entry_owners: BTreeMap<String, BTreeSet<String>>,
    /// 没做不动点时，没见过的旗标一律当作开局就可能有。
    open_flags: bool,
    monthly: BTreeMap<String, i64>,
    pub flags: BTreeMap<String, u32>,
    pub entries: BTreeMap<String, u32>,
    pub chapters: BTreeMap<(String, String), u32>,
}

fn hull(a: Option<(u32, u32)>, b: (u32, u32)) -> Option<(u32, u32)> {
    Some(a.map_or(b, |(lo, hi)| (lo.min(b.0), hi.max(b.1))))
}

/// 两份时间轮廓的并：日期取外包，开局属性取高。
fn merge(mut a: Profile, b: Profile) -> Profile {
    a.act |= b.act;
    a.born = (a.born.0.min(b.born.0), a.born.1.max(b.born.1));
    a.born_dates = (a.born_dates.0.min(b.born_dates.0), a.born_dates.1.max(b.born_dates.1));
    a.home = match (a.home, b.home) {
        (Some(x), Some(y)) => hull(Some(x), y),
        (x, y) => x.or(y),
    };
    a.academy = match (a.academy, b.academy) {
        (Some(x), Some(y)) => hull(Some(x), y),
        (x, y) => x.or(y),
    };
    for (k, v) in b.academies {
        let merged = hull(a.academies.get(&k).copied(), v).unwrap_or(v);
        a.academies.insert(k, merged);
    }
    a.first_year = a.first_year.min(b.first_year);
    for (k, v) in b.initial {
        let e = a.initial.entry(k).or_insert(v);
        *e = (*e).max(v);
    }
    a
}

impl<'a> Reachability<'a> {
    fn day(&self, d: WorldDate) -> Option<u32> {
        crate::scenario::day_of(self.defs, d).ok()
    }
    fn date(&self, day: u32) -> String {
        let d = self.defs.calendar.date_of(day);
        format!("{}-{:02}-{:02}", self.defs.rules.world.start_year + i64::from(d.year) - 1, d.month, d.day)
    }

    /// 对世界数据做不动点；故事选项门槛按硬门槛（软门槛开关合并 U02 后接入）。
    pub fn new(defs: &'a StaticData) -> Self {
        let mut r = Self::profiles(defs);
        r.open_flags = false;
        r.seed();
        r.solve();
        r
    }

    /// 只建时间轮廓、不做故事不动点：任何旗标都当作开局就可能有（`validate-data` 已保证每个解锁旗标都有来源），
    /// 只有别家的进门旗标在固定家庭时判死。给 U04 的活动列表按局判断用，便宜。
    pub fn profiles(defs: &'a StaticData) -> Self {
        let u = &defs.upbringing;
        let day = |d: WorldDate| crate::scenario::day_of(defs, d).ok();
        let mut families = BTreeMap::new();
        let mut family_keys = BTreeMap::new();
        let mut entry_owners: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        // 改投路线派生的家庭与原家庭同 key、同进门旗标：轮廓并在一起（两所学院的日期都算本家的）。
        for f in u.family_variants() {
            for s in &f.stages {
                if let Some(flag) = &s.entry_flag {
                    entry_owners.entry(flag.clone()).or_default().insert(f.key.clone());
                }
            }
        }
        let table = &u.rules.growth_table;
        for f in u.family_variants() {
            let mut p = Profile {
                born: (day(f.born).unwrap_or(0), day(f.born).unwrap_or(0)),
                born_dates: (f.born, f.born),
                home: None,
                academy: None,
                academies: BTreeMap::new(),
                first_year: f.stages.first().map_or(0, |s| s.from[0]),
                initial: BTreeMap::new(),
                act: f.act,
            };
            let end = day(f.graduation).unwrap_or(u32::MAX);
            for (i, s) in f.stages.iter().enumerate() {
                let lo = day(s.from).unwrap_or(0);
                let hi = f.stages.get(i + 1).and_then(|n| day(n.from)).map_or(end, |d| d.saturating_sub(1));
                match s.stage {
                    Stage::Home => p.home = hull(p.home, (lo, hi)),
                    Stage::Academy => p.academy = hull(p.academy, (lo, hi)),
                }
                if let Some(k) = &s.academy {
                    let v = hull(p.academies.get(k).copied(), (lo, hi)).unwrap_or((lo, hi));
                    p.academies.insert(k.clone(), v);
                }
            }
            for (i, a) in defs.captain.attributes.iter().enumerate() {
                let points = f.initial_points.get(&a.key).copied().unwrap_or(0);
                let conduct = defs.captain.group(i).is_some_and(|g| g.key == "conduct");
                // 自创出身的开局属性由玩家分配，按满格估。
                let custom = !f.templates.is_empty();
                let value = if conduct {
                    if custom { 100 } else { (50 + points * 10).clamp(0, 100) }
                } else {
                    let level = if custom { 10 } else { (1 + points).clamp(1, 10) };
                    table.iter().find(|b| b.value >= level).map_or(0, |b| b.from)
                };
                p.initial.insert(a.key.clone(), value);
            }
            let profile_key = f.stages.first().and_then(|s| s.entry_flag.clone()).unwrap_or_else(|| f.key.clone());
            family_keys.insert(f.key.clone(), profile_key.clone());
            let merged = match families.remove(&profile_key) {
                Some(prev) => merge(prev, p),
                None => p,
            };
            families.insert(profile_key, merged);
        }
        let global = families.values().cloned().reduce(merge);
        // 每月最多可得成长：三旬两格都排收益最高的活动（心情、师傅各 +10%），再加上每格一次最大的故事成长。
        let mut monthly = BTreeMap::new();
        for a in &u.activities {
            for (k, r) in &a.gains {
                let e = monthly.entry(k.clone()).or_insert(0i64);
                *e = (*e).max(
                    r[1].saturating_mul(
                        defs.rules.upbringing.act.as_ref().filter(|r| r.enabled).map_or(6, |r| r.monthly_slots_bound()),
                    ) * 121
                        / 100,
                );
            }
        }
        let mut story = BTreeMap::<String, i64>::new();
        if let Some(r) = defs.rules.upbringing.act.as_ref().filter(|r| r.enabled) {
            let duty = u.act_duties.iter().flat_map(|d| d.growth.values()).copied().max().unwrap_or(0);
            let bound = r.ladder_monthly_bound(duty);
            for a in &defs.captain.attributes {
                let v = monthly.entry(a.key.clone()).or_default();
                *v = (*v).max(bound);
            }
        }
        for e in defs
            .story2
            .tracks
            .iter()
            .flat_map(|t| &t.chapters)
            .flat_map(crate::story2::graph::branches)
            .flat_map(|b| b.effects)
        {
            if let Effect::Growth { attr, value } = e {
                let v = story.entry(attr).or_insert(0);
                *v = (*v).max(value);
            }
        }
        for (k, v) in story {
            *monthly.entry(k).or_insert(0) += v.saturating_mul(6);
        }
        let start = families
            .values()
            .filter_map(|p| p.home.or(p.academy).map(|r| r.0))
            .min()
            .or_else(|| defs.scenarios.iter().filter_map(|s| day(s.start_date)).min())
            .unwrap_or(0);
        let end = u.families.iter().filter_map(|f| day(f.graduation)).max();
        Self {
            defs,
            start,
            end,
            global,
            families,
            family_keys,
            entry_owners,
            monthly,
            open_flags: true,
            flags: BTreeMap::new(),
            entries: BTreeMap::new(),
            chapters: BTreeMap::new(),
        }
    }

    fn seed(&mut self) {
        let defs = self.defs;
        let u = &defs.upbringing;
        let grad = u.families.iter().filter_map(|f| self.day(f.graduation)).min();
        // 故事效果以外的固定来源：开局即可（往早里估），结业类的在最早的结业日，远足许可在家乡期开始满规则天数。
        for f in crate::story2::graph::external_flag_sources(defs) {
            self.flags.insert(f, self.start);
        }
        for f in crate::upbringing::GRADUATION_RESULT_FLAGS.iter().chain(&[crate::upbringing::GRADUATED_FLAG]) {
            if let Some(g) = grad {
                self.flags.insert((*f).into(), g);
            }
        }
        self.flags.remove(super::OUTING_PERMISSION_FLAG);
        if u.rules.outing_permission_days > 0
            && let Some(home) = self.families.values().filter_map(|p| p.home.map(|h| h.0)).min()
        {
            self.flags
                .insert(super::OUTING_PERMISSION_FLAG.into(), home.saturating_add(u.rules.outing_permission_days));
        }
        for capital in u
            .families
            .iter()
            .filter_map(|f| f.completion.as_ref().map(|c| &c.capital))
            .chain(u.paths.iter().map(|p| &p.capital))
        {
            for f in capital
                .grant_once
                .iter()
                .chain(capital.estate.iter().map(|e| &e.grant_once))
                .chain(capital.caravan.iter().map(|c| &c.grant_once))
            {
                if let Some(g) = grad {
                    self.flags.insert(f.clone(), g);
                }
            }
        }
        // 轨道入口：自动轨道与各处引用（人物、养成事件、结社、血脉……）开局即可；短事件按门槛；start_track 在不动点里传播。
        for t in &defs.story2.tracks {
            if t.auto {
                self.entries.insert(t.key.clone(), self.start);
            }
        }
        let patterns = crate::story2::graph::entry_patterns(defs, false);
        for t in &defs.story2.tracks {
            if let Some(g) = u.event_gates.get(&t.key) {
                if let Ok(d) = self.earliest(&constraints_of_gate(g), self.start, Some(true)) {
                    let d = if defs.rules.upbringing.cadence.as_ref().is_some_and(|r| r.enabled) {
                        super::cadence::next_week_start(defs, d)
                    } else {
                        d
                    };
                    self.lower(&t.key, d);
                }
            } else if patterns.iter().any(|p| crate::upbringing::activity_validation::event_matches(p, &t.key)) {
                self.lower(&t.key, self.start);
            }
        }
    }

    fn lower(&mut self, track: &str, day: u32) -> bool {
        let e = self.entries.entry(track.into()).or_insert(u32::MAX);
        if day < *e {
            *e = day;
            true
        } else {
            false
        }
    }

    fn solve(&mut self) {
        let defs = self.defs;
        for _ in 0..64 {
            let mut changed = false;
            for t in &defs.story2.tracks {
                let Some(entry) = self.entries.get(&t.key).copied() else { continue };
                let upbringing = (t.academy || t.upbringing).then_some(false);
                let mut pred: BTreeMap<&str, u32> = BTreeMap::from([(t.start.as_str(), entry)]);
                for _ in 0..=t.chapters.len() {
                    let mut local = false;
                    for c in &t.chapters {
                        let Some(&p) = pred.get(c.key.as_str()) else { continue };
                        let Ok(d) = self.earliest(&constraints_of_chapter(c), p, upbringing) else { continue };
                        let key = (t.key.clone(), c.key.clone());
                        if self.chapters.get(&key).is_some_and(|old| *old <= d) {
                            continue;
                        }
                        self.chapters.insert(key, d);
                        local = true;
                        changed = true;
                        let mut branches: Vec<(Branch, u32)> = Vec::new();
                        for o in &c.choices {
                            let Ok(cd) = self.earliest(&constraints_of_choice(o, false), d, upbringing) else {
                                continue;
                            };
                            branches.push((o.branch(), cd));
                            branches.extend(o.fail.iter().map(|b| (b.clone(), cd)));
                        }
                        branches.extend(c.default.iter().chain(&c.timeout).map(|b| (b.clone(), d)));
                        for (b, at) in branches {
                            for e in &b.effects {
                                match e {
                                    Effect::Flag { flag, value: true } => {
                                        let f = self.flags.entry(flag.clone()).or_insert(u32::MAX);
                                        if at < *f {
                                            *f = at;
                                            changed = true;
                                        }
                                    }
                                    Effect::StartTrack { track } | Effect::EndTrack { track } => {
                                        changed |= self.lower(track, at)
                                    }
                                    Effect::LearnSpell { .. } => {
                                        let f =
                                            self.flags.entry(super::ARCANA_AWAKENED_FLAG.into()).or_insert(u32::MAX);
                                        *f = (*f).min(at);
                                    }
                                    _ => {}
                                }
                            }
                            if let Some(next) = t.chapter(&b.next) {
                                let e = pred.entry(next.key.as_str()).or_insert(u32::MAX);
                                let gap = defs
                                    .rules
                                    .upbringing
                                    .cadence
                                    .as_ref()
                                    .filter(|r| r.enabled)
                                    .filter(|_| {
                                        t.kind != crate::story2::TrackKind::Encounter
                                            && !t.key.contains("_critical_")
                                            && !super::cadence::is_guide(t.kind)
                                    })
                                    .filter(|_| !super::events::direct_continuation(next))
                                    .map_or(0, |r| r.chain_gap_weeks.saturating_mul(7));
                                *e = (*e).min(at.saturating_add(gap));
                            }
                        }
                    }
                    if !local {
                        break;
                    }
                }
            }
            if !changed {
                break;
            }
        }
    }

    fn profile(&self, cs: &[Constraint]) -> Option<&Profile> {
        cs.iter()
            .find_map(|c| match c {
                Constraint::Flag { flag, value: true } => self.families.get(flag),
                _ => None,
            })
            .or(self.global.as_ref())
    }

    fn level(&self, attr: &str, growth: i64) -> i64 {
        let conduct = self
            .defs
            .captain
            .attribute_index(attr)
            .and_then(|i| self.defs.captain.group(i))
            .is_some_and(|g| g.key == "conduct");
        if conduct {
            return growth;
        }
        self.defs
            .upbringing
            .rules
            .growth_table
            .iter()
            .find(|b| b.from <= growth && growth <= b.to)
            .map_or(1, |b| b.value)
    }

    /// 养成期内某属性的成长上界最早达到 `need` 的日子；整段养成都达不到时返回 None。
    fn growth_day(&self, p: &Profile, attr: &str, need: i64, as_level: bool) -> Option<u32> {
        let defs = self.defs;
        if attr == "fortune" {
            return Some(self.start);
        }
        let end = self.end?;
        let cap_pct = if p.act {
            defs.rules
                .upbringing
                .act
                .as_ref()
                .filter(|r| r.enabled)
                .map_or(100, |r| r.ladder.cap_pct_by_tier.into_iter().max().unwrap_or(100))
        } else {
            100
        };
        let base_cap = if p.act && defs.rules.upbringing.act.as_ref().is_some_and(|r| r.enabled) {
            defs.upbringing
                .rules
                .annual_growth_cap_by_age
                .iter()
                .map(|v| v[1])
                .max()
                .unwrap_or(defs.upbringing.rules.annual_growth_cap)
                .max(defs.upbringing.rules.annual_growth_cap)
        } else {
            defs.upbringing.rules.annual_growth_cap
        };
        let cap = base_cap * cap_pct / 100;
        let monthly = self.monthly.get(attr).copied().unwrap_or(0);
        let mut value = p.initial.get(attr).copied().unwrap_or(0);
        let max = if defs
            .captain
            .attribute_index(attr)
            .and_then(|i| defs.captain.group(i))
            .is_some_and(|g| g.key == "conduct")
        {
            100
        } else {
            1000
        };
        let first = defs.calendar.date_of(self.start);
        let (mut year, mut month) = (defs.rules.world.start_year as u32 + first.year - 1, first.month);
        let mut used = 0;
        loop {
            let at = self.day([year, month, 1])?;
            let ok = if as_level { self.level(attr, value) >= need } else { value >= need };
            if ok {
                return Some(at.max(self.start));
            }
            if at > end {
                return None;
            }
            let gain = monthly.min(cap - used).max(0);
            used += gain;
            value = (value + gain).min(max);
            month += 1;
            if month as usize > defs.calendar.months().len() {
                month = 1;
                year += 1;
                used = 0;
            }
        }
    }

    /// 一组约束最早能在哪天同时满足（不早于 `lo`）。`upbringing = Some(true)` 表示只在养成期内有效（活动、门槛等）；
    /// `Some(false)` 为学院轨道（养成期内受成长上界限制，结业后不再受限）；None 为成年期的轨道（不估属性）。
    pub fn earliest(&self, cs: &[Constraint], lo: u32, upbringing: Option<bool>) -> Result<u32, String> {
        self.earliest_in(None, cs, lo, upbringing)
    }

    /// 同 [`Self::earliest`]，但固定按某个家庭的时间轮廓判断（U04：年度目标、本局的活动列表）。
    pub fn earliest_for(
        &self,
        family: &str,
        cs: &[Constraint],
        lo: u32,
        upbringing: Option<bool>,
    ) -> Result<u32, String> {
        let profile = self
            .family_keys
            .get(family)
            .and_then(|k| self.families.get(k))
            .ok_or_else(|| format!("没有养成家庭 {family}"))?;
        self.earliest_in(Some((family, profile)), cs, lo, upbringing)
    }

    /// 某个家庭养成期的最后一天（结业前一天）。
    pub fn family_end(&self, family: &str) -> Option<u32> {
        let f = self.defs.upbringing.family(family)?;
        self.day(f.graduation).map(|d| d.saturating_sub(1))
    }

    fn earliest_in(
        &self,
        fixed: Option<(&str, &Profile)>,
        cs: &[Constraint],
        lo: u32,
        upbringing: Option<bool>,
    ) -> Result<u32, String> {
        let mut lo = lo.max(self.start);
        let mut hi = if upbringing == Some(true) { self.end.unwrap_or(u32::MAX) } else { u32::MAX };
        let mut why = String::from("最早可能的日子");
        let profile = fixed.map(|(_, p)| p).or_else(|| self.profile(cs));
        let mut raise = |lo: &mut u32, d: u32, reason: String| {
            if d > *lo {
                *lo = d;
                why = reason;
            }
        };
        let mut late = Vec::new();
        for c in cs {
            match c {
                Constraint::Flag { flag, value: true } => {
                    // 固定家庭时，别的家庭阶段的进门旗标这一局永远不会有（U04：别家专属）。
                    if let Some((family, _)) = fixed
                        && self.entry_owners.get(flag).is_some_and(|owners| !owners.contains(family))
                    {
                        return Err(format!("旗标 {flag} 是别的家庭的进门旗标"));
                    }
                    match self.flags.get(flag) {
                        Some(d) => raise(&mut lo, *d, format!("旗标 {flag} 最早 {} 才有", self.date(*d))),
                        None if self.open_flags => {}
                        None => return Err(format!("旗标 {flag} 没有可达的来源")),
                    }
                }
                Constraint::Date { from, to } => {
                    if let Some(d) = from.and_then(|d| self.day(d)) {
                        raise(&mut lo, d, format!("日期从 {from:?} 起"));
                    }
                    if let Some(d) = to.and_then(|d| self.day(d)) {
                        hi = hi.min(d);
                        late.push(format!("日期到 {to:?} 止"));
                    }
                }
                Constraint::Age { person, ge, le } => {
                    let born = match person {
                        Some(p) => self.defs.cast.person(p).map(|p| (p.born, p.born)),
                        None => profile.map(|p| p.born_dates),
                    };
                    let Some((early, late_born)) = born else { continue };
                    if let Some(g) = ge
                        && let Some(d) = self.day([early[0] + g, early[1], early[2]])
                    {
                        raise(&mut lo, d, format!("年龄满 {g} 岁"));
                    }
                    if let Some(l) = le {
                        let cutoff = [late_born[0] + l + 1, late_born[1], late_born[2]];
                        match self.day(cutoff) {
                            Some(d) => {
                                hi = hi.min(d.saturating_sub(1));
                                late.push(format!("年龄不超过 {l} 岁"));
                            }
                            // 年龄上限落在纪年开始之前（算不出日子）：世界一开始就已经超龄，永远等不到
                            None if i64::from(cutoff[0]) < self.defs.rules.world.start_year => {
                                return Err(format!("年龄不超过 {l} 岁：世界开始时已经超龄"));
                            }
                            None => {}
                        }
                    }
                }
                Constraint::Stage { stage } => {
                    let range = profile.and_then(|p| if *stage == Stage::Home { p.home } else { p.academy });
                    let Some((a, b)) = range else {
                        if self.end.is_some() {
                            return Err(format!(
                                "没有家庭有{}阶段",
                                if *stage == Stage::Home { "家乡" } else { "学院" }
                            ));
                        }
                        continue;
                    };
                    raise(&mut lo, a, "阶段开始".into());
                    hi = hi.min(b);
                    late.push("阶段结束".into());
                }
                Constraint::Academy { academy } => {
                    // 固定家庭时只看这一家会读的学院，不退回到所有家庭的并。
                    let range = profile.and_then(|p| p.academies.get(academy).copied()).or_else(|| {
                        fixed.is_none().then(|| self.global.as_ref().and_then(|p| p.academies.get(academy).copied()))?
                    });
                    let Some((a, b)) = range else { return Err(format!("没有家庭会入读学院 {academy}")) };
                    raise(&mut lo, a, format!("入读 {academy}"));
                    hi = hi.min(b);
                    late.push(format!("{academy} 在读期结束"));
                }
                Constraint::SchoolYear { year } => {
                    if let Some(p) = profile
                        && let Some(d) = self.day([p.first_year + year.saturating_sub(1), 1, 1])
                    {
                        raise(&mut lo, d, format!("第 {year} 年"));
                    }
                }
                Constraint::Attr { attr, ge, hard: true } | Constraint::Growth { attr, ge, hard: true }
                    if upbringing.is_some() && self.defs.captain.attribute_index(attr).is_some() =>
                {
                    let as_level = matches!(c, Constraint::Attr { .. });
                    let Some(p) = profile else { continue };
                    match self.growth_day(p, attr, *ge, as_level) {
                        Some(d) => raise(&mut lo, d, format!("{attr} 的成长上界最早 {} 才到 {ge}", self.date(d))),
                        None if upbringing == Some(false) => {
                            // 学院轨道结业后改看正式属性，不再受养成上界限制。
                            if let Some(end) = self.end {
                                raise(&mut lo, end.saturating_add(1), format!("{attr} 在养成期内到不了 {ge}"));
                            }
                        }
                        None => return Err(format!("{attr} 在养成期内的成长上界到不了 {ge}")),
                    }
                }
                Constraint::Rating { rating, ge } if *ge > 1000 => return Err(format!("评价 {rating} 不可能到 {ge}")),
                Constraint::Affinity { person, ge } if *ge > 100 => {
                    return Err(format!("对 {person} 的情谊不可能到 {ge}"));
                }
                Constraint::Any { any } => {
                    let mut best: Option<u32> = None;
                    let mut reasons = Vec::new();
                    for alt in any {
                        match self.earliest_in(fixed, alt, lo, upbringing) {
                            Ok(d) => best = Some(best.map_or(d, |b| b.min(d))),
                            Err(e) => reasons.push(e),
                        }
                    }
                    match best {
                        Some(d) => raise(&mut lo, d, "任选条件".into()),
                        None => return Err(format!("任选条件都不成立：{}", reasons.join("；"))),
                    }
                }
                _ => {}
            }
        }
        if lo > hi {
            return Err(format!(
                "时间窗口错开：{why}（{}），晚于 {}（{}）",
                self.date(lo),
                late.last().map_or("截止日", String::as_str),
                self.date(hi)
            ));
        }
        Ok(lo)
    }

    /// validate-data 判死的对象：自动轨道的起始章、远足节点、活动、考试、志向、短事件门槛。
    pub fn unreachable(&self) -> Vec<String> {
        let defs = self.defs;
        let u = &defs.upbringing;
        let mut errors = Vec::new();
        for t in defs.story2.tracks.iter().filter(|t| t.auto) {
            if let Some(c) = t.chapter(&t.start)
                && let Err(e) =
                    self.earliest(&constraints_of_chapter(c), self.start, (t.academy || t.upbringing).then_some(false))
            {
                errors.push(format!("{}:{}: 自动轨道的起始章静态不可达：{e}", t.key, c.key));
            }
        }
        if u.families.is_empty() {
            return errors;
        }
        for (key, g) in &u.event_gates {
            let Some(t) = defs.story2.track(key) else { continue };
            let mut cs = constraints_of_gate(g);
            cs.extend(t.chapter(&t.start).map(constraints_of_chapter).unwrap_or_default());
            if let Err(e) = self.earliest(&cs, self.start, Some(true)) {
                errors.push(format!("{key}: 短事件静态不可达：{e}"));
            }
        }
        for a in &u.activities {
            if let Err(e) = self.earliest(&constraints_of_activity(a), self.start, Some(true)) {
                errors.push(format!("activity:{}: 活动静态不可达：{e}", a.key));
            }
        }
        for ex in &u.excursions {
            for n in &ex.nodes {
                if let Err(e) = self.earliest(&constraints_of_node(ex, n), self.start, Some(true)) {
                    errors.push(format!("excursion:{}:{}: 远足节点静态不可达：{e}", ex.key, n.key));
                }
            }
        }
        for x in &u.exams {
            if let Err(e) = self.earliest(&constraints_of_exam(x), self.start, Some(true)) {
                errors.push(format!("exam:{}: 考试静态不可达：{e}", x.key));
            }
        }
        for p in &u.paths {
            let mut cs = constraints_of_requirements(&p.requirements);
            if p.hidden {
                cs.extend(constraints_of_requirements(&p.reveal));
            }
            if let Err(e) = self.earliest(&cs, self.start, Some(true)) {
                errors.push(format!("path:{}: 志向静态不可达：{e}", p.key));
            }
        }
        errors
    }
}

// ───────────────────────── 动态差项 ─────────────────────────

fn bond_rank(b: Option<Bond>) -> i64 {
    match b {
        None => 0,
        Some(Bond::C) => 1,
        Some(Bond::B) => 2,
        Some(Bond::A) => 3,
        Some(Bond::S) => 4,
    }
}

impl World {
    pub(crate) fn attr_label(&self, key: &str) -> String {
        self.defs
            .captain
            .attributes
            .iter()
            .find(|a| a.key == key)
            .map(|a| a.name.clone())
            .or_else(|| self.defs.captain.ratings.iter().find(|r| r.key == key).map(|r| r.name.clone()))
            .unwrap_or_else(|| key.into())
    }
    pub(crate) fn person_label(&self, key: &str) -> String {
        self.defs.cast.person(key).map_or_else(|| key.into(), |p| p.name.clone())
    }

    /// 按当前状态列出没满足的约束；`entered` 只供日后的等待类条件使用。不改世界。
    pub fn constraint_gaps(&self, cs: &[Constraint]) -> Vec<Gap> {
        let mut gaps = Vec::new();
        let day = i64::from(self.day());
        let date_day = |d: WorldDate| crate::scenario::day_of(&self.defs, d).map_or(0, i64::from);
        let age = |person: &Option<String>| -> i64 {
            let date = self.cast_date();
            person
                .as_ref()
                .map_or_else(
                    || self.state.protagonist.as_ref().and_then(|p| p.age_on(date)),
                    |p| self.defs.cast.person(p).and_then(|p| p.age_on(date)),
                )
                .map_or(0, i64::from)
        };
        for c in cs {
            let mut gap = |key: String, label: String, have: i64, need: i64| gaps.push(Gap { key, label, have, need });
            match c {
                Constraint::Flag { flag, value } => {
                    let set = self.upbringing_flag(flag);
                    if set != *value {
                        gap(format!("flag:{flag}"), flag.clone(), i64::from(set), i64::from(*value));
                    }
                }
                Constraint::Age { person, ge, le } => {
                    let a = age(person);
                    let label = person.as_deref().map_or_else(|| "年龄".into(), |p| self.person_label(p));
                    if let Some(g) = ge.filter(|g| a < i64::from(*g)) {
                        gap("age:ge".into(), label.clone(), a, i64::from(g));
                    }
                    if let Some(l) = le.filter(|l| a > i64::from(*l)) {
                        gap("age:le".into(), label, a, i64::from(l));
                    }
                }
                Constraint::Date { from, to } => {
                    if let Some(f) = from.filter(|f| day < date_day(*f)) {
                        gap("date:from".into(), format!("{}-{}-{}", f[0], f[1], f[2]), day, date_day(f));
                    }
                    if let Some(t) = to.filter(|t| day > date_day(*t)) {
                        gap("date:to".into(), format!("{}-{}-{}", t[0], t[1], t[2]), day, date_day(t));
                    }
                }
                Constraint::Stage { stage } => {
                    let now = self.upbringing_stage_on(self.cast_date()).map(|s| s.stage);
                    if now != Some(*stage) {
                        gap(format!("stage:{stage:?}").to_lowercase(), format!("{stage:?}"), 0, 1);
                    }
                }
                Constraint::Academy { academy } => {
                    if self.upbringing_academy().is_none_or(|a| &a.key != academy) {
                        let label =
                            self.defs.upbringing.academy(academy).map_or_else(|| academy.clone(), |a| a.name.clone());
                        gap(format!("academy:{academy}"), label, 0, 1);
                    }
                }
                Constraint::SchoolYear { year } => {
                    let date = self.cast_date();
                    let have =
                        self.upbringing_stage_on(date).map_or(0, |s| i64::from(date[0].saturating_sub(s.from[0]) + 1));
                    if have < i64::from(*year) {
                        gap("school_year".into(), "学年".into(), have, i64::from(*year));
                    }
                }
                Constraint::Attr { attr, ge, .. } => {
                    let have = self.story2_check_value(attr);
                    if have < *ge {
                        gap(format!("attr:{attr}"), self.attr_label(attr), have, *ge);
                    }
                }
                Constraint::Growth { attr, ge, .. } => {
                    let have = self.upbringing_growth(attr);
                    if have < *ge {
                        gap(format!("growth:{attr}"), self.attr_label(attr), have, *ge);
                    }
                }
                Constraint::Rating { rating, ge } => {
                    let have = self.upbringing_rating(rating);
                    if have < *ge {
                        gap(format!("rating:{rating}"), self.attr_label(rating), have, *ge);
                    }
                }
                Constraint::Skill { skill, ge, .. } => {
                    let have = self.upbringing_skill_xp(skill);
                    if have < *ge {
                        let label = self
                            .defs
                            .story2
                            .skill_labels
                            .iter()
                            .find(|l| &l.key == skill)
                            .map_or_else(|| skill.clone(), |l| l.name.clone());
                        gap(format!("skill:{skill}"), label, have, *ge);
                    }
                }
                Constraint::Cash { ge } => {
                    let have = self.state.agents.get(&crate::OwnerId::Player).map_or(0, |a| a.cash);
                    if have < *ge {
                        gap("cash".into(), "现款".into(), have, *ge);
                    }
                }
                Constraint::Affinity { person, ge } => {
                    let have = self.affection(person).map_or(0, |a| a.affinity);
                    if have < *ge {
                        gap(format!("affinity:{person}"), self.person_label(person), have, *ge);
                    }
                }
                Constraint::Bond { person, level } => {
                    let have = bond_rank(self.affection(person).and_then(|a| a.bond));
                    if have < bond_rank(Some(*level)) {
                        gap(format!("bond:{person}"), self.person_label(person), have, bond_rank(Some(*level)));
                    }
                }
                Constraint::Any { any } => {
                    let best = any.iter().map(|alt| self.constraint_gaps(alt)).min_by_key(Vec::len);
                    if let Some(best) = best.filter(|g| !g.is_empty()) {
                        gaps.extend(best);
                    }
                }
                Constraint::Opaque { .. } => {}
            }
        }
        gaps
    }
}

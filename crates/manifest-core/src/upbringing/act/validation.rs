use super::*;
use crate::StaticData;
fn places<'a>(d: &'a StaticData, f: &'a FamilyDef, stage: Stage, academy: &str) -> Option<&'a [PlaceDef]> {
    let valid = std::iter::once(f)
        .chain(f.routed.iter().map(|(_, v)| v))
        .flat_map(|f| &f.stages)
        .any(|s| s.stage == stage && s.academy.as_deref().unwrap_or("") == academy);
    if !valid {
        return None;
    }
    if stage == Stage::Home { Some(&f.places) } else { d.upbringing.academy(academy).map(|a| a.places.as_slice()) }
}
fn family_places<'a>(d: &'a StaticData, f: &'a FamilyDef) -> Vec<&'a PlaceDef> {
    let mut out: Vec<_> = f.places.iter().collect();
    for route in std::iter::once(f).chain(f.routed.iter().map(|(_, v)| v)) {
        for a in route.stages.iter().filter_map(|s| s.academy.as_deref()).filter_map(|k| d.upbringing.academy(k)) {
            out.extend(a.places.iter());
        }
    }
    out.extend(
        d.upbringing.act_voyages.iter().filter(|v| v.family == f.key).flat_map(|v| &v.legs).flat_map(|l| &l.places),
    );
    out
}
fn requirements(d: &StaticData, r: &Requirements, depth: u8) -> bool {
    depth < 12
        && r.all.iter().chain(&r.any).all(|r| requirements(d, r, depth + 1))
        && r.attr.as_ref().is_none_or(|k| d.captain.attribute_index(k).is_some())
        && r.skill.as_ref().is_none_or(|k| d.story2.skills.contains(k))
        && r.person.as_ref().is_none_or(|k| d.cast.person(k).is_some())
        && r.activity.as_ref().is_none_or(|k| d.upbringing.activity(k).is_some())
        && r.exam_passed.as_ref().is_none_or(|k| d.upbringing.exams.iter().any(|e| &e.key == k))
        && r.contest.as_ref().is_none_or(|k| d.upbringing.contests.iter().any(|e| &e.key == k))
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut out = Vec::new();
    let r = d.rules.upbringing.act.clone().unwrap_or_default();
    out.extend(r.problems());
    if r.enabled
        && (d.rules.upbringing.weekly.is_none() || !d.rules.upbringing.cadence.as_ref().is_some_and(|r| r.enabled))
    {
        out.push("行动制要求 weekly 与 cadence 同时启用".into());
    }
    if d.captain.attribute_index(&r.pray.attr).is_none() && d.rules.upbringing.act.is_some() {
        out.push("行动制参拜引用未知属性".into());
    }
    let mut keys = BTreeSet::new();
    for line in &d.upbringing.lines {
        let mut check = |ok: bool, msg: &str| {
            if !ok {
                out.push(format!("{}:{}：{msg}", line.source, line.key));
            }
        };
        check(
            keys.insert(&line.key) && !line.key.is_empty() && !line.name.trim().is_empty(),
            "门键重复、为空或名称为空",
        );
        let f = d.upbringing.family(&line.family);
        check(f.is_some_and(|f| f.act), "门须属于启用行动制的家庭");
        let p = f.and_then(|f| places(d, f, line.stage, &line.academy));
        check(p.is_some_and(|p| p.iter().any(|p| p.key == line.place)), "门的阶段或地点不属于家庭及其路线");
        check((1..=4).contains(&line.tiers.len()), "门须有 1–4 档");
        check(
            line.attr.iter().chain(&line.side).chain(&line.root).all(|a| d.captain.attribute_index(a).is_some())
                && line.skill.as_ref().is_none_or(|s| d.story2.skills.contains(s))
                && line.mentor.as_ref().is_none_or(|p| d.cast.person(p).is_some()),
            "K2 字段引用未知键",
        );
        for tier in &line.tiers {
            let a = d.upbringing.activity(&tier.activity);
            check(a.is_some(), "档引用未知活动");
            if let Some(a) = a {
                check(
                    matches!(
                        a.kind,
                        ActivityKind::Lesson | ActivityKind::Training | ActivityKind::Club | ActivityKind::Craft
                    ),
                    "活动种类不能排入课线",
                );
                check(
                    a.stage.allows(line.stage) && a.place.academy.as_ref().is_none_or(|k| *k == line.academy),
                    "档活动与门的阶段不符",
                );
                let stage = f
                    .into_iter()
                    .flat_map(|f| std::iter::once(f).chain(f.routed.iter().map(|(_, f)| f)))
                    .flat_map(|f| &f.stages)
                    .find(|s| s.stage == line.stage && s.academy.as_deref().unwrap_or("") == line.academy);
                let loc = stage.and_then(|s| d.locations.iter().find(|l| l.key == s.at));
                check(a.place.at.as_ref().is_none_or(|at| loc.is_some_and(|l| l.key == *at)), "档活动不在阶段城市");
                if let Some(feature) = &a.place.feature {
                    let venues = p.unwrap_or(&[]);
                    let exists = match feature.as_str() {
                        "school" => venues.iter().any(|p| p.venue == "classroom"),
                        "library" => venues.iter().any(|p| p.venue == "library"),
                        "lodging" => venues.iter().any(|p| ["home", "dorm"].contains(&p.venue.as_str())),
                        "dock" => loc.is_some_and(|l| l.is_port()),
                        "shipyard" => loc.is_some_and(|l| !l.shipyard.is_empty()),
                        "shop" => loc.is_some_and(|l| l.shop),
                        "market" => loc.is_some_and(|l| !l.market.is_empty()),
                        "workplace" => {
                            venues.iter().any(|p| ["market", "dock", "workshop"].contains(&p.venue.as_str()))
                        }
                        "workshop" => {
                            venues.iter().any(|p| p.venue == "workshop") || loc.is_some_and(|l| !l.shipyard.is_empty())
                        }
                        "settlement" => loc.is_some_and(|l| l.is_port() || !l.market.is_empty()),
                        _ => false,
                    };
                    check(exists, "当地缺少档活动所需设施");
                }
            }
            check(
                tier.requires.as_ref().is_none_or(|r| match r {
                    LineRequires::Legacy(r) => requirements(d, r, 0),
                    LineRequires::Lines(_) => true,
                }),
                "档前置引用未知键",
            );
            check(tier.gate.as_deref().is_none_or(|s| s == "master_test"), "未知开档方式");
        }
    }
    for f in d.upbringing.families.iter().filter(|f| f.act) {
        let stages: BTreeSet<_> = std::iter::once(f)
            .chain(f.routed.iter().map(|(_, f)| f))
            .flat_map(|f| &f.stages)
            .map(|s| lessons::stage_key(s.stage, s.academy.as_deref().unwrap_or("")))
            .collect();
        for key in stages {
            if !d.upbringing.lines.iter().any(|l| l.family == f.key && lessons::stage_key(l.stage, &l.academy) == key) {
                out.push(format!("{}:{key} 缺少门", f.key));
            }
            if r.stages.iter().any(|s| s == "family_duty") {
                let count = d
                    .upbringing
                    .act_duties
                    .iter()
                    .filter(|d| d.family == f.key && lessons::stage_key(d.stage, &d.academy) == key)
                    .count();
                if !(1..=3).contains(&count) {
                    out.push(format!("{}:{key} 家业须有 1–3 条", f.key));
                }
            }
        }
    }
    let mut keys = BTreeSet::new();
    for p in &d.upbringing.act_places {
        let f = d.upbringing.family(&p.family);
        let ok = f.is_some_and(|f| f.act && family_places(d, f).iter().any(|x| x.key == p.place));
        if !ok
            || !keys.insert((&p.family, &p.place))
            || p.actions.len() > 5
            || p.actions.iter().collect::<BTreeSet<_>>().len() != p.actions.len()
            || p.actions.iter().any(|s| {
                !["job", "talk", "gift", "marker", "rest", "pray", "self_study", "excursion", "rumor"]
                    .contains(&s.as_str())
            })
            || p.jobs.iter().any(|k| d.upbringing.activity(k).is_none_or(|a| a.kind != ActivityKind::Job))
            || p.shop.iter().any(|s| {
                d.items.item(&s.item).is_none_or(|i| {
                    i.protected() || s.price.unwrap_or(i.price) < i.price * d.rules.items.sell_bp / 10_000
                })
            })
            || p.shop.iter().map(|s| &s.item).collect::<BTreeSet<_>>().len() != p.shop.len()
        {
            out.push(format!("{}:{} 行动地点、工种或货架无效", p.source, p.place));
        }
    }
    let mut keys = BTreeSet::new();
    for t in &d.upbringing.act_timetables {
        let stage = lessons::stage_key(t.stage, &t.academy);
        let count = if t.stage == Stage::Home { r.lessons.home } else { r.lessons.academy };
        if !keys.insert((&t.family, stage))
            || t.slots.len() != usize::from(count)
            || d.upbringing.family(&t.family).is_none_or(|f| !f.act || places(d, f, t.stage, &t.academy).is_none())
            || t.slots.iter().any(|p| {
                d.upbringing.lines.iter().find(|l| l.key == p.line).is_none_or(|l| {
                    l.family != t.family
                        || l.stage != t.stage
                        || l.academy != t.academy
                        || usize::from(p.tier) >= l.tiers.len()
                }) || p.with.as_ref().is_some_and(|p| d.cast.person(p).is_none())
            })
        {
            out.push(format!("{}:{} 缺省课表无效", t.source, t.family));
        }
    }
    let mut keys = BTreeSet::new();
    for duty in &d.upbringing.act_duties {
        if !keys.insert(&duty.key)
            || duty.key.is_empty()
            || duty.name.trim().is_empty()
            || duty.desc.trim().is_empty()
            || d.upbringing
                .family(&duty.family)
                .is_none_or(|f| !f.act || places(d, f, duty.stage, &duty.academy).is_none())
            || duty.cash[0] < 0
            || duty.cash[0] > duty.cash[1]
            || duty.growth.iter().any(|(k, v)| d.captain.attribute_index(k).is_none() || !(0..=1000).contains(v))
            || duty.skills.iter().any(|(k, v)| !d.story2.skills.contains(k) || !(0..=10000).contains(v))
            || duty.affinity.iter().any(|(k, v)| d.cast.person(k).is_none() || !(-100..=100).contains(v))
        {
            out.push(format!("{}:{} 家业无效", duty.source, duty.key));
        }
    }
    for g in &d.upbringing.act_greetings {
        if d.upbringing.family(&g.family).is_none_or(|f| !f.act)
            || d.cast.person(&g.person).is_none()
            || g.seasons.iter().any(|s| *s > 3)
            || g.seasons.iter().collect::<BTreeSet<_>>().len() != g.seasons.len()
            || g.lines.iter().any(|s| s.chars().count() > 40)
            || g.lines.len() > u16::MAX as usize
        {
            out.push(format!("{}:{} 寒暄池无效", g.source, g.person));
        }
    }
    let mut keys = BTreeSet::new();
    for m in &d.upbringing.act_markers {
        let track = d.story2.track(&m.track);
        if !keys.insert(&m.track)
            || !d.upbringing.event_gates.contains_key(&m.track)
            || track.is_none()
            || m.person.as_ref().is_some_and(|p| d.cast.person(p).is_none())
            || m.key.iter().flatten().any(|k| track.is_none_or(|t| t.chapter(k).is_none()))
            || m.places.iter().any(|(k, p)| {
                track.is_none_or(|t| t.chapter(k).is_none())
                    || !d
                        .upbringing
                        .families
                        .iter()
                        .any(|f| f.act && family_places(d, f).iter().any(|place| place.key == *p))
            })
        {
            out.push(format!("{}:{} 标记补充无效", m.source, m.track));
        }
    }
    for (aliases, p) in d
        .upbringing
        .families
        .iter()
        .map(|f| (&f.venue_aliases, f.places.as_slice()))
        .chain(d.upbringing.academies.iter().map(|a| (&a.venue_aliases, a.places.as_slice())))
    {
        if aliases.iter().any(|(k, v)| k.is_empty() || !p.iter().any(|p| p.venue == *v)) {
            out.push("行动制场所别名无效".into());
        }
    }
    out.extend(k2_validation::validate(d));
    out.extend(validate_k3(d));
    out.extend(validate_voyages(d));
    out
}
impl World {
    /// K1 的整数与零头按旧档位区间折成 K2 点数；已有非零 K2 点数时不再补算。
    pub(crate) fn reconcile_act(&mut self) {
        if !self.act_running() {
            return;
        }
        let stage = self.act_stage_key();
        let mut templates = self.state.upbringing.as_ref().map(|s| s.act.free_templates.clone()).unwrap_or_default();
        if let Some(s) = &mut self.state.upbringing {
            let legacy = std::mem::take(&mut s.act.free_template);
            if !legacy.is_empty() {
                templates.entry(stage).or_insert(legacy);
            }
        }
        for steps in templates.values_mut() {
            *steps = steps.iter().filter_map(|step| self.act_normalize_free_step(step)).collect();
        }
        if let Some(s) = &mut self.state.upbringing {
            s.act.free_templates = templates;
        }
        let rumors: BTreeSet<_> = self.defs.upbringing.act_rumors.iter().map(|r| r.key.as_str()).collect();
        let goods: BTreeSet<_> = self.defs.goods.iter().map(|g| g.key.as_str()).collect();
        let known_after = self.act_rules().map_or(3, |r| r.rumor.known_after);
        if let Some(s) = &mut self.state.upbringing {
            s.act.rumors.retain(|key, _| rumors.contains(key.as_str()));
            s.act.goods_seen.retain(|key, _| goods.contains(key.as_str()));
            for n in s.act.goods_seen.values_mut() {
                *n = (*n).min(known_after);
            }
            s.act.voyages.retain(|key, _| {
                self.defs.upbringing.act_voyages.iter().any(|v| v.key == *key && v.family == s.family)
            });
            if s.act.voyage.as_ref().is_some_and(|v| {
                self.defs
                    .upbringing
                    .act_voyages
                    .iter()
                    .find(|d| d.key == v.key && d.family == s.family)
                    .is_none_or(|d| v.leg >= d.weeks)
            }) {
                s.act.voyage = None;
            }
        }
        if self.state.upbringing.as_ref().is_some_and(|s| s.act.jobs.values().all(|points| *points == 0)) {
            let r = self.act_rules().cloned().unwrap_or_default();
            let mut jobs = BTreeMap::<String, u32>::new();
            for a in self.defs.upbringing.activities.iter().filter(|a| a.kind == ActivityKind::Job) {
                let Some(tier) = &a.tier else { continue };
                let level = self.act_job_level(a);
                if tier.branch.as_ref().is_some_and(|branch| !self.upbringing_flag(branch)) {
                    continue;
                }
                let carry = self
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.act.carry.get(&format!("job:{}", tier.group)))
                    .copied()
                    .unwrap_or(0);
                let progress = i64::from(self.upbringing_job_progress(&tier.group)) * 1000 + carry;
                let from = i64::from(tier.after) * 1000;
                if progress == 0 || progress < from {
                    continue;
                }
                let start = r.job_promote[level];
                let points = if let Some(next) = r.job_promote.get(level + 1).filter(|_| tier.next > tier.after) {
                    let span = i64::from(tier.next - tier.after) * 1000;
                    i64::from(start)
                        + ((progress - from).min(span) * i64::from(next.saturating_sub(start)) + span / 2) / span
                } else {
                    i64::from(start)
                };
                let entry = jobs.entry(tier.group.clone()).or_default();
                *entry = (*entry).max(points as u32);
            }
            if let Some(s) = &mut self.state.upbringing {
                s.act.jobs = jobs;
            }
        }
        if self.state.upbringing.as_ref().and_then(|s| s.act.opened.as_ref()).is_some_and(|s| s.score.is_none()) {
            let score = self.act_score().total;
            if let Some(opened) = self.state.upbringing.as_mut().and_then(|s| s.act.opened.as_mut()) {
                opened.score = Some(score);
            }
        }
    }
    pub(crate) fn act_snapshot_problem(&self) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let a = &s.act;
        if !a.on {
            return !a.is_default();
        }
        let r = self.act_rules().cloned().unwrap_or_default();
        let week = week_index(&self.defs, self.day());
        !self.upbringing_family().is_some_and(|f| f.act)
            || !s.weekly.on
            || a.week > week
            || a.points > a.points_max
            || a.points_max > 12
            || matches!(a.phase, ActPhase::Story | ActPhase::Voyage)
            || a.carry.values().any(|v| !(1..=999).contains(v))
            || a.timetables.iter().any(|(key, p)| {
                ![usize::from(r.lessons.home), usize::from(r.lessons.academy)].contains(&p.len())
                    || p.iter().any(|p| {
                        self.defs.upbringing.lines.iter().find(|l| l.key == p.line).is_none_or(|l| {
                            l.family != s.family
                                || lessons::stage_key(l.stage, &l.academy) != *key
                                || usize::from(p.tier) >= l.tiers.len()
                        })
                    })
            })
            || a.templates.iter().any(|(_, t)| {
                t.len() > usize::from(r.templates)
                    || t.iter().any(|p| {
                        !p.is_empty()
                            && ![usize::from(r.lessons.home), usize::from(r.lessons.academy)].contains(&p.len())
                    })
            })
            || a.markers.iter().any(|(key, m)| {
                !self.defs.upbringing.act_index.tracks.contains_key(key)
                    || m.since_week > m.expires_week
                    || m.since_week > week
                    || m.cooldown_until > week + r.marker.missed_cooldown_weeks
                    || m.missed > r.marker.rehang.saturating_add(1)
            })
            || a.due.iter().any(|(key, d)| {
                !self.defs.upbringing.act_index.tracks.contains_key(key)
                    || (self.act_running() && (*d < self.day() || *d > self.day().saturating_add(7)))
            })
            || a.greeted.values().any(|w| *w > week)
            || a.rumors.values().any(|w| *w > week)
            || a.voyage.as_ref().is_some_and(|v| {
                self.defs.upbringing.act_voyages.iter().find(|d| d.key == v.key && d.family == s.family).is_none_or(
                    |d| v.leg >= d.weeks || v.start_week > week || week >= v.start_week + u32::from(d.weeks),
                ) || v.plan.len() > 3
                    || a.moment.is_some()
                    || v.plan.iter().any(|p| {
                        self.defs
                            .upbringing
                            .lines
                            .iter()
                            .find(|l| l.key == p.line)
                            .is_none_or(|l| l.family != s.family || usize::from(p.tier) >= l.tiers.len())
                            || p.with.is_some()
                    })
            })
            || a.duty_week.is_some_and(|w| w > week)
            || a.restaged_week.is_some_and(|w| w > week)
            || a.lines
                .iter()
                .any(|(key, l)| l.used > 15 || l.seen > 15 || !self.defs.upbringing.lines.iter().any(|d| &d.key == key))
            || a.free_templates.iter().any(|(stage, steps)| {
                !self
                    .defs
                    .upbringing
                    .lines
                    .iter()
                    .any(|l| l.family == s.family && lessons::stage_key(l.stage, &l.academy) == *stage)
                    || steps.len() > usize::from(r.points.home.max(r.points.academy) + r.points.bonus_max) + 1
            })
            || usize::from(a.free_applied) > a.done.len()
            || a.free_skipped.iter().any(|skip| {
                usize::from(skip.step) > usize::from(r.points.home.max(r.points.academy) + r.points.bonus_max)
                    || !crate::error::REASON_CODES
                        .iter()
                        .chain(crate::error::ERROR_CODES)
                        .any(|(code, _)| *code == skip.reason)
            })
            || a.done.iter().any(|d| d.cost != d.action.cost() || d.result.index >= 7)
            || self.act_k2_snapshot_problem()
    }
}

fn validate_voyages(d: &StaticData) -> Vec<String> {
    let mut out = Vec::new();
    let mut keys = BTreeSet::new();
    let mut place_keys = d
        .upbringing
        .families
        .iter()
        .flat_map(|f| &f.places)
        .chain(d.upbringing.academies.iter().flat_map(|a| &a.places))
        .map(|p| p.key.as_str())
        .collect::<BTreeSet<_>>();
    for v in &d.upbringing.act_voyages {
        let family = d.upbringing.family(&v.family);
        let start = crate::scenario::day_of(d, v.start).ok();
        let end = start.map(|day| {
            let week = week_index(d, day) + u32::from(v.weeks);
            let month = week / 4;
            [d.rules.world.start_year as u32 + month / 12, month % 12 + 1, 1 + week % 4 * 7]
        });
        let dates_ok = family.is_some_and(|f| {
            std::iter::once(f).chain(f.routed.iter().map(|(_, f)| f)).all(|f| {
                start.is_some()
                    && end.is_some_and(|end| {
                        f.stages.first().is_some_and(|s| s.from <= v.start)
                            && end <= f.graduation
                            && f.stages.iter().all(|s| s.from <= v.start || s.from >= end)
                    })
            })
        });
        let companion = v.requires.person.as_ref().is_none_or(|(p, level)| {
            (1..=4).contains(level)
                && family.is_some_and(|f| {
                    f.companions.contains_key(p)
                        || std::iter::once(f)
                            .chain(f.routed.iter().map(|(_, f)| f))
                            .flat_map(|f| &f.stages)
                            .filter_map(|s| s.academy.as_deref())
                            .filter_map(|key| d.upbringing.academy(key))
                            .any(|a| a.companions.contains_key(p))
                })
        });
        let references = v
            .requires
            .after
            .iter()
            .chain(&v.excludes)
            .all(|key| d.upbringing.act_voyages.iter().any(|other| other.key == *key && other.family == v.family));
        let mut legs_ok = true;
        for leg in &v.legs {
            legs_ok &= !leg.places.is_empty()
                && d.locations.iter().any(|l| l.key == leg.port)
                && leg
                    .people
                    .iter()
                    .all(|(key, place)| d.cast.person(key).is_some() && leg.places.iter().any(|p| p.key == *place));
            for place in &leg.places {
                legs_ok &= place_keys.insert(&place.key);
            }
        }
        if !keys.insert(&v.key)
            || v.key.is_empty()
            || v.weeks == 0
            || usize::from(v.weeks) != v.legs.len()
            || ![1, 8, 15, 22].contains(&v.start[2])
            || !dates_ok
            || !companion
            || !references
            || !legs_ok
            || !family.is_some_and(|f| f.act)
            || !d.upbringing.lines.iter().any(|l| l.family == v.family && l.key == v.line)
            || !["race", "identify"].contains(&v.gate.game.as_str())
            || d.captain.attribute_index(&v.gate.attr).is_none()
        {
            out.push(format!("{} 见习出海的日期、程数或引用无效", v.key));
        }
    }
    out
}

fn validate_k3(d: &StaticData) -> Vec<String> {
    let mut out = Vec::new();
    let groups: BTreeSet<_> =
        d.upbringing.activities.iter().filter(|a| a.kind == ActivityKind::Job).map(job_group).collect();
    let goods: BTreeSet<_> = d.goods.iter().map(|g| g.key.as_str()).collect();
    let mut keys = BTreeSet::new();
    for t in &d.upbringing.act_tides {
        for (field, text) in [("name", &t.name), ("desc", &t.desc)] {
            if text.as_ref().is_some_and(|text| text.trim().is_empty()) {
                out.push(format!("{}:{} 潮汐 {field} 不能为空", t.source_file, t.key));
            }
        }
        if !keys.insert((&t.port, &t.key))
            || !d.locations.iter().any(|l| l.key == t.port)
            || t.months.iter().any(|m| !(1..=12).contains(m))
            || t.jobs.iter().any(|(k, v)| !groups.contains(k.as_str()) || !(-100..=100).contains(v))
            || t.people.iter().any(|p| d.cast.person(p).is_none())
            || t.closed.iter().any(|key| {
                key.split_once(':').is_none_or(|(e, n)| {
                    !d.upbringing.excursions.iter().any(|e2| e2.key == e && e2.nodes.iter().any(|n2| n2.key == n))
                })
            })
            || t.duty_fail
                .iter()
                .any(|(key, pct)| !d.upbringing.act_duties.iter().any(|d| d.key == *key) || !(-100..=100).contains(pct))
        {
            out.push(format!("{}:{} 潮汐引用或百分比无效", t.source_file, t.key));
        }
    }
    let mut keys = BTreeSet::new();
    for r in &d.upbringing.act_rumors {
        if r.text.as_ref().is_some_and(|text| text.trim().is_empty()) {
            out.push(format!("{}:{} 见闻卡 text 不能为空", r.source, r.key));
        }
        if !keys.insert(&r.key)
            || !d.locations.iter().any(|l| l.key == r.port && l.is_port())
            || !["demand", "supply", "pirates"].contains(&r.kind.as_str())
            || !(r.kind == "pirates" && r.good.is_empty() || goods.contains(r.good.as_str()))
            || r.heard.iter().any(|key| !d.locations.iter().any(|l| l.key == *key))
            || r.valid[0] > r.valid[1]
            || !r.person.is_empty() && d.cast.person(&r.person).is_none()
        {
            out.push(format!("{}:{} 见闻卡引用或日期无效", r.source, r.key));
        }
    }
    let mut keys = BTreeSet::new();
    for p in &d.upbringing.act_perks {
        let family = d.upbringing.family(&p.family);
        let companion = family.is_some_and(|f| {
            f.companions.contains_key(&p.person)
                || std::iter::once(f)
                    .chain(f.routed.iter().map(|(_, f)| f))
                    .flat_map(|f| &f.stages)
                    .filter_map(|s| s.academy.as_deref())
                    .filter_map(|k| d.upbringing.academy(k))
                    .any(|a| a.companions.contains_key(&p.person))
        });
        if !keys.insert((&p.person, p.level))
            || !companion
            || !(1..=4).contains(&p.level)
            || !["rumor", "job_partner", "companion", "teach", "introduce"].contains(&p.kind.as_str())
            || p.kind == "teach"
                && !d.upbringing.lines.iter().any(|l| l.key == p.line && l.family == p.family && l.tiers.len() >= 3)
            || p.kind == "introduce" && p.flag.is_empty()
        {
            out.push(format!("{}:{} 人物好处无效", p.source, p.person));
        }
    }
    for p in &d.upbringing.act_places {
        if p.job_goods
            .iter()
            .any(|(group, list)| !groups.contains(group.as_str()) || list.iter().any(|g| !goods.contains(g.as_str())))
        {
            out.push(format!("{}:{} 识货簿引用无效", p.source, p.place));
        }
    }
    for m in &d.upbringing.act_markers {
        if m.levels.iter().any(|(key, level)| {
            !(1..=4).contains(level) || d.story2.track(&m.track).is_none_or(|t| t.chapter(key).is_none())
        }) {
            out.push(format!("{}:{} 章节等级无效", m.source, m.track));
        }
    }
    out
}

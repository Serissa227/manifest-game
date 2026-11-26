use super::*;
use crate::{story2::deeds::Deed, text::TextArg};
use settlement::ActScale;

#[derive(Clone, Debug, Serialize)]
pub struct ActPlaceAction {
    pub kind: String,
    pub cost: u8,
    pub enabled: bool,
    pub reason: Option<String>,
    pub targets: Vec<String>,
}
/// 自由日的停因每次按当前状态重算，不另存自动推进状态。
#[derive(Clone, Debug)]
pub struct ActFreeStop {
    pub step: Option<u8>,
    pub targets: Vec<String>,
    pub error: CommandError,
}
fn kinds(kind: &str) -> &'static [&'static str] {
    match kind {
        "home" | "dorm" => &["rest", "self_study", "excursion", "talk", "marker"],
        "classroom" => &["talk", "gift", "marker"],
        "library" => &["self_study", "talk", "gift", "marker"],
        "market" | "dock" | "trading_house" => &["job", "talk", "gift", "marker", "rumor"],
        "workshop" => &["job", "talk", "gift", "marker"],
        "shrine" => &["pray", "talk", "gift", "marker"],
        _ => &["talk", "gift", "marker", "rest"],
    }
}
pub fn job_group(activity: &ActivityDef) -> &str {
    activity.tier.as_ref().map_or(activity.key.as_str(), |t| t.group.as_str())
}
fn job_venue(group: &str) -> &'static str {
    match group {
        "dock_work" | "fishing_job" | "shipyard_job" | "smuggling_job" | "guard_job" | "c9_mio_sail_toll" => "dock",
        "woodworking_job" | "weaving_job" | "apothecary_job" | "printing_job" => "workshop",
        "sanctuary_job" => "shrine",
        "c9_mio_court_duty" => "classroom",
        _ => "market",
    }
}
impl World {
    fn act_affordable(&self, a: &ActivityDef, permille: i64) -> bool {
        self.act_cash() >= (self.upbringing_activity_cost(a) * permille + 999) / 1000
            && a.monthly_limit.is_none_or(|limit| {
                self.upbringing_monthly_used(a.monthly_limit_group.as_deref().unwrap_or(&a.key)) < limit as usize
            })
    }
    fn act_targets_problem(&self, kind: &str, targets: &[String]) -> Option<&'static str> {
        let r = self.act_rules()?;
        match kind {
            "job" => (!targets
                .iter()
                .any(|key| self.defs.upbringing.activity(key).is_some_and(|a| self.act_affordable(a, r.job.permille))))
            .then_some("ub.act.job"),
            "self_study" if self.act_ladder_on() => None,
            "self_study" => (!targets.iter().any(|target| {
                target
                    .rsplit_once(':')
                    .and_then(|(key, tier)| {
                        let tier = tier.parse::<usize>().ok()?;
                        self.defs.upbringing.lines.iter().find(|l| l.key == key)?.tiers.get(tier)
                    })
                    .and_then(|t| self.defs.upbringing.activity(&t.activity))
                    .is_some_and(|a| self.act_affordable(a, r.self_study_permille))
            }))
            .then_some("ub.act.self_study"),
            "marker" => {
                let mut first = None;
                for key in targets {
                    let place = self
                        .state
                        .upbringing
                        .as_ref()
                        .and_then(|s| s.act.markers.get(key))
                        .map(|m| m.place.as_str())
                        .unwrap_or("");
                    match self.act_check_marker(place, key) {
                        Ok(()) => return None,
                        Err(error) => {
                            first.get_or_insert(error.code());
                        }
                    }
                }
                first.or(Some("ub.act.marker"))
            }
            "rumor" => self.act_rumor_candidates("").is_empty().then_some("ub.act.rumor_none"),
            "gift" => {
                let items = self.act_gift_items();
                if items.is_empty() {
                    return Some("ub.act.item");
                }
                let mut first = None;
                for person in targets {
                    for (item, _) in &items {
                        match crate::items::gifts::check(self, OwnerId::Player, person, item, 1) {
                            Ok(_) => return None,
                            Err(e) => {
                                first.get_or_insert(e.code());
                            }
                        }
                    }
                }
                first
            }
            "excursion" => {
                if !targets
                    .iter()
                    .any(|target| target.split_once(':').is_some_and(|(e, n)| self.check_excursion(e, n).is_ok()))
                {
                    Some("ub.act.excursion")
                } else {
                    self.cadence_excursion_problem(1)
                }
            }
            _ => None,
        }
    }
    pub fn act_place_def(&self, place: &str) -> Option<&ActPlaceDef> {
        let family = self.upbringing_family()?;
        self.defs.upbringing.act_places.iter().find(|p| p.family == family.key && p.place == place)
    }
    pub fn act_shop(&self, place: &str) -> Vec<(String, i64)> {
        self.act_place_def(place)
            .into_iter()
            .flat_map(|p| &p.shop)
            .filter_map(|s| self.defs.items.item(&s.item).map(|i| (s.item.clone(), s.price.unwrap_or(i.price))))
            .collect()
    }
    pub fn act_job_tier(&self, place: &str) -> Vec<&ActivityDef> {
        let Some(p) = self.act_places().iter().find(|p| p.key == place) else { return Vec::new() };
        let custom = self.act_place_def(place);
        let groups: Option<BTreeSet<_>> =
            custom.map(|p| p.jobs.iter().filter_map(|k| self.defs.upbringing.activity(k)).map(job_group).collect());
        let mut jobs: BTreeMap<&str, Vec<&ActivityDef>> = BTreeMap::new();
        for a in
            self.defs.upbringing.activities.iter().filter(|a| a.kind == ActivityKind::Job && self.act_activity_open(a))
        {
            let group = job_group(a);
            if groups.as_ref().map_or_else(|| job_venue(group) == p.venue, |groups| groups.contains(group)) {
                jobs.entry(group).or_default().push(a);
            }
        }
        let mut out = Vec::new();
        for mut group in jobs.into_values() {
            let level = group.iter().map(|a| self.act_job_level(a)).max().unwrap_or(0);
            group.retain(|a| self.act_job_level(a) == level);
            group.sort_by(|a, b| a.key.cmp(&b.key));
            out.extend(group);
        }
        out
    }
    pub fn act_gift_items(&self) -> Vec<(String, i64)> {
        self.defs
            .items
            .items
            .iter()
            .filter(|i| !i.protected())
            .filter_map(|i| {
                let qty = self.item_available(OwnerId::Player, &i.key);
                (qty > 0).then(|| (i.key.clone(), qty))
            })
            .collect()
    }
    pub fn act_place_actions(&self, place: &str) -> Vec<ActPlaceAction> {
        let Some(p) = self.act_places().iter().find(|p| p.key == place) else { return Vec::new() };
        let defaults = kinds(&p.kind);
        let custom = self.act_place_def(place);
        let kinds: Vec<_> =
            custom.map_or_else(|| defaults.to_vec(), |p| p.actions.iter().map(String::as_str).collect());
        let Some(s) = &self.state.upbringing else { return Vec::new() };
        let mut out = Vec::new();
        for kind in kinds {
            if kind == "rumor" && !self.act_rumor_place(place) {
                continue;
            }
            let targets: Vec<_> = match kind {
                "talk" | "gift" => {
                    s.act.presence.iter().filter(|(_, p)| p.as_str() == place).map(|(k, _)| k.clone()).collect()
                }
                "job" => self.act_job_tier(place).iter().map(|a| a.key.clone()).collect(),
                "marker" => s
                    .act
                    .markers
                    .iter()
                    .filter(|(key, m)| m.place == place && self.act_marker_visible(key))
                    .map(|(k, _)| k.clone())
                    .collect(),
                "self_study" => self
                    .defs
                    .upbringing
                    .lines
                    .iter()
                    .filter(|l| self.act_line_here(l))
                    .flat_map(|l| {
                        (0..l.tiers.len().min(2))
                            .filter(|t| self.act_tier_open(l, *t as u8))
                            .map(|t| format!("{}:{t}", l.key))
                    })
                    .collect(),
                "excursion" => self
                    .defs
                    .upbringing
                    .excursions
                    .iter()
                    .filter(|e| self.excursion_available(e))
                    .flat_map(|e| {
                        e.nodes
                            .iter()
                            .filter(|n| {
                                matches!(self.excursion_node_state(&e.key, &n.key), NodeState::New | NodeState::Seen)
                                    && !self.act_tide_closed(&e.key, &n.key)
                            })
                            .map(|n| format!("{}:{}", e.key, n.key))
                    })
                    .collect(),
                "rumor" if self.act_stage_on("rumors") => Vec::new(),
                "rest" | "pray" => Vec::new(),
                _ => continue,
            };
            if targets.is_empty() && !matches!(kind, "rest" | "pray" | "rumor") {
                continue;
            }
            let cost = if kind == "excursion" { 2 } else { 1 };
            let error = if self.act_ill() && kind != "rest" {
                Some("ub.act.ill")
            } else if !self.upbringing_place_open(p) {
                Some("ub.act.place")
            } else if self.act_phase() != ActPhase::Free {
                Some("ub.act.phase")
            } else if s.act.points < cost {
                Some("ub.act.points")
            } else if self.act_story_waiting() {
                Some("ub.act.story")
            } else {
                self.act_targets_problem(kind, &targets)
            };
            out.push(ActPlaceAction {
                kind: kind.into(),
                cost,
                enabled: error.is_none(),
                reason: error.map(str::to_owned),
                targets,
            });
        }
        out
    }
    pub fn act_action_problem(&self, place: &str, action: &ActAction) -> Result<(), CommandError> {
        if self.act_ill() && !matches!(action, ActAction::Rest) {
            return Err(reason("ub.act.ill"));
        }
        if self.act_story_waiting() {
            return Err(reason("ub.act.story"));
        }
        if self.act_phase() != ActPhase::Free
            && !(matches!(action, ActAction::Greet { .. }) && self.act_phase() == ActPhase::Plan)
        {
            return self.act_require_phase(ActPhase::Free);
        }
        let p = self
            .act_places()
            .iter()
            .find(|p| p.key == place && self.upbringing_place_open(p))
            .ok_or_else(|| reason("ub.act.place"))?;
        if matches!(action, ActAction::Rumor) && !self.act_stage_on("rumors") {
            return Err(crate::error::Reason::new("ub.act.stage_off", "（待写）")
                .arg("stage", TextArg::Text("rumors".into()))
                .rule());
        }
        if let ActAction::Excursion { excursion, node } = action
            && self.act_tide_closed(excursion, node)
        {
            return Err(crate::error::Reason::new("ub.act.tide_closed", "（待写）")
                .arg("node", TextArg::Text(node.clone()))
                .rule());
        }
        if !matches!(action, ActAction::Greet { .. })
            && !self.act_place_actions(place).iter().any(|a| a.kind == action.kind())
        {
            return Err(reason("ub.act.action"));
        }
        let points = self.state.upbringing.as_ref().map_or(0, |s| s.act.points);
        if points < action.cost() {
            return Err(crate::error::Reason::new("ub.act.points", "（待写）")
                .arg("need", TextArg::Int(i64::from(action.cost())))
                .arg("have", TextArg::Int(i64::from(points)))
                .rule());
        }
        match action {
            ActAction::Rumor if self.act_rumor_candidates("").is_empty() => return Err(reason("ub.act.rumor_none")),
            ActAction::Greet { person } | ActAction::Talk { person } | ActAction::Gift { person, .. } => {
                if self.act_presence(person) != Some(place) {
                    return Err(argument("ub.act.absent", "slot", -1));
                }
                if matches!(action, ActAction::Greet { .. })
                    && self.state.upbringing.as_ref().is_some_and(|s| s.act.greeted.get(person) == Some(&s.act.week))
                {
                    return Err(reason("ub.act.greeted"));
                }
                if let ActAction::Gift { item, .. } = action {
                    let available = self.item_available(OwnerId::Player, item);
                    if available < 1 {
                        return Err(CommandError::InsufficientStock { available });
                    }
                    if self.defs.items.item(item).is_none_or(|i| i.protected()) {
                        return Err(reason("ub.act.item"));
                    }
                    crate::items::gifts::check(self, OwnerId::Player, person, item, 1)?;
                }
                if matches!(action, ActAction::Talk { .. })
                    && let Some(track) = self.act_marker_for_person(person)
                {
                    self.act_check_marker(place, track)?;
                }
            }
            ActAction::Job { activity } => {
                let a = self
                    .act_job_tier(place)
                    .into_iter()
                    .find(|a| a.key == *activity)
                    .ok_or_else(|| reason("ub.act.job"))?;
                let r = self.act_rules().cloned().unwrap_or_default();
                if self.act_cash() < (self.upbringing_activity_cost(a) * r.job.permille + 999) / 1000 {
                    return Err(reason("ub.act.job"));
                }
                if a.monthly_limit.is_some_and(|n| {
                    self.upbringing_monthly_used(a.monthly_limit_group.as_deref().unwrap_or(&a.key)) >= n as usize
                }) {
                    return Err(reason("ub.act.job"));
                }
            }
            ActAction::Marker { track } => self.act_check_marker(place, track)?,
            ActAction::SelfStudy { line, tier } => {
                let l = self
                    .defs
                    .upbringing
                    .lines
                    .iter()
                    .find(|l| l.key == *line && self.act_line_here(l))
                    .ok_or_else(|| reason("ub.act.self_study"))?;
                if *tier > 1 || !self.act_tier_open(l, *tier) {
                    return Err(reason("ub.act.self_study"));
                }
                let a = l
                    .tiers
                    .get(usize::from(*tier))
                    .and_then(|t| self.defs.upbringing.activity(&t.activity))
                    .ok_or_else(|| reason("ub.act.self_study"))?;
                let r = self.act_rules().cloned().unwrap_or_default();
                if (!self.act_ladder_on()
                    && self.act_cash() < (self.upbringing_activity_cost(a) * r.self_study_permille + 999) / 1000)
                    || a.monthly_limit.is_some_and(|n| {
                        self.upbringing_monthly_used(a.monthly_limit_group.as_deref().unwrap_or(&a.key)) >= n as usize
                    })
                {
                    return Err(reason("ub.act.self_study"));
                }
            }
            ActAction::Excursion { excursion, node } => {
                if !matches!(self.excursion_node_state(excursion, node), NodeState::New | NodeState::Seen)
                    || self.check_excursion(excursion, node).is_err()
                {
                    return Err(reason("ub.act.excursion"));
                }
                if let Some(code) = self.cadence_excursion_problem(1) {
                    return Err(reason(code));
                }
            }
            ActAction::Pray if p.kind != "shrine" && p.venue != "shrine" => return Err(reason("ub.act.action")),
            ActAction::Duty { .. } => return Err(reason("ub.act.action")),
            _ => {}
        }
        Ok(())
    }
    fn act_check_marker(&self, place: &str, track: &str) -> Result<(), CommandError> {
        if self.state.upbringing.as_ref().is_none_or(|s| s.act.markers.get(track).is_none_or(|m| m.place != place))
            || !self.act_marker_visible(track)
        {
            return Err(reason("ub.act.marker"));
        }
        self.act_marker_candidate_problem(track)?;
        if self.state.upbringing.as_ref().is_some_and(|s| s.event_permits.iter().any(|key| self.act_marker_held(key))) {
            return Err(reason("ub.act.story"));
        }
        Ok(())
    }
    pub(super) fn act_affinity(
        &mut self,
        person: &str,
        amount: i64,
        result: &mut SlotResult,
    ) -> Result<(), CommandError> {
        let before = self.state.cast.persons.get(person).map_or(0, |p| p.affection.affinity);
        self.change_affinity(person, amount)?;
        let after = self.state.cast.persons.get(person).map_or(0, |p| p.affection.affinity);
        *result.affinity.entry(person.into()).or_default() += after - before;
        Ok(())
    }
    pub(super) fn act_meters(&mut self, fatigue: i64, mood: i64, result: &mut SlotResult) {
        if let Some(s) = &mut self.state.upbringing {
            let before = (s.fatigue, s.mood);
            s.fatigue = (s.fatigue + fatigue).clamp(0, 100);
            s.mood = (s.mood + mood).clamp(-100, 100);
            s.stamina = 100 - s.fatigue;
            result.fatigue += s.fatigue - before.0;
            result.mood += s.mood - before.1;
        }
    }
    pub(super) fn act_do_action(&mut self, place: &str, action: &ActAction) -> Result<(), CommandError> {
        self.act_action_problem(place, action)?;
        let visit = match action {
            ActAction::Talk { person } if self.act_marker_for_person(person).is_some() => Some(person.clone()),
            _ => None,
        };
        let action = if let ActAction::Talk { person } = action {
            self.act_marker_for_person(person).map_or_else(|| action.clone(), |t| ActAction::Marker { track: t.into() })
        } else {
            action.clone()
        };
        let r = self.act_rules().cloned().unwrap_or_default();
        let n = self.state.upbringing.as_ref().map_or(0, |s| s.act.done.len());
        let mut result = SlotResult { index: 0, eighths: 1, ..Default::default() };
        let mut greet = None;
        let mut rumors = Vec::new();
        let mut events = Vec::new();
        match &action {
            ActAction::Greet { person } => {
                self.state.cast.persons.entry(person.clone()).or_default().met = true;
                let season = self.defs.calendar.season_of(self.day()) as u8;
                let family = self.upbringing_family().map(|f| f.key.as_str()).unwrap_or("");
                let pool: Vec<_> = self
                    .defs
                    .upbringing
                    .act_greetings
                    .iter()
                    .enumerate()
                    .filter(|(_, g)| {
                        g.family == family
                            && g.person == *person
                            && (g.seasons.is_empty() || g.seasons.contains(&season))
                    })
                    .flat_map(|(i, g)| (0..g.lines.len()).map(move |j| (i as u16, j as u16)))
                    .collect();
                if !pool.is_empty() {
                    let mut rng = self.upbringing_rng(&format!("act:greet:{person}"), 0, 0);
                    greet = pool.get(rng.range(0, pool.len() as i64 - 1) as usize).copied();
                }
                if let Some(s) = &mut self.state.upbringing {
                    s.act.greeted.insert(person.clone(), s.act.week);
                }
                if self.act_has_perk(person, "rumor") {
                    rumors = self.act_hear_rumors(person);
                }
            }
            ActAction::Talk { person } => {
                self.act_affinity(person, r.talk.affinity, &mut result)?;
                self.act_meters(0, r.talk.mood, &mut result);
                self.record_deed(Deed::Talk, 1);
                self.record_deed(Deed::UbTalkDeep, 1);
            }
            ActAction::Gift { person, item } => {
                let plan = crate::items::gifts::check(self, OwnerId::Player, person, item, 1)?;
                let before = self.state.cast.persons.get(person).map_or(0, |p| p.affection.affinity);
                crate::items::gifts::apply(self, plan);
                let after = self.state.cast.persons.get(person).map_or(0, |p| p.affection.affinity);
                result.affinity.insert(person.clone(), after - before);
                result.items.insert(item.clone(), -1);
                self.record_deed(Deed::Gift, 1);
                self.record_deed(Deed::UbGift, 1);
            }
            ActAction::Marker { track } => {
                // 非自动轨道同样要有运行态；与 U06a 预排共用形状，但不占预算。
                if let Some(t) = self.defs.story2.track(track) {
                    let entered = self.day();
                    self.state.story2.tracks.entry(track.clone()).or_insert_with(|| crate::story2::TrackState {
                        chapter: t.start.clone(),
                        visited: BTreeSet::new(),
                        entered,
                        status: crate::story2::Status::Active,
                        failure: None,
                    });
                }
                if let Some(s) = &mut self.state.upbringing {
                    s.activity_tracks.insert(track.clone());
                    s.event_permits.insert(track.clone());
                }
                self.record_deed(Deed::UbMarker, 1);
                if let Some(s) = &mut self.state.upbringing {
                    s.act.markers_seen += 1;
                }
            }
            ActAction::Job { activity } => {
                let a = self.defs.upbringing.activity(activity).cloned().ok_or_else(|| reason("ub.act.job"))?;
                result.activities.push(a.key.clone());
                let group = job_group(&a).to_owned();
                let mut scale = ActScale::job(&r);
                scale.income = Some(self.act_job_income(place, &a));
                events = self
                    .settle_upbringing_activity_scaled(&a, 200 + n as u8, 0, scale, &mut result)
                    .map_err(|e| CommandError::Internal(e.to_string()))?;
                if let Some(s) = &mut self.state.upbringing {
                    *s.act.jobs.entry(group.clone()).or_default() += 1;
                }
                self.act_see_goods(place, &group);
                self.record_deed(Deed::UbJob, 1);
            }
            ActAction::Rest => {
                self.act_meters(-r.recover.rest, 0, &mut result);
                self.record_deed(Deed::UbRest, 1);
            }
            ActAction::Pray => {
                self.act_meters(-r.recover.pray, r.pray.mood, &mut result);
                let growth = self.act_carry(&format!("growth:{}", r.pray.attr), 1, r.pray.growth_permille);
                result.growth.insert(r.pray.attr.clone(), self.gain_upbringing_growth(&r.pray.attr, growth));
                self.record_deed(Deed::UbRest, 1);
            }
            ActAction::SelfStudy { line, tier } => {
                let a = self
                    .defs
                    .upbringing
                    .lines
                    .iter()
                    .find(|l| l.key == *line)
                    .and_then(|l| l.tiers.get(usize::from(*tier)))
                    .and_then(|t| self.defs.upbringing.activity(&t.activity))
                    .cloned()
                    .ok_or_else(|| reason("ub.act.self_study"))?;
                result.activities.push(a.key.clone());
                if self.act_ladder_on() {
                    let l = self
                        .defs
                        .upbringing
                        .lines
                        .iter()
                        .find(|l| l.key == *line)
                        .cloned()
                        .ok_or_else(|| reason("ub.act.self_study"))?;
                    events = self
                        .settle_act_lesson(
                            &l,
                            &LessonPlan { line: line.clone(), tier: *tier, with: None },
                            200 + n as u8,
                            true,
                            &mut result,
                        )
                        .map_err(|e| CommandError::Internal(e.to_string()))?;
                } else {
                    events = self
                        .settle_upbringing_activity_scaled(&a, 200 + n as u8, 0, ActScale::self_study(&r), &mut result)
                        .map_err(|e| CommandError::Internal(e.to_string()))?;
                }
                self.record_deed(Deed::UbSelfStudy, 1);
            }
            ActAction::Excursion { excursion, node } => {
                let mut choice = AfterChoice::activity("");
                choice.excursion = Some(excursion.clone());
                choice.node = Some(node.clone());
                events = self
                    .settle_excursion(&choice, 200 + n as u8, &mut result)
                    .map_err(|e| CommandError::Internal(e.to_string()))?;
                self.cadence_note_excursion();
                let fatigue = self.act_carry("fatigue", r.excursion_fatigue, 100);
                self.act_meters(fatigue, 0, &mut result);
            }
            ActAction::Rumor => {
                rumors = self.act_hear_rumors("");
                self.record_deed(Deed::UbRumor, 1);
            }
            ActAction::Duty { .. } => return Err(reason("ub.act.action")),
        }
        self.record_deed(Deed::UbAction, u32::from(action.cost()));
        events.extend(self.settle_upbringing_low_mood());
        self.refresh_upbringing_goals().map_err(|e| CommandError::Internal(e.to_string()))?;
        self.refresh_upbringing_unlocks(false);
        self.act_journal(&result);
        self.trigger_cadence_events(&events, &result);
        if let Some(s) = &mut self.state.upbringing {
            s.act.points -= action.cost();
            s.act.done.push(ActionRecord {
                place: place.into(),
                cost: action.cost(),
                action,
                result,
                greet,
                rumors,
                fame: 0,
                visit,
            });
        }
        Ok(())
    }
    pub fn act_duty_problem(&self, key: &str) -> Result<(), CommandError> {
        if self.act_sailing() {
            return Err(reason("ub.act.voyage"));
        }
        if self.act_ill() {
            return Err(reason("ub.act.ill"));
        }
        if !self.act_rules().is_some_and(|r| r.stages.iter().any(|s| s == "family_duty")) {
            return Err(crate::error::Reason::new("ub.act.stage_off", "（待写）")
                .arg("stage", TextArg::Text("family_duty".into()))
                .rule());
        }
        self.act_require_phase(ActPhase::Free)?;
        if self.act_story_waiting() {
            return Err(reason("ub.act.story"));
        }
        if self.state.upbringing.as_ref().is_some_and(|s| s.act.duty_week == Some(s.act.week)) {
            return Err(reason("ub.act.duty_done"));
        }
        self.defs
            .upbringing
            .act_duties
            .iter()
            .find(|d| {
                d.key == key
                    && self.upbringing_family().is_some_and(|f| f.key == d.family)
                    && lessons::stage_key(d.stage, &d.academy) == self.act_stage_key()
            })
            .ok_or_else(|| reason("ub.act.duty"))?;
        Ok(())
    }
    pub(super) fn act_do_duty(&mut self, key: &str) -> Result<(), CommandError> {
        self.act_duty_problem(key)?;
        let duty = self
            .defs
            .upbringing
            .act_duties
            .iter()
            .find(|d| d.key == key)
            .cloned()
            .ok_or_else(|| reason("ub.act.duty"))?;
        let mut result = SlotResult { eighths: 1, ..Default::default() };
        let week = self.state.upbringing.as_ref().map_or(0, |s| s.act.week);
        let fail_pct = self.act_tide_effects().duty_fail.get(key).copied().unwrap_or(0);
        let failed = self.upbringing_rng(&format!("act:duty_fail:{key}"), week as u8, 0).range(0, 99) < fail_pct;
        result.success = Some(!failed);
        let mut rng = self.upbringing_rng(&format!("act:duty:{key}"), 0, 0);
        let cash = if failed { 0 } else { rng.range(duty.cash[0], duty.cash[1]) };
        if cash > 0 {
            let loc = self.upbringing_location().ok_or(CommandError::WrongLocation)?;
            self.book_external(
                OwnerId::Player,
                crate::treasury::Flow::Other,
                self.town_sector(loc),
                crate::ledger::JournalEntry::new(
                    self.day(),
                    crate::ledger::Memo::Other,
                    crate::ledger::CashClass::Operating,
                )
                .dr(crate::ledger::Account::Cash, cash)
                .cr(crate::ledger::Account::OtherIncome, cash),
            )
            .map_err(|e| CommandError::Internal(e.to_string()))?;
            result.cash = cash;
        }
        for (a, v) in duty.growth {
            if !failed {
                result.growth.insert(a.clone(), self.gain_upbringing_growth(&a, v));
            }
        }
        for (k, v) in duty.skills {
            if failed {
                continue;
            }
            let xp = self.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.entry(k.clone()).or_default();
            *xp = xp.saturating_add(v);
            result.skills.insert(k, v);
        }
        for (p, v) in duty.affinity {
            self.act_affinity(&p, v, &mut result)?;
        }
        let fame = self.state.upbringing.as_mut().map_or(0, |s| {
            let before = s.fame;
            s.fame = (s.fame + duty.fame).clamp(0, 100);
            s.fame - before
        });
        self.act_journal(&result);
        if let Some(s) = &mut self.state.upbringing {
            s.act.duty_week = Some(s.act.week);
            let n = s.act.family_duty.entry(key.into()).or_default();
            *n = n.saturating_add(1);
            s.act.done.push(ActionRecord {
                place: String::new(),
                action: ActAction::Duty { duty: key.into() },
                cost: 0,
                result,
                greet: None,
                rumors: Vec::new(),
                fame,
                visit: None,
            });
        }
        self.record_deed(Deed::UbFamilyDuty, 1);
        self.refresh_upbringing_goals().map_err(|e| CommandError::Internal(e.to_string()))?;
        self.refresh_upbringing_unlocks(false);
        Ok(())
    }
    pub fn act_free_template(&self) -> &[FreeStep] {
        self.state
            .upbringing
            .as_ref()
            .and_then(|s| s.act.free_templates.get(&self.act_stage_key()))
            .map_or(&[], Vec::as_slice)
    }
    pub(super) fn act_normalize_free_step(&self, step: &FreeStep) -> Option<FreeStep> {
        let action = match &step.action {
            ActAction::Job { activity } => {
                let group = self.defs.upbringing.activity(activity).map_or(activity.as_str(), job_group);
                ActAction::Job { activity: group.into() }
            }
            ActAction::Marker { .. } | ActAction::Greet { .. } => return None,
            action => action.clone(),
        };
        Some(FreeStep { place: step.place.clone(), action })
    }
    pub(super) fn act_free_step_action(&self, step: &FreeStep) -> Result<ActAction, CommandError> {
        if let ActAction::Job { activity: group } = &step.action {
            return self
                .act_job_tier(&step.place)
                .into_iter()
                .filter(|a| job_group(a) == group)
                .map(|a| ActAction::Job { activity: a.key.clone() })
                .find(|action| self.act_action_problem(&step.place, action).is_ok())
                .ok_or_else(|| reason("ub.act.job"));
        }
        Ok(step.action.clone())
    }
    /// 按本周记录与已跳过步骤匹配前缀；手动行动也认工种组和原来的拜访。
    pub(super) fn act_free_template_next(&self) -> usize {
        let Some(s) = &self.state.upbringing else { return 0 };
        let mut done = s.act.done.iter();
        let template = self.act_free_template();
        for (i, step) in template.iter().enumerate() {
            if s.act.free_skipped.iter().any(|skip| usize::from(skip.step) == i && skip.plan == *step)
                || matches!(step.action, ActAction::Duty { .. }) && s.act.duty_week == Some(s.act.week)
            {
                continue;
            }
            // 深谈遇到人物标记会改记为 Marker；它同样完成了模板里对这个人的一次拜访。
            if !done.any(|d| {
                d.place == step.place
                    && (d.action == step.action
                        || match (&step.action, &d.action) {
                            (ActAction::Job { activity: group }, ActAction::Job { activity }) => {
                                self.defs.upbringing.activity(activity).is_some_and(|a| job_group(a) == group)
                            }
                            (ActAction::Talk { person }, ActAction::Marker { .. }) => d.visit.as_ref() == Some(person),
                            _ => false,
                        })
            }) {
                return i;
            }
        }
        template.len()
    }
    pub fn act_free_template_done(&self) -> bool {
        let template = self.act_free_template();
        let next = self.act_free_template_next();
        self.act_sailing()
            || self.act_ill() && template.get(next).is_none_or(|step| !matches!(step.action, ActAction::Rest))
            || self.state.upbringing.as_ref().is_some_and(|s| s.act.points == 0)
            || (!template.is_empty() && next == template.len())
    }
    pub fn act_free_stop(&self) -> Option<ActFreeStop> {
        if self.act_phase() != ActPhase::Free || self.act_sailing() || self.act_ill() {
            return None;
        }
        let s = self.state.upbringing.as_ref()?;
        if s.act.points == 0 {
            return None;
        }
        let targets: Vec<_> = s
            .act
            .markers
            .iter()
            .filter(|(_, m)| m.key && (m.since_week == s.act.week || m.expires_week == s.act.week))
            .filter(|(key, m)| self.act_marker_problem(&m.place, key).is_ok())
            .map(|(key, _)| key.clone())
            .collect();
        if !targets.is_empty() {
            return Some(ActFreeStop { step: None, targets, error: reason("ub.act.free_marker") });
        }
        let template = self.act_free_template();
        if template.is_empty() {
            return Some(ActFreeStop { step: None, targets: Vec::new(), error: reason("ub.act.template") });
        }
        let next = self.act_free_template_next();
        if next == template.len()
            && s.act.free_applied == 0
            && template.iter().enumerate().all(|(i, step)| {
                s.act.free_skipped.iter().any(|skip| usize::from(skip.step) == i && skip.plan == *step)
            })
        {
            return Some(ActFreeStop { step: None, targets: Vec::new(), error: reason("ub.act.template_empty") });
        }
        None
    }
    pub fn act_free_auto_ok(&self) -> bool {
        self.act_phase() == ActPhase::Free && !self.act_free_template_done() && self.act_free_stop().is_none()
    }
    pub(crate) fn act_check_buy(
        &self,
        owner: OwnerId,
        loc: crate::LocId,
        item: &str,
        qty: i64,
        limit: Option<i64>,
    ) -> Result<crate::items::shop::TradePlan, CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        if !matches!(self.act_phase(), ActPhase::Plan | ActPhase::Free) {
            return self.act_require_phase(ActPhase::Free).and(Err(reason("ub.act.phase")));
        }
        if Some(loc) != self.upbringing_location() {
            return Err(CommandError::WrongLocation);
        }
        let price = self
            .act_places()
            .iter()
            .filter(|p| self.upbringing_place_open(p))
            .flat_map(|p| self.act_shop(&p.key))
            .filter(|(key, _)| key == item)
            .map(|(_, p)| p)
            .min()
            .ok_or_else(|| reason("ub.act.shop"))?;
        if !(1..=99).contains(&qty) {
            return Err(CommandError::InvalidQuantity);
        }
        let total = price.checked_mul(qty).ok_or(CommandError::InvalidQuantity)?;
        if let Some(limit) = limit
            && total > limit
        {
            return Err(CommandError::PriceLimit { total, limit });
        }
        if total > self.act_cash() {
            return Err(CommandError::InsufficientCash { need: total, have: self.act_cash() });
        }
        self.item_quantity(owner, item).checked_add(qty).ok_or(CommandError::InvalidQuantity)?;
        Ok(crate::items::shop::TradePlan { owner, loc, item: item.into(), qty, total, buy: true })
    }
}

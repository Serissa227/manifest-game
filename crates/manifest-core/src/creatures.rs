//! 按日期、月相与地点生成的有限遭遇；夜间只供应用层决定展示时机。
pub mod validation;
use crate::{
    World,
    arcana::Cost,
    error::{CommandError, CoreError},
    ids::*,
    rng::{Domain, Rng},
    societies::{blocked, transaction},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CreaturesDefs {
    pub creatures: Vec<CreatureDef>,
    pub moon_epoch: u32,
}
impl CreaturesDefs {
    pub fn is_empty(&self) -> bool {
        self.creatures.is_empty()
    }
    pub fn creature(&self, k: &str) -> Option<&CreatureDef> {
        self.creatures.iter().find(|c| c.key == k)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Response {
    Avoid,
    Observe,
    Noise,
    Stillness,
    Signal,
    Recite,
    Offering,
    Trade,
    Release,
    Ruse,
    Fight,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Omen {
    FishShoal,
    Calm,
    StrangeLight,
    Song,
    Bells,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct When {
    pub months: Vec<u8>,
    pub moon: Vec<u8>,
    pub night: bool,
    pub weather: Vec<crate::weather::Sky>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatureDef {
    pub key: String,
    pub name: String,
    pub text: String,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub ports: Vec<String>,
    #[serde(default)]
    pub when: When,
    #[serde(default)]
    pub omens: Vec<Omen>,
    pub omen_text: Option<String>,
    pub responses: Vec<Response>,
    pub outcomes: BTreeMap<Response, Outcome>,
    pub chance_bp: i64,
    pub cooldown_days: u32,
    pub knowledge: Option<String>,
    #[serde(default)]
    pub books: Vec<String>,
    #[serde(default)]
    pub loot: Vec<Loot>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Outcome {
    pub text: String,
    pub reply: String,
    pub cost: Cost,
    pub hull_pct: u8,
    pub crew_pct: u8,
    pub delay_days: u8,
    pub loot: bool,
    pub identify: bool,
    pub clue: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Loot {
    pub item: String,
    pub genuine: bool,
    pub appraisal: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CreaturesState {
    pub pending: Option<Encounter>,
    pub last: BTreeMap<String, u32>,
    pub delays: BTreeMap<FleetId, u32>,
    pub specimens: BTreeMap<String, Specimen>,
    pub resolved: BTreeSet<String>,
    pub last_result: Option<EncounterResult>,
}
impl CreaturesState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Encounter {
    pub id: String,
    pub creature: String,
    pub fleet: FleetId,
    pub day: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Genuine,
    Fake,
    Unsure,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Specimen {
    pub item: String,
    pub creature: String,
    pub day: u32,
    pub verdict: Verdict,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncounterResult {
    pub encounter: Encounter,
    pub response: Response,
    pub hull_lost: i64,
    pub crew_lost: i64,
}
/// 朔望月用2953/100日近似；只依赖世界日历已经展开的绝对日数。
pub fn moon_phase(day: u32, epoch: u32) -> u8 {
    ((((u64::from(day) + u64::from(epoch)) * 100) % 2953) * 8 / 2953) as u8
}
impl World {
    pub fn creature_delayed(&self, f: FleetId) -> bool {
        self.state.creatures.delays.get(&f).is_some_and(|d| *d > self.day())
    }
    pub fn creature_pending(&self) -> Option<(&Encounter, &CreatureDef)> {
        let e = self.state.creatures.pending.as_ref()?;
        Some((e, self.defs.creatures.creature(&e.creature)?))
    }
    pub fn creature_response_ready(&self, response: Response) -> Result<(), CommandError> {
        let (e, c) = self.creature_pending().ok_or_else(|| blocked("creature.no_encounter"))?;
        if !c.responses.contains(&response) {
            return Err(blocked("creature.response"));
        }
        if self.state.fleets.get(&e.fleet).is_none_or(|f| f.owner != OwnerId::Player) {
            return Err(blocked("creature.fleet"));
        }
        let o = c.outcomes.get(&response).ok_or_else(|| blocked("creature.response"))?;
        if !empty_cost(&o.cost) {
            self.check_arcana_cost(&o.cost)?;
        }
        Ok(())
    }
    fn creature_matches(&self, c: &CreatureDef, f: FleetId) -> bool {
        let Some(f) = self.state.fleets.get(&f) else { return false };
        let here = f.docked_at().is_some_and(|l| c.ports.contains(&self.defs.loc(l).key))
            || f.docked_at().is_none()
                && self
                    .defs
                    .map
                    .region_of(f.cell(&self.defs))
                    .is_some_and(|r| c.regions.contains(&self.defs.regions[r.idx()].key));
        here && c.knowledge.as_ref().is_none_or(|k| self.has_knowledge_record(k))
            && (c.when.months.is_empty()
                || c.when.months.contains(&(self.defs.calendar.date_of(self.day()).month as u8)))
            && (c.when.moon.is_empty() || c.when.moon.contains(&moon_phase(self.day(), self.defs.creatures.moon_epoch)))
            && (c.when.weather.is_empty()
                || self.weather_at(f.cell(&self.defs)).is_some_and(|w| c.when.weather.contains(&w.sky)))
            && self
                .state
                .creatures
                .last
                .get(&c.key)
                .is_none_or(|day| self.day().saturating_sub(*day) >= c.cooldown_days)
    }
    pub(crate) fn creatures_day(&mut self) -> Result<(), CoreError> {
        if self.defs.creatures.is_empty() {
            return Ok(());
        }
        let day = self.day();
        self.state.creatures.delays.retain(|_, until| *until > day);
        if self.state.creatures.pending.as_ref().is_some_and(|e| !self.state.fleets.contains_key(&e.fleet)) {
            self.state.creatures.pending = None;
        }
        // 未回应的遭遇保持待决，不用看不见的默认选项偷偷改变结果。
        if self.state.creatures.pending.is_some() {
            return Ok(());
        }
        let Some(f) = self.flagship(OwnerId::Player) else { return Ok(()) };
        let mut candidates: Vec<_> =
            self.defs.creatures.creatures.iter().filter(|c| self.creature_matches(c, f)).collect();
        candidates.sort_by_key(|c| &c.key);
        let mut met = false;
        for c in candidates {
            let h = blake3::hash(c.key.as_bytes());
            let mut bytes = [0; 8];
            bytes.copy_from_slice(&h.as_bytes()[..8]);
            let sacred = self.creature_ward(f);
            if Rng::derive(self.state.seed, day, Domain::Creatures, u64::from_le_bytes(bytes), u64::from(f.0))
                .chance_bp(c.chance_bp * (100 - sacred) / 100 * (100 - self.legend_sacred_avoid(f)) / 100)
            {
                let id = format!("{}:{day}:{}", c.key, f.0);
                self.state.creatures.pending = Some(Encounter { id, creature: c.key.clone(), fleet: f, day });
                self.state.creatures.last.insert(c.key.clone(), day);
                met = true;
                break;
            }
        }
        if met {
            self.pacing_note(crate::pacing::BeatSource::Creature.weight());
        }
        Ok(())
    }
    pub fn creature_ward(&self, f: FleetId) -> i64 {
        ((self.arcana_bonus(f, "ward")
            + if self.flagship(OwnerId::Player) == Some(f) { self.lineage_power("ward", 720) } else { 0 })
            + self.state.fleets.get(&f).map_or(0, |f| self.attr_hook(f.owner, crate::captain::AttrHook::CreatureCheck)))
        .clamp(0, 50)
    }
}
fn empty_cost(c: &Cost) -> bool {
    c.cash == 0 && c.items.is_empty() && c.goods.is_empty()
}
pub(crate) fn check(
    w: &World,
    owner: OwnerId,
    id: &str,
    response: Response,
) -> Result<Box<crate::WorldState>, CommandError> {
    transaction(w, |w| {
        if owner != OwnerId::Player {
            return Err(blocked("creature.player_only"));
        }
        let (e, c) =
            w.creature_pending().filter(|(e, _)| e.id == id).ok_or_else(|| blocked("creature.no_encounter"))?;
        let (e, c) = (e.clone(), c.clone());
        w.creature_response_ready(response)?;
        if w.state.creatures.resolved.contains(id) {
            return Err(blocked("creature.resolved"));
        }
        let o = c.outcomes.get(&response).ok_or_else(|| blocked("creature.response"))?;
        if !empty_cost(&o.cost) {
            w.pay_arcana_cost(&o.cost)?;
        }
        let books = c.books.iter().filter(|b| w.has_read_work(owner, b)).count().min(10) as i64;
        let guard = (w.creature_ward(e.fleet) + books * 2).min(50);
        let f = w.fleet_mut(e.fleet)?;
        let mut hull_lost = 0;
        for s in &mut f.ships {
            let damage = crate::fixed::mul_div_floor(s.max_durability, i64::from(o.hull_pct) * (100 - guard), 10000)
                .min((s.durability - 1).max(0));
            s.durability -= damage;
            hull_lost += damage;
        }
        let crew_lost =
            crate::fixed::mul_div_floor(f.crew, i64::from(o.crew_pct) * (100 - guard), 10000).min((f.crew - 1).max(0));
        f.crew -= crew_lost;
        if o.delay_days > 0 {
            w.state.creatures.delays.insert(e.fleet, w.day().saturating_add(u32::from(o.delay_days)));
        }
        if o.loot {
            for (i, loot) in c.loot.iter().enumerate() {
                w.grant_item(owner, &loot.item, 1)?;
                let verdict = if o.identify
                    && w.attr_hook(owner, crate::captain::AttrHook::Appraisal) + books * 5 >= loot.appraisal
                {
                    if loot.genuine { Verdict::Genuine } else { Verdict::Fake }
                } else {
                    Verdict::Unsure
                };
                w.state.creatures.specimens.insert(
                    format!("{id}:{i}"),
                    Specimen { item: loot.item.clone(), creature: c.key.clone(), day: w.day(), verdict },
                );
            }
        }
        if let Some(clue) = &o.clue {
            w.state.story2.flags.insert(clue.clone());
        }
        w.state.creatures.resolved.insert(id.into());
        w.state.creatures.pending = None;
        w.state.creatures.last_result = Some(EncounterResult { encounter: e, response, hull_lost, crew_lost });
        Ok(())
    })
}

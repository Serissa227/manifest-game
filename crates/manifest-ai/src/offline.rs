//! 离线降级：未配置 LLM、超出预算或网络失败时，用 `data/templates/` 的模板生成同类提案。
//! 随机数由世界种子与日期派生，因此同一局面得到同样的结果。离线提案同样要经过裁决与内核校验。

use crate::adjudicator::intent_label;
use crate::proposal::*;
use manifest_core::World;
use manifest_core::defs::EventRequire;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::events::EventParams;
use manifest_core::fixed::{Fx, mul_div};
use manifest_core::ids::*;
use manifest_core::news::{Intent, NewsFact, NewsPlan, YearFacts};
use manifest_core::rng::{Domain, Rng};
use manifest_core::summary::{owner_name, status_name, world_date_text, year_text};
use manifest_core::text::{TextArg, TextRef};
use manifest_data::OfflineTemplates;
use std::collections::BTreeMap;

/// 用变量替换模板中的 `{name}`。
pub fn fill(template: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut out = template.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

fn pick<'a>(rng: &mut Rng, lines: &'a [String]) -> &'a str {
    if lines.is_empty() { "" } else { &lines[rng.below(lines.len() as u64) as usize] }
}

/// 百分比文字（如 3%）。
pub fn percent(f: Fx) -> String {
    let bp = f.raw();
    if bp % 100 == 0 { format!("{}%", bp / 100) } else { format!("{:.1}%", bp as f64 / 100.0) }
}

fn rng_for(world: &World, kind: u64, extra: u64) -> Rng {
    Rng::derive(world.state.seed, world.day(), Domain::Events, 100 + kind, extra)
}

/// 在范围内随机取一个系数（精确到 0.01）。
fn random_mult(rng: &mut Rng, lo: Fx, hi: Fx) -> Fx {
    let steps = (hi.raw() - lo.raw()) / 100;
    Fx(lo.raw() + rng.range(0, steps.max(0)) * 100)
}

/// 为某个事件类型随机生成一组参数。
fn random_params(world: &World, kind: EventTypeId, rng: &mut Rng) -> Option<EventParams> {
    let defs = &world.defs;
    let def = defs.event_type(kind);
    let e = def.effect;
    let mut p = EventParams::default();
    if e.needs_good() {
        let pool: Vec<GoodId> = if def.goods.is_empty() { defs.good_ids().collect() } else { def.goods.clone() };
        p.good = Some(pool[rng.below(pool.len() as u64) as usize]);
    }
    if e.needs_loc() {
        let locs: Vec<LocId> = defs
            .loc_ids()
            .filter(|l| !def.port_only || defs.loc(*l).is_port())
            // 殖民点没有市场，内核不接受以它为地点的事件
            .filter(|l| !defs.loc(*l).is_site())
            .filter(|l| p.good.is_none_or(|g| defs.loc(*l).market.iter().any(|m| m.good == g)))
            // 事件类型限定了地点时只在其中挑（不限定时这一步不筛，随机数的消耗与原来相同）
            .filter(|l| def.locs.is_empty() || def.locs.contains(l))
            .collect();
        if locs.is_empty() {
            return None;
        }
        p.loc = Some(locs[rng.below(locs.len() as u64) as usize]);
    }
    if e.needs_region() {
        p.region = Some(if def.regions.is_empty() {
            RegionId::from_idx(rng.below(defs.regions.len() as u64) as usize)
        } else {
            def.regions[rng.below(def.regions.len() as u64) as usize]
        });
    }
    if e.needs_faction_a() {
        if e.needs_faction_b() {
            let pairs: Vec<(FactionId, FactionId)> = world
                .state
                .relations
                .iter()
                .filter(|r| match def.requires {
                    EventRequire::None => true,
                    EventRequire::Tension => r.status == DiploStatus::Tension,
                    EventRequire::TensionOrWar => matches!(r.status, DiploStatus::Tension | DiploStatus::War),
                })
                .filter(|r| def.factions.is_empty() || (def.factions.contains(&r.a) && def.factions.contains(&r.b)))
                .map(|r| (r.a, r.b))
                .collect();
            if pairs.is_empty() {
                return None;
            }
            let (a, b) = pairs[rng.below(pairs.len() as u64) as usize];
            p.faction_a = Some(a);
            p.faction_b = Some(b);
        } else if def.factions.is_empty() {
            p.faction_a = Some(FactionId::from_idx(rng.below(defs.factions.len() as u64) as usize));
        } else {
            p.faction_a = Some(def.factions[rng.below(def.factions.len() as u64) as usize]);
        }
    }
    if let (true, Some((lo, hi))) = (e.needs_mult(), def.mult) {
        p.mult = Some(random_mult(rng, lo, hi));
    }
    if let (true, Some((lo, hi))) = (e.needs_days(), def.days) {
        p.days = Some(rng.range(lo as i64, hi as i64) as u32);
    }
    if let (true, Some((lo, hi))) = (e.needs_delta(), def.delta) {
        p.delta = Some(rng.range(lo, hi));
    }
    Some(p)
}

/// 把内核参数写成提案中的 key 形式。
pub fn to_pick(world: &World, kind: EventTypeId, p: &EventParams) -> EventPick {
    let defs = &world.defs;
    EventPick {
        event: defs.event_type(kind).key.clone(),
        params: EventParamsRaw {
            loc: p.loc.map(|l| defs.loc(l).key.clone()),
            good: p.good.map(|g| defs.good(g).key.clone()),
            region: p.region.map(|r| defs.region(r).key.clone()),
            faction_a: p.faction_a.map(|f| defs.faction(f).key.clone()),
            faction_b: p.faction_b.map(|f| defs.faction(f).key.clone()),
            mult: p.mult.map(|m| m.raw() as f64 / Fx::SCALE as f64),
            days: p.days,
            delta: p.delta,
        },
    }
}

/// 离线事件导演：按权重决定事件数量，随机挑选当前可行的事件与参数。
pub fn director(world: &World, t: &OfflineTemplates) -> DirectorProposal {
    let defs = &world.defs;
    let mut rng = rng_for(world, 1, 0);
    let weights: Vec<i64> = t.director.count_weights.iter().map(|w| *w as i64).collect();
    let count = rng.weighted(&weights).unwrap_or(0);
    let mut picks: Vec<EventPick> = Vec::new();
    let mut used: Vec<EventTypeId> = Vec::new();
    let n = defs.events.len() as u64;
    for _ in 0..count * 8 {
        if picks.len() >= count || n == 0 {
            break;
        }
        let kind = EventTypeId::from_idx(rng.below(n) as usize);
        if used.contains(&kind) {
            continue;
        }
        let Some(params) = random_params(world, kind, &mut rng) else { continue };
        if world.validate_event(kind, &params).is_ok() {
            used.push(kind);
            picks.push(to_pick(world, kind, &params));
        }
    }
    DirectorProposal { events: picks }
}

/// 事实对应的模板变量。
pub fn fact_vars(world: &World, fact: &NewsFact) -> (String, BTreeMap<&'static str, String>) {
    let defs = &world.defs;
    let mut vars = BTreeMap::new();
    let key = match fact {
        NewsFact::PriceHigh { loc, good } | NewsFact::PriceLow { loc, good } | NewsFact::Shortage { loc, good } => {
            vars.insert("loc", defs.loc(*loc).name.clone());
            vars.insert("good", defs.good(*good).name.clone());
            match fact {
                NewsFact::PriceHigh { .. } => "price_high",
                NewsFact::PriceLow { .. } => "price_low",
                _ => "shortage",
            }
        }
        NewsFact::Relation { a, b, status } => {
            vars.insert("faction_a", defs.faction(*a).name.clone());
            vars.insert("faction_b", defs.faction(*b).name.clone());
            vars.insert("status", status_name(*status).to_string());
            "relation"
        }
        NewsFact::EventActive { event } => {
            vars.insert("event", defs.event_type(*event).name.clone());
            "event_active"
        }
    };
    (key.to_string(), vars)
}

/// 事实对应的文字引用参数（显示时按语言取名字，见 EXPANSION.md §12.1）。
pub fn fact_args(fact: &NewsFact) -> BTreeMap<String, TextArg> {
    let mut args = BTreeMap::new();
    match fact {
        NewsFact::PriceHigh { loc, good } | NewsFact::PriceLow { loc, good } | NewsFact::Shortage { loc, good } => {
            args.insert("loc".into(), TextArg::Loc(*loc));
            args.insert("good".into(), TextArg::Good(*good));
        }
        NewsFact::Relation { a, b, status } => {
            args.insert("faction_a".into(), TextArg::Faction(*a));
            args.insert("faction_b".into(), TextArg::Faction(*b));
            args.insert("status".into(), TextArg::Status(*status));
        }
        NewsFact::EventActive { event } => {
            args.insert("event".into(), TextArg::Event(*event));
        }
    }
    args
}

/// 在一组模板中挑一条的序号（与 [`pick`] 消耗同样的随机数：空列表不抽取）。
fn pick_index(rng: &mut Rng, lines: Option<&Vec<String>>) -> Option<usize> {
    let n = lines?.len();
    (n > 0).then(|| rng.below(n as u64) as usize)
}

/// 离线传闻。
pub fn rumor(world: &World, plan: &NewsPlan, t: &OfflineTemplates) -> RumorProposal {
    rumor_with_ref(world, plan, t).0
}

/// 离线传闻，附带模板位置与参数（显示时按语言重新格式化）。
pub fn rumor_with_ref(world: &World, plan: &NewsPlan, t: &OfflineTemplates) -> (RumorProposal, Option<TextRef>) {
    let mut rng = rng_for(world, 2, 0);
    let (key, vars) = fact_vars(world, &plan.fact);
    let lines = t.rumor.get(&key);
    let idx = pick_index(&mut rng, lines);
    let line = idx.and_then(|i| lines.map(|l| l[i].as_str())).unwrap_or("");
    let tpl = idx.map(|i| TextRef { parts: vec![TextRef::part("rumor", &key, i)], args: fact_args(&plan.fact) });
    (RumorProposal { text: fill(line, &vars) }, tpl)
}

/// 离线议价回复。
pub fn bargain(world: &World, intent: Intent, discount: Fx, loc: LocId, t: &OfflineTemplates) -> BargainProposal {
    bargain_with_ref(world, intent, discount, loc, t).0
}

/// 离线议价回复，附带模板位置与参数。
pub fn bargain_with_ref(
    world: &World,
    intent: Intent,
    discount: Fx,
    loc: LocId,
    t: &OfflineTemplates,
) -> (BargainProposal, Option<TextRef>) {
    let mut rng = rng_for(world, 3, loc.0 as u64);
    let key = intent_label(intent);
    let lines = t.bargain.get(key);
    let idx = pick_index(&mut rng, lines);
    let line = idx.and_then(|i| lines.map(|l| l[i].as_str())).unwrap_or("");
    let mut vars = BTreeMap::new();
    vars.insert("discount", percent(discount));
    vars.insert("loc", world.defs.loc(loc).name.clone());
    let tpl = idx.map(|i| {
        TextRef { parts: vec![TextRef::part("bargain", key, i)], args: BTreeMap::new() }
            .with("discount", TextArg::Percent(discount.raw()))
            .with("loc", TextArg::Loc(loc))
    });
    (BargainProposal { reply: fill(line, &vars) }, tpl)
}

/// 离线商会战略：风险偏好小幅随机调整，偏好商品取本据港价值最高的特产。
pub fn strategy(world: &World, company: CompanyId, t: &OfflineTemplates) -> StrategyProposal {
    let defs = &world.defs;
    let mut rng = rng_for(world, 4, company.0 as u64);
    let owner = OwnerId::Company(company);
    let current = world.state.agents.get(&owner).and_then(|a| a.strategy.clone());
    let risk = current.as_ref().map(|s| s.risk).unwrap_or(Fx::from_pct(50));
    let step = t.strategy.risk_step_pct;
    let new_risk = risk + Fx::from_pct(rng.range(-step, step));
    let home = world.state.agents.get(&owner).map(|a| a.home).unwrap_or(LocId(0));
    let mut specialties: Vec<GoodId> = defs.loc(home).market.iter().filter(|m| m.specialty).map(|m| m.good).collect();
    specialties.sort_by_key(|g| (-defs.good(*g).base_price, g.0));
    specialties.truncate(3);
    let preferred = if specialties.is_empty() { current.map(|s| s.preferred).unwrap_or_default() } else { specialties };
    StrategyProposal {
        risk: new_risk.raw() as f64 / Fx::SCALE as f64,
        preferred: preferred.iter().map(|g| defs.good(*g).key.clone()).collect(),
        memo: format!("{}调整经营方针。", owner_name(world, owner)),
    }
}

/// 离线委托合同：某势力的港口急需一批当地需求大于产出的商品。
pub fn contract(world: &World, t: &OfflineTemplates) -> Option<ContractProposal> {
    let defs = &world.defs;
    let mut rng = rng_for(world, 5, 0);
    let faction = FactionId::from_idx(rng.below(defs.factions.len() as u64) as usize);
    let ports: Vec<LocId> = defs.port_ids().filter(|l| defs.loc(*l).faction == faction).collect();
    if ports.is_empty() {
        return None;
    }
    let to = ports[rng.below(ports.len() as u64) as usize];
    let eligible = defs.rules.contracts.v2.enabled.then(|| manifest_core::contract::candidates(world, faction));
    let goods: Vec<(GoodId, i64)> = defs
        .loc(to)
        .market
        .iter()
        .filter(|m| {
            !m.specialty
                && !manifest_core::stages::is_rare(defs, m.good)
                && world.market_open(to, m.good)
                && !defs.good(m.good).license
                && eligible.as_ref().is_none_or(|cands| cands.iter().any(|c| c.0 == to && c.1 == m.good))
        })
        .map(|m| (m.good, m.demand))
        .collect();
    if goods.is_empty() {
        return None;
    }
    let (good, demand) = goods[rng.below(goods.len() as u64) as usize];
    let qty = (demand * rng.range(5, 10)).clamp(1, 2_000);
    let days = rng.range(t.contract.days[0], t.contract.days[1]);
    let fair = if defs.rules.contracts.v2.enabled {
        manifest_core::contract::fair_reward_v2(defs, good, qty, to, days)?
    } else {
        manifest_core::contract::fair_reward(defs, good, qty, days)
    };
    let reward = mul_div(fair, rng.range(t.contract.reward_pct[0], t.contract.reward_pct[1]), 100);
    Some(ContractProposal {
        issuer: defs.faction(faction).key.clone(),
        good: defs.good(good).key.clone(),
        to: defs.loc(to).key.clone(),
        qty,
        days,
        reward,
    })
}

/// 离线组合事件：按权重挑一个原型，确定性地挑选目标、在范围内取参数，
/// 通过内核校验（冷却、叠加、预算等）的第一个候选即为结果；若干次尝试都不行时返回 None。
pub fn composed(world: &World, t: &OfflineTemplates) -> Option<ComposedEventProposal> {
    let tpl = &t.composed;
    let weights: Vec<i64> = tpl.archetypes.iter().map(|a| a.weight as i64).collect();
    for attempt in 0..16u64 {
        let mut rng = rng_for(world, 7, attempt);
        let i = rng.weighted(&weights)?;
        let a = &tpl.archetypes[i];
        let Some((title, text, effects)) = instantiate(world, a, &tpl.sources, &mut rng) else { continue };
        if world.validate_composed(&title, &text, &effects).is_err() {
            continue;
        }
        let raw: Option<Vec<ComposedEffectRaw>> =
            effects.iter().map(|e| crate::resolve::raw_from_effect(&world.defs, e)).collect();
        if let Some(effects) = raw {
            return Some(ComposedEventProposal { title, narrative: text, effects });
        }
    }
    None
}

/// 两个范围的交集（下限不大于上限时才有效）。
fn intersect<T: Ord + Copy>(a: (T, T), b: Option<(T, T)>) -> Option<(T, T)> {
    let (lo, hi) = match b {
        Some((blo, bhi)) => (a.0.max(blo), a.1.min(bhi)),
        None => a,
    };
    (lo <= hi).then_some((lo, hi))
}

/// 按原型实例化一个候选：（标题、叙事、效果）。
fn instantiate(
    world: &World,
    a: &manifest_data::ComposedArchetype,
    sources: &[String],
    rng: &mut Rng,
) -> Option<(String, String, Vec<manifest_core::composed::ComposedEffect>)> {
    use manifest_core::composed::ComposedEffect;
    use manifest_core::defs::EffectKind;
    let defs = &world.defs;
    let rules = &defs.composed;
    let specs: Vec<(EffectKind, &manifest_data::ArchetypeEffect)> =
        a.effects.iter().map(|e| EffectKind::from_key(&e.effect).map(|k| (k, e))).collect::<Option<_>>()?;
    // 每条涉及商品的效果的候选商品
    let pools: Vec<Vec<GoodId>> = specs
        .iter()
        .map(|(_, e)| {
            if e.goods.is_empty() {
                defs.good_ids().collect()
            } else {
                e.goods.iter().filter_map(|g| defs.find_good(g)).collect()
            }
        })
        .collect();
    let needs_loc = specs.iter().any(|(k, _)| k.needs_loc() && !k.targets_site());
    let colony_mode = specs.iter().any(|(k, _)| k.targets_colony());
    let claim_mode = specs.iter().any(|(k, _)| *k == EffectKind::SiteClaim);
    // 地点：港口，且每条"某地某商品"效果都能在当地找到候选商品
    let eligible: Vec<LocId> = defs
        .port_ids()
        .filter(|l| !defs.loc(*l).market.is_empty())
        .filter(|l| {
            specs.iter().zip(&pools).all(|((k, _), pool)| {
                !(k.needs_loc() && k.needs_good())
                    || pool.iter().any(|g| defs.loc(*l).market.iter().any(|m| m.good == *g))
            })
        })
        .collect();
    let mut region: Option<RegionId> = None;
    // 殖民地效果：在现有的殖民地中挑一个；占领殖民点：挑一对（势力, 可以占领的殖民点）
    let mut colony: Option<&manifest_core::colony::Colony> = None;
    let mut claimant: Option<FactionId> = None;
    let loc = if colony_mode {
        let colonies: Vec<&manifest_core::colony::Colony> = world.state.colonies.values().collect();
        let c = *colonies.get(rng.below(colonies.len() as u64) as usize)?;
        colony = Some(c);
        region = defs.map.region_of(defs.loc(c.loc).cell);
        c.loc
    } else if claim_mode {
        let pairs: Vec<(FactionId, LocId)> = defs
            .faction_ids()
            .flat_map(|f| defs.site_ids().map(move |l| (f, l)))
            .filter(|(f, l)| manifest_core::colony::claim_blocker(world, *f, *l).is_none())
            .filter(|(f, _)| {
                !world.state.relations.iter().any(|r| (r.a == *f || r.b == *f) && r.status == DiploStatus::War)
            })
            .collect();
        let (f, l) = *pairs.get(rng.below(pairs.len() as u64) as usize)?;
        claimant = Some(f);
        region = defs.map.region_of(defs.loc(l).cell);
        l
    } else if needs_loc {
        let l = *eligible.get(rng.below(eligible.len() as u64) as usize)?;
        region = defs.map.region_of(defs.loc(l).cell);
        l
    } else {
        // 没有地点效果：地点只作叙事背景；有海区效果时尽量取该海区的港口
        if specs.iter().any(|(k, _)| k.needs_region()) && !defs.regions.is_empty() {
            region = Some(RegionId::from_idx(rng.below(defs.regions.len() as u64) as usize));
        }
        let in_region: Vec<LocId> =
            defs.port_ids().filter(|l| region.is_some() && defs.map.region_of(defs.loc(*l).cell) == region).collect();
        let ports: Vec<LocId> = if in_region.is_empty() { defs.port_ids().collect() } else { in_region };
        *ports.get(rng.below(ports.len() as u64) as usize)?
    };
    if region.is_none() && specs.iter().any(|(k, _)| k.needs_region()) && !defs.regions.is_empty() {
        region = Some(RegionId::from_idx(rng.below(defs.regions.len() as u64) as usize));
    }
    // 势力：关系类效果取一对不同的势力，关税效果共用第一个
    let n = defs.factions.len() as u64;
    let fa = FactionId::from_idx(rng.below(n) as usize);
    let mut fb = FactionId::from_idx(rng.below(n) as usize);
    if n > 1 && fb == fa {
        fb = FactionId::from_idx(((fa.idx() as u64 + 1 + rng.below(n - 1)) % n) as usize);
    }
    let fa = claimant.unwrap_or(fa);
    // 发现物传闻：挑一件可以流传传闻的发现物，{region} 取传闻所指的海区
    let mut discovery: Option<DiscoveryId> = None;
    if specs.iter().any(|(k, _)| k.needs_discovery()) {
        let candidates: Vec<DiscoveryId> = defs.discovery_ids().filter(|d| world.rumor_blocker(*d).is_none()).collect();
        let d = *candidates.get(rng.below(candidates.len() as u64) as usize)?;
        discovery = Some(d);
        if region.is_none() {
            region = manifest_core::explore::discovery_region(defs, d);
        }
    }
    let mut effects: Vec<ComposedEffect> = Vec::new();
    let mut first_good: Option<GoodId> = None;
    for ((k, spec), pool) in specs.iter().zip(&pools) {
        let b = rules.bounds(*k)?;
        let mut p = EventParams::default();
        if k.needs_loc() {
            p.loc = Some(loc);
        }
        if k.needs_discovery() {
            p.discovery = discovery;
        }
        if k.allows_building() {
            // 候选：模板列出的建筑（"all" 表示全部）与该殖民地已建成的产出建筑取交集；模板未列出时任选其一或全部
            let c = colony?;
            let built = |b: ColonyBuildingId| c.level(b) > 0 && manifest_core::colony::is_productive(defs, b);
            let options: Vec<Option<ColonyBuildingId>> = if spec.buildings.is_empty() {
                std::iter::once(None).chain(c.buildings.keys().copied().filter(|b| built(*b)).map(Some)).collect()
            } else {
                spec.buildings
                    .iter()
                    .filter_map(|k| {
                        if k == crate::resolve::ALL_BUILDINGS {
                            Some(None)
                        } else {
                            defs.find_colony_building(k).filter(|b| built(*b)).map(Some)
                        }
                    })
                    .collect()
            };
            p.building = *options.get(rng.below(options.len() as u64) as usize)?;
        }
        if k.needs_good() {
            let candidates: Vec<GoodId> = if k.needs_loc() {
                pool.iter().copied().filter(|g| defs.loc(loc).market.iter().any(|m| m.good == *g)).collect()
            } else {
                pool.clone()
            };
            let g = *candidates.get(rng.below(candidates.len() as u64) as usize)?;
            first_good.get_or_insert(g);
            p.good = Some(g);
        }
        if k.needs_region() {
            p.region = region;
        }
        if k.needs_faction_a() {
            p.faction_a = Some(fa);
        }
        if k.needs_faction_b() {
            p.faction_b = Some(fb);
        }
        if let Some([lo, hi]) = spec.mult {
            let range = (crate::resolve::fx_from_f64(lo)?, crate::resolve::fx_from_f64(hi)?);
            let (lo, hi) = intersect(range, b.mult)?;
            let m = random_mult(rng, lo, hi);
            p.mult = Some(if m == Fx::ONE { hi } else { m });
        }
        if let Some([lo, hi]) = spec.days {
            let (lo, hi) = intersect((lo, hi), b.days)?;
            p.days = Some(rng.range(lo as i64, hi as i64) as u32);
        }
        if let Some([lo, hi]) = spec.delta {
            let (mut lo, mut hi) = intersect((lo, hi), b.delta)?;
            // 和平或停战的两国之间取更窄的范围
            if let (Some((plo, phi)), EffectKind::RelationShift) = (b.peace_delta, k) {
                let status = world.relation(fa, fb).map(|r| r.status).unwrap_or(DiploStatus::Peace);
                if matches!(status, DiploStatus::Peace | DiploStatus::Truce) {
                    (lo, hi) = intersect((lo, hi), Some((plo, phi)))?;
                }
            }
            let d = rng.range(lo, hi);
            p.delta = Some(if d == 0 { hi } else { d });
        }
        effects.push(ComposedEffect { effect: *k, params: p });
    }
    let mut vars: BTreeMap<&str, String> = BTreeMap::new();
    vars.insert("loc", defs.loc(loc).name.clone());
    vars.insert("date", world_date_text(&defs.rules.world, world.day()));
    if let Some(g) = first_good {
        vars.insert("good", defs.good(g).name.clone());
    }
    if let Some(r) = region {
        vars.insert("region", defs.region(r).name.clone());
    }
    vars.insert("faction_a", defs.faction(fa).name.clone());
    vars.insert("faction_b", defs.faction(fb).name.clone());
    if let Some(c) = colony {
        vars.insert("colony", c.name.clone());
    }
    if let Some(d) = discovery {
        vars.insert("discovery", defs.discovery(d).name.clone());
    }
    let title = fill(pick(rng, &a.titles), &vars);
    let source = fill(pick(rng, sources), &vars);
    let body = fill(pick(rng, &a.narratives), &vars);
    let title: String = title.chars().take(rules.max_title_chars).collect();
    let text: String = format!("{source}{body}").chars().take(rules.max_text_chars).collect();
    Some((title, text, effects))
}

/// 年度事实对应的模板变量。
pub fn chronicle_vars(world: &World, f: &YearFacts) -> BTreeMap<&'static str, String> {
    let defs = &world.defs;
    let mut vars = BTreeMap::new();
    vars.insert("year", year_text(&defs.rules.world, f.year));
    let mut names: Vec<String> = f.events.iter().map(|e| defs.event_type(*e).name.clone()).collect();
    names.dedup();
    // 组合事件的标题也写进编年史
    names.extend(f.composed.iter().cloned());
    vars.insert("events", if names.is_empty() { "诸事平稳".into() } else { names.join("、") });
    let wars: Vec<String> =
        f.wars.iter().map(|(a, b)| format!("{}与{}", defs.faction(*a).name, defs.faction(*b).name)).collect();
    vars.insert("wars", wars.join("、"));
    let bankrupt: Vec<String> = f.bankrupt.iter().map(|o| owner_name(world, *o)).collect();
    vars.insert("bankrupt", bankrupt.join("、"));
    vars.insert("richest", f.richest.map(|o| owner_name(world, o)).unwrap_or_else(|| "无人".into()));
    vars.insert("net_worth", f.player_net_worth.to_string());
    vars
}

/// 年度事实对应的文字引用参数（与 [`chronicle_vars`] 逐项对应，名字在显示时按语言取）。
pub fn chronicle_args(world: &World, f: &YearFacts) -> BTreeMap<String, TextArg> {
    let defs = &world.defs;
    let mut args = BTreeMap::new();
    args.insert("year".into(), TextArg::Year(f.year));
    // 与 chronicle_vars 相同的去重：相邻的同名事件只写一次
    let mut events: Vec<TextArg> = Vec::new();
    let mut last: Option<&str> = None;
    for e in &f.events {
        let name = defs.event_type(*e).name.as_str();
        if last != Some(name) {
            events.push(TextArg::Event(*e));
            last = Some(name);
        }
    }
    events.extend(f.composed.iter().map(|t| TextArg::Composed(t.clone())));
    args.insert(
        "events".into(),
        if events.is_empty() { TextArg::Term("quiet_year".into()) } else { TextArg::List(events) },
    );
    args.insert("wars".into(), TextArg::List(f.wars.iter().map(|(a, b)| TextArg::Pair(*a, *b)).collect()));
    args.insert("bankrupt".into(), TextArg::List(f.bankrupt.iter().map(|o| TextArg::Owner(*o)).collect()));
    args.insert("richest".into(), f.richest.map(TextArg::Owner).unwrap_or_else(|| TextArg::Term("nobody".into())));
    args.insert("net_worth".into(), TextArg::Int(f.player_net_worth));
    args
}

/// 离线编年史。
pub fn chronicle(world: &World, f: &YearFacts, t: &OfflineTemplates) -> ChronicleProposal {
    chronicle_with_ref(world, f, t).0
}

/// 离线编年史，附带各段的模板位置与参数。
pub fn chronicle_with_ref(world: &World, f: &YearFacts, t: &OfflineTemplates) -> (ChronicleProposal, Option<TextRef>) {
    let mut rng = rng_for(world, 6, f.year as u64);
    let vars = chronicle_vars(world, f);
    let mut sections = vec!["opening", "events"];
    if !f.wars.is_empty() {
        sections.push("wars");
    }
    if !f.bankrupt.is_empty() {
        sections.push("bankrupt");
    }
    sections.push("closing");
    let mut parts = Vec::new();
    let mut refs = Vec::new();
    for s in sections {
        let lines = t.chronicle.get(s);
        match pick_index(&mut rng, lines) {
            Some(i) => {
                parts.push(fill(lines.map(|l| l[i].as_str()).unwrap_or(""), &vars));
                refs.push(TextRef::part("chronicle", s, i));
            }
            None => parts.push(String::new()),
        }
    }
    let tpl = (!refs.is_empty()).then(|| TextRef { parts: refs, args: chronicle_args(world, f) });
    (ChronicleProposal { text: parts.join("") }, tpl)
}

// ───────────────────────────── 第八批 E7：商会展望、市场月报、复盘点评、身世序章 ─────────────────────────────

/// 从文字模板的某一段挑一句：返回填好的句子与模板位置。
fn text_part(
    rng: &mut Rng,
    t: &BTreeMap<String, Vec<String>>,
    file: &str,
    section: &str,
    vars: &BTreeMap<&str, String>,
) -> Option<(String, String)> {
    let lines = t.get(section)?;
    let i = pick_index(rng, Some(lines))?;
    Some((fill(&lines[i], vars), TextRef::part(file, section, i)))
}

/// 离线商会展望（ECONOMY.md 8.2）：看法按商会所知的本据港行情定——近 30 天的收盘价涨跌超过一成看好或看淡、超过两成五再加一级，
/// 库存不到目标三成的再看好一级；先看偏好商品，再按基准价从高到低看本据港的其他商品，至多 4 条；方法照旧；
/// 备忘按最强的一条看法挑一句（没有看法时挑“平稳”的一句）。
pub fn outlook(world: &World, company: CompanyId, t: &OfflineTemplates) -> (OutlookProposal, Option<TextRef>) {
    let defs = &world.defs;
    let mut rng = rng_for(world, 8, company.0 as u64);
    let owner = OwnerId::Company(company);
    let method = crate::resolve::method_key(world.company_method(owner)).to_string();
    let Some(agent) = world.state.agents.get(&owner) else {
        return (OutlookProposal { views: Vec::new(), method, memo: String::new() }, None);
    };
    let home = agent.home;
    let sight = world.sight(owner);
    let mut goods: Vec<GoodId> = agent.strategy.as_ref().map(|s| s.preferred.clone()).unwrap_or_default();
    // 本据港清单里的商品（开放市场补上的只收不卖的条目不看）
    let mut rest: Vec<GoodId> =
        world.state.locations[home.idx()].market.iter().filter(|(_, e)| !e.extra).map(|(g, _)| *g).collect();
    rest.sort_by_key(|g| (-defs.good(*g).base_price, g.0));
    for g in rest {
        if !goods.contains(&g) {
            goods.push(g);
        }
    }
    let mut views: Vec<(GoodId, i8)> = Vec::new();
    for g in goods {
        if views.len() >= manifest_core::commerce::OUTLOOK_MAX_VIEWS {
            break;
        }
        let Some(k) = sight.market(home, g) else { continue };
        let n = k.history_len();
        if n < 31 {
            continue;
        }
        let (Some(old), Some(now)) = (k.history_at(n - 31), k.history_at(n - 1)) else { continue };
        let change = mul_div(now - old, 10_000, old.max(1));
        let mut v: i8 = match change {
            c if c >= 2_500 => 2,
            c if c >= 1_000 => 1,
            c if c <= -2_500 => -2,
            c if c <= -1_000 => -1,
            _ => 0,
        };
        if k.stock * 10 < k.entry.target * 3 {
            v = (v + 1).min(2);
        }
        if v != 0 {
            views.push((g, v));
        }
    }
    let strongest = views.iter().max_by_key(|(g, v)| (v.abs(), -(g.0 as i32))).copied();
    let mut vars: BTreeMap<&str, String> = BTreeMap::new();
    vars.insert("company", owner_name(world, owner));
    let mut args = BTreeMap::new();
    args.insert("company".to_string(), TextArg::Owner(owner));
    let section = match strongest {
        Some((g, v)) => {
            vars.insert("good", defs.good(g).name.clone());
            args.insert("good".to_string(), TextArg::Good(g));
            if v > 0 { "up" } else { "down" }
        }
        None => "flat",
    };
    let (memo, tpl) = match text_part(&mut rng, &t.outlook, "outlook", section, &vars) {
        Some((memo, part)) => (memo, Some(TextRef { parts: vec![part], args })),
        None => (format!("{}照常经营。", owner_name(world, owner)), None),
    };
    let views = views.iter().map(|(g, v)| OutlookView { good: defs.good(*g).key.clone(), view: *v as i64 }).collect();
    (OutlookProposal { views, method, memo }, tpl)
}

/// 离线市场月报（ECONOMY.md 8.5）：按上个月的事实各取一句拼成全文（没有的事实不写）。
pub fn market_report_with_ref(
    world: &World,
    f: &manifest_core::report::ReportFacts,
    t: &OfflineTemplates,
) -> (TextProposal, Option<TextRef>) {
    let defs = &world.defs;
    let mut rng = rng_for(world, 9, f.region.0 as u64);
    let mut vars: BTreeMap<&str, String> = BTreeMap::new();
    let mut args: BTreeMap<String, TextArg> = BTreeMap::new();
    vars.insert("region", defs.region(f.region).name.clone());
    args.insert("region".into(), TextArg::Region(f.region));
    let mut sections = vec!["opening"];
    if let Some((l, g, pct)) = f.riser {
        sections.push("riser");
        vars.insert("riser_loc", defs.loc(l).name.clone());
        vars.insert("riser_good", defs.good(g).name.clone());
        vars.insert("riser_pct", percent(Fx(pct)));
        args.insert("riser_loc".into(), TextArg::Loc(l));
        args.insert("riser_good".into(), TextArg::Good(g));
        args.insert("riser_pct".into(), TextArg::Percent(pct));
    }
    if let Some((l, g, pct)) = f.faller {
        sections.push("faller");
        vars.insert("faller_loc", defs.loc(l).name.clone());
        vars.insert("faller_good", defs.good(g).name.clone());
        vars.insert("faller_pct", percent(Fx(pct.abs())));
        args.insert("faller_loc".into(), TextArg::Loc(l));
        args.insert("faller_good".into(), TextArg::Good(g));
        args.insert("faller_pct".into(), TextArg::Percent(pct.abs()));
    }
    if let Some((l, g)) = f.shortage {
        sections.push("shortage");
        vars.insert("shortage_loc", defs.loc(l).name.clone());
        vars.insert("shortage_good", defs.good(g).name.clone());
        args.insert("shortage_loc".into(), TextArg::Loc(l));
        args.insert("shortage_good".into(), TextArg::Good(g));
    }
    if let Some(title) = &f.policy {
        sections.push("policy");
        vars.insert("policy", title.clone());
        args.insert("policy".into(), TextArg::Composed(title.clone()));
    }
    if let Some((l, v)) = f.money {
        sections.push("money");
        let term = if v < Fx::ONE { "money_tight" } else { "money_flush" };
        vars.insert("money_loc", defs.loc(l).name.clone());
        vars.insert("money_state", if v < Fx::ONE { "钱袋吃紧、物价走低" } else { "钱袋充裕、物价走高" }.to_string());
        args.insert("money_loc".into(), TextArg::Loc(l));
        args.insert("money_state".into(), TextArg::Term(term.into()));
    }
    if let Some((c, g, v)) = f.outlook {
        sections.push("outlook");
        let owner = OwnerId::Company(c);
        vars.insert("company", owner_name(world, owner));
        vars.insert("view_good", defs.good(g).name.clone());
        vars.insert("view", if v > 0 { "看好" } else { "看淡" }.to_string());
        args.insert("company".into(), TextArg::Owner(owner));
        args.insert("view_good".into(), TextArg::Good(g));
        args.insert("view".into(), TextArg::Term(if v > 0 { "outlook_up" } else { "outlook_down" }.into()));
    }
    sections.push("closing");
    let mut text = String::new();
    let mut parts = Vec::new();
    for s in sections {
        if let Some((line, part)) = text_part(&mut rng, &t.market_report, "market_report", s, &vars) {
            text.push_str(&line);
            parts.push(part);
        }
    }
    let tpl = (!parts.is_empty()).then_some(TextRef { parts, args });
    (TextProposal { text }, tpl)
}

/// 离线复盘点评（ECONOMY.md 8.6）：把复盘算出的诊断与驱动（已按界面语言写好）框进几句话。
pub fn review_with_ref(world: &World, place: &str, facts: &[String], t: &OfflineTemplates) -> (TextProposal, TextRef) {
    let mut rng = rng_for(world, 10, facts.len() as u64);
    let joined = facts.join("、");
    let mut vars: BTreeMap<&str, String> = BTreeMap::new();
    vars.insert("place", place.to_string());
    vars.insert("facts", joined);
    let mut args: BTreeMap<String, TextArg> = BTreeMap::new();
    args.insert("place".into(), TextArg::Text(place.to_string()));
    args.insert("facts".into(), TextArg::List(facts.iter().map(|f| TextArg::Text(f.clone())).collect()));
    let mut text = String::new();
    let mut parts = Vec::new();
    for s in ["opening", "facts", "closing"] {
        if let Some((line, part)) = text_part(&mut rng, &t.review, "review", s, &vars) {
            text.push_str(&line);
            parts.push(part);
        }
    }
    (TextProposal { text }, TextRef { parts, args })
}

/// 身世序章的事实（由应用层按界面语言写好）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PrologueFacts {
    pub name: String,
    /// 星座
    pub sign: String,
    /// 身世五问的回答（按问题顺序）
    pub answers: Vec<String>,
    /// 启航的港口
    pub port: String,
}

/// 离线身世序章（ECONOMY.md 8.7）：按身世选项拼接。
pub fn prologue_with_ref(world: &World, f: &PrologueFacts, t: &OfflineTemplates) -> (TextProposal, TextRef) {
    let mut rng = rng_for(world, 11, f.answers.len() as u64);
    let mut vars: BTreeMap<&str, String> = BTreeMap::new();
    vars.insert("name", f.name.clone());
    vars.insert("sign", f.sign.clone());
    vars.insert("answers", f.answers.join("、"));
    vars.insert("port", f.port.clone());
    let mut args: BTreeMap<String, TextArg> = BTreeMap::new();
    args.insert("name".into(), TextArg::Text(f.name.clone()));
    args.insert("sign".into(), TextArg::Text(f.sign.clone()));
    args.insert("answers".into(), TextArg::List(f.answers.iter().map(|a| TextArg::Text(a.clone())).collect()));
    args.insert("port".into(), TextArg::Text(f.port.clone()));
    let mut text = String::new();
    let mut parts = Vec::new();
    for s in ["opening", "story", "closing"] {
        if let Some((line, part)) = text_part(&mut rng, &t.prologue, "prologue", s, &vars) {
            text.push_str(&line);
            parts.push(part);
        }
    }
    (TextProposal { text }, TextRef { parts, args })
}

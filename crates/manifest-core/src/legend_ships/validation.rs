//! 名船身份不能被普通船厂或损坏存档复制。
use super::*;
use crate::societies::validation::key;
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    let mut unique_hulls = BTreeSet::new();
    if !d.rules.ships.valid()
        || d.rules
            .ships
            .sacred_ports
            .iter()
            .chain(&d.rules.ships.shallow_ports)
            .any(|p| d.find_loc(p).is_none_or(|l| !d.loc(l).is_port()))
    {
        errors.push("rules.ships：特性数值或港口引用无效".into());
    }
    if d.legend_ships.ships.len() > 128 {
        errors.push("传说船超过128条".into());
    }
    for s in &d.legend_ships.ships {
        let hull = d.ships.iter().find(|h| h.key == s.hull);
        let build = s.acquire.kind == AcquireKind::Build;
        let acquire_valid = if build {
            valid_build(d, s)
        } else {
            d.rules.ships.s02_enabled
                && s.acquire.blueprint.is_none()
                && s.acquire.shipyards.is_empty()
                && s.cost == Cost::default()
                && match s.acquire.kind {
                    AcquireKind::Witness => s.acquire.track.is_some() && s.maintenance.is_empty(),
                    AcquireKind::GrantStory => {
                        s.lost == Recovery::Never
                            && s.acquire.track.as_ref().and_then(|k| d.story2.track(k)).is_some_and(|t| {
                                t.chapters.iter().flat_map(crate::story2::graph::branches).any(|b| {
                                    b.effects.iter().any(
                                        |e| matches!(e, crate::story2::Effect::LegendShip { ship } if ship == &s.key),
                                    )
                                })
                            })
                    }
                    AcquireKind::Build => false,
                }
        };
        if !key(&s.key)
            || !keys.insert(&s.key)
            || s.name.trim().is_empty()
            || s.lore.trim().is_empty()
            || s.acquire_note.trim().is_empty()
            || hull.is_none_or(|h| h.unique && !unique_hulls.insert(&s.hull))
            || !(1..=5).contains(&s.limit)
            || s.unique && s.limit != 1
            || s.trait_notes.iter().any(|(t, n)| !s.traits.contains(t) || n.trim().is_empty())
            || s.traits.is_empty()
            || s.traits.iter().collect::<BTreeSet<_>>().len() != s.traits.len()
            || !d.rules.ships.s02_enabled
                && s.traits.iter().any(|t| {
                    matches!(
                        t,
                        Trait::Dread
                            | Trait::NightHide
                            | Trait::StormWard
                            | Trait::CalmFloor
                            | Trait::FreshKeep
                            | Trait::Lookout
                    )
                })
            || match (&s.unrevealed_name, &s.reveal_flag) {
                (None, None) => false,
                (Some(name), Some(flag)) => name.trim().is_empty() || name.chars().count() > 100 || !key(flag),
                _ => true,
            }
            || s.acquire.track.as_ref().is_some_and(|k| d.story2.track(k).is_none())
            || !acquire_valid
            || s.maintenance.len() > 8
            || s.maintenance.iter().any(|(k, q)| !(1..=1000).contains(q) || d.find_good(k).is_none())
            || s.traits.contains(&Trait::Oracle)
                && s.oracle_spell
                    .as_ref()
                    .is_none_or(|k| d.arcana.spell(k).is_none_or(|s| s.effect != crate::arcana::Effect::Divination))
            || s.oracle_spell.as_ref().is_some_and(|_| !s.traits.contains(&Trait::Oracle))
            || s.salvage.len() > 16
            || s.salvage.iter().any(|k| {
                d.items.item(k).is_none_or(|i| {
                    i.protected() || crate::arcana::validation::religious(i) || i.price > crate::arcana::MAX_VALUE
                })
            })
            || !s.salvage.is_empty() && !s.traits.contains(&Trait::Salvage)
        {
            errors.push(format!("{}：传说船图纸、船厂、费用或特性无效", s.key));
        }
    }
    errors
}

/// 图纸开造继续保留原来的船厂、最低船价与材料限制。
fn valid_build(d: &StaticData, s: &LegendShipDef) -> bool {
    let materials = crate::arcana::validation::material_value(d, &s.cost);
    s.acquire.blueprint.as_ref().is_some_and(|k| d.items.item(k).is_some())
        && !s.acquire.shipyards.is_empty()
        && s.acquire.shipyards.iter().all(|p| {
            d.find_loc(p)
                .is_some_and(|l| d.loc(l).is_port() && d.loc(l).shipyard.iter().any(|h| d.ship(*h).key == s.hull))
        })
        && (1..=100_000_000).contains(&s.cost.cash)
        && s.cost.items.len() + s.cost.goods.len() <= 32
        && s.cost.items.iter().all(|(k, q)| {
            (1..=10000).contains(q)
                && d.items.item(k).is_some_and(|i| !i.protected() && !crate::arcana::validation::religious(i))
        })
        && s.cost.goods.iter().all(|(k, q)| (1..=10000).contains(q) && d.find_good(k).is_some())
        && materials.is_some_and(|v| v <= 100_000_000)
        && d.ships
            .iter()
            .find(|h| h.key == s.hull)
            .is_none_or(|h| s.cost.cash.saturating_add(materials.unwrap_or(0)) >= h.price)
}
impl World {
    pub(crate) fn validate_legend_ships_snapshot(&self) -> Result<(), CoreError> {
        let state = &self.state.legend_ships;
        let mut counts = BTreeMap::<&str, u8>::new();
        for f in self.state.fleets.values() {
            for s in &f.ships {
                if let Some(k) = &s.legend {
                    let Some(d) = self.defs.legend_ships.ship(k) else {
                        return Err(CoreError::SnapshotMismatch("传说船身份未知".into()));
                    };
                    if f.owner != OwnerId::Player || self.defs.ship(s.kind).key != d.hull {
                        return Err(CoreError::SnapshotMismatch("传说船所有者或船体不符".into()));
                    }
                    let n = counts.entry(k).or_default();
                    *n = n.saturating_add(1);
                    if *n > d.limit {
                        return Err(CoreError::SnapshotMismatch("传说船被复制".into()));
                    }
                }
            }
        }
        let valid = state.known.iter().all(|k| self.defs.legend_ships.ship(k).is_some())
            && state.ships.iter().all(|(k, r)| {
                self.defs.legend_ships.ship(k).is_some_and(|d| {
                    r.owned <= d.limit
                        && u64::from(r.built) == u64::from(r.owned) + u64::from(r.sold) + u64::from(r.lost)
                        && counts.get(k.as_str()).copied().unwrap_or(0) <= r.owned
                })
            })
            && counts
                .iter()
                .all(|(k, n)| state.ships.get(*k).is_some_and(|r| r.owned >= *n && r.built >= u32::from(*n)))
            && state.oracle.iter().all(|(k, day)| {
                *day <= self.day() && self.defs.legend_ships.ship(k).is_some_and(|s| s.traits.contains(&Trait::Oracle))
            })
            && state.salvage.len() <= 10000
            && state.salvage.iter().all(|k| k.len() <= 128 && (k.starts_with("battle:") || k.starts_with("dive:")));
        if valid { Ok(()) } else { Err(CoreError::SnapshotMismatch("传说船唯一性与建造记录无效".into())) }
    }
}

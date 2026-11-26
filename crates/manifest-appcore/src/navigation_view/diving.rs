//! 潜水入口只暴露已有线索，能否执行由同一条命令校验决定。
use crate::views::{Ctx, PLAYER};
use manifest_core::{Command, DiscoveryId, StaticData, World, geo::authored::DiscoveryMode};
use serde::Serialize;

pub(crate) fn is_dive(defs: &StaticData, key: &str) -> bool {
    defs.geography.places.authored.discoveries.get(key).is_some_and(|d| d.requires.mode == DiscoveryMode::Dive)
}

#[derive(Clone, Debug, Serialize)]
pub struct DiveView {
    pub fleet: u32,
    pub discovery: u16,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
}

pub(crate) fn options(ctx: Ctx<'_>, world: &World) -> Vec<DiveView> {
    let known: Vec<_> = world
        .defs
        .discoveries
        .iter()
        .enumerate()
        .filter_map(|(i, d)| {
            let id = DiscoveryId::from_idx(i);
            let visible = !world.hides_unknown_locations()
                || world.state.explore.discovered.contains_key(&id)
                || world.state.explore.rumors.contains_key(&id)
                || world
                    .discovery_cell(id)
                    .is_some_and(|cell| world.state.explore.is_revealed(world.defs.map.idx(cell)));
            (is_dive(&world.defs, &d.key) && visible).then_some(id)
        })
        .collect();
    world
        .fleets_of(PLAYER)
        .flat_map(|fleet| {
            known.iter().map(move |&discovery| {
                let checked = Command::Dive { owner: PLAYER, fleet: fleet.id, discovery }.validate(world);
                DiveView {
                    fleet: fleet.id.0,
                    discovery: discovery.0,
                    enabled: checked.is_ok(),
                    blocked_reason: checked.err().map(|error| ctx.error(&error)),
                }
            })
        })
        .collect()
}

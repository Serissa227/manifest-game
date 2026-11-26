//! H10b：目的地只在菜单需要时计算；粗格内移动不使结果失效。
use crate::{AppError, AppState, views::Ctx};
use manifest_core::{FleetId, OwnerId, StaticData, World};
use serde_json::{Value, json};
use std::sync::Arc;

pub(crate) struct DestKey {
    defs: Arc<StaticData>,
    digest: blake3::Hash,
}

impl DestKey {
    pub(crate) fn new(generation: u64, world: &World, locale: &str, fleet: FleetId) -> Result<Self, AppError> {
        let f = world.fleet(fleet).map_err(manifest_core::CommandError::from).map_err(AppError::Command)?;
        if f.owner != OwnerId::Player {
            return Err(AppError::Command(manifest_core::CommandError::NotOwner));
        }
        let places: Vec<_> = world
            .defs
            .loc_ids()
            .map(|id| {
                (
                    id,
                    world.location_visible(id),
                    world.location_open(id),
                    world.port_is_open(id),
                    world.check_port_access(f, id).is_ok(),
                )
            })
            .collect();
        let mods = world.voyage_mods(fleet);
        let value = (
            generation,
            Arc::as_ptr(&world.defs) as usize,
            locale,
            fleet,
            world.day(),
            f.cell(&world.defs),
            world.state.explore.fog_revision(),
            places,
            world.realm_passes_of(OwnerId::Player),
            (
                &f.ships,
                f.crew,
                (f.food, f.water, &f.supply_remainder),
                f.morale,
                world.fleet_speed_bonus(fleet),
                (mods.speed_bp, mods.upwind, mods.fog_offset, mods.coordination, mods.idle_crew, mods.auto_reef),
            ),
        );
        let bytes = serde_json::to_vec(&value).map_err(|e| AppError::Data(e.to_string()))?;
        Ok(Self { defs: world.defs.clone(), digest: blake3::hash(&bytes) })
    }

    pub(crate) fn rev(&self) -> String {
        self.digest.to_hex()[..16].to_owned()
    }
    fn matches(&self, other: &Self) -> bool {
        self.digest == other.digest && Arc::ptr_eq(&self.defs, &other.defs)
    }
}

#[derive(Default)]
pub(crate) struct DestCache {
    entry: Option<(DestKey, Value)>,
}

impl DestCache {
    pub(crate) fn query(&mut self, key: DestKey, build: impl FnOnce(&str) -> Value) -> Value {
        if let Some((old, value)) = &self.entry
            && old.matches(&key)
        {
            return value.clone();
        }
        let value = build(&key.rev());
        self.entry = Some((key, value.clone()));
        value
    }
    pub(crate) fn clear(&mut self) {
        self.entry = None;
    }
}

pub fn navigation_dests(st: &AppState, fleet: u32) -> Result<Value, AppError> {
    let guard = st.game()?;
    let game = guard.as_ref().ok_or(AppError::NoGame)?;
    let world = game.view_world();
    let id = FleetId(fleet);
    let locale = st.locale();
    let key = DestKey::new(st.generation(), &world, locale.code(), id)?;
    let ctx = st.resources().locales.ctx(locale);
    st.cached_dests(key, |rev| dests_view(ctx, &world, id, rev))
}

pub fn dests_view(ctx: Ctx<'_>, world: &World, fleet: FleetId, rev: &str) -> Value {
    let Ok(f) = world.fleet(fleet) else { return Value::Null };
    let from = f.cell(&world.defs);
    let (locations, paths) = crate::navigation_view::destination_paths(world, fleet);
    let dests = crate::navigation_view::destination_estimates(ctx, world, fleet, locations, paths, true);
    json!({"fleet":fleet.0,"day":world.day(),"from":[from.x,from.y],"rev":rev,"dests":dests})
}

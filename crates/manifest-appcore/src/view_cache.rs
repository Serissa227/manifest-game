//! P03：航行查询缓存只保存编码后的两个最近结果，不持有世界投影或无界操舵历史。
use crate::state::Game;
use crate::{AppError, AppState};
use manifest_core::navigation::Steering;
use manifest_core::{FleetId, RegionId, StaticData};
use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::sync::Arc;

pub const ENTRY_BYTES: usize = 512 * 1024;
pub const CACHE_BYTES: usize = 3 * ENTRY_BYTES;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub entries: usize,
    pub bytes: usize,
}

pub(crate) enum Query<'a> {
    Navigation { fleet: u32 },
    Preview { fleet: u32, minute: u16, steers: &'a [Steering] },
    Course { fleet: u32, minute: u16, steers: &'a [Steering], days: u8 },
    NavigationWith { fleet: u32, opts: crate::navigation_view::NavigationOptions },
}

pub(crate) struct ViewKey {
    /// 持有同一不可变定义的 Arc，避免释放后地址复用；定义被替换或 Arc::make_mut 时必然失效。
    defs: Arc<StaticData>,
    digest: blake3::Hash,
    slot: usize,
}

#[derive(Default)]
struct Fingerprint(blake3::Hasher);
impl Write for Fingerprint {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Fingerprint {
    fn add(&mut self, value: &impl Serialize) -> Result<(), AppError> {
        serde_json::to_writer(&mut *self, value).map_err(|e| AppError::Data(e.to_string()))?;
        self.0.update(b"\n");
        Ok(())
    }
}

impl ViewKey {
    /// 指纹在投影前建立，命中时省去世界复制、分钟积分、已知海域寻路与 JSON 构建。
    pub(crate) fn new(
        st: &AppState,
        game: &Game,
        locale: manifest_data::Locale,
        query: Query<'_>,
    ) -> Result<Self, AppError> {
        let w = &game.session.world;
        let s = &w.state;
        let mut hash = Fingerprint::default();
        let (slot, fleet, minute, steers, days, opts) = match query {
            Query::Navigation { fleet } => (0, fleet, 0, &[][..], 0, None),
            Query::Preview { fleet, minute, steers } => (1, fleet, minute, steers, 0, None),
            Query::Course { fleet, minute, steers, days } => (2, fleet, minute, steers, days, None),
            Query::NavigationWith { fleet, opts } => (0, fleet, 0, &[][..], opts.course_days, Some(opts)),
        };
        hash.add(&(days, opts))?;
        hash.add(&(st.generation(), game.minute, locale.code(), slot, fleet, minute, steers))?;
        // 舰队包含船装、货载、船员、自动驾驶及定点余数；全体舰队参与沿途船只发现。
        hash.add(&(s.seed, s.day, &s.navigation, &s.fleets, &s.explore, &s.battles))?;
        // 当前有效属性与探索可见性属于读模型输入，不把市场历史等无关大块纳入哈希。
        for id in s.fleets.keys() {
            hash.add(&(id, w.fleet_speed_bonus(*id), w.navigation_sight(*id)))?;
            let mods = w.voyage_mods(*id);
            hash.add(&(
                (mods.speed_bp, mods.upwind, mods.fog_offset, mods.coordination, mods.idle_crew, mods.auto_reef),
                w.creature_delayed(*id),
                w.realm_passes_of(
                    w.fleet(*id).map_err(manifest_core::CommandError::from).map_err(AppError::Command)?.owner,
                ),
            ))?;
        }
        for index in 0..w.defs.regions.len() {
            hash.add(&w.weather_today(RegionId::from_idx(index)).map(|day| {
                (
                    day.region,
                    day.day,
                    day.sky,
                    day.sea.wind_dir,
                    day.sea.wind_strength,
                    day.sea.current_dir,
                    day.sea.current_strength,
                    day.sea.storm_bp,
                    day.sea.pirate_bp,
                    day.storm_hit_e8,
                )
            }))?;
        }
        for id in w.defs.loc_ids() {
            hash.add(&(id, w.location_visible(id), w.location_open(id), w.port_is_open(id)))?;
        }
        Ok(Self { defs: w.defs.clone(), digest: hash.0.finalize(), slot })
    }

    fn matches(&self, other: &Self) -> bool {
        self.slot == other.slot && self.digest == other.digest && Arc::ptr_eq(&self.defs, &other.defs)
    }
}

struct Entry {
    key: ViewKey,
    json: Box<[u8]>,
}

#[derive(Default)]
pub(crate) struct ViewCache {
    entries: [Option<Entry>; 3],
    hits: u64,
    misses: u64,
}

struct Bounded(Vec<u8>);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > ENTRY_BYTES.saturating_sub(self.0.len()) {
            return Err(std::io::Error::other("航行缓存条目超限"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl ViewCache {
    pub(crate) fn query(
        &mut self,
        key: ViewKey,
        build: impl FnOnce() -> Result<Value, AppError>,
    ) -> Result<Value, AppError> {
        if let Some(entry) = &self.entries[key.slot]
            && entry.key.matches(&key)
        {
            self.hits += 1;
            return serde_json::from_slice(&entry.json).map_err(|e| AppError::Data(e.to_string()));
        }
        self.misses += 1;
        let value = build()?;
        let mut json = Bounded(Vec::new());
        // 浮点解析的特性组合可能影响最后一位；不能让缓存改变既有 JSON 数值。
        if serde_json::to_writer(&mut json, &value).is_ok()
            && serde_json::from_slice::<Value>(&json.0).is_ok_and(|decoded| decoded == value)
        {
            let slot = key.slot;
            self.entries[slot] = Some(Entry { key, json: json.0.into_boxed_slice() });
        }
        Ok(value)
    }

    pub(crate) fn clear(&mut self) {
        self.entries = [None, None, None];
    }

    pub(crate) fn stats(&self) -> CacheStats {
        CacheStats {
            hits: self.hits,
            misses: self.misses,
            entries: self.entries.iter().flatten().count(),
            bytes: self.entries.iter().flatten().map(|e| e.json.len()).sum(),
        }
    }
}

/// 两个外壳的 navigation 名称继续转到同一个有界缓存入口。
pub fn navigation(st: &AppState, fleet: u32) -> Result<Value, AppError> {
    let guard = st.game()?;
    let Some(game) = guard.as_ref() else { return Ok(Value::Null) };
    if !game.session.world.defs.manual_navigation {
        return Ok(Value::Null);
    }
    let locale = st.locale();
    let key = ViewKey::new(st, game, locale, Query::Navigation { fleet })?;
    st.cached_view(key, || {
        crate::navigation_view::navigation(
            st.resources().locales.ctx(locale),
            &game.session.world,
            FleetId(fleet),
            crate::clock::since_day_start(game.minute) as u16,
            st.resources().map_resource().cell_km,
        )
        .map_err(AppError::Command)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppPaths, handlers};
    use manifest_ai::{AiMode, MemoryKeyStore};
    use manifest_core::navigation::Sail;
    use manifest_core::world::{FleetLocation, Voyage};
    use manifest_core::{Command, Fx, LocId, OwnerId};
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn app(testbed: bool) -> (AppState, FleetId) {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "manifest-p03-cache-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let st = AppState::from_data_dir(
            &manifest_data::find_data_dir().unwrap(),
            Arc::new(MemoryKeyStore::default()),
            AppPaths::in_dir(&dir),
        )
        .unwrap();
        let st = if testbed {
            st
        } else {
            let mut defs = (**st.defs()).clone();
            defs.manual_navigation = true;
            AppState::new(
                Arc::new(defs),
                st.content().clone(),
                st.locales().clone(),
                Arc::new(MemoryKeyStore::default()),
                AppPaths::in_dir(&dir),
            )
            .unwrap()
        };
        let mut settings = st.settings();
        settings.ai.mode = AiMode::Off;
        settings.autosave_days = 0;
        handlers::save_settings(&st, settings).unwrap();
        if testbed {
            handlers::new_world_game(
                &st,
                serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap(),
            )
            .unwrap();
        } else {
            handlers::new_game(&st, "newcomer", Some(42)).unwrap();
        }
        let id = {
            let mut guard = st.game().unwrap();
            let g = guard.as_mut().unwrap();
            Arc::make_mut(&mut g.session.world.defs).manual_navigation = true;
            g.session.world.fleets_of(OwnerId::Player).next().unwrap().id
        };
        handlers::submit(&st, Command::Depart { owner: OwnerId::Player, fleet: id, minute: 120, heading: 90 }).unwrap();
        (st, id)
    }

    fn preview(st: &AppState, id: FleetId) -> Value {
        let minute = crate::clock::since_day_start(st.game().unwrap().as_ref().unwrap().minute) as u16;
        let steers = vec![Steering { minute, heading: Some(90), sail: Some(Sail::Furled) }];
        let actual = handlers::preview_course(st, id.0, steers.clone(), minute).unwrap();
        let guard = st.game().unwrap();
        let g = guard.as_ref().unwrap();
        let before = g.session.to_save();
        let expected = crate::navigation_view::preview_course(st.ctx(), &g.view_world(), id, &steers, minute).unwrap();
        assert_eq!(actual, expected, "缓存与共用积分器必须逐点、逐暂停分钟相同");
        assert_eq!(g.session.to_save(), before);
        actual
    }

    #[test]
    fn identical_queries_hit_and_every_navigation_input_invalidates() {
        let (st, id) = app(false);
        let first = preview(&st, id);
        assert_eq!(first, preview(&st, id));
        assert_eq!(st.view_cache_stats().unwrap().hits, 1);
        for change in 0..10 {
            let before = st.view_cache_stats().unwrap();
            {
                let mut guard = st.game().unwrap();
                let g = guard.as_mut().unwrap();
                let now = crate::clock::since_day_start(g.minute) as u16;
                let w = &mut g.session.world;
                match change {
                    0 => w.state.seed += 1,
                    1 => w.state.day += 1,
                    2 => g.minute += 1,
                    3 => w.fleet_mut(id).unwrap().ships[0].speed_bonus = Fx::from_int(3),
                    4 => w.fleet_mut(id).unwrap().morale -= 1,
                    5 => w.state.explore.cells[0] ^= 1,
                    6 => {
                        if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location
                        {
                            manual.autopilot = Some(LocId(0));
                        }
                    }
                    7 => w.state.navigation.pending.entry(id).or_default().steers.push(Steering {
                        minute: now + 30,
                        heading: Some(270),
                        sail: Some(Sail::Half),
                    }),
                    8 => Arc::make_mut(&mut w.defs).navigation.sight_fame += 1,
                    _ => {
                        let other = w.state.fleets.values_mut().find(|f| f.id != id).unwrap();
                        other.food += 1;
                    }
                }
            }
            preview(&st, id);
            assert_eq!(st.view_cache_stats().unwrap().misses, before.misses + 1, "输入 {change} 必须失效");
        }
    }

    #[test]
    fn steering_order_language_and_invalid_queries_do_not_reuse_old_results() {
        let (st, id) = app(false);
        let a = Steering { minute: 120, heading: Some(90), sail: Some(Sail::Furled) };
        let b = Steering { minute: 120, heading: Some(180), sail: Some(Sail::Half) };
        for orders in [vec![a, b], vec![b, a]] {
            let actual = handlers::preview_course(&st, id.0, orders.clone(), 120).unwrap();
            let guard = st.game().unwrap();
            let g = guard.as_ref().unwrap();
            assert_eq!(
                actual,
                crate::navigation_view::preview_course(st.ctx(), &g.view_world(), id, &orders, 120).unwrap()
            );
        }
        assert_eq!(st.view_cache_stats().unwrap().misses, 2);
        preview(&st, id);
        let before = st.view_cache_stats().unwrap();
        let mut settings = st.settings();
        settings.language = Some(manifest_data::Locale::En);
        handlers::save_settings(&st, settings).unwrap();
        preview(&st, id);
        assert_eq!(st.view_cache_stats().unwrap().misses, before.misses + 1);
        let before = st.view_cache_stats().unwrap();
        for _ in 0..2 {
            let result = handlers::preview_course(
                &st,
                id.0,
                vec![Steering { minute: 120, heading: Some(360), sail: None }],
                120,
            );
            assert!(matches!(result, Err(AppError::Command(e)) if e.code() == "navigation.heading"));
        }
        assert_eq!(st.view_cache_stats().unwrap().misses, before.misses + 2, "错误不得成为缓存条目");
    }

    #[test]
    fn load_new_game_and_world_switch_clear_the_cache_even_at_the_same_minute() {
        let (st, id) = app(false);
        let original = preview(&st, id);
        handlers::save_game(&st, "cache").unwrap();
        handlers::load_game(&st, "cache").unwrap();
        assert_eq!(st.view_cache_stats().unwrap().entries, 0);
        assert_eq!(preview(&st, id), original);
        handlers::new_game(&st, "newcomer", Some(42)).unwrap();
        assert_eq!(st.view_cache_stats().unwrap().entries, 0);
        assert!(handlers::preview_course(&st, id.0, vec![], 120).is_err());
        handlers::load_game(&st, "cache").unwrap();
        assert_eq!(preview(&st, id), original);
        let (other, fleet) = app(true);
        preview(&other, fleet);
        assert_eq!(other.view_cache_stats().unwrap().entries, 1);
        handlers::new_game(&other, "newcomer", Some(42)).unwrap();
        assert_eq!(other.view_cache_stats().unwrap().entries, 0);
        assert_eq!(handlers::pending::navigation(&other, fleet.0).unwrap(), Value::Null);
        handlers::new_world_game(
            &other,
            serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap(),
        )
        .unwrap();
        assert_eq!(other.view_cache_stats().unwrap().entries, 0);
    }

    #[test]
    fn drag_requests_keep_constant_cache_bytes_and_navigation_uses_the_same_cache() {
        let (st, id) = app(false);
        for heading in (0..360).step_by(3) {
            handlers::preview_course(
                &st,
                id.0,
                vec![Steering { minute: 120, heading: Some(heading), sail: Some(Sail::Furled) }],
                120,
            )
            .unwrap();
            assert!(st.view_cache_stats().unwrap().bytes <= CACHE_BYTES);
            assert_eq!(st.view_cache_stats().unwrap().entries, 1);
        }
        let nav = handlers::pending::navigation(&st, id.0).unwrap();
        assert_eq!(handlers::pending::navigation(&st, id.0).unwrap(), nav);
        let guard = st.game().unwrap();
        let g = guard.as_ref().unwrap();
        assert_eq!(
            nav,
            crate::navigation_view::navigation(
                st.ctx(),
                &g.session.world,
                id,
                120,
                st.resources().map_resource().cell_km
            )
            .unwrap()
        );
        assert_eq!(st.view_cache_stats().unwrap().entries, 2);
        assert!(st.view_cache_stats().unwrap().bytes <= CACHE_BYTES);
    }

    #[test]
    fn a_port_closing_invalidates_known_destinations_without_advancing_time() {
        let (st, id) = app(false);
        let before = handlers::pending::navigation(&st, id.0).unwrap();
        let loc = before["known_dests"].as_array().unwrap().first().expect("夹具要有可见目的港")["loc"]
            .as_u64()
            .unwrap() as u16;
        let stats = st.view_cache_stats().unwrap();
        {
            let mut guard = st.game().unwrap();
            let world = &mut guard.as_mut().unwrap().session.world;
            world.state.history.ports.insert(
                LocId(loc),
                manifest_core::history::DynamicPort {
                    status: manifest_core::history::PortStatus::Destroyed,
                    ..Default::default()
                },
            );
        }
        let after = handlers::pending::navigation(&st, id.0).unwrap();
        assert_eq!(st.view_cache_stats().unwrap().misses, stats.misses + 1);
        assert!(after["known_dests"].as_array().unwrap().iter().all(|dest| dest["loc"] != loc));
        let guard = st.game().unwrap();
        let game = guard.as_ref().unwrap();
        assert_eq!(
            after,
            crate::navigation_view::navigation(
                st.ctx(),
                &game.session.world,
                id,
                120,
                st.resources().map_resource().cell_km
            )
            .unwrap()
        );
    }

    #[test]
    fn cache_round_trips_preserve_exact_json_numbers() {
        let (st, _) = app(false);
        let guard = st.game().unwrap();
        let game = guard.as_ref().unwrap();
        for index in 1..=256 {
            let key = || ViewKey::new(&st, game, st.locale(), Query::Navigation { fleet: index }).unwrap();
            let value = json!({"speed": f64::from(index) / 1.852, "current": f64::from(index) / 24.0, "zero": -0.0});
            assert_eq!(st.cached_view(key(), || Ok(value.clone())).unwrap(), value);
            assert_eq!(st.cached_view(key(), || Ok(value.clone())).unwrap(), value);
            assert!(st.view_cache_stats().unwrap().bytes <= CACHE_BYTES);
        }
    }

    #[test]
    fn oversized_cache_results_are_returned_without_being_retained() {
        let (st, id) = app(false);
        let guard = st.game().unwrap();
        let g = guard.as_ref().unwrap();
        let key = ViewKey::new(&st, g, st.locale(), Query::Navigation { fleet: id.0 }).unwrap();
        let large = json!("x".repeat(ENTRY_BYTES + 1));
        assert_eq!(st.cached_view(key, || Ok(large.clone())).unwrap(), large);
        assert_eq!(st.view_cache_stats().unwrap().bytes, 0);
    }
}

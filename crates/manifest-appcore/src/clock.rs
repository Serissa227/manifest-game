//! 时钟（EXPANSION.md §9.2）：一天 24 小时，精度 1 分钟（`minute` 0–1439）；内核的每日结算发生在清晨 6:00。
//!
//! 时钟只存在于应用层：不进入世界状态，不影响世界哈希与重放；随存档保存在 meta 文件里（与主角同处）。
//! 这里放常量、纯函数，以及后台线程把实时折算成游戏分钟用的 [`Pace`]。推进本身见 [`crate::handlers::advance_clock`]。

use serde::{Deserialize, Deserializer, Serialize};
use std::time::Duration;

/// 一天的分钟数。
pub const MINUTES_PER_DAY: u16 = 1440;
/// 每日结算发生的时刻（6:00）：时钟走到这里时推进一天，新的日期从 6:00 开始。
pub const DAY_START_MINUTE: u16 = 360;
/// 新游戏与没有时刻的旧存档的起始时刻（8:00）。
pub const DEFAULT_MINUTE: u16 = 480;
/// 1× 时一天的实时长度（毫秒）；n× 时为它的 1/n。
pub const BASE_DAY_MS: u64 = 4_000;
/// 后台线程每一小步的实时间隔。1× 时一步约 18 分钟，32× 时约 576 分钟（不到一天）。
pub const STEP: Duration = Duration::from_millis(50);
/// 暂停或没有游戏时，后台线程查看速度的间隔。
pub const IDLE: Duration = Duration::from_millis(100);
/// `clock` 事件的最短推送间隔（实时）。
pub const EMIT_INTERVAL: Duration = Duration::from_millis(100);
/// 单步折算的实时上限：系统休眠或线程被长时间挂起后，不一次补推很多天（32× 时最多约两天）。
pub const MAX_STEP: Duration = Duration::from_millis(250);

pub(crate) const UPBRINGING_WEEK_DAYS: u32 = 7;

/// 当前养成周在本月的首末日（含）。最后一周截止于月末。
pub(crate) fn upbringing_week(world: &manifest_core::World) -> Option<[u32; 2]> {
    if !world.defs.rules.upbringing.weekly_playback || !world.upbringing_active() || world.upbringing_skipping() {
        return None;
    }
    let calendar = &world.defs.calendar;
    let today = world.day();
    let day = calendar.date_of(today).day;
    // U05 按周排程：每月固定四周，第四周吃掉月末零头（22 日到月末）；与内核的周历一致。
    if world.upbringing_weekly() {
        use manifest_core::upbringing::weekly;
        return Some(weekly::week_bounds(calendar.month_days(today), weekly::week_of(day)));
    }
    let start = (day - 1) / UPBRINGING_WEEK_DAYS * UPBRINGING_WEEK_DAYS + 1;
    Some([start, (start + UPBRINGING_WEEK_DAYS - 1).min(calendar.month_days(today))])
}

/// 播放时在哪一天之后停下（绝对日序）：按 [`UpbringingPause`] 取本周末或本月末；“有事才停”时只在疲劳到了
/// 效率打折线（≥ 80）才在周末停一下。没有按周播放、不在养成期时为 None。
pub(crate) fn upbringing_stop_after(
    world: &manifest_core::World,
    pause: crate::settings::UpbringingPause,
) -> Option<u32> {
    use crate::settings::UpbringingPause;
    let [_, end] = upbringing_week(world)?;
    let today = world.day();
    let day = world.defs.calendar.date_of(today).day;
    let week_end = today.saturating_add(end.saturating_sub(day));
    let month_end = today.saturating_add(world.defs.calendar.month_days(today).saturating_sub(day));
    let tired = world.state.upbringing.as_ref().is_some_and(|s| s.fatigue >= UPBRINGING_TIRED);
    match pause {
        UpbringingPause::Week => Some(week_end),
        _ if tired => Some(week_end),
        UpbringingPause::Month => Some(month_end),
        UpbringingPause::Event => None,
    }
}

/// 疲劳到这个数，成长效率开始打折（内核的 80 台阶）：“每月停 / 有事才停”时也在周末停一下提醒。
pub(crate) const UPBRINGING_TIRED: i64 = 80;

/// 时钟推送（`clock` 事件的负载，与前端 `ipc/types.ts` 的 `ClockView` 一致）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClockView {
    pub day: u32,
    /// 当天时刻，分钟 0–1439
    pub minute: u16,
    #[serde(default)]
    pub day_ms: u32,
    #[serde(default)]
    pub sea_clock: bool,
}

/// 把任意分钟数规范到 0–1439。
pub fn norm(minute: u32) -> u16 {
    // 余数小于 1440，必然放得进 u16
    (minute % u32::from(MINUTES_PER_DAY)) as u16
}

/// 从当前时刻走到下一个 6:00 需要的分钟数（1–1440；正好 6:00 时为一整天）。
pub fn minutes_to_day_start(minute: u16) -> u32 {
    let (m, start, day) = (u32::from(norm(u32::from(minute))), u32::from(DAY_START_MINUTE), u32::from(MINUTES_PER_DAY));
    if m < start { start - m } else { day - m + start }
}

/// 从当天 6:00 起已经走过的分钟数（0–1439）：同一个游戏日内比较先后用（游戏日从 6:00 到次日 5:59）。
pub fn since_day_start(minute: u16) -> u32 {
    let day = u32::from(MINUTES_PER_DAY);
    (u32::from(norm(u32::from(minute))) + day - u32::from(DAY_START_MINUTE)) % day
}

/// 时刻戳：先比日期、再比当天走过的分钟（存档写盘时判断快照新旧）。
pub fn stamp(day: u32, minute: u16) -> u64 {
    u64::from(day) * u64::from(MINUTES_PER_DAY) + u64::from(since_day_start(minute))
}

/// 存档 meta 中的时刻：缺失由 `#[serde(default)]` 取 8:00；存在但不是 0–1439 的整数（手工改坏等）时也取 8:00，
/// 不让一个坏字段连累同一文件里的主角。
pub fn lenient_minute<'de, D: Deserializer<'de>>(d: D) -> Result<u16, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(v.as_u64()
        .filter(|m| *m < u64::from(MINUTES_PER_DAY))
        .and_then(|m| u16::try_from(m).ok())
        .unwrap_or(DEFAULT_MINUTE))
}

/// `#[serde(default = ...)]` 用：没有时刻的旧存档从 8:00 开始。
pub fn default_minute() -> u16 {
    DEFAULT_MINUTE
}

/// 实时 → 游戏分钟的折算：整数运算，不足 1 分钟的部分留到下一步，长期速度准确（1× 每天 4 秒）。
#[derive(Clone, Debug, Default)]
pub struct Pace {
    /// 不足一分钟的余数（单位见 [`Pace::UNIT`]）
    carry: u64,
}

impl Pace {
    /// 1× 时一天的实时微秒数。折算量 = 实时微秒 × 速度 × 1440，每满一个 UNIT 即一游戏分钟。
    const UNIT: u64 = BASE_DAY_MS * 1_000;

    /// 按速度把一段实时折算成游戏分钟；单步最多按 [`MAX_STEP`] 计。
    pub fn minutes(&mut self, speed: u8, elapsed: Duration) -> u32 {
        let micros = u64::try_from(elapsed.min(MAX_STEP).as_micros()).unwrap_or(0);
        let units = self.carry + micros * u64::from(speed) * u64::from(MINUTES_PER_DAY);
        self.carry = units % Self::UNIT;
        u32::try_from(units / Self::UNIT).unwrap_or(u32::MAX)
    }

    /// 暂停后清掉余数（恢复时从整分钟开始）。
    pub fn reset(&mut self) {
        self.carry = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_start_distance_and_elapsed() {
        assert_eq!(minutes_to_day_start(0), 360);
        assert_eq!(minutes_to_day_start(359), 1);
        assert_eq!(minutes_to_day_start(360), 1440, "正好 6:00 时，下一次结算在一整天之后");
        assert_eq!(minutes_to_day_start(480), 1320);
        assert_eq!(minutes_to_day_start(1439), 361);
        assert_eq!(since_day_start(360), 0);
        assert_eq!(since_day_start(359), 1439);
        assert_eq!(since_day_start(0), 1080);
        assert_eq!(norm(1440 + 5), 5);
        // 同一个游戏日里，次日凌晨 2:00 晚于当天 23:00
        assert!(stamp(3, 120) > stamp(3, 1380));
        assert!(stamp(4, 360) > stamp(3, 359));
    }

    #[test]
    fn pace_matches_the_speed_table() {
        // 1× 每天 4 秒 … 32× 每天 0.125 秒
        for (speed, ms_per_day) in [(1u8, 4_000u64), (2, 2_000), (4, 1_000), (8, 500), (16, 250), (32, 125)] {
            let mut p = Pace::default();
            let mut total = 0;
            let mut ms = 0;
            // 25 ms 一步：各档三天的实时都是它的整数倍
            while ms < ms_per_day * 3 {
                total += p.minutes(speed, Duration::from_millis(25));
                ms += 25;
            }
            assert_eq!(total, 3 * 1440, "{speed}× 时三天的实时应走满 3 × 1440 分钟");
        }
        // 余数累积：1× 时 8 ms 一步不到 3 分钟，余数也不会丢
        let mut p = Pace::default();
        let total: u32 = (0..4_000 / 8).map(|_| p.minutes(1, Duration::from_millis(8))).sum();
        assert_eq!(total, 1440);
        // 单步上限：挂起 10 秒后最多按 250 ms 计
        let mut p = Pace::default();
        assert_eq!(p.minutes(32, Duration::from_secs(10)), 2880);
        p.reset();
        assert_eq!(p.minutes(1, Duration::from_millis(1)), 0);
    }

    #[test]
    fn short_clock_steps_pause_at_the_same_land_minute_and_resume_past_it() {
        use manifest_core::{Cell, Command, Fx, OwnerId, ScenarioId};
        use std::sync::Arc;
        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        defs.manual_navigation = true;
        defs.map.terrain.fill(manifest_core::nav::Terrain::Deep);
        defs.map.region.fill(u16::MAX);
        defs.locations[0].cell = Cell::new(2, 15);
        defs.locations[1].cell = Cell::new(35, 15);
        defs.rules.explore.sight = 0;
        defs.rules.pirates.spawn_scale = Fx::ZERO;
        defs.ships[0].speed = Fx::from_int(120);
        let land = defs.map.idx(Cell::new(5, 15));
        defs.map.terrain[land] = manifest_core::nav::Terrain::Land;
        defs.nav = Arc::new(manifest_core::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
        let defs = Arc::new(defs);
        for chunk in [1, 18, 60, 300, 1440] {
            let mut session = manifest_sim::GameSession::new(defs.clone(), ScenarioId(0), 42).unwrap();
            let fleet = session.world.flagship(OwnerId::Player).unwrap();
            session.submit_at(0, Command::Depart { owner: OwnerId::Player, fleet, minute: 0, heading: 90 }).unwrap();
            let full = session.world.preview_course(fleet, &[], 0).unwrap();
            assert_eq!(full.stops.len(), 1);
            let at = full.stops[0].minute;
            assert_eq!(full.stops[0].kind, manifest_core::navigation::StopKind::Land);
            let mut game = crate::state::Game {
                session,
                ai: None,
                speed: 1,
                run_speed: 1,
                resume_speed: None,
                last_autosave: 0,
                captain: None,
                minute: DAY_START_MINUTE,
                last_navigation_stop: None,
                book: Default::default(),
                notes: Default::default(),
                clock_speeds: Default::default(),
                upbringing_unlock_notices: Default::default(),
            };
            let settings = crate::settings::AppSettings { navigation_pause: true, ..Default::default() };
            let mut start = 0;
            loop {
                let end = (start + chunk).min(MINUTES_PER_DAY);
                let stop = game.next_navigation_pause(end, &settings);
                if end >= at {
                    let stop = stop.expect("跨过撞岸分钟必须暂停");
                    assert_eq!(stop.minute, at, "时钟步长 {chunk}");
                    assert_eq!(stop.fleet, fleet.0);
                    game.last_navigation_stop = Some(stop);
                    game.minute = norm(u32::from(DAY_START_MINUTE + at));
                    assert!(game.next_navigation_pause((at + 1).min(MINUTES_PER_DAY), &settings).is_none());
                    break;
                }
                assert!(stop.is_none());
                start = end;
                game.minute = norm(u32::from(DAY_START_MINUTE + start));
            }
        }
    }

    #[test]
    fn arrival_sight_pause_truth_table() {
        use manifest_core::navigation::StopKind::{Land, Port, Sight};
        for old_kind in [Port, Land] {
            for kind in [Sight, Land] {
                for same_day in [false, true] {
                    for minute in [4, 5, 6] {
                        for fleet in [1, 2] {
                            for loc in [None, Some(7), Some(8)] {
                                let old = NavigationPause {
                                    day: 2,
                                    minute: 5,
                                    fleet: 1,
                                    kind: old_kind,
                                    loc: Some(7),
                                    slow: false,
                                };
                                let next = NavigationPause {
                                    day: if same_day { 2 } else { 3 },
                                    minute,
                                    fleet,
                                    kind,
                                    loc,
                                    slow: false,
                                };
                                let ordered = (minute, kind.order(), fleet, loc) <= (5, old_kind.order(), 1, Some(7));
                                let pair =
                                    old_kind == Port && kind == Sight && minute == 5 && fleet == 1 && loc == Some(7);
                                let expected = same_day && (ordered || pair);
                                let actual = old.covers(&next);
                                println!(
                                    "old={old_kind:?} next={kind:?} same_day={same_day} minute={minute} fleet={fleet} loc={loc:?} ordered={ordered} pair={pair} covered={actual}"
                                );
                                assert_eq!(actual, expected);
                            }
                        }
                    }
                }
            }
        }
        use manifest_core::{
            LocId, OwnerId, ScenarioId,
            navigation::ManualVoyage,
            world::{FleetLocation, Voyage},
        };
        let world = manifest_core::World::new(manifest_core::testkit::tiny_defs(), ScenarioId(0), 42).unwrap();
        let fleet = world.flagship(OwnerId::Player).unwrap();
        for manual in [false, true] {
            for at_sea in [false, true] {
                for arrived in [false, true] {
                    let mut world = world.clone();
                    std::sync::Arc::make_mut(&mut world.defs).manual_navigation = manual;
                    if at_sea {
                        world.state.fleets.get_mut(&fleet).unwrap().location = FleetLocation::AtSea(Voyage::Manual {
                            manual: ManualVoyage::new(world.defs.locations[0].cell, 90),
                        });
                    }
                    if arrived {
                        world.state.navigation.arrived.insert(fleet, LocId(0));
                    }
                    let actual = sea_clock_world(&world);
                    println!("manual={manual} at_sea={at_sea} arrived_history={arrived} sea_clock={actual}");
                    assert_eq!(actual, manual && at_sea);
                }
            }
        }
    }

    #[test]
    fn lenient_minute_falls_back_to_eight() {
        #[derive(Deserialize)]
        struct M {
            #[serde(default = "default_minute", deserialize_with = "lenient_minute")]
            minute: u16,
        }
        let parse = |s: &str| serde_json::from_str::<M>(s).map(|m| m.minute).ok();
        assert_eq!(parse("{}"), Some(480));
        assert_eq!(parse(r#"{"minute": 1000}"#), Some(1000));
        assert_eq!(parse(r#"{"minute": 1440}"#), Some(480));
        assert_eq!(parse(r#"{"minute": -5}"#), Some(480));
        assert_eq!(parse(r#"{"minute": "早上"}"#), Some(480));
        assert_eq!(parse(r#"{"minute": null}"#), Some(480));
    }
}

/// 暂停点也作为同一游戏日内的确认水位；同分钟按种类与舰队逐个确认。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavigationPause {
    pub day: u32,
    pub minute: u16,
    pub fleet: u32,
    pub kind: manifest_core::navigation::StopKind,
    pub loc: Option<u16>,
    /// H03：只降到 1×、不暂停（普通商船进入视野）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub slow: bool,
}
impl NavigationPause {
    fn sort_key(&self) -> (u16, u8, u32, Option<u16>) {
        (self.minute, self.kind.order(), self.fleet, self.loc)
    }

    /// 抵港同时看见的就是该港；到港已确认后，不再为同一地点在原分钟停一次。
    fn covers(&self, next: &Self) -> bool {
        use manifest_core::navigation::StopKind;
        self.day == next.day
            && (next.sort_key() <= self.sort_key()
                || (self.kind == StopKind::Port
                    && next.kind == StopKind::Sight
                    && self.fleet == next.fleet
                    && self.minute == next.minute
                    && self.loc == next.loc))
    }
}

/// H03：这个世界有没有“降到 1×”（天气团或按分钟追击开着；经典世界没有，普通商船进入视野照旧不停）。
fn navigation_slow_world(world: &manifest_core::World) -> bool {
    world.defs.rules.weather_cells.enabled || world.defs.rules.pursuit.enabled
}

/// 坏掉的可选暂停信息不能丢掉同一 meta 文件中仍然有效的主角与时刻。
pub fn lenient_navigation_pause<'de, D: Deserializer<'de>>(d: D) -> Result<Option<NavigationPause>, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value::<NavigationPause>(value).ok().filter(|s| s.minute <= MINUTES_PER_DAY))
}

impl crate::state::Game {
    /// 时钟和查询只产生投影；真正命令由 submit_at 落实并进入重放日志。
    pub fn view_world(&self) -> std::borrow::Cow<'_, manifest_core::World> {
        let world = &self.session.world;
        if !world.defs.manual_navigation {
            return std::borrow::Cow::Borrowed(world);
        }
        let minute = (since_day_start(self.minute) as u16).max(world.state.navigation.settled);
        // 没有手动航行中的玩家舰队，且水位、时刻都不变时，投影与原世界完全相同。
        // 其余情形仍调用完整投影，保留同一分钟的航迹、抵港和可见性处理。
        if minute == world.state.navigation.settled
            && minute <= world.state.navigation.minute
            && !world.fleets_of(manifest_core::OwnerId::Player).any(|fleet| {
                matches!(
                    fleet.location,
                    manifest_core::world::FleetLocation::AtSea(manifest_core::world::Voyage::Manual { .. })
                )
            })
        {
            return std::borrow::Cow::Borrowed(world);
        }
        world.navigation_projection(minute).map(std::borrow::Cow::Owned).unwrap_or(std::borrow::Cow::Borrowed(world))
    }

    pub(crate) fn next_navigation_pause(
        &self,
        end: u16,
        settings: &crate::settings::AppSettings,
    ) -> Option<NavigationPause> {
        use crate::settings::ArrivalPause;
        use manifest_core::navigation::StopKind;
        use manifest_core::world::{FleetLocation, Voyage};
        let world = &self.session.world;
        // 在港暂停（handlers/harbor.rs）：旗舰队靠港的那一分钟总要停下，不论“航行中的分钟暂停”“抵达时自动暂停”两项设置
        let harbor = crate::handlers::harbor_rule(world);
        let supplies = world.defs.rules.autopilot.supplies_stop_days > 0;
        if !world.defs.manual_navigation || (!settings.navigation_pause && !harbor && !supplies) {
            return None;
        }
        let start = since_day_start(self.minute) as u16;
        let flagship = world.flagship(manifest_core::OwnerId::Player);
        let mut stops = Vec::new();
        for fleet in world.fleets_of(manifest_core::OwnerId::Player) {
            let flag = Some(fleet.id) == flagship;
            // 关掉分钟暂停仍看旗舰抵港，以及规则要求的粮水提醒。
            let watched = settings.navigation_pause || (harbor && flag) || supplies;
            if !watched || !matches!(fleet.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
                continue;
            }
            let Ok(course) = world.preview_course_until(fleet.id, &[], start, end) else { continue };
            for stop in course.stops {
                let forced = stop.kind == StopKind::SuppliesLow
                    || (harbor
                        && flag
                        && stop.kind == StopKind::Port
                        && stop.loc.is_some_and(|loc| world.defs.loc(loc).is_port()));
                // 普通商船进入视野不停；
                // 海盗进入视野、发现新的地点、靠港、触礁与风暴照旧停。
                let merchant_only = stop.kind == StopKind::Sight
                    && stop.loc.is_none()
                    && !course.contacts.iter().any(|c| c.minute == stop.minute && c.pirate);
                // H03：远处的天气团、普通商船进入视野只“降到 1×”（可关），不停
                let slow = merchant_only || matches!(stop.kind, StopKind::StormAhead | StopKind::FogAhead);
                let pause = NavigationPause {
                    day: world.day(),
                    minute: stop.minute,
                    fleet: fleet.id.0,
                    kind: stop.kind,
                    loc: stop.loc.map(|id| id.0),
                    slow: merchant_only,
                };
                if (slow
                    && (!settings.navigation_slow
                        || self.speed <= if self.sea_clock() { crate::settings::NORMAL_SPEED } else { 1 }
                        || !navigation_slow_world(world)))
                    || (merchant_only && !navigation_slow_world(world))
                    || (!settings.navigation_pause && !forced)
                    || stop.minute < start
                    || stop.minute > end
                    || self.last_navigation_stop.as_ref().is_some_and(|old| old.covers(&pause))
                    || (stop.kind == StopKind::Port
                        && !forced
                        && (settings.arrival_pause == ArrivalPause::Off
                            || (settings.arrival_pause == ArrivalPause::Flagship && !flag)))
                {
                    continue;
                }
                stops.push(pause);
            }
        }
        stops.into_iter().min_by_key(NavigationPause::sort_key)
    }

    /// H03：这一停是“降到 1×”而不是暂停（远处的天气团、普通商船）。
    pub(crate) fn navigation_slows(stop: &NavigationPause) -> bool {
        use manifest_core::navigation::StopKind;
        matches!(stop.kind, StopKind::StormAhead | StopKind::FogAhead) || (stop.kind == StopKind::Sight && stop.slow)
    }

    pub(crate) fn navigation_pause_view(
        &self,
        ctx: crate::views::Ctx<'_>,
        world: &manifest_core::World,
    ) -> Option<serde_json::Value> {
        let pause = self.last_navigation_stop.as_ref()?;
        let at = since_day_start(self.minute) as u16;
        if self.speed != 0
            || !((pause.day == world.day() && pause.minute == at)
                || (pause.minute == MINUTES_PER_DAY && pause.day.checked_add(1) == Some(world.day()) && at == 0))
        {
            return None;
        }
        let mut value = crate::navigation_view::stop_view(
            ctx,
            world,
            &manifest_core::navigation::CourseStop {
                minute: pause.minute,
                kind: pause.kind,
                loc: pause.loc.map(manifest_core::LocId),
            },
        );
        value["fleet"] = serde_json::json!(pause.fleet);
        value["day"] = serde_json::json!(pause.day);
        Some(value)
    }
}

#[cfg(test)]
#[path = "clock_projection_tests.rs"]
mod projection_tests;

/// H10b：实际一天的实时长度；0 表示暂停。
pub fn day_ms(speed: u8, sea: bool) -> u64 {
    if speed == 0 {
        return 0;
    }
    if sea {
        let tier = crate::settings::nearest_sea_tier(speed);
        crate::settings::SEA_TIERS.iter().position(|s| *s == tier).map_or(3_000, |i| crate::settings::SEA_DAY_MS[i])
    } else {
        BASE_DAY_MS / u64::from(speed.min(8))
    }
}

impl Pace {
    pub fn minutes_ms(&mut self, day_ms: u64, elapsed: Duration) -> u32 {
        if day_ms == 0 {
            self.reset();
            return 0;
        }
        let unit = day_ms.saturating_mul(1_000);
        let micros = u64::try_from(elapsed.min(MAX_STEP).as_micros()).unwrap_or(0);
        let units = self.carry + micros * u64::from(MINUTES_PER_DAY);
        self.carry = units % unit;
        u32::try_from(units / unit).unwrap_or(u32::MAX)
    }
}

/// 仅在应用内记忆两套档位；换局时由默认设置重新初始化，不进世界存档。
#[derive(Clone, Debug, Default)]
pub struct ClockSpeeds {
    sea: u8,
    port: u8,
    context: Option<bool>,
}

pub fn sea_clock_world(world: &manifest_core::World) -> bool {
    use manifest_core::{
        OwnerId,
        world::{FleetLocation, Voyage},
    };
    let Some(id) = world.flagship(OwnerId::Player) else { return false };
    world.defs.manual_navigation
        && !world.upbringing_active()
        && world.fleet(id).is_ok_and(|f| matches!(f.location, FleetLocation::AtSea(Voyage::Manual { .. })))
        && !world.state.shore.camps.contains_key(&id)
        && !world.state.navigation.landings.contains_key(&id)
}

impl crate::state::Game {
    pub fn sea_clock(&self) -> bool {
        let w = &self.session.world;
        if !sea_clock_world(w) {
            return false;
        }
        let id = w.flagship(manifest_core::OwnerId::Player);
        let now = since_day_start(self.minute);
        !self.last_navigation_stop.as_ref().is_some_and(|s| {
            s.kind == manifest_core::navigation::StopKind::Port
                && Some(manifest_core::FleetId(s.fleet)) == id
                && s.day == w.day()
                && u32::from(s.minute) <= now
                && id
                    .and_then(|id| w.state.navigation.pending.get(&id))
                    .and_then(|p| p.depart)
                    .is_none_or(|d| d < s.minute)
        })
    }

    pub(crate) fn sync_clock_speed(&mut self) {
        let sea = self.sea_clock();
        match self.clock_speeds.context {
            None => {
                self.clock_speeds.sea = crate::settings::nearest_sea_tier(self.run_speed);
                self.clock_speeds.port = self.run_speed;
            }
            Some(old) if old != sea => {
                if old {
                    self.clock_speeds.sea = crate::settings::nearest_sea_tier(self.run_speed);
                } else {
                    self.clock_speeds.port = self.run_speed;
                }
                self.run_speed = if sea { self.clock_speeds.sea } else { self.clock_speeds.port };
                if self.speed != 0 {
                    self.speed = self.run_speed;
                }
                if self.resume_speed.is_some() {
                    self.resume_speed = Some(self.run_speed);
                }
            }
            _ => {}
        }
        self.clock_speeds.context = Some(sea);
    }
}

/// 结算持有游戏锁时独立推送最后一次已确认时刻；停止并回收后才允许推新日期。
pub(crate) struct SettlementPulse {
    stop: std::sync::mpsc::Sender<()>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl SettlementPulse {
    pub(crate) fn start(st: crate::AppState, clock: ClockView, generation: u64) -> Self {
        let (stop, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            while matches!(rx.recv_timeout(EMIT_INTERVAL), Err(std::sync::mpsc::RecvTimeoutError::Timeout)) {
                if st.generation() != generation {
                    break;
                }
                st.emit("clock", serde_json::to_value(clock).unwrap_or_default());
            }
        });
        Self { stop, worker: Some(worker) }
    }
}

impl Drop for SettlementPulse {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

//! 在港暂停：在港时间不走，住旅店才过天，出海以后时间才流动。只在手动航行的世界、养成期之外：
//!
//! - 旗舰队（`world.flagship(Player)`）停在港口（港口类地点；殖民点锚地不算，那里没有旅店）时时钟不走：抵港那一分钟自动暂停
//!   （不论“抵达时自动暂停”“航行中的分钟暂停”两项设置，见 [`Game::next_navigation_pause`]），停泊期间按开始也不走
//!   （记下这一档留到出港，概览的 `port_hold` 说明“在港中”，不报错）；
//! - 旅店休息走现有的按天推进（[`super::step`]），不看倍速；
//! - 旗舰队出港（出港、自动导航等命令让它离开港口）后按玩家最近一次选的倍速（[`Game::run_speed`]）自动继续。
//!
//! 只看旗舰队：别的舰队在海上、旗舰在港时同样停着。

use super::awaiting_player;
use crate::clock;
use crate::state::Game;
use crate::views::{self, PLAYER};
use manifest_core::ids::LocId;
use manifest_core::navigation::StopKind;
use manifest_core::world::{FleetLocation, Voyage};

/// 这个世界、这个时候有没有“在港暂停”。
pub(crate) fn harbor_rule(world: &manifest_core::World) -> bool {
    world.defs.manual_navigation && !world.upbringing_active()
}

/// 旗舰队按真实状态停在港口时，所在的港口（只看舰队的位置，不做投影：后台时钟每一小步都查）。
pub(super) fn flagship_docked(world: &manifest_core::World) -> Option<LocId> {
    if !harbor_rule(world) {
        return None;
    }
    let loc = world.fleet(world.flagship(PLAYER)?).ok()?.docked_at()?;
    world.defs.loc(loc).is_port().then_some(loc)
}

impl Game {
    /// 旗舰队在港（包括已经驶进锚地、要等下一条命令或日结才落实靠港的：按当前时刻投影的世界看）时，所在的港口。
    /// 真实状态在海上时只预测旗舰队到当前分钟，不复制整个经济世界。
    pub(crate) fn port_hold(&self) -> Option<LocId> {
        let world = &self.session.world;
        if !harbor_rule(world) {
            return None;
        }
        if let Some(loc) = flagship_docked(world) {
            return Some(loc);
        }
        let id = world.flagship(PLAYER)?;
        if !matches!(world.fleet(id).ok()?.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
            return None;
        }
        let minute = (clock::since_day_start(self.minute) as u16).max(world.state.navigation.settled);
        world.preview_course_until(id, &[], minute, minute).ok()?.arrival.filter(|loc| world.defs.loc(*loc).is_port())
    }
}

/// 提交命令之前旗舰队是否在港（据此认出“这条命令让它出了港”）。先用便宜的判断筛掉在海上的大多数情况
/// （海上操舵很频繁）：真实状态停在港口，或今天最近一次航行暂停正是旗舰队抵港、那一分钟已经过了、之后没再出港，
/// 再按投影确认。
pub(super) fn held_before_command(g: &Game) -> bool {
    let world = &g.session.world;
    if !harbor_rule(world) {
        return false;
    }
    if flagship_docked(world).is_some() {
        return true;
    }
    let Some(flagship) = world.flagship(PLAYER) else { return false };
    let now = clock::since_day_start(g.minute);
    // 当天航行从哪一分钟起算（出港或上一条命令落实到的分钟）：抵港之后又出了港的，这里不早于抵港的那一分钟
    let from = world.state.navigation.pending.get(&flagship).and_then(|p| p.depart);
    g.last_navigation_stop.as_ref().is_some_and(|s| {
        s.kind == StopKind::Port
            && s.fleet == flagship.0
            && s.day == world.day()
            && u32::from(s.minute) <= now
            && from.is_none_or(|d| d < s.minute)
    }) && g.port_hold().is_some()
}

/// 运行中的时钟遇到旗舰队在港：停下（按真实状态；抵港那一分钟由航行暂停停下）。返回是否停下了。
pub(super) fn hold_in_port(g: &mut Game) -> bool {
    if g.speed == 0 || flagship_docked(&g.session.world).is_none() {
        return false;
    }
    g.speed = 0;
    g.resume_speed = None;
    true
}

/// 旗舰队出港：按玩家最近一次选的倍速继续；还有事在等玩家回应时，回应完再继续（见 [`super::auto_resume`]）。
pub(super) fn resume_after_departure(g: &mut Game) {
    let world = &g.session.world;
    if awaiting_player(world, g.minute) || world.creature_pending().is_some() {
        g.resume_speed = Some(g.run_speed);
    } else {
        g.speed = g.run_speed;
        g.resume_speed = None;
    }
}

/// 概览的“在港中”（只在手动航行的世界、养成期之外，旗舰队停在港口时有）。`world` 是按当前时刻投影的世界。
pub(super) fn port_hold_view(world: &manifest_core::World, g: &Game) -> Option<views::PortHoldView> {
    let loc = flagship_docked(world)?;
    let calendar = &world.defs.calendar;
    let day = world.day();
    // 住到下月初：今天住下，过这么多天正好是下个月的 1 日
    let month_days = (calendar.month_days(day) + 1).saturating_sub(calendar.date_of(day).day).max(1);
    Some(views::PortHoldView { loc: loc.0, resume: g.run_speed, month_days })
}

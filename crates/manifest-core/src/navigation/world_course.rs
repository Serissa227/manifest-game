//! 世界查询与日结的积分入口，天气只读当日确定性表。
use super::ManualVoyage;
use super::course::{Course, CourseInput, MINUTES_PER_DAY, Steering};
use crate::weather::DayTable;
use crate::world::{Fleet, FleetLocation, Voyage, World};
use crate::{CommandError, FleetId, Reason};

impl World {
    pub(crate) fn integrate_manual(
        &self,
        fleet: &Fleet,
        start: &ManualVoyage,
        from: u16,
        until: u16,
        steers: &[Steering],
    ) -> Course {
        if self.creature_delayed(fleet.id) {
            let from = from.min(MINUTES_PER_DAY);
            let until = until.min(MINUTES_PER_DAY).max(from);
            let mut voyage = start.clone();
            // 延误冻结位置，但已经接受的操舵与领航计划仍按同分钟次序生效。
            let pilots = self.state.navigation.pending.get(&fleet.id).map(|p| p.autopilots.as_slice()).unwrap_or(&[]);
            let mut orders: Vec<_> =
                steers.iter().enumerate().map(|(i, s)| (s.minute, 2 * i + 1, Some(s), None)).collect();
            orders.extend(pilots.iter().map(|p| (p.minute, 2 * p.after_steers, None, Some(p))));
            orders.sort_by_key(|(minute, seq, _, _)| (*minute, *seq));
            for (_, _, steer, pilot) in orders.into_iter().filter(|(at, _, _, _)| *at >= from && *at <= until) {
                if let Some(s) = steer {
                    if s.sail.is_none()
                        && let Some(motion) = voyage
                            .pilot
                            .as_ref()
                            .and_then(|p| p.motion())
                            .filter(|m| m.mode == super::autopilot::PilotMode::Creep)
                    {
                        voyage.sail = motion.sail;
                    }
                    if let Some(h) = s.heading {
                        voyage.heading = h;
                    }
                    if let Some(sail) = s.sail {
                        voyage.sail = sail;
                    }
                    voyage.autopilot = None;
                    voyage.pilot = None;
                }
                if let Some(p) = pilot {
                    voyage.autopilot = Some(p.dest);
                    voyage.pilot = Some(p.pilot.clone());
                    voyage.sail = super::Sail::Full;
                }
            }
            return Course {
                voyage,
                points: (from..=until).map(|minute| super::course::CoursePoint { pos: start.pos, minute }).collect(),
                stops: Vec::new(),
                arrival: None,
                cells: vec![super::course::SweptCell { cell: start.pos.cell(), minute: from }],
                contacts: Vec::new(),
                realms: Vec::new(),
                pilot_modes: Vec::new(),
            };
        }
        let mut today = DayTable::new(self);
        let input = CourseInput {
            defs: &self.defs,
            fleet,
            start,
            from,
            until,
            steers,
            day: self.day(),
            speed_bonus: self.fleet_speed_bonus(fleet.id),
            mods: self.voyage_mods(fleet.id),
        };
        let orders = self.state.navigation.pending.get(&fleet.id).map(|p| p.autopilots.as_slice()).unwrap_or(&[]);
        let mut course = super::course::integrate_with_pilot(
            input,
            orders,
            Some(&self.state.explore),
            &self.realm_passes(fleet.owner),
            // H03：手动航行只有玩家舰队，取位置天况（天气团开着时团内外不同；关着时与海区天况相同）
            |cell| today.at_pos(&self.defs, cell),
        );
        // 已在风暴内的分钟投影不能把同一风暴重新当成入口。
        if self.state.navigation.traces.contains_key(&fleet.id)
            && from == self.state.navigation.settled
            && self.weather_at_pos(start.pos.cell()).is_some_and(|w| w.sky == crate::weather::Sky::Storm)
        {
            course.stops.retain(|s| !(s.kind == super::StopKind::Storm && s.minute == from));
        }
        self.add_navigation_sights(fleet, &mut course);
        course
    }

    /// 返回 minute 至当天结束的所有分钟点；查询不修改世界或随机流。
    pub fn preview_course(&self, fleet: FleetId, steers: &[Steering], minute: u16) -> Result<Course, CommandError> {
        self.preview_course_until(fleet, steers, minute, MINUTES_PER_DAY)
    }

    /// 只预测到 until；时钟检查本步的暂停点时，不必反复积分余下整天。
    pub fn preview_course_until(
        &self,
        fleet: FleetId,
        steers: &[Steering],
        minute: u16,
        until: u16,
    ) -> Result<Course, CommandError> {
        if !self.defs.manual_navigation {
            return Err(Reason::new("navigation.disabled", "这个世界没有手动航行").rule());
        }
        let fleet = self.fleet(fleet)?;
        if !matches!(fleet.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
            return Err(Reason::new("navigation.not_manual", "舰队当前没有手动航行").rule());
        }
        if self.fleet_in_battle(fleet.id) {
            return Err(Reason::new("fleet.in_battle", "舰队正在交战").rule());
        }
        if minute >= MINUTES_PER_DAY
            || until < minute
            || until > MINUTES_PER_DAY
            || until < self.state.navigation.settled
        {
            return Err(Reason::new("navigation.minute", "航行分钟须在 0 至 1439 之间").range());
        }
        if steers.len() + self.state.navigation.pending.get(&fleet.id).map_or(0, |p| p.steers.len()) > 4096 {
            return Err(Reason::new("navigation.queue_full", "当天操舵命令已达上限").rule());
        }
        let mut cursor = minute.max(self.state.navigation.minute);
        for order in steers {
            super::orders::check_steering(order, cursor)?;
            cursor = order.minute;
        }
        let mut result = self.manual_course(fleet, steers, until);
        // 当天再次出港仍保留上一航段的抵港记录；只用本次预测的抵港限制操舵。
        if result.arrival.is_some()
            && result
                .stops
                .iter()
                .filter(|stop| stop.kind == super::StopKind::Port)
                .max_by_key(|stop| stop.minute)
                .is_some_and(|stop| steers.iter().any(|s| s.minute >= stop.minute))
        {
            return Err(Reason::new("navigation.arrived", "舰队在这个分钟已经抵达锚地，等待日结靠港").rule());
        }
        result.points.retain(|p| p.minute >= minute);
        result.stops.retain(|s| s.minute >= minute);
        Ok(result)
    }
}

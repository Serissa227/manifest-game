//! 养成期只走人物与历史时间轴；经济暂停，不补造四年的交易和收盘线。
use crate::{CoreError, DayReport, World};

mod reconcile;

/// 只通知步骤完成；时钟和统计由调用层持有，不进入世界状态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LightWorldStep {
    History,
    StoryWindows,
    UpbringingFinish,
    UpbringingStart,
    WorldStart,
    UpbringingEvents,
    StoryRefresh,
    Finish,
}

impl World {
    /// 与完整日结保持相同的历史、人物、月程顺序；会话仍在新日期执行到期命令。
    pub(crate) fn end_light_world_day(&mut self) -> Result<DayReport, CoreError> {
        self.end_light_world_day_observed(&mut |_| {})
    }

    pub(super) fn end_light_world_day_observed(
        &mut self,
        observed: &mut impl FnMut(LightWorldStep),
    ) -> Result<DayReport, CoreError> {
        let day = self.day();
        let month_end = self.defs.calendar.month_end(day);
        let year_end = self.defs.calendar.year_end(day);
        self.state.closed = true;
        self.story_expire();
        let arrivals = self.move_upbringing_training()?;
        self.story_day();
        // 外交与事件期限仍按日推进，历史留下的战争、禁运与涟漪不能被冻结。
        self.diplomacy_step()?;
        self.event_day();
        self.ideas_day()?;
        self.lineages_day();
        self.societies_day()?;
        self.history_day()?;
        self.observe_history();
        self.captain_day();
        if month_end {
            self.captain_month_end();
            self.geniuses_wander();
            // 只结转实际发生的零用钱、奖励等分录；不收工资、租金或税收。
            for agent in self.state.agents.values_mut() {
                agent.ledger.close_month_in(day, &self.defs.calendar);
            }
        }
        if year_end {
            for agent in self.state.agents.values_mut() {
                agent.ledger.close_year_in(day, &self.defs.calendar);
            }
        }
        observed(LightWorldStep::History);
        self.close_story2_windows();
        observed(LightWorldStep::StoryWindows);
        let player_arrived: Vec<_> = arrivals
            .iter()
            .filter_map(|(id, loc)| {
                (self.flagship(crate::OwnerId::Player) == Some(*id)
                    && self.cast_player_place().is_some_and(|p| p.loc == *loc))
                .then_some(*loc)
            })
            .collect();
        for loc in player_arrived {
            self.hear_news_at(loc, true);
        }
        self.finish_upbringing_day()?;
        observed(LightWorldStep::UpbringingFinish);
        let fleets = &self.state.fleets;
        self.state.navigation.landings.retain(|id, _| fleets.contains_key(id));
        self.settle_due_contests()?;
        self.state.day += 1;
        self.arcana_day();
        self.new_upbringing_day()?;
        observed(LightWorldStep::UpbringingStart);
        self.items_day()?;
        self.prepare_upbringing_reading();
        self.prepare_training_fleet();
        self.auctions_day()?;
        self.cast_meet_here();
        observed(LightWorldStep::WorldStart);
        self.queue_upbringing_events();
        observed(LightWorldStep::UpbringingEvents);
        self.refresh_story2_day_start();
        observed(LightWorldStep::StoryRefresh);
        self.finish_upbringing()?;
        self.state.closed = false;
        observed(LightWorldStep::Finish);
        Ok(DayReport { day, arrivals, month_end, year_end })
    }

    fn move_upbringing_training(&mut self) -> Result<Vec<(crate::FleetId, crate::LocId)>, CoreError> {
        let training = self.state.upbringing.as_ref().and_then(|s| s.training.as_ref()).map(|t| t.fleet);
        let Some(id) = training else {
            // 日内命令与投影不能带着昨天的分钟数进入新一天，也不能悬挂在已归还的借船上。
            self.state.navigation = Default::default();
            return Ok(Vec::new());
        };
        let arrivals = self.move_fleets_for(Some(id))?;
        // 只完成学生的登陆；旧档中其它舰队的在途事务继续暂停。
        let mut parked = std::mem::take(&mut self.state.navigation.landings);
        if let Some(trip) = parked.remove(&id) {
            self.state.navigation.landings.insert(id, trip);
            self.finish_landing_day();
        }
        self.state.navigation.landings.extend(parked);
        Ok(arrivals)
    }
}

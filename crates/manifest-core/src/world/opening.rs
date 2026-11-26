//! 开局前推演与控制日的玩家初始化，和重放共用同一条路径。

use super::World;
use crate::error::CoreError;
use crate::ids::{OwnerId, ScenarioId};
use crate::replay::StartParams;
use crate::scenario::{self, BootstrapProgress, CaptainPreset};
use crate::{Command, StaticData};
use std::sync::Arc;

impl World {
    /// 每推进一天调用一次进度；首次为 0，末次等于 total。
    pub fn bootstrap(
        defs: Arc<StaticData>,
        scenario: ScenarioId,
        seed: u64,
        progress: impl FnMut(BootstrapProgress),
    ) -> Result<Self, CoreError> {
        Self::bootstrap_history(defs, scenario, seed, true, None, progress)
    }

    fn bootstrap_history(
        defs: Arc<StaticData>,
        scenario: ScenarioId,
        seed: u64,
        history: bool,
        identity: Option<scenario::ProtagonistIdentity>,
        mut progress: impl FnMut(BootstrapProgress),
    ) -> Result<Self, CoreError> {
        let sc = defs.scenarios.get(scenario.idx()).ok_or(CoreError::UnknownScenario)?.clone();
        let first = scenario::day_of(&defs, sc.start_date)?;
        let control = scenario::day_of(&defs, sc.control_date)?;
        let total = control.checked_sub(first).ok_or_else(|| scenario::invalid("control_date 不能早于 start_date"))?;
        let mut world = Self::new_at(defs, scenario, seed, first, total == 0)?;
        if identity.is_some() {
            world.state.protagonist = identity;
            world.refresh_story2();
        }
        if !world.defs.history.is_empty() {
            world.state.history.enabled = history;
        }
        progress(BootstrapProgress { day: 0, total });
        for day in 1..=total {
            if world.defs.rules.upbringing.light_world {
                world.end_light_world_day()?;
            } else {
                world.end_day()?;
            }
            progress(BootstrapProgress { day, total });
        }
        if total > 0 {
            // 与结业共用恢复边界；先补正世界，再发放控制日的玩家资产。
            world.reconcile_light_world()?;
            let before = world.total_money();
            world.add_player(&sc)?;
            world.apply_scenario_start();
            world.init_exploration();
            let capital = world.total_money() - before;
            world.state.money.initial += capital;
            // 玩家开局出资来自腹地；货币流通开启时须同时登记对手部门。
            world.settle_sector(crate::circulation::Sector::Hinterland, capital, crate::treasury::Flow::Other);
        }
        world.init_upbringing()?;
        world.cast_meet_here();
        world.refresh_story2();
        Ok(world)
    }

    /// 唯一的日志起点构造器：请求、身份、身世效果与情报均在控制日生效。
    pub fn from_start(
        defs: Arc<StaticData>,
        start: &StartParams,
        progress: impl FnMut(BootstrapProgress),
    ) -> Result<Self, CoreError> {
        let sc = defs.scenarios.get(start.scenario.idx()).ok_or(CoreError::UnknownScenario)?.clone();
        let identity = if let Some(opening) = &start.opening {
            let request = opening;
            if request.scenario != sc.key || request.seed.unwrap_or(42) != start.seed {
                return Err(scenario::invalid("开局请求与剧本或种子不一致"));
            }
            let total = scenario::day_of(&defs, sc.control_date)?
                .checked_sub(scenario::day_of(&defs, sc.start_date)?)
                .ok_or_else(|| scenario::invalid("control_date 不能早于 start_date"))?;
            if start.bootstrap_days != total {
                return Err(scenario::invalid("存档推演天数与剧本日期不一致"));
            }
            scenario::identity(&defs, &sc, request)?
        } else {
            None
        };
        let mut world = Self::bootstrap_history(
            defs,
            start.scenario,
            start.seed,
            start.opening.as_ref().is_none_or(|r| r.history),
            identity,
            progress,
        )?;
        if let Some(opening) = &start.opening {
            let request = opening;
            let preset = request
                .protagonist
                .as_ref()
                .and_then(|key| sc.protagonist_defs.iter().find(|p| &p.key == key))
                .and_then(|p| p.captain.as_ref())
                .or_else(|| {
                    request
                        .template
                        .as_ref()
                        .and_then(|key| sc.template_defs.iter().find(|t| &t.key == key))
                        .and_then(|t| t.captain.as_ref())
                });
            if let (Some(identity), Some(preset)) = (world.state.protagonist.as_ref(), preset) {
                let birthday = identity.birthday();
                world.create_opening_captain(birthday, preset)?;
            } else if request.protagonist.is_none()
                && request.template.is_none()
                && let Some(hero) = &sc.hero
            {
                let birthday = crate::captain::Birthday {
                    year: i64::from(sc.control_date[0]) - hero.age,
                    month: hero.month,
                    day: hero.day,
                };
                world.create_opening_captain(
                    birthday,
                    &CaptainPreset {
                        answers: hero.answers.clone(),
                        alloc: hero.alloc.clone(),
                        genius: hero.genius.clone(),
                    },
                )?;
            }
            crate::info::exec_mode(&mut world, request.info);
        }
        world.cast_meet_here();
        world.refresh_story2();
        if start.opening.as_ref().is_some_and(|r| r.skip_upbringing) && world.upbringing_active() {
            Command::SkipUpbringing { owner: OwnerId::Player }
                .apply(&mut world)
                .map_err(|e| scenario::invalid(e.to_string()))?;
            while world.upbringing_skipping() {
                world.end_day()?;
            }
        }
        Ok(world)
    }

    fn create_opening_captain(
        &mut self,
        birthday: crate::captain::Birthday,
        preset: &CaptainPreset,
    ) -> Result<(), CoreError> {
        Command::CreateCaptain {
            owner: OwnerId::Player,
            birthday,
            answers: preset.answers.clone(),
            alloc: preset.alloc.clone(),
            genius: preset.genius.clone(),
        }
        .apply(self)
        .map_err(|e| scenario::invalid(e.to_string()))?;
        Ok(())
    }

    pub fn player_start_day(&self) -> u32 {
        self.state.control_day.unwrap_or(0)
    }
}

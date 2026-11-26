//! M5：海战（测试 15）、航海士、探索、剧本胜负。使用内核自带的小型世界（海盗活跃度很高）。

use manifest_core::battle::{BattleMode, BattleResult, TacticalOrder, UnitStatus, hex_distance};
use manifest_core::goals::{OutcomeKind, OutcomeReason};
use manifest_core::mates::MateRole;
use manifest_core::replay::{LogEntry, Source, StartParams, replay};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::world::FleetLocation;
use manifest_core::*;

fn new_world(seed: u64) -> World {
    World::new(tiny_defs(), ScenarioId(0), seed).expect("开局")
}

fn player_fleet(w: &World) -> Option<FleetId> {
    w.fleets_of(OwnerId::Player).next().map(|f| f.id)
}

/// 记录命令并执行（与游戏会话相同：命令在当天的 tick 开头执行）。
struct Runner {
    world: World,
    log: Vec<LogEntry>,
}

impl Runner {
    fn new(seed: u64) -> Runner {
        Runner { world: new_world(seed), log: Vec::new() }
    }

    fn submit(&mut self, c: Command) -> Result<CommandOutcome, CommandError> {
        let r = c.apply(&mut self.world);
        if r.is_ok() {
            let seq = self.log.len() as u64;
            self.log.push(LogEntry { minute: None, tick: self.world.day(), seq, source: Source::Player, command: c });
        }
        r
    }

    fn end_day(&mut self) {
        self.world.end_day().unwrap();
    }

    /// 玩家舰队在 alpha 与 beta 之间来回航行（停港时补给并出航）。
    fn shuttle(&mut self) {
        let Some(fid) = player_fleet(&self.world) else { return };
        let f = self.world.fleet(fid).unwrap().clone();
        if let Some(at) = f.docked_at() {
            let dest = if at == LocId(0) { LocId(1) } else { LocId(0) };
            let need = 40 - f.food.min(f.water);
            if need > 0 {
                let _ = self.submit(Command::Resupply { owner: OwnerId::Player, fleet: fid, food: need, water: need });
            }
            let _ = self.submit(Command::SetSail { owner: OwnerId::Player, fleet: fid, dest });
        }
    }

    fn replay_hash(&self) -> String {
        let start = StartParams::new(ScenarioId(0), self.world.state.seed);
        replay(tiny_defs(), start, &self.log, self.world.day()).unwrap().state_hash()
    }
}

// ───────────────────────────── 测试 15 ─────────────────────────────

/// 测试 15（自动结算）：海盗舰队出现并与商会、玩家舰队交战；玩家未作选择的遭遇次日自动结算。
/// 同种子同命令两次运行结果一致，只用命令日志重放也一致。
#[test]
fn test15_auto_battles_are_replayable() {
    let run = |seed: u64| {
        let mut r = Runner::new(seed);
        for _ in 0..240 {
            r.shuttle();
            r.end_day();
            check_invariants(&r.world).unwrap();
        }
        r
    };
    let a = run(5);
    let b = run(5);
    let recs = &a.world.state.battles.records;
    assert!(a.world.state.battles.pirates_spawned > 0, "应有海盗出现");
    assert!(recs.iter().any(|r| r.owner.company().is_some()), "商会舰队应遭遇海盗");
    assert!(recs.iter().any(|r| r.owner == OwnerId::Player), "玩家舰队应遭遇海盗");
    assert!(recs.iter().all(|r| r.mode == BattleMode::Auto));
    assert!(recs.iter().any(|r| r.result == BattleResult::Won) && recs.iter().any(|r| r.result == BattleResult::Lost));
    assert_eq!(a.world.state_hash(), b.world.state_hash(), "同种子同命令结果一致");
    assert_eq!(a.replay_hash(), a.world.state_hash(), "只用命令日志重放结果一致");
    assert_ne!(run(6).world.state_hash(), a.world.state_hash());
}

/// 让玩家舰队遇到海盗并进入待决状态。
fn until_pending(r: &mut Runner) -> BattleId {
    for _ in 0..600 {
        if let Some(p) = r.world.state.battles.pending.values().next() {
            return p.id;
        }
        r.shuttle();
        r.end_day();
    }
    panic!("600 天内玩家舰队应遇到海盗");
}

/// 简单的玩家战术：能开火就开火，能接舷且船员占优就接舷，否则向最近的海盗靠近；最后结束回合。
fn tactical_turn(r: &mut Runner, battle: BattleId) {
    let owner = OwnerId::Player;
    let Some(t) = r.world.state.battles.tactical.get(&battle).cloned() else { return };
    let range = r.world.defs.rules.battle.gun_range;
    let mine: Vec<u8> = t.units.iter().filter(|u| u.player && u.status == UnitStatus::Active).map(|u| u.id).collect();
    for id in mine {
        let Some(t) = r.world.state.battles.tactical.get(&battle).cloned() else { return };
        let me = t.units.iter().find(|u| u.id == id).unwrap().clone();
        let enemies: Vec<_> = t.units.iter().filter(|u| !u.player && u.status == UnitStatus::Active).cloned().collect();
        let Some(nearest) = enemies.iter().min_by_key(|e| (hex_distance((me.q, me.r), (e.q, e.r)), e.id)) else {
            return;
        };
        if t.can_board(id, nearest.id) && me.crew > nearest.crew {
            let _ = r.submit(Command::TacticalCommand {
                owner,
                battle,
                order: TacticalOrder::Board { unit: id, target: nearest.id },
            });
            continue;
        }
        if !enemies.iter().any(|e| t.can_fire(id, e.id, range)) {
            // 选一个能侧舷对敌的落点；没有就尽量靠近
            let reach = t.reachable(id);
            let target = (nearest.q, nearest.r);
            let best = reach
                .iter()
                .map(|(pos, (_, dir))| {
                    let d = hex_distance(*pos, target);
                    (pos, d, *dir)
                })
                .min_by_key(|(pos, d, _)| (*d, **pos));
            if let Some((pos, _, _)) = best {
                let _ = r.submit(Command::TacticalCommand {
                    owner,
                    battle,
                    order: TacticalOrder::Move { unit: id, q: pos.0, r: pos.1 },
                });
            }
            // 转向，让最近的海盗落在侧舷
            for facing in 0..6u8 {
                let Some(t) = r.world.state.battles.tactical.get(&battle).cloned() else { return };
                if enemies.iter().any(|e| t.can_fire(id, e.id, range)) {
                    break;
                }
                let _ = r.submit(Command::TacticalCommand {
                    owner,
                    battle,
                    order: TacticalOrder::Turn { unit: id, facing },
                });
            }
        }
        let Some(t) = r.world.state.battles.tactical.get(&battle).cloned() else { return };
        if let Some(e) = enemies.iter().filter(|e| t.can_fire(id, e.id, range)).min_by_key(|e| (e.hp, e.id)) {
            let _ = r.submit(Command::TacticalCommand {
                owner,
                battle,
                order: TacticalOrder::Fire { unit: id, target: e.id },
            });
        }
    }
    if r.world.state.battles.tactical.contains_key(&battle) {
        r.submit(Command::TacticalCommand { owner, battle, order: TacticalOrder::EndTurn }).unwrap();
    }
}

/// 测试 15（战术海战）：六角格回合制战斗的每个操作都是命令；同种子同操作结果一致，只用日志重放也一致。
#[test]
fn test15_tactical_battle_is_replayable() {
    let play = || {
        let mut r = Runner::new(21);
        let battle = until_pending(&mut r);
        let fleet = r.world.state.battles.pending[&battle].fleet;
        r.submit(Command::EngageBattle { owner: OwnerId::Player, battle, tactical: true }).unwrap();
        assert!(r.world.state.battles.pending.is_empty());
        let t = r.world.state.battles.tactical[&battle].clone();
        assert!(t.units.iter().any(|u| u.player) && t.units.iter().any(|u| !u.player));
        assert!(r.world.fleet_in_battle(fleet), "交战中的舰队不能移动");
        assert!(
            r.world.fleet(fleet).is_ok_and(|_| {
                Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(2) }.validate(&r.world).is_err()
            }),
            "交战中不能改航"
        );
        // 非法操作被拒绝且不改变状态
        let before = r.world.state_hash();
        let player_unit = t.units.iter().find(|u| u.player).unwrap().id;
        let pirate_unit = t.units.iter().find(|u| !u.player).unwrap().id;
        let bad = [
            TacticalOrder::Move { unit: player_unit, q: 99, r: 99 },
            TacticalOrder::Move { unit: pirate_unit, q: 0, r: 0 },
            TacticalOrder::Board { unit: player_unit, target: pirate_unit },
            TacticalOrder::Turn { unit: player_unit, facing: 9 },
        ];
        for order in bad {
            assert!(r.submit(Command::TacticalCommand { owner: OwnerId::Player, battle, order }).is_err(), "{order:?}");
        }
        assert_eq!(r.world.state_hash(), before);
        for _ in 0..60 {
            if !r.world.state.battles.tactical.contains_key(&battle) {
                break;
            }
            tactical_turn(&mut r, battle);
        }
        assert!(!r.world.state.battles.tactical.contains_key(&battle), "战斗应在回合上限内结束");
        let rec = r.world.state.battles.records.iter().find(|x| x.id == battle).unwrap().clone();
        assert_eq!(rec.mode, BattleMode::Tactical);
        assert!(!r.world.fleet_in_battle(fleet));
        for _ in 0..30 {
            r.shuttle();
            r.end_day();
        }
        check_invariants(&r.world).unwrap();
        (r, rec)
    };
    let (a, rec_a) = play();
    let (b, rec_b) = play();
    assert_eq!(rec_a, rec_b);
    assert!(a.log.iter().filter(|e| matches!(e.command, Command::TacticalCommand { .. })).count() > 3);
    assert_eq!(a.world.state_hash(), b.world.state_hash(), "同种子同操作结果一致");
    assert_eq!(a.replay_hash(), a.world.state_hash(), "只用命令日志重放结果一致");
}

/// 玩家选择自动结算，或放着不管（次日自动结算），结果都写入战斗记录。
#[test]
fn pending_battles_resolve_by_choice_or_next_day() {
    let mut r = Runner::new(21);
    let battle = until_pending(&mut r);
    r.submit(Command::EngageBattle { owner: OwnerId::Player, battle, tactical: false }).unwrap();
    assert!(r.world.state.battles.records.iter().any(|x| x.id == battle && x.mode == BattleMode::Auto));

    let mut r = Runner::new(21);
    let battle = until_pending(&mut r);
    r.end_day();
    assert!(!r.world.state.battles.pending.contains_key(&battle));
    assert!(r.world.state.battles.records.iter().any(|x| x.id == battle));
    // 商会不能替玩家决定
    let mut r = Runner::new(21);
    let battle = until_pending(&mut r);
    let cmd = Command::EngageBattle { owner: OwnerId::Company(CompanyId(0)), battle, tactical: true };
    assert!(cmd.validate(&r.world).is_err());
}

// ───────────────────────────── 航海士 ─────────────────────────────

#[test]
fn mates_hire_assign_bonuses_salary_and_loyalty() {
    let mut w = new_world(3);
    let fid = player_fleet(&w).unwrap();
    // 剧本的航海士开局即任旗舰舰长
    assert_eq!(w.state.mates[&MateId(0)].owner, Some(OwnerId::Player));
    assert_eq!(w.state.mates[&MateId(0)].role, MateRole::Captain(fid));
    assert!(w.fleet_speed_bonus(fid) > Fx::ZERO);
    assert!(w.fleet_combat_mult(fid) > Fx::ONE);

    // 在酒馆招募：须有舰队在其所在港口
    let hire_far = Command::HireMate { owner: OwnerId::Player, mate: MateId(2) };
    assert!(hire_far.validate(&w).is_err(), "航海士在 beta，舰队在 alpha");
    let cash = w.state.agents[&OwnerId::Player].cash;
    Command::HireMate { owner: OwnerId::Player, mate: MateId(1) }.apply(&mut w).unwrap();
    assert_eq!(w.state.agents[&OwnerId::Player].cash, cash - w.defs.mate(MateId(1)).hire_cost);
    assert!(Command::HireMate { owner: OwnerId::Player, mate: MateId(1) }.validate(&w).is_err(), "不能重复招募");

    // 交易员：降低交易税、提高议价加成
    let tax_before = manifest_core::market::tax_rate(&w, OwnerId::Player, LocId(0));
    Command::AssignMate { owner: OwnerId::Player, mate: MateId(1), role: MateRole::Trader }.apply(&mut w).unwrap();
    assert!(manifest_core::market::tax_rate(&w, OwnerId::Player, LocId(0)) < tax_before);
    assert!(w.state.agents[&OwnerId::Player].trade_bonus > Fx::ZERO);
    // 同一职位只有一人
    Command::AssignMate { owner: OwnerId::Player, mate: MateId(0), role: MateRole::Trader }.apply(&mut w).unwrap();
    assert_eq!(w.state.mates[&MateId(1)].role, MateRole::None);
    // 会计：降低工资
    Command::AssignMate { owner: OwnerId::Player, mate: MateId(1), role: MateRole::Accountant }.apply(&mut w).unwrap();
    assert!(w.wage_discount(OwnerId::Player) > Fx::ZERO);
    // 不能任命为别人舰队的舰长
    let other = w.state.fleets.values().find(|f| f.owner != OwnerId::Player).unwrap().id;
    assert!(
        Command::AssignMate { owner: OwnerId::Player, mate: MateId(1), role: MateRole::Captain(other) }
            .validate(&w)
            .is_err()
    );

    // 月末发薪，按时发薪忠诚上升；在岗积累经验并升级
    let loyalty = w.state.mates[&MateId(1)].loyalty;
    let level = w.state.mates[&MateId(1)].level;
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    assert!(w.state.mates[&MateId(1)].loyalty > loyalty);
    assert!(w.state.mates[&MateId(1)].level > level, "在岗 30 天应升级（小世界每级 30 点经验）");
    let wages = w.state.agents[&OwnerId::Player].ledger.monthly[0]
        .income
        .expenses
        .iter()
        .find(|(a, _)| *a == manifest_core::ledger::Account::Wages)
        .map(|x| x.1)
        .unwrap_or(0);
    assert!(wages > 0);
    check_invariants(&w).unwrap();

    // 欠薪降低忠诚，过低会离开并回到原先的酒馆
    w.state.agents.get_mut(&OwnerId::Player).unwrap().cash = -1;
    w.state.mates.get_mut(&MateId(1)).unwrap().loyalty = 25;
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    let m = &w.state.mates[&MateId(1)];
    assert_eq!((m.owner, m.role, m.at), (None, MateRole::None, LocId(0)));

    // 解雇
    Command::DismissMate { owner: OwnerId::Player, mate: MateId(0) }.apply(&mut w).unwrap();
    assert!(w.state.mates[&MateId(0)].owner.is_none());
    assert_eq!(w.fleet_speed_bonus(fid), Fx::ZERO);
}

#[test]
fn mate_roles_follow_their_assets() {
    let mut w = new_world(4);
    let fid = player_fleet(&w).unwrap();
    assert_eq!(w.state.mates[&MateId(0)].role, MateRole::Captain(fid));
    // 舰队不存在后，舰长任命自动撤销
    w.state.fleets.remove(&fid);
    w.end_day().unwrap();
    assert_eq!(w.state.mates[&MateId(0)].role, MateRole::None);
}

// ───────────────────────────── 探索 ─────────────────────────────

#[test]
fn fog_charts_and_market_unlock() {
    let mut r = Runner::new(8);
    let w = &r.world;
    let width = w.defs.map.width as usize;
    let idx = |x: usize, y: usize| y * width + x;
    let alpha = w.defs.loc(LocId(0)).cell;
    assert!(w.state.explore.is_revealed(idx(alpha.x as usize, alpha.y as usize)), "开局港周围已揭开");
    assert!(!w.state.explore.is_revealed(idx(39, 23)), "远处仍是迷雾");
    assert!(w.loc_known(LocId(0)) && !w.loc_known(LocId(1)));
    let revealed = w.state.explore.revealed_count();

    // 航行揭开沿途，抵达后解锁市场信息
    let fid = player_fleet(&r.world).unwrap();
    r.submit(Command::Resupply { owner: OwnerId::Player, fleet: fid, food: 40, water: 40 }).unwrap();
    r.submit(Command::SetSail { owner: OwnerId::Player, fleet: fid, dest: LocId(1) }).unwrap();
    let mut arrived = false;
    for _ in 0..60 {
        // 遭遇海盗时自动结算
        let pending: Vec<BattleId> = r.world.state.battles.pending.keys().copied().collect();
        for b in pending {
            let _ = r.submit(Command::EngageBattle { owner: OwnerId::Player, battle: b, tactical: false });
        }
        r.end_day();
        match r.world.fleet(fid) {
            Ok(f) if f.docked_at() == Some(LocId(1)) => {
                arrived = true;
                break;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    if arrived {
        assert!(r.world.loc_known(LocId(1)), "到过的港口解锁市场信息");
    }
    assert!(r.world.state.explore.revealed_count() > revealed, "航行揭开了新的格子");

    // 买海图：揭开整个海区；不能重复购买；商会不需要海图
    let mut w = new_world(8);
    let price = w.chart_price(RegionId(1));
    assert!(price > 0);
    let cash = w.state.agents[&OwnerId::Player].cash;
    Command::BuyChart { owner: OwnerId::Player, region: RegionId(1) }.apply(&mut w).unwrap();
    assert_eq!(w.state.agents[&OwnerId::Player].cash, cash - price);
    assert!(w.state.explore.is_revealed(idx(39, 23)));
    assert!(Command::BuyChart { owner: OwnerId::Player, region: RegionId(1) }.validate(&w).is_err());
    assert!(Command::BuyChart { owner: OwnerId::Company(CompanyId(0)), region: RegionId(0) }.validate(&w).is_err());
    check_invariants(&w).unwrap();
}

#[test]
fn player_at_sea_cannot_buy_charts() {
    let mut w = new_world(9);
    let fid = player_fleet(&w).unwrap();
    Command::Resupply { owner: OwnerId::Player, fleet: fid, food: 30, water: 30 }.apply(&mut w).unwrap();
    Command::SetSail { owner: OwnerId::Player, fleet: fid, dest: LocId(1) }.apply(&mut w).unwrap();
    assert!(matches!(w.fleet(fid).unwrap().location, FleetLocation::AtSea(_)));
    assert!(Command::BuyChart { owner: OwnerId::Player, region: RegionId(0) }.validate(&w).is_err());
}

// ───────────────────────────── 剧本胜负 ─────────────────────────────

#[test]
fn scenario_goals_and_failures() {
    // 开局声望
    let w = new_world(1);
    assert_eq!(w.reputation(OwnerId::Player, FactionId(0)), 5);
    let (cur, target) = w.goal_progress().unwrap();
    assert!(cur > 0 && target == 1_000_000);
    assert!(w.state.outcome.is_none());

    // 达成净资产目标
    let mut w = new_world(1);
    {
        // 借：现金 / 贷：资本，账本保持平衡，净资产增加 200 万
        use manifest_core::ledger::Account;
        let b = &mut w.state.agents.get_mut(&OwnerId::Player).unwrap().ledger.balances;
        *b.entry(Account::Cash).or_insert(0) += 2_000_000;
        *b.entry(Account::Capital).or_insert(0) -= 2_000_000;
    }
    w.end_day().unwrap();
    let o = w.state.outcome.unwrap();
    assert_eq!((o.kind, o.reason), (OutcomeKind::Won, OutcomeReason::GoalReached));
    // 结果只判定一次
    w.state.agents.get_mut(&OwnerId::Player).unwrap().reorganizations = 9;
    w.end_day().unwrap();
    assert_eq!(w.state.outcome.unwrap().kind, OutcomeKind::Won);

    // 破产重组次数达到上限
    let mut w = new_world(1);
    w.state.agents.get_mut(&OwnerId::Player).unwrap().reorganizations = 3;
    w.end_day().unwrap();
    let o = w.state.outcome.unwrap();
    assert_eq!((o.kind, o.reason), (OutcomeKind::Lost, OutcomeReason::Reorganizations));

    // 限期已到
    let mut w = new_world(1);
    w.state.day = 3_599;
    w.end_day().unwrap();
    let o = w.state.outcome.unwrap();
    assert_eq!((o.kind, o.reason), (OutcomeKind::Lost, OutcomeReason::Deadline));
}

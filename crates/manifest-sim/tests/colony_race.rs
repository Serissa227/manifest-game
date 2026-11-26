//! 殖民竞赛的节奏（真实数据、完整世界模拟、离线 AI）：
//! 新大陆要一直留有“许多可以殖民的未知地区”——十年后被各势力占领的殖民点不超过约 40%，三十年不超过约 60%；
//! 各势力只占领本国港口附近的殖民点、占领数不超过随年代放开的上限；离线模板的“占领殖民点”组合事件遵守同样的限制。

mod common;

use manifest_ai::AiMode;
use manifest_core::calendar::DAYS_PER_YEAR;
use manifest_core::colony::{Claim, faction_reaches};
use manifest_core::ids::*;
use manifest_core::testkit::check_invariants;
use manifest_sim::{AiDriver, GameSession};
use std::collections::BTreeMap;

/// 各势力占领的殖民点。
fn claims(s: &GameSession) -> BTreeMap<FactionId, Vec<LocId>> {
    let mut out: BTreeMap<FactionId, Vec<LocId>> = BTreeMap::new();
    for l in s.world.defs.site_ids() {
        if let Some(Claim::Faction(f)) = s.world.claim_of(l) {
            out.entry(f).or_default().push(l);
        }
    }
    out
}

fn claimed(s: &GameSession) -> usize {
    claims(s).values().map(Vec::len).sum()
}

/// 数据层面的保证：占领上限随年代放开，十年、三十年时的上限本身就不超过 40%、60%。
#[test]
fn claim_caps_in_data_leave_most_sites_free() {
    let defs = common::defs();
    let rules = &defs.rules.colony;
    let sites = defs.site_ids().count();
    let factions = defs.factions.len();
    assert!(sites >= 32, "至少 32 个殖民点");
    assert!(rules.claim_slot_years > 0 && rules.claim_reach > 0 && rules.claim_start_day > 0);
    let cap_at = |years: u32| (1 + (years / rules.claim_slot_years) as usize).min(rules.max_claims_per_faction);
    assert!(factions * cap_at(10) * 100 <= sites * 40, "十年时的占领上限 {} × {factions}", cap_at(10));
    assert!(factions * cap_at(30) * 100 <= sites * 60, "三十年时的占领上限 {} × {factions}", cap_at(30));
    // 势力范围之外（离任何势力的港口都远）的殖民点永远留给冒险者
    let unreachable = defs.site_ids().filter(|l| defs.faction_ids().all(|f| !faction_reaches(&defs, f, *l))).count();
    assert!(unreachable >= 1, "应有势力够不着的殖民点");
}

/// 完整模拟三十年（玩家不行动、离线 AI）：占领比例、势力范围与上限。
#[test]
fn colony_race_leaves_room_for_the_player_for_decades() {
    let defs = common::defs();
    let sites = defs.site_ids().count();
    std::thread::scope(|scope| {
        for seed in [42u64, 7] {
            let defs = defs.clone();
            scope.spawn(move || {
                let mut s = GameSession::new(defs.clone(), ScenarioId(0), seed).unwrap();
                let driver = AiDriver::with_mode(common::ai_content(), AiMode::Offline).unwrap().expect("离线 AI");
                let mut at_10 = 0;
                let mut composed_claims = 0;
                for day in 0..30 * DAYS_PER_YEAR {
                    driver.run_due(&mut s);
                    s.advance_day().unwrap();
                    composed_claims += s
                        .world
                        .state
                        .events
                        .composed
                        .iter()
                        .filter(|r| r.day == day)
                        .flat_map(|r| &r.effects)
                        .filter(|e| e.effect == manifest_core::defs::EffectKind::SiteClaim)
                        .count();
                    if day + 1 == 10 * DAYS_PER_YEAR {
                        at_10 = claimed(&s);
                        check_invariants(&s.world).unwrap();
                    }
                }
                let at_30 = claimed(&s);
                println!(
                    "种子 {seed}：十年 {at_10}/{sites}，三十年 {at_30}/{sites}，其中组合事件占领 {composed_claims} 处"
                );
                assert!(at_10 * 100 <= sites * 40, "种子 {seed}：十年后被占领 {at_10}/{sites}");
                assert!(at_30 * 100 <= sites * 60, "种子 {seed}：三十年后被占领 {at_30}/{sites}");
                assert!(at_10 >= 4 && at_30 > at_10, "种子 {seed}：各国仍在持续争夺殖民点（{at_10} → {at_30}）");
                let rules = &defs.rules.colony;
                for (f, locs) in claims(&s) {
                    assert!(locs.len() <= rules.max_claims_per_faction, "{f:?} 占领 {} 处", locs.len());
                    for l in locs {
                        assert!(faction_reaches(&defs, f, l), "{f:?} 占领了势力范围之外的 {}", defs.loc(l).key);
                    }
                }
                assert!(s.world.money_conserved());
            });
        }
    });
}

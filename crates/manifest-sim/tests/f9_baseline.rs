//! 第九批开始前采集的经典世界基线；常量只能因明确的需求变更调整。

mod common;

use manifest_core::captain::Birthday;
use manifest_core::info::InfoMode;
use manifest_core::{Command, OwnerId, ScenarioId, World};
use manifest_sim::GameSession;
use std::sync::Arc;

fn mix(h: &mut u64, bytes: &[u8]) {
    for b in bytes {
        *h ^= u64::from(*b);
        *h = h.wrapping_mul(0x0100_0000_01b3);
    }
}

fn digest(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325;
    mix(&mut h, bytes);
    h
}

#[test]
fn classic_data_hash_and_all_scenarios_keep_their_serialized_bytes() {
    let defs = common::defs();
    assert_eq!(defs.meta.hash, "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35");
    let mut rows = Vec::new();
    for (i, scenario) in defs.scenarios.iter().enumerate() {
        let mut game = GameSession::new(defs.clone(), ScenarioId(i as u16), 42).unwrap();
        let opening = digest(&serde_json::to_vec(&game.world.state).unwrap());
        if let Some(hero) = &scenario.hero {
            game.submit(Command::CreateCaptain {
                owner: OwnerId::Player,
                birthday: Birthday { year: defs.rules.world.start_year - hero.age, month: hero.month, day: hero.day },
                answers: hero.answers.clone(),
                alloc: hero.alloc.clone(),
                genius: hero.genius.clone(),
            })
            .unwrap();
            game.advance_day().unwrap();
            game.submit(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }).unwrap();
        }
        while game.day() < 30 {
            game.advance_day().unwrap();
        }
        let state = serde_json::to_vec(&game.world.state).unwrap();
        let commands = serde_json::to_vec(&game.to_save().log).unwrap();
        rows.push((scenario.key.clone(), opening, digest(&state), digest(&commands)));
        let back = GameSession::from_save(defs.clone(), game.to_save()).unwrap();
        assert_eq!(serde_json::to_vec(&back.world.state).unwrap(), state);
        assert_eq!(serde_json::to_vec(&game.replay().unwrap().state).unwrap(), state);
    }
    let expected = [
        ("newcomer", 0xf358_e7e8_41aa_2a9c, 0x7806_a418_95b6_e1fc, 0x0961_2b07_b5ec_b5a5),
        ("heir", 0xda6a_8c1e_958e_a1f1, 0x4eea_e91d_b8de_5e5b, 0x0961_2b07_b5ec_b5a5),
        ("sandbox", 0x11c4_64be_b8f0_6efd, 0x9f8d_f46c_9c69_11b5, 0x0961_2b07_b5ec_b5a5),
        ("colonist", 0x1673_c86a_3934_1be7, 0xf935_5b38_1ac1_42dd, 0x0961_2b07_b5ec_b5a5),
        ("rossella", 0x04cc_1787_037e_18c7, 0x3831_056b_fc41_664e, 0x0bc8_4883_ce24_8f73),
        ("noel", 0x1516_4b7f_7204_ebc4, 0xec97_4e8e_f021_6971, 0xd2d3_5f76_af6b_34d2),
        ("xingcha", 0x365c_af9a_2607_58bd, 0xa7e4_f36d_e133_7c5e, 0x2248_fd3a_b318_941a),
    ];
    assert_eq!(rows, expected.map(|(key, a, b, c)| (key.to_owned(), a, b, c)));
}

#[test]
fn e8_market_trajectory_and_final_state_keep_their_bytes() {
    let mut defs = (*common::defs()).clone();
    defs.rules.open_market.enabled = false;
    let defs = Arc::new(defs);
    let mut rows = Vec::new();
    for mode in [InfoMode::Live, InfoMode::Carried] {
        let mut world = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
        Command::SetInfoMode { owner: OwnerId::Player, mode }.apply(&mut world).unwrap();
        let mut h = 0xcbf2_9ce4_8422_2325;
        for _ in 0..365 {
            world.end_day().unwrap();
            for location in &world.state.locations {
                for (good, entry) in &location.market {
                    mix(&mut h, &good.0.to_le_bytes());
                    mix(&mut h, &entry.price.to_le_bytes());
                    mix(&mut h, &entry.stock.to_le_bytes());
                }
            }
        }
        rows.push((h, digest(&serde_json::to_vec(&world.state).unwrap())));
    }
    assert_eq!(rows, [(0x1843_6fff_7722_0844, 0x8f87_7cbc_fbcb_5088), (0x0af6_c5ce_3f32_c491, 0x0579_8b14_f63b_9c5c)]);
}

#[test]
fn legacy_v1_fixture_in_v2_v3_v4_envelopes_continues_identically() {
    // 从已入库的旧快照出发，覆盖字段更名之后的每个历史版本入口。
    let bytes = include_bytes!("fixtures/save_v1.mfsave.zst");
    let original = manifest_sim::storage::decode(bytes).unwrap();
    let defs = common::defs();
    let mut expected = GameSession::from_save(defs.clone(), original.clone()).unwrap();
    for _ in 0..30 {
        expected.advance_day().unwrap();
    }
    for version in [2, 3, 4] {
        let mut value = serde_json::to_value(&original).unwrap();
        value["version"] = version.into();
        let save = manifest_core::save::SaveFile::from_json(&value.to_string()).unwrap();
        let mut game = GameSession::from_save(defs.clone(), save).unwrap();
        for _ in 0..30 {
            game.advance_day().unwrap();
        }
        assert_eq!(game.world.state, expected.world.state, "v{version}");
        assert_eq!(game.day(), 50);
    }
}

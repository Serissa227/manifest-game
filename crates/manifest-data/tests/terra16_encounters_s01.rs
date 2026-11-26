//! S01：寰宇出海后的奇遇——真实数据走生产加载器。
//!
//! - 条数与规矩：海上、港口各有多少条；每条 2–3 个选项，至少一个不花钱、不交货；一年内不重复或一局只出一次；
//!   后果都在“一趟短途的零头”之内，没有属性、航海士、海图这类贵重的后果；
//! - 出场条件可达（枚举，不抽样）：只用海区、文化圈、季节、天况、风力这几种条件；限定的文化圈里确有港口；
//!   海上的每一条在一整年里至少有一天、一片允许的海区，季节、天况与风力同时成立；
//! - 每条奇遇的每个选项都能结算：没有检定的走一遍，有检定的成功与失败各走一遍，都是内核的 `StoryAnswer`，
//!   结算后账目平衡、现金与货舱的变化同数据写的一致；身无分文、舱里空空时每条也至少有一个选项交得上。
//!
//! 养成期不出奇遇、同种子结果相同、林晚灯的五章羁绊出场，在 `manifest-sim --test terra16_encounters_s01`；
//! 行情事件在 `terra16_events_s01`。
use manifest_core::calendar::Season;
use manifest_core::captain::Birthday;
use manifest_core::story::{Cond, EncounterDef, Place, StoryEffect, StoryPending, StorySource};
use manifest_core::testkit::check_invariants;
use manifest_core::weather::day_weather;
use manifest_core::{Command, FleetId, Fx, GoodId, OwnerId, RegionId, StaticData, World};
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

const PLAYER: OwnerId = OwnerId::Player;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("寰宇完整加载")).clone()
}

/// 自由航海剧本、立过身世的世界（1557-01-01，停在里斯本）。成年创建页没有身世问答，自由点数按组平均撒开。
fn sea_world() -> World {
    static WORLD: OnceLock<World> = OnceLock::new();
    WORLD
        .get_or_init(|| {
            let d = defs();
            let scenario = d.find_scenario("free_1557").expect("自由航海剧本");
            let mut w = World::new(d.clone(), scenario, 42).expect("开局预演");
            let mut alloc = vec![0i64; d.captain.attributes.len()];
            for group in &d.captain.groups {
                let members: Vec<usize> = d
                    .captain
                    .attributes
                    .iter()
                    .enumerate()
                    .filter(|(_, a)| a.group == group.key)
                    .map(|(i, _)| i)
                    .collect();
                for n in 0..group.free.max(0) as usize {
                    alloc[members[n % members.len()]] += 1;
                }
            }
            let start = d.rules.world.calendar_year(d.calendar.date_of(w.player_start_day()).year);
            Command::CreateCaptain {
                owner: PLAYER,
                birthday: Birthday { year: start - d.captain.points.age_default, month: 6, day: 1 },
                answers: Vec::new(),
                alloc,
                genius: None,
            }
            .apply(&mut w)
            .expect("自由航海补建身世");
            assert!(w.story_enabled() && !w.upbringing_active());
            w
        })
        .clone()
}

fn flagship(w: &World) -> FleetId {
    w.flagship(PLAYER).expect("玩家有旗舰")
}

/// S01 的随机奇遇表。H02（2026-11-11）把船员情绪三阶段的九条事件（stories/voyage_crew.toml）也写成了旧式奇遇，
/// 但它们不参与每天的随机、只由 `[voyage_wear]` 在士气跌到线下时派出（内核用 `is_crisis_event` 把它们排除在抽取之外），
/// 守的是 H02 自己的规矩（tests/voyage_wear_h02.rs：都在海上、有不花钱的出路、怠工与哗变带复工 / 靠港 / 哗变的旗标）。
/// 这里照内核的同一条判据只看随机表；排除的必须恰好是 `[voyage_wear]` 列的那九条（见 `crisis_events_are_exactly_the_wear_lists`）。
fn encounters(place: Place) -> Vec<&'static EncounterDef> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    let d = DEFS.get_or_init(defs);
    d.stories.encounters.iter().filter(|e| e.place == place && !d.rules.voyage_wear.is_crisis_event(&e.key)).collect()
}

#[test]
fn crisis_events_are_exactly_the_wear_lists() {
    let d = defs();
    let r = &d.rules.voyage_wear;
    let excluded: BTreeSet<&str> =
        d.stories.encounters.iter().filter(|e| r.is_crisis_event(&e.key)).map(|e| e.key.as_str()).collect();
    let listed: BTreeSet<&str> =
        r.grumble_events.iter().chain(&r.slowdown_events).chain(&r.mutiny_events).map(String::as_str).collect();
    assert_eq!(excluded, listed, "随机表之外的只能是情绪阶段列的事件");
    assert_eq!(excluded.len(), 9);
    assert!(excluded.iter().all(|k| k.starts_with("crew_")));
}

fn all_encounters() -> Vec<&'static EncounterDef> {
    let mut all = encounters(Place::Sea);
    all.extend(encounters(Place::Port));
    all
}

#[test]
fn the_table_is_registered_with_enough_entries_and_the_documented_pace() {
    let d = defs();
    let (sea, port) = (encounters(Place::Sea), encounters(Place::Port));
    assert!(sea.len() >= 20, "海上的奇遇 {} 条", sea.len());
    assert!(port.len() >= 16, "港口的奇遇 {} 条", port.len());
    assert!(sea.len() + port.len() >= 36);
    // 节奏写在 encounters_sea.toml 的 [rules]；数值的来历见 docs/BALANCE.md（S01）。
    let r = &d.stories.rules;
    // H04（2026-11-11）：海上所见分担了“海上有事”，每日概率 1_600 → 1_000（见 docs/drafts/h04-handoff.md）。
    assert_eq!((r.encounter_bp, r.gap_days, r.first_day), (1_000, 6, 0));
    // 寰宇没有经典故事线：旧式剧情文件里只有奇遇。
    assert!(d.stories.stories.is_empty());
    let keys: BTreeSet<&str> = all_encounters().iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys.len(), sea.len() + port.len(), "key 不重复");
    assert!(sea.iter().all(|e| e.key.starts_with("sea_")) && port.iter().all(|e| e.key.starts_with("port_")));
}

#[test]
fn every_encounter_keeps_the_house_rules() {
    let d = defs();
    for e in all_encounters() {
        let key = &e.key;
        assert!((2..=3).contains(&e.choices.len()), "{key}：选项 {} 个", e.choices.len());
        // 身无分文、舱里空空也答得了（带检定不算门槛：输赢都结算）。
        assert!(e.choices.iter().any(|c| c.cost == 0 && c.give.is_none()), "{key}：没有无门槛的选项");
        // 一年内不重复；带出处的一局只出一次。
        assert!(e.once || e.cooldown_days >= 365, "{key}：冷却 {} 天", e.cooldown_days);
        assert!(!e.title.is_empty() && !e.text.is_empty(), "{key}");
        for (i, c) in e.choices.iter().enumerate() {
            let at = format!("{key} 选项 {}", i + 1);
            assert!(!c.text.is_empty() && !c.reply.is_empty(), "{at}：选项与回应都要有字");
            assert_eq!(c.check.is_some(), !c.fail_reply.is_empty(), "{at}：有检定就要有失败的叙事");
            // 得失只相当于一趟短途的零头。
            assert!(c.cost <= 320, "{at}：花费 {}", c.cost);
            let give = c.give.map_or(0, |(g, q)| d.good(g).base_price * q);
            assert!(give <= 300, "{at}：交出的货值 {give}");
            for branch in [&c.effects, &c.fail] {
                let mut money = -c.cost - give;
                for effect in branch {
                    match effect {
                        StoryEffect::Cash(v) => {
                            assert!(v.abs() <= 300, "{at}：现金 {v}");
                            money += v;
                        }
                        StoryEffect::Goods(g, q) => {
                            let value = d.good(*g).base_price * q;
                            assert!(*q > 0 && value <= 500, "{at}：货值 {value}");
                            money += value;
                        }
                        StoryEffect::Fame(v) => assert!((-1..=3).contains(v), "{at}：名声 {v}"),
                        StoryEffect::Reputation(faction, v) => {
                            assert!(v.abs() <= 4, "{at}：声望 {v}");
                            // 海上没有“当地势力”，不写势力的声望在海上不起作用。
                            assert!(e.place == Place::Port || faction.is_some(), "{at}：海上的声望要写势力");
                        }
                        StoryEffect::Morale(v) => assert!(v.abs() <= 8, "{at}：士气 {v}"),
                        StoryEffect::Crew(v) => assert!(v.abs() <= 2, "{at}：水手 {v}"),
                        StoryEffect::Repair(v) => assert!(*v <= 35, "{at}：修复 {v}"),
                        StoryEffect::Damage(v) => assert!(*v <= 8, "{at}：损伤 {v}"),
                        StoryEffect::Supplies(v) => assert!(v.abs() <= 4, "{at}：粮水 {v}"),
                        StoryEffect::Rumor => {}
                        other => panic!("{at}：奇遇不该给这种后果 {other:?}"),
                    }
                }
                // 最好的情形也刷不出钱：一条的净得不超过三百。
                assert!(money <= 300, "{at}：净得 {money}");
            }
        }
    }
}

/// 出场条件里限定的海区、文化圈、季节、天况、风力；别的条件种类（日期、现金、旗标……）这张表不用。
struct Gate<'a> {
    regions: Option<&'a [RegionId]>,
    cultures: Option<&'a [String]>,
    seasons: Option<&'a [u8]>,
    skies: Option<&'a [manifest_core::weather::Sky]>,
    wind: Option<(i64, i64)>,
}

fn gate(e: &EncounterDef) -> Gate<'_> {
    let mut g = Gate { regions: None, cultures: None, seasons: None, skies: None, wind: None };
    for cond in &e.when {
        match cond {
            Cond::AtSea(regions) if !regions.is_empty() => g.regions = Some(regions),
            Cond::Culture(cultures) => g.cultures = Some(cultures),
            Cond::Season(seasons) => g.seasons = Some(seasons),
            Cond::Sky(skies) => g.skies = Some(skies),
            Cond::Wind(lo, hi) => g.wind = Some((*lo, *hi)),
            other => panic!("{}：可达判定不认识的条件 {other:?}", e.key),
        }
    }
    g
}

#[test]
fn every_encounter_can_actually_come_up_somewhere_in_the_year() {
    let d = defs();
    let first = manifest_core::scenario::day_of(&d, [1557, 1, 1]).unwrap();
    let year = d.calendar.year_days();
    let season_ok =
        |g: &Gate, day: u32| g.seasons.is_none_or(|s| s.contains(&(d.calendar.season_of(day).index() as u8)));
    // 港口：限定的文化圈里确有港口（季节一年四季都会轮到）。
    for e in encounters(Place::Port) {
        let g = gate(e);
        assert!(g.regions.is_none() && g.skies.is_none() && g.wind.is_none(), "{}", e.key);
        let ports =
            d.port_ids().filter(|l| g.cultures.is_none_or(|c| c.iter().any(|c| *c == d.loc(*l).culture))).count();
        assert!(ports >= 1, "{}：没有一座港口属于 {:?}", e.key, g.cultures);
        if let Some(seasons) = g.seasons {
            assert!(seasons.iter().all(|s| (*s as usize) < Season::ALL.len()), "{}", e.key);
        }
    }
    // 海上：一整年 × 允许的海区逐日枚举，季节、天况、风力要有同时成立的日子。两颗种子都要成立。
    let mut wide = 0;
    for e in encounters(Place::Sea) {
        let g = gate(e);
        assert!(g.cultures.is_none(), "{}", e.key);
        let regions: Vec<RegionId> = match g.regions {
            Some(regions) => regions.to_vec(),
            None => (0..d.regions.len()).map(RegionId::from_idx).collect(),
        };
        wide += usize::from(g.regions.is_none());
        for seed in [7u64, 42] {
            let mut hits = 0u32;
            for day in first..first + year {
                if !season_ok(&g, day) {
                    continue;
                }
                for region in &regions {
                    let Some(weather) = day_weather(&d, seed, *region, day, Fx::ONE) else { continue };
                    let sky = g.skies.is_none_or(|s| s.contains(&weather.sky));
                    let wind = g.wind.is_none_or(|(lo, hi)| (lo..=hi).contains(&weather.wind_strength()));
                    hits += u32::from(sky && wind);
                }
            }
            // 不只是“有”：至少十个海区日，免得一年里只碰得上一两回。
            assert!(hits >= 10, "{}（种子 {seed}）：一年里只有 {hits} 个海区日满足条件", e.key);
        }
    }
    // 不限海区的至少十条：常在一片海里跑的船，一年里也有十来条海上的事可遇。
    assert!(wide >= 10, "不限海区的海上奇遇只有 {wide} 条");
    // 各片海、各文化圈都有自己的事：东亚、南洋、印度洋、地中海、大西洋、新大陆。
    let region = |key: &str| RegionId::from_idx(d.regions.iter().position(|r| r.key == key).unwrap());
    for key in ["east_china_sea", "malacca", "arabian_sea", "tyrrhenian", "north_sea", "sargasso", "east_caribbean"] {
        let id = region(key);
        let local = encounters(Place::Sea).iter().filter(|e| gate(e).regions.is_some_and(|r| r.contains(&id))).count();
        assert!(local >= 1, "{key} 没有自己的海上奇遇");
    }
    for culture in [
        "ming",
        "japanese",
        "malay",
        "indian",
        "ottoman",
        "desert",
        "mediterranean",
        "lowland",
        "nordic",
        "frontier",
        "swahili",
    ] {
        let local = encounters(Place::Port)
            .iter()
            .filter(|e| gate(e).cultures.is_some_and(|c| c.iter().any(|c| c == culture)))
            .count();
        assert!(local >= 1, "{culture} 的港口没有自己的奇遇");
    }
}

/// 把这条奇遇摆到玩家面前（跳过随机与出场条件，只为结算），再选第 `choice` 个选项。
/// 返回结算后的世界与检定结果；`seed` 只影响检定的骰子。
fn settle(base: &World, e: &EncounterDef, choice: usize, seed: u64) -> (World, Option<bool>) {
    let mut w = base.clone();
    w.state.seed = seed;
    let fleet = flagship(&w);
    let c = &e.choices[choice];
    if let Some((good, qty)) = c.give {
        // 货只放进货舱、不进存货簿：交出去时按零成本转出，账目照样平衡。
        *w.state.fleets.get_mut(&fleet).unwrap().cargo.entry(good).or_insert(0) += qty;
    }
    w.state.story.pending = Some(StoryPending { day: w.day(), fleet, source: StorySource::Encounter(e.key.clone()) });
    assert!(!w.story2_is_front(), "{}：开局这一刻没有别的章节挡在奇遇前面", e.key);
    Command::StoryAnswer { owner: PLAYER, choice: choice as u32 }
        .apply(&mut w)
        .unwrap_or_else(|err| panic!("{} 选项 {}：结算被拒 {err}", e.key, choice + 1));
    let last = w.state.story.last.clone().expect("有结算结果");
    assert_eq!(last.source, StorySource::Encounter(e.key.clone()));
    assert_eq!(last.choice, Some(choice as u32));
    assert!(w.state.story.pending.is_none());
    (w, last.success)
}

fn cash(w: &World) -> i64 {
    w.agent(PLAYER).unwrap().cash
}

fn cargo(w: &World, good: GoodId) -> i64 {
    w.fleet(flagship(w)).unwrap().cargo.get(&good).copied().unwrap_or(0)
}

/// 结算后的世界同数据写的后果逐项对一遍：现金、货舱、士气、名声都按内核的规则落了地，账目平衡。
fn verify(base: &World, after: &World, e: &EncounterDef, choice: usize, success: Option<bool>) {
    let at = format!("{} 选项 {}（{success:?}）", e.key, choice + 1);
    let c = &e.choices[choice];
    check_invariants(after).unwrap_or_else(|err| panic!("{at}：{err}"));
    let branch = if success == Some(false) { &c.fail } else { &c.effects };
    // 现金：先付花费，再逐条加减（扣钱不会扣成负数；开局现金一万，表里最大的花费与罚款加起来也到不了）。
    let money: i64 = branch.iter().map(|x| if let StoryEffect::Cash(v) = x { *v } else { 0 }).sum();
    assert_eq!(cash(after), cash(base) - c.cost + money, "{at}：现金");
    // 货舱：交出去的拿走了，得到的装上了（舱位够，表里一次最多十几件）。
    let goods: BTreeSet<GoodId> = branch
        .iter()
        .filter_map(|x| if let StoryEffect::Goods(g, _) = x { Some(*g) } else { None })
        .chain(c.give.map(|(g, _)| g))
        .collect();
    for good in goods {
        let gained: i64 = branch
            .iter()
            .map(|x| match x {
                StoryEffect::Goods(g, q) if *g == good => *q,
                _ => 0,
            })
            .sum();
        assert_eq!(cargo(after, good), cargo(base, good) + gained, "{at}：货舱里的 {}", base.defs.good(good).key);
    }
    let fleet = |w: &World| w.fleet(flagship(w)).unwrap().clone();
    let morale: i64 = branch.iter().map(|x| if let StoryEffect::Morale(v) = x { *v } else { 0 }).sum();
    assert_eq!(fleet(after).morale, (fleet(base).morale + morale).clamp(0, 100), "{at}：士气");
    let fame: i64 = branch.iter().map(|x| if let StoryEffect::Fame(v) = x { *v } else { 0 }).sum();
    assert_eq!(after.agent(PLAYER).unwrap().fame, (base.agent(PLAYER).unwrap().fame + fame).max(0), "{at}：名声");
    // 声望：港口的奇遇不写势力时算在停靠港口的势力头上。
    for x in branch {
        if let StoryEffect::Reputation(faction, v) = x {
            let id = faction
                .unwrap_or_else(|| after.location_faction(fleet(after).docked_at().expect("夹具里旗舰停在里斯本")));
            let (before, now) = (base.reputation(PLAYER, id), after.reputation(PLAYER, id));
            assert!(
                now != before && (now - before).signum() == v.signum(),
                "{at}：声望 {before} → {now}（应当 {v:+}）"
            );
        }
    }
}

#[test]
fn every_choice_of_every_encounter_settles_through_the_kernel() {
    let base = sea_world();
    // 自由航海开局现金一万：这里枚举的是每个选项结不结得了算，“钱不够、货不够”另有一条测试。
    assert!(cash(&base) >= 5_000, "自由航海开局现金 {}", cash(&base));
    let (mut plain, mut both) = (0, 0);
    for e in all_encounters() {
        for (i, c) in e.choices.iter().enumerate() {
            if c.check.is_none() {
                let (after, success) = settle(&base, e, i, 42);
                assert_eq!(success, None, "{}", e.key);
                verify(&base, &after, e, i, None);
                plain += 1;
                continue;
            }
            // 有检定：成功率夹在 5%–95%，两条分支都走得到。换种子逐个找，找齐为止（确定性的枚举，不是抽样统计）。
            let mut seen = [false; 2];
            for seed in 0..4_000u64 {
                let (after, success) = settle(&base, e, i, seed);
                let hit = success.unwrap_or_else(|| panic!("{} 选项 {}：有检定却没有检定结果", e.key, i + 1));
                if !seen[usize::from(hit)] {
                    seen[usize::from(hit)] = true;
                    verify(&base, &after, e, i, Some(hit));
                }
                if seen == [true, true] {
                    break;
                }
            }
            assert_eq!(seen, [true, true], "{} 选项 {}：成功与失败没有都走到", e.key, i + 1);
            both += 1;
        }
    }
    let total: usize = all_encounters().iter().map(|e| e.choices.len()).sum();
    assert_eq!(plain + both, total);
    assert!(both >= 30, "带检定的选项 {both} 个");
}

#[test]
fn a_broke_captain_with_an_empty_hold_can_still_answer_every_encounter() {
    let base = sea_world();
    assert!(base.fleet(flagship(&base)).unwrap().cargo.is_empty(), "自由航海开局是空舱");
    // 把现金花到付不起表里最贵的那个“只花钱”的选项为止：钱是经内核的结算一笔一笔花掉的，不直接改数。
    let spender = all_encounters()
        .into_iter()
        .flat_map(|e| e.choices.iter().enumerate().map(move |(i, c)| (e, i, c)))
        .filter(|(_, _, c)| c.cost > 0 && c.give.is_none() && c.check.is_none())
        .max_by_key(|(_, _, c)| c.cost)
        .expect("表里有只花钱、不带检定的选项");
    let mut poor = base.clone();
    for _ in 0..2_000 {
        let (e, i, c) = spender;
        if cash(&poor) < c.cost {
            break;
        }
        poor = settle(&poor, e, i, 42).0;
    }
    assert!(cash(&poor) < spender.2.cost, "现金 {}", cash(&poor));
    check_invariants(&poor).unwrap();
    let mut blocked = 0;
    for e in all_encounters() {
        // 每条至少有一个选项此刻交得上；花钱、交货的选项该挡的也确实挡住了。
        let mut open = 0;
        for (i, c) in e.choices.iter().enumerate() {
            let mut w = poor.clone();
            let fleet = flagship(&w);
            w.state.story.pending =
                Some(StoryPending { day: w.day(), fleet, source: StorySource::Encounter(e.key.clone()) });
            let result = Command::StoryAnswer { owner: PLAYER, choice: i as u32 }.validate(&w);
            if c.give.is_some() || c.cost > cash(&poor) {
                assert!(result.is_err(), "{} 选项 {}：货或钱不够却能选", e.key, i + 1);
                blocked += 1;
            } else {
                assert!(result.is_ok(), "{} 选项 {}：{result:?}", e.key, i + 1);
                open += 1;
            }
        }
        assert!(open >= 1, "{}：穷船长一个选项也交不上", e.key);
    }
    // 要交货的选项一共五六个，加上付不起的那几个：挡住的不止一两个，这条测试不是空转。
    assert!(blocked >= 5, "挡住的选项 {blocked} 个");
}

//! S01：寰宇出海后的奇遇在概览里的样子。
//!
//! 奇遇走的是旧式剧情的那一套视图（`story.pending` 的 kind 为 encounter）：标题、正文、选项的花费、要交的货与检定的成功率，
//! 回应之后的叙事与实际发生的后果。界面不需要新的字段；这里用真实的寰宇数据把这条路从数据走到概览的 JSON。
use manifest_appcore::views;
use manifest_core::captain::Birthday;
use manifest_core::story::{StoryPending, StorySource};
use manifest_core::{Command, OwnerId, World};
use serde_json::{Value, json};
use std::path::PathBuf;

const PLAYER: OwnerId = OwnerId::Player;

/// 自由航海剧本、在成年创建页立过身世的世界（1557-01-01，停在里斯本）。
fn sea_world() -> World {
    let d =
        manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "terra16").unwrap();
    let scenario = d.find_scenario("free_1557").expect("自由航海剧本");
    let mut w = World::new(d.clone(), scenario, 42).expect("开局预演");
    let mut alloc = vec![0i64; d.captain.attributes.len()];
    for group in &d.captain.groups {
        let members: Vec<usize> =
            d.captain.attributes.iter().enumerate().filter(|(_, a)| a.group == group.key).map(|(i, _)| i).collect();
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
    w
}

fn story(w: &World) -> Value {
    serde_json::to_value(views::overview(w, 0, "off".into(), None)).unwrap()["story"].clone()
}

/// 把一条奇遇摆到玩家面前（跳过随机；出现的日子照内核的口径记作昨夜结算的那一天）。
fn meet(w: &mut World, key: &str) {
    let fleet = w.flagship(PLAYER).unwrap();
    w.state.story.pending = Some(StoryPending { day: w.day() - 1, fleet, source: StorySource::Encounter(key.into()) });
}

#[test]
fn a_port_encounter_shows_its_choices_and_settles_through_story_answer() {
    let mut w = sea_world();
    let cash = w.agent(PLAYER).unwrap().cash;
    meet(&mut w, "port_tax_clerk");
    let s = story(&w);
    let p = &s["pending"];
    assert_eq!(
        (&p["kind"], &p["key"], &p["title"]),
        (&json!("encounter"), &json!("port_tax_clerk"), &json!("验货的税吏"))
    );
    assert!(p["text"].as_str().unwrap().contains("税吏"));
    // 奇遇是旁白，没有头像；不带 story2 的轨道、地点这些扩展字段。
    assert!(p.get("track").is_none());
    let choices = p["choices"].as_array().unwrap();
    assert_eq!(choices.len(), 3);
    // 第一项要付钱；第二项只有检定；第三项先付钱再检定。钱够，三项都没被挡住。
    assert_eq!((&choices[0]["cost"], &choices[0]["check"]), (&json!(120), &Value::Null));
    assert_eq!((&choices[1]["cost"], &choices[1]["check"]["attr"]), (&json!(0), &json!("numeracy")));
    assert_eq!(choices[1]["check"]["name"], "算学");
    assert_eq!((&choices[2]["cost"], &choices[2]["check"]["attr"]), (&json!(50), &json!("etiquette")));
    for c in choices {
        assert!(c["blocked"].is_null(), "{c}");
        if let Some(pct) = c["check"]["pct"].as_i64() {
            assert!((5..=95).contains(&pct), "{c}");
        }
    }
    // 选第一项：照估的数补税。
    Command::StoryAnswer { owner: PLAYER, choice: 0 }.apply(&mut w).unwrap();
    let s = story(&w);
    assert!(s["pending"].is_null());
    let last = &s["last"];
    assert_eq!(
        (&last["kind"], &last["key"], &last["choice"]),
        (&json!("encounter"), &json!("port_tax_clerk"), &json!("照他估的数补税。"))
    );
    assert!(last["reply"].as_str().unwrap().contains("收条"));
    let outcomes = last["outcomes"].as_array().unwrap();
    assert_eq!(outcomes[0], json!({"kind":"cash","value":-120}));
    assert_eq!((&outcomes[1]["kind"], outcomes[1]["value"].as_i64().unwrap() > 0), (&json!("reputation"), true));
    assert_eq!(w.agent(PLAYER).unwrap().cash, cash - 120);
    // 故事面板里记下了这一件。
    assert_eq!(s["journal"].as_array().unwrap().last().unwrap()["title"], "验货的税吏");
}

#[test]
fn a_choice_that_needs_cargo_is_blocked_until_the_hold_has_it() {
    let mut w = sea_world();
    meet(&mut w, "sea_green_water");
    let choices = story(&w)["pending"]["choices"].as_array().unwrap().clone();
    assert_eq!(choices.len(), 3);
    // 第三项要交两桶酒：舱里没有，挡住；另两项不花钱不交货，照样能选。
    assert_eq!(choices[2]["blocked"], "cargo");
    assert!(choices[2]["give"].is_array());
    assert!(choices[0]["blocked"].is_null() && choices[1]["blocked"].is_null());
    assert!(Command::StoryAnswer { owner: PLAYER, choice: 2 }.validate(&w).is_err());
    let wine = w.defs.find_good("wine").unwrap();
    let fleet = w.flagship(PLAYER).unwrap();
    w.state.fleets.get_mut(&fleet).unwrap().cargo.insert(wine, 2);
    assert!(story(&w)["pending"]["choices"][2]["blocked"].is_null());
    Command::StoryAnswer { owner: PLAYER, choice: 2 }.apply(&mut w).unwrap();
    let last = story(&w)["last"].clone();
    assert_eq!(last["outcomes"][0], json!({"kind":"goods","value":-2,"good":wine.0}));
    assert!(!w.fleet(fleet).unwrap().cargo.contains_key(&wine));
}

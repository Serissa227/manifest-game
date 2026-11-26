//! U03：二十一家（九位主角、十二种自创出身）从开局跑到结业的整局测试。
//!
//! 跑法见 `support/u03.rs`：月程由测试自己排，待回应一律选第一个能选的选项。
#[path = "support/u03.rs"]
mod u03;
use std::collections::BTreeSet;
use u03::*;

fn check_common(r: &Report) {
    eprintln!("{}", summary(r));
    assert!(r.locked.is_empty(), "{}：出现了没有可选选项的待回应章节 {:?}", r.family, r.locked);
    assert!(r.errors.is_empty(), "{}：{:?}", r.family, r.errors);
    assert!(r.graduated, "{}：没有跑到结业，停在 {:?}", r.family, r.end);
    let d = defs();
    let c11 = r.seen.iter().filter(|s| d.story2.track(&s.track).is_some_and(|t| !t.academy)).collect::<Vec<_>>();
    assert!(c11.is_empty(), "{}：养成期出现了非养成轨道 {:?}", r.family, c11.iter().take(5).collect::<Vec<_>>());
}

/// 九位主角另查写好事件的出场（U03 / A5）：家人羁绊、家庭节庆、生日各自有到期的事件；第一次远足出现过（A3）。
fn check_hero(r: &Report) {
    for part in ["family_bond", "festival", "birthday"] {
        let (_, due) = coverage(r, part);
        assert!(due > 0, "{}：{part} 没有到期的事件", r.family);
    }
    let first = r.seen.iter().any(|s| {
        s.track.starts_with(&format!("c9_{}_", r.family))
            && (s.track.ends_with("first_outing") || s.track.ends_with("outing_first"))
    });
    assert!(first, "{}：第一次远足没有出现", r.family);
}

/// 澪（A4）：四位同窗在 1554–1556 年至少各出现 C 级两段（c1、c2）；冷泉雪在“每月一次同行”下走到 A。
fn check_mio_bonds(r: &Report) {
    let d = defs();
    let (from, to) = (day_of(&d, [1554, 1, 1]), day_of(&d, [1556, 12, 31]));
    for person in ["ushio", "reizei_yuki", "kikuchiyo", "kogo"] {
        let track = format!("bond_{person}");
        let c_level: BTreeSet<&str> = r
            .seen
            .iter()
            .filter(|s| s.track == track && (from..=to).contains(&s.day) && s.chapter.starts_with('c'))
            .map(|s| s.chapter.as_str())
            .collect();
        assert!(c_level.len() >= 2, "澪与 {person} 的 C 级只出现了 {c_level:?}");
    }
    let yuki = r.bonds.get("reizei_yuki");
    assert!(
        yuki.is_some_and(|b| b.3.is_some_and(|level| level >= manifest_core::cast::relations::Bond::A)),
        "冷泉雪没有走到 A：{yuki:?}"
    );
}

macro_rules! family_runs {
    ($($name:ident => $key:literal $(+ $extra:ident)*),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                let r = run($key);
                check_common(&r);
                $($extra(&r);)*
            }
        )*
    };
}

family_runs! {
    run_baraka => "baraka" + check_hero,
    run_ix_nikte => "ix_nikte" + check_hero,
    run_kaicili => "kaicili" + check_hero,
    run_lieve => "lieve" + check_hero,
    run_lin_wandeng => "lin_wandeng" + check_hero,
    run_mio => "mio" + check_hero + check_mio_bonds,
    run_najma => "najma" + check_hero,
    run_noel => "noel" + check_hero,
    run_tariq => "tariq" + check_hero,
    run_custom_basque_whaling => "custom_basque_whaling",
    run_custom_busan_interpreter => "custom_busan_interpreter",
    run_custom_cambay_broker => "custom_cambay_broker",
    run_custom_chincha_rafts => "custom_chincha_rafts",
    run_custom_fez_scholar => "custom_fez_scholar",
    run_custom_istanbul_shipyard => "custom_istanbul_shipyard",
    run_custom_lisbon_medicine => "custom_lisbon_medicine",
    run_custom_lubeck_accounts => "custom_lubeck_accounts",
    run_custom_murano_glass => "custom_murano_glass",
    run_custom_naha_envoy => "custom_naha_envoy",
    run_custom_seville_pilot => "custom_seville_pilot",
    run_custom_tondo_datu => "custom_tondo_datu",
}

#[test]
fn every_family_has_a_run() {
    let d = defs();
    let keys: BTreeSet<&str> = d.upbringing.families.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys.len(), 21, "{keys:?}");
}

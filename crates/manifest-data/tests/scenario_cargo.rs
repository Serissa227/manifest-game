//! 剧本的开局货物与粮水（data/scenarios/）：
//! “新大陆开拓者”的货舱里备好建立殖民地与第一座农庄、伐木场的物资和粮水，并且装得下；
//! 旧剧本不写这些字段；故意损坏的样例（商品不存在、数量不为正、商品重复、超出舱位、粮水为负）被拒绝并给出可读错误。

use std::path::{Path, PathBuf};

const COLONIST: &str = "scenarios/04_colonist.toml";

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 复制一份 data/，对某个文件做替换，返回临时目录。
fn corrupted(rel: &str, from: &str, to: &str) -> tempfile::TempDir {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = rel.split('/').fold(tmp.path().to_path_buf(), |p, part| p.join(part));
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains(from), "样例替换目标“{from}”不在 {rel} 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    tmp
}

#[test]
fn colonist_scenario_carries_what_the_first_colony_needs() {
    let defs = manifest_data::load(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    let id = defs.find_scenario("colonist").expect("新大陆开拓者剧本");
    let s = &defs.scenarios[id.idx()];
    let have = |g| s.cargo.iter().filter(|(k, _)| *k == g).map(|(_, q)| *q).sum::<i64>();
    let need = |key: &str| {
        let b = defs.find_colony_building(key).unwrap_or_else(|| panic!("殖民地建筑 {key}"));
        defs.colony_building(b).materials.clone()
    };
    // 建立物资须全部在船上；建立时消耗掉一部分，其余卸入殖民地仓库，
    // 连同船上剩下的，要够农庄与伐木场的建材——都不必另行采购
    let rules = &defs.rules.colony;
    for (g, q) in &rules.found_materials {
        assert!(have(*g) >= *q, "建立殖民地需要 {} {q} 件，开局只有 {}", defs.good(*g).key, have(*g));
    }
    let consumed = |g| {
        rules.found_materials.iter().filter(|(k, _)| *k == g).map(|(_, q)| rules.found_consume.apply(*q)).sum::<i64>()
    };
    let mut builds: Vec<(manifest_core::GoodId, i64)> = Vec::new();
    for (g, q) in need("farm").iter().chain(need("lumber").iter()) {
        match builds.iter_mut().find(|(k, _)| k == g) {
            Some((_, n)) => *n += q,
            None => builds.push((*g, *q)),
        }
    }
    for (g, q) in &builds {
        let left = have(*g) - consumed(*g);
        assert!(left >= *q, "建立殖民地后 {} 还剩 {left} 件，农庄与伐木场需要 {q}", defs.good(*g).key);
    }
    // 粮水够全体船员跑一周以上，货物与粮水装得下，殖民者与驾船的船员都够
    let per = defs.rules.crew_per_supply_unit.max(1);
    let daily = (s.crew + per - 1) / per;
    assert!(s.food >= daily * 7 && s.water >= daily * 7, "开局粮水 {} / {}，每天需要 {daily}", s.food, s.water);
    let hold: i64 = s.ships.iter().map(|k| defs.ship(*k).capacity).sum();
    let loaded: i64 = s.cargo.iter().map(|(_, q)| q).sum::<i64>() + s.food + s.water;
    assert!(loaded <= hold, "开局货物与粮水 {loaded} 超过舱位 {hold}");
    let crew_min: i64 = s.ships.iter().map(|k| defs.ship(*k).crew_min).sum();
    assert!(s.crew - crew_min >= rules.min_settlers, "留足驾船的船员后仍有足够的殖民者");
    // 旧剧本不写开局货物与粮水
    for key in ["newcomer", "heir", "sandbox"] {
        let s = &defs.scenarios[defs.find_scenario(key).unwrap().idx()];
        assert!(s.cargo.is_empty() && s.food == 0 && s.water == 0, "剧本 {key} 不应有开局货物与粮水");
    }
}

#[test]
fn corrupted_opening_cargo_is_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &[&str])] = &[
        // 商品不存在
        (
            "{ good = \"ironware\", qty = 10 }",
            "{ good = \"moonsilk\", qty = 10 }",
            &["04_colonist.toml", "scenario[colonist]", "moonsilk"],
        ),
        // 数量必须为正
        (
            "{ good = \"ironware\", qty = 10 }",
            "{ good = \"ironware\", qty = 0 }",
            &["scenario[colonist]", "数量必须大于 0"],
        ),
        // 同一商品不能重复
        ("{ good = \"ironware\", qty = 10 }", "{ good = \"timber\", qty = 10 }", &["scenario[colonist]", "重复"]),
        // 货物与粮水合计超出舰队舱位
        ("{ good = \"timber\", qty = 70 }", "{ good = \"timber\", qty = 700 }", &["scenario[colonist]", "舱位"]),
        // 粮水不能为负
        ("food = 80", "food = -5", &["scenario[colonist]", "food"]),
        // 未知字段
        ("water = 80", "water = 80\nrum = 3", &["04_colonist.toml", "rum"]),
    ];
    for (from, to, needles) in cases {
        let tmp = corrupted(COLONIST, from, to);
        let msg = match manifest_data::load(tmp.path()) {
            Ok(_) => panic!("损坏的数据（{COLONIST}：{from} → {to}）应被拒绝"),
            Err(e) => e.to_string(),
        };
        for needle in *needles {
            assert!(msg.contains(needle), "错误信息应包含“{needle}”：\n{msg}");
        }
    }
}

#[test]
fn scenario_without_cargo_fields_still_loads() {
    // 去掉开局货物与粮水三个字段：剧本照常加载，货舱为空
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = tmp.path().join("scenarios").join("04_colonist.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    let start = text.find("cargo = [").expect("cargo 字段");
    let end = text.find("[reputation]").expect("reputation 表");
    std::fs::write(&path, format!("{}{}", &text[..start], &text[end..])).unwrap();
    let defs = manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("{e}"));
    let s = &defs.scenarios[defs.find_scenario("colonist").unwrap().idx()];
    assert!(s.cargo.is_empty());
    assert_eq!((s.food, s.water), (0, 0));
}

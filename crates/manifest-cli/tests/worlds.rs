//! 命令行多世界入口：经典缺省、隐藏包及损坏包的退出码。

use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

fn data() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_manifest-cli")).arg("--data").arg(root).args(args).output().unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

fn stable_output(output: &Output) -> String {
    // 耗时由真实时钟测量，不属于命令的确定性输出。
    stdout(output)
        .lines()
        .filter(|line| !line.starts_with("10 年模拟（单线程）耗时"))
        .map(|line| line.split_once("耗时 ").map_or(line, |(before, _)| before))
        .collect::<Vec<_>>()
        .join("\n")
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.path().is_dir() {
            copy(&entry.path(), &to.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "manifest-cli-worlds-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn copy_data(&self) {
        copy(&data(), &self.0);
    }

    /// 寰宇 2026-11-02 转为成品世界；草稿检查的测试把数据复制一份、把寰宇恢复成草稿（hidden + draft）当夹具。
    fn copy_data_with_draft_terra16(&self) {
        self.copy_data();
        let path = self.0.join("worlds/terra16/world.toml");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\nhidden = false\n"), "寰宇清单的写法变了，夹具要跟着改");
        let text = text.replacen("\nhidden = false\n", "\nhidden = true\ndraft = true\n", 1);
        // FIX8 的立绘被剧情真实引用；保留原目录，按正式加载器的 figures 逻辑表登记。
        let text = text.replace("[tables]\n", "[tables]\nfigures = [\"cast/figures.toml\"]\n");
        std::fs::write(path, text).unwrap();
        // 后端显示文字表是转为成品世界时才加的，草稿时期没有。
        std::fs::remove_file(self.0.join("worlds/terra16/texts.toml")).unwrap();
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn classic_default_simulate_and_replay_match_explicit_world() {
    for args in [
        vec!["simulate", "--seed", "42", "--days", "30", "--ai", "mock"],
        vec!["replay-check", "--seed", "7", "--days", "30", "--ai", "mock"],
    ] {
        let implicit = cli(&data(), &args);
        let mut explicit_args = args;
        explicit_args.extend(["--world", "classic"]);
        let explicit = cli(&data(), &explicit_args);
        assert!(implicit.status.success(), "{implicit:?}");
        assert_eq!(implicit.status.code(), explicit.status.code());
        assert_eq!(implicit.stderr, explicit.stderr);
        assert_eq!(stable_output(&implicit), stable_output(&explicit));
    }
}

#[test]
fn classic_default_balance_matches_explicit_world_and_report() {
    let temp = Scratch::new();
    let report = temp.0.join("balance.md");
    let args = ["balance", "--seeds", "1", "--years", "1", "--threads", "1", "--out", report.to_str().unwrap()];
    let implicit = cli(&data(), &args);
    let before = std::fs::read(&report).unwrap();
    let mut args = args.to_vec();
    args.extend(["--world", "classic"]);
    let explicit = cli(&data(), &args);
    assert_eq!(implicit.status.code(), explicit.status.code());
    assert_eq!(implicit.stderr, explicit.stderr);
    assert_eq!(stable_output(&implicit), stable_output(&explicit));
    assert_eq!(before, std::fs::read(&report).unwrap());
    assert!(stdout(&implicit).contains("4 局模拟完成"));
}

#[test]
fn validation_includes_hidden_testbed_and_retains_classic_output() {
    let classic = cli(&data(), &["validate-data", "--world", "classic"]);
    let all = cli(&data(), &["validate-data"]);
    let hidden = cli(&data(), &["validate-data", "--world", "testbed"]);
    for output in [&classic, &all, &hidden] {
        assert!(output.status.success(), "{output:?}");
    }
    assert!(stdout(&all).starts_with(&stdout(&classic)));
    assert!(stdout(&all).contains("校验世界：testbed"));
    assert!(stdout(&all).contains("校验世界：terra16"));
    // 寰宇 2026-11-02 转为成品世界，按完整世界校验；仓库里不再有草稿世界。
    assert!(stdout(&all).contains("数据校验通过：港口 194、内陆城市 46"));
    assert!(!stdout(&all).contains("草稿数据校验通过"));
    assert!(stdout(&hidden).contains("地图 120×60"));
    assert!(stdout(&hidden).contains("数据校验通过："));
    assert!(manifest_data::list_worlds(&data()).unwrap().iter().all(|w| w.key != "testbed"));
}

#[test]
fn testbed_simulates_and_replays_with_its_own_scenario() {
    for command in ["simulate", "replay-check"] {
        let output = cli(&data(), &[command, "--world", "testbed", "--days", "30", "--ai", "mock"]);
        assert!(output.status.success(), "{output:?}");
        if command == "simulate" {
            assert!(stdout(&output).contains("测试航行"));
        } else {
            assert!(stdout(&output).contains("重放一致："));
        }
    }
}

#[test]
fn corrupt_and_unknown_worlds_fail_without_poisoning_classic() {
    let temp = Scratch::new();
    temp.copy_data();
    std::fs::write(temp.0.join("worlds/testbed/ports.toml"), "这不是 TOML").unwrap();
    for args in [vec!["validate-data"], vec!["validate-data", "--world", "testbed"]] {
        let output = cli(&temp.0, &args);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("testbed"));
    }
    assert!(cli(&temp.0, &["validate-data", "--world", "classic"]).status.success());
    for command in ["validate-data", "simulate", "replay-check", "balance"] {
        let output = cli(&temp.0, &[command, "--world", "missing"]);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("未知世界"));
    }
}

#[test]
fn malformed_hidden_manifest_and_world_ai_override_are_rejected() {
    let temp = Scratch::new();
    temp.copy_data();
    let prompts = temp.0.join("worlds/testbed/prompts");
    std::fs::create_dir_all(&prompts).unwrap();
    std::fs::write(prompts.join("director.toml"), "broken = true").unwrap();
    assert!(!cli(&temp.0, &["validate-data", "--world", "testbed"]).status.success());
    assert!(cli(&temp.0, &["validate-data", "--world", "classic"]).status.success());
    std::fs::write(temp.0.join("worlds/testbed/world.toml"), "损坏清单").unwrap();
    assert!(!cli(&temp.0, &["validate-data"]).status.success());
}

#[test]
fn balance_uses_the_selected_world_and_keeps_classic_report_separate() {
    let temp = Scratch::new();
    let root = temp.0.join("data");
    copy(&data(), &root);
    let docs = temp.0.join("docs");
    std::fs::create_dir(&docs).unwrap();
    std::fs::write(docs.join("BALANCE.md"), "经典报告不能被覆盖").unwrap();
    let output = cli(&root, &["balance", "--world", "testbed", "--seeds", "1", "--years", "1", "--threads", "1"]);
    // 测试海域不要求达到经典平衡阈值；必须实际跑完四种 bot 并按所选世界出报告。
    assert!(stdout(&output).contains("4 局模拟完成"), "{output:?}");
    assert!(docs.join("BALANCE-testbed.md").is_file());
    assert_eq!(std::fs::read_to_string(docs.join("BALANCE.md")).unwrap(), "经典报告不能被覆盖");
}

#[test]
fn draft_validation_reports_pending_references_and_guards_incomplete_drafts() {
    // 真实的寰宇已是成品世界：按完整世界校验通过，进入开局列表。
    let complete = cli(&data(), &["--world", "terra16", "validate-data"]);
    assert!(complete.status.success(), "{complete:?}");
    assert!(stdout(&complete).lines().any(|line| line.starts_with("数据校验通过：港口 194")));
    assert!(manifest_data::list_worlds(&data()).unwrap().iter().any(|w| w.key == "terra16"));
    // 草稿检查本身用恢复成草稿的寰宇副本。
    let drafts = Scratch::new();
    drafts.copy_data_with_draft_terra16();
    let output = cli(&drafts.0, &["--world", "terra16", "validate-data"]);
    assert!(output.status.success(), "{output:?}");
    let text = stdout(&output);
    // 养成内容（2026-11-03）：九份 <主角>_growth.toml 与七份 <主角>_growth_persons.toml（828 → 844）。
    // 合并 G01 的三份商品、一份配方、一份工坊：再加 5 份。
    // U02 工作包 4 的战斗练习 upbringing/common_practices.toml 登记进清单：再加 1 份（849 → 850）。
    // 2026-11-04：U04 两份数据、低谷场景、比赛奖品与三份改投学院的事件（850 → 857）。
    // 2026-11-11：S01 的两份奇遇（+2）、I01 的九个新物品分片（+9）、I03 的船只改装（+1）、
    // H04 的海上所见 voyage/sightings.toml（+1）：857 → 870（与 data 的 worlds.rs、terra16_fragments.rs 同步）；
    // H08 的甲板闲话 voyage/banter.toml（+1）= 871；G02 交易品扩充的商品分片与来源配方分片（+2）= 873。
    // 第九批 P13 统一验证合入后实测 873。
    // H02（2026-11-11）：船员情绪三阶段 stories/voyage_crew.toml 登记（+1）= 874（最后一轮全量实测，2026-11-12）。
    // TCLEAN4：草稿重数 890，CLI 完整加载夹具另保留 FIX8 立绘目录一份。
    // 公开版拿掉两个人物以后少 17 片：891 → 874。
    assert!(text.contains("草稿数据校验通过：terra16；分片 874"), "{text}");
    assert!(!text.contains("Unresolved factions:"));
    assert!(text.contains("Unresolved event data:") && text.contains("H13"));
    // request_charles_v 已由 C13 交付、C11 的八条关系线已由 C11 收尾交付（2026-11-01）；仍未解析的轨道是自由船长模板的 main_track。
    assert!(text.contains("Unresolved tracks:") && text.contains("free_captain"));
    assert!(!text.contains("Unresolved market_entries:"));
    assert!(text.contains("草稿仅校验资源，不可开局"));
    assert!(!text.lines().any(|line| line.starts_with("数据校验通过：")));
    assert!(manifest_data::list_worlds(&drafts.0).unwrap().iter().all(|w| w.key != "terra16"));
    // B10b 允许完整草稿显式加载；公共 AI 文案未登记时用 off，不能借用经典人物文本。
    for command in ["simulate", "replay-check"] {
        let output = cli(&drafts.0, &[command, "--world", "terra16", "--days", "1", "--ai", "off"]);
        assert!(output.status.success(), "{output:?}");
        let expected = if command == "simulate" { "模拟结束：" } else { "重放一致：" };
        assert!(stdout(&output).contains(expected));
    }
    // 保留三种入口对不完整草稿的负例，夹具恢复 B10b 补齐前缺少基础配置的状态。
    let temp = Scratch::new();
    temp.copy_data_with_draft_terra16();
    std::fs::remove_file(temp.0.join("worlds/terra16/rules.toml")).unwrap();
    for command in ["simulate", "replay-check", "balance"] {
        let output = cli(&temp.0, &[command, "--world", "terra16"]);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("草稿世界"));
    }
}

#[test]
fn invalid_draft_data_fails_explicit_and_all_world_validation() {
    let temp = Scratch::new();
    temp.copy_data_with_draft_terra16();
    let path = temp.0.join("worlds/terra16/ports_iberia.toml");
    let text = std::fs::read_to_string(&path).unwrap();
    std::fs::write(path, text.replacen("[[ports]]", "[[ports]]\nmisspelled = true", 1)).unwrap();
    for args in [vec!["validate-data", "--world", "terra16"], vec!["validate-data"]] {
        let output = cli(&temp.0, &args);
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("misspelled"));
        assert!(!stdout(&output).contains("草稿数据校验通过：terra16"));
    }
    let testbed = cli(&temp.0, &["validate-data", "--world", "testbed"]);
    assert!(testbed.status.success(), "{testbed:?}");
}

#[test]
fn unconsumed_draft_fragments_fail_explicit_and_all_world_validation() {
    for (table, fragment) in [("overseas", "junk.toml")] {
        let temp = Scratch::new();
        temp.copy_data_with_draft_terra16();
        let base = temp.0.join("worlds/terra16");
        let path = base.join("world.toml");
        let text = std::fs::read_to_string(&path)
            .unwrap()
            .replace("[tables]", &format!("[tables]\n{table} = [\"{fragment}\"]"));
        std::fs::write(path, text).unwrap();
        std::fs::write(base.join(fragment), "[[unknown_table]]\nkey='junk'\n").unwrap();
        for args in [vec!["validate-data", "--world", "terra16"], vec!["validate-data"]] {
            let output = cli(&temp.0, &args);
            let error = String::from_utf8_lossy(&output.stderr);
            assert!(!output.status.success(), "漏检了 {fragment}");
            assert!(error.contains(fragment) && error.contains("未被消费"), "{error}");
            assert!(!stdout(&output).contains("草稿数据校验通过：terra16"));
        }
    }
}

#[test]
fn chinese_only_drafts_allow_missing_overlays_but_reject_invalid_existing_fields() {
    let temp = Scratch::new();
    temp.copy_data_with_draft_terra16();
    let base = temp.0.join("worlds/terra16");
    std::fs::remove_file(base.join("locales/en/cities.toml")).unwrap();
    for args in [vec!["validate-data", "--world", "terra16"], vec!["validate-data"]] {
        let output = cli(&temp.0, &args);
        assert!(output.status.success(), "{output:?}");
        // 真实寰宇本来就有 372 片仅中文分片（原有 18 片、C13 整合 307 片、C11 收尾 4 片、亚特兰蒂斯补章 10 片、A10 的 AI 提示词与离线模板 33 片，见 tests/languages.rs），删掉英文的 cities 再加 1 片。
        // 原来写的“：1”是子串匹配，有 18 片仅中文分片时碰巧对上“：19”；C13 整合以后对不上，这里按数据写成精确值（2026-11-01）。
        // 转为成品世界（2026-11-02）时删掉 4 个只有注释的英文覆盖，这 4 片从此只有中文：373 + 4 = 377。
        // 养成内容（2026-11-03）：16 份只写中文的 _growth / _growth_persons 新分片，加整份删掉的 5 份英文占位覆盖（377 → 398）。
        // 合并 G01 的三份商品、一份配方、一份工坊：再加 5 份。
        // U02 工作包 4 的战斗练习 upbringing/common_practices.toml 只写中文，登记进清单：再加 1 份（403 → 404）。
        // 2026-11-04：再加 7 份只写中文的新分片（U04 两份、低谷场景、比赛奖品、三份改投学院的事件）：404 → 411。
        // 2026-11-11：S01 的两份奇遇（+2）、I01 的九个新物品分片（+9）、I03 的 ships/09_refits.toml（+1）、
        // H04 的 voyage/sightings.toml（+1）都只写中文：411 → 424（与 tests/languages.rs 同步）；
        // H08 的 voyage/banter.toml（+1）= 425；G02 交易品扩充的商品分片与来源配方分片（+2）= 427。
        // 第九批 P13 统一验证合入后实测 427。
        // H02（2026-11-11）：stories/voyage_crew.toml 只写中文（+1）= 428（最后一轮全量实测，2026-11-12）。
        // TCLEAN4：主线重数 444；CLI 夹具保留只写中文的 FIX8 立绘目录，再加一份。
        // 公开版拿掉两个人物以后少 7 片：445 → 438。
        assert!(stdout(&output).contains("仅中文的分片数：438\n"), "{}", stdout(&output));
    }
    for command in ["simulate", "replay-check"] {
        let output = cli(&temp.0, &[command, "--world", "terra16", "--days", "1", "--ai", "off"]);
        assert!(output.status.success(), "{output:?}");
    }
    std::fs::write(base.join("locales/en/cities.toml"), "[cities]\n").unwrap();
    let partial = cli(&temp.0, &["validate-data", "--world", "terra16"]);
    assert!(partial.status.success(), "{partial:?}");
    std::fs::write(base.join("locales/en/cities.toml"), "[cities.unknown]\nname='Unknown'\n").unwrap();
    let output = cli(&temp.0, &["validate-data", "--world", "terra16"]);
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("cities"));
}

#[test]
fn bilingual_classic_and_draft_validation_warns_about_missing_english_files() {
    let temp = Scratch::new();
    temp.copy_data();
    let base = temp.0.join("worlds/bilingual");
    std::fs::create_dir_all(base.join("locales/en")).unwrap();
    std::fs::write(base.join("world.toml"), "key='bilingual'\nname='测试'\nmap='missing'\ndraft=true\nlanguages=['zh','en']\n[tables]\npast=['past.toml']\n").unwrap();
    std::fs::write(
        base.join("past.toml"),
        "[[past]]\nkey='memory'\nname='往事'\nlore='测试往事。'\nsources=['测试']\n",
    )
    .unwrap();
    std::fs::write(base.join("locales/en/past.toml"), "[past.memory]\nname='Memory'\nlore='Test memory.'\n").unwrap();
    let valid = cli(&temp.0, &["validate-data", "--world", "bilingual"]);
    assert!(valid.status.success(), "{valid:?}");
    for (world, file, message) in [
        ("bilingual", "worlds/bilingual/locales/en/past.toml", "past.toml"),
        ("classic", "locales/en/goods.toml", "缺失"),
    ] {
        let original = std::fs::read_to_string(temp.0.join(file)).unwrap();
        std::fs::remove_file(temp.0.join(file)).unwrap();
        let output = cli(&temp.0, &["validate-data", "--world", world]);
        assert!(output.status.success(), "{world}: {output:?}");
        assert!(stdout(&output).contains("语言覆盖（en）校验通过：缺失"), "{world}: {output:?}");
        assert!(!stdout(&output).contains("缺失 0 条"), "{world}: {message}");
        std::fs::write(temp.0.join(file), original).unwrap();
    }
}

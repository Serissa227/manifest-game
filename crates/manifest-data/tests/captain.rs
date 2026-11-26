//! 第八批 E2：主角身世的数据（data/captain.toml 与英文覆盖）通过校验；故意写错的属性、星座（日期区间重叠、日子不存在、
//! 缺首日、个数不对、旧版星宫写了首日）、问题、选项、开局效果与点数规则（含年龄）会被拒绝并给出可读错误；
//! 删掉 captain.toml 时开局不设身世。

use manifest_core::captain::{ATTRIBUTES, StartEffect};
use manifest_data::Locale;
use std::path::{Path, PathBuf};

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

/// 复制一份 data/，对 captain.toml 做一次替换后加载，返回错误文本。
fn corrupt(from: &str, to: &str) -> String {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    let path = tmp.path().join("captain.toml");
    let text = std::fs::read_to_string(&path).unwrap().replace("\r\n", "\n");
    assert!(text.contains(from), "样例替换目标“{from}”不在 captain.toml 中");
    std::fs::write(&path, text.replacen(from, to, 1)).unwrap();
    match manifest_data::load(tmp.path()) {
        Ok(_) => panic!("损坏的数据（captain.toml：{from} → {to}）应被拒绝"),
        Err(e) => e.to_string(),
    }
}

#[test]
fn real_captain_data_passes_validation() {
    let defs = manifest_data::load(&data_dir()).unwrap_or_else(|e| panic!("{e}"));
    let c = &defs.captain;
    assert!(c.enabled());
    let keys: Vec<&str> = c.attributes.iter().map(|a| a.key.as_str()).collect();
    assert_eq!(keys, ATTRIBUTES);
    // 旧版星宫：原来的十二个都还在（旧存档按 key 记着），不参与按生日判定
    let legacy: Vec<&str> = c.signs.iter().filter(|s| s.is_legacy()).map(|s| s.key.as_str()).collect();
    assert_eq!(
        legacy,
        [
            "petrel",
            "quill",
            "anchor",
            "compass",
            "purse",
            "cutlass",
            "astrolabe",
            "merchantman",
            "hive",
            "horn",
            "lighthouse",
            "lantern"
        ]
    );
    assert_eq!(c.sign("lantern").map(|s| s.name.as_str()), Some("提灯座"));
    // 现行的十二星座：按现实的日期划分（首日、末日、中文名、加点），摩羯座跨年
    let zodiac = [
        ("aquarius", "水瓶座", (1, 20), (2, 18), "numeracy"),
        ("pisces", "双鱼座", (2, 19), (3, 20), "seamanship"),
        ("aries", "白羊座", (3, 21), (4, 19), "arms"),
        ("taurus", "金牛座", (4, 20), (5, 20), "commerce"),
        ("gemini", "双子座", (5, 21), (6, 21), "eloquence"),
        ("cancer", "巨蟹座", (6, 22), (7, 22), "stewardship"),
        ("leo", "狮子座", (7, 23), (8, 22), "eloquence"),
        ("virgo", "处女座", (8, 23), (9, 22), "numeracy"),
        ("libra", "天秤座", (9, 23), (10, 23), "commerce"),
        ("scorpio", "天蝎座", (10, 24), (11, 22), "arms"),
        ("sagittarius", "射手座", (11, 23), (12, 21), "seamanship"),
        ("capricorn", "摩羯座", (12, 22), (1, 19), "stewardship"),
    ];
    let spans: Vec<_> = c
        .zodiac_spans()
        .iter()
        .map(|(s, x)| {
            (
                s.key.as_str(),
                s.name.as_str(),
                (x.first.month, x.first.day),
                (x.last.month, x.last.day),
                ATTRIBUTES[s.attribute],
            )
        })
        .collect();
    assert_eq!(spans, zodiac);
    assert_eq!(c.zodiac_spans().iter().map(|(_, x)| x.days).sum::<u32>(), 360);
    // 每项属性恰好两个星座
    for a in ATTRIBUTES {
        assert_eq!(zodiac.iter().filter(|z| z.4 == a).count(), 2, "{a}");
    }
    // 边界：2 月 18 日水瓶座、2 月 19 日双鱼座；摩羯座跨年
    let at = |m: u32, d: u32| c.sign_of(m, d).map(|s| s.key.as_str());
    assert_eq!((at(2, 18), at(2, 19)), (Some("aquarius"), Some("pisces")));
    assert_eq!(
        (at(12, 21), at(12, 22), at(1, 1), at(1, 19), at(1, 20)),
        (Some("sagittarius"), Some("capricorn"), Some("capricorn"), Some("capricorn"), Some("aquarius"))
    );
    // 开局年龄 16–45，向导里缺省 18 岁
    assert_eq!((c.points.age_min, c.points.age_max, c.points.age_default), (16, 45, 18));
    // 身世五问，每问至少五个选项
    assert_eq!(c.questions.len(), 5);
    for (qi, q) in c.questions.iter().enumerate() {
        let n = c.options.iter().filter(|o| o.question == qi).count();
        assert!(n >= 5, "{} 只有 {n} 个选项", q.key);
    }
    // 每个选项加 1–3 点；八种开局效果都有选项用到
    for o in &c.options {
        let sum: i64 = o.attrs.iter().sum();
        assert!((1..=3).contains(&sum), "{} 加了 {sum} 点", o.key);
    }
    let kinds: std::collections::BTreeSet<&str> = c
        .options
        .iter()
        .filter_map(|o| o.effect.as_ref())
        .map(|e| match e {
            StartEffect::CashPct(_) => "cash_pct",
            StartEffect::Reputation(_) => "reputation",
            StartEffect::Fame(_) => "fame",
            StartEffect::Morale(_) => "morale",
            StartEffect::Chart(_) => "chart",
            StartEffect::Rumor => "rumor",
            StartEffect::Goods(..) => "goods",
            StartEffect::Loan { .. } => "loan",
        })
        .collect();
    assert_eq!(kinds.len(), 8, "{kinds:?}");
    // 点数规则：开局算学 7 即奇才，4 起手调参数，5 起能跟奇才学
    let p = &c.points;
    assert_eq!((p.base, p.free, p.creation_cap, p.max), (1, 5, 7, 10));
    assert_eq!((p.genius_numeracy, p.manual_numeracy, p.learn_numeracy, p.learn_days), (7, 4, 5, 360));
    // 算学奇才的路子：身世最多能给算学 2 + 1 + 2 + 1 = 6 点（家世、童年、少年、成年），加上起点与星宫就到开局上限
    let most_numeracy: i64 = (0..c.questions.len())
        .map(|qi| c.options.iter().filter(|o| o.question == qi).map(|o| o.attrs[4]).max().unwrap_or(0))
        .sum();
    assert!(p.base + most_numeracy + 1 >= p.genius_numeracy, "身世与星宫足以让主角成为算学奇才");
}

#[test]
fn english_names_every_background_entry() {
    let en = manifest_data::load_locale_shared(&data_dir(), Locale::En).unwrap_or_else(|e| panic!("{e}"));
    let c = &en.defs.captain;
    let cjk = |s: &str| {
        s.chars().any(|ch| ('\u{3000}'..='\u{9fff}').contains(&ch) || ('\u{ff00}'..='\u{ffef}').contains(&ch))
    };
    for a in &c.attributes {
        assert!(!cjk(&a.name) && !cjk(&a.desc), "属性 {} 缺英文", a.key);
    }
    for s in &c.signs {
        assert!(!cjk(&s.name) && !cjk(&s.desc), "星座 {} 缺英文", s.key);
    }
    // 现行星座用标准的英文名；旧版星宫也有英文（旧存档照常显示）
    let names: Vec<&str> = c.zodiac_spans().iter().map(|(s, _)| s.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "Aquarius",
            "Pisces",
            "Aries",
            "Taurus",
            "Gemini",
            "Cancer",
            "Leo",
            "Virgo",
            "Libra",
            "Scorpio",
            "Sagittarius",
            "Capricorn"
        ]
    );
    for q in &c.questions {
        assert!(!cjk(&q.title) && !cjk(&q.prompt), "问题 {} 缺英文", q.key);
    }
    for o in &c.options {
        assert!(!cjk(&o.name) && !cjk(&o.text), "选项 {} 缺英文", o.key);
    }
    assert_eq!(c.signs.iter().find(|s| s.key == "lantern").map(|s| s.name.as_str()), Some("The Lantern"));
    // 数值与 key 不变（星座的首日与加点也一样）
    let zh = manifest_data::load(&data_dir()).unwrap();
    assert_eq!(c.points, zh.captain.points);
    assert_eq!(
        c.signs.iter().map(|s| (&s.key, s.start, s.attribute)).collect::<Vec<_>>(),
        zh.captain.signs.iter().map(|s| (&s.key, s.start, s.attribute)).collect::<Vec<_>>()
    );
    assert_eq!(
        c.options.iter().map(|o| (&o.key, &o.attrs)).collect::<Vec<_>>(),
        zh.captain.options.iter().map(|o| (&o.key, &o.attrs)).collect::<Vec<_>>()
    );
}

#[test]
fn corrupted_backgrounds_are_rejected_with_readable_errors() {
    let cases: &[(&str, &str, &[&str])] = &[
        // 属性：固定的六项，顺序不变
        ("key = \"seamanship\"", "key = \"sailing\"", &["captain.toml", "attributes", "属性须按顺序"]),
        // 星座：日期区间不能重叠（两个星座同一天开始）、首日须是航海历里的日子、现行星座要写首日且正好十二个、
        // 旧版星宫不能写首日、key 在现行星座与旧版星宫之间也不重复；属性认识、特性认识
        ("start = [4, 20]", "start = [3, 21]", &["captain.toml", "signs[aries]", "signs[taurus]", "重叠"]),
        ("start = [3, 21]", "start = [3, 31]", &["captain.toml", "signs[aries]", "[3, 31]", "航海历"]),
        ("start = [3, 21]", "start = [13, 1]", &["captain.toml", "signs[aries]", "[13, 1]", "航海历"]),
        ("start = [3, 21]", "start = [3]", &["captain.toml", "signs[aries]", "[月, 日]"]),
        ("start = [3, 21]", "", &["captain.toml", "signs[aries]", "缺少 start", "legacy = true"]),
        ("start = [3, 21]", "legacy = true", &["captain.toml", "signs", "须正好十二个", "11"]),
        (
            "attribute = \"eloquence\"\nlegacy = true",
            "attribute = \"eloquence\"\nlegacy = true\nstart = [1, 1]",
            &["captain.toml", "signs[petrel]", "旧版星宫", "start"],
        ),
        ("key = \"aries\"", "key = \"lantern\"", &["captain.toml", "signs[lantern]", "key 重复"]),
        ("attribute = \"eloquence\"", "attribute = \"charm\"", &["captain.toml", "signs[petrel]", "charm"]),
        // 选项：所属问题、key 唯一、属性认识、每项 0–3、合计不超过 3
        ("question = \"motive\"", "question = \"destiny\"", &["captain.toml", "options[family_debt]", "destiny"]),
        ("key = \"fortune\"", "key = \"freedom\"", &["captain.toml", "options[freedom]", "key 重复"]),
        (
            "attrs = { commerce = 2 }",
            "attrs = { charisma = 2 }",
            &["captain.toml", "options[merchant_house]", "charisma"],
        ),
        (
            "attrs = { numeracy = 2 }",
            "attrs = { numeracy = 4 }",
            &["captain.toml", "options[lighthouse_scribes]", "0 到 3"],
        ),
        (
            "attrs = { commerce = 2 }",
            "attrs = { commerce = 2, arms = 2 }",
            &["captain.toml", "options[merchant_house]", "合计不能超过 3"],
        ),
        // 开局效果：封闭集合、范围、引用
        // （文件头的注释里也有效果的写法，替换目标带上前一行，只改选项本身）
        (
            "attrs = { commerce = 2 }
effect = { kind = \"cash_pct\", value = 10 }",
            "attrs = { commerce = 2 }
effect = { kind = \"cash_pct\", value = 50 }",
            &["captain.toml", "options[merchant_house]", "effect.value = 50"],
        ),
        (
            "attrs = { commerce = 2 }
effect = { kind = \"cash_pct\", value = 10 }",
            "attrs = { commerce = 2 }
effect = { kind = \"gold\", value = 10 }",
            &["captain.toml", "options[merchant_house]", "未知的开局效果", "gold"],
        ),
        (
            "attrs = { seamanship = 1 }
effect = { kind = \"chart\", region = \"silvermist\" }",
            "attrs = { seamanship = 1 }
effect = { kind = \"chart\", region = \"atlantis\" }",
            &["captain.toml", "options[new_world]", "atlantis", "海区"],
        ),
        (
            "good = \"spice\", qty = 12 }",
            "good = \"spice\", qty = 400 }",
            &["captain.toml", "options[caravan_folk]", "货值"],
        ),
        (
            "attrs = { stewardship = 1 }
effect = { kind = \"loan\", amount = 8000",
            "attrs = { stewardship = 1 }
effect = { kind = \"loan\", amount = 90000",
            &["captain.toml", "options[family_debt]", "effect.amount"],
        ),
        (
            "attrs = { seamanship = 1 }
effect = { kind = \"rumor\" }",
            "attrs = { seamanship = 1 }
effect = { kind = \"chart\" }",
            &["captain.toml", "options[lost_relative]", "region"],
        ),
        // 点数规则
        ("creation_cap = 7 ", "creation_cap = 11 ", &["captain.toml", "points"]),
        ("free = 5 ", "free = 30 ", &["captain.toml", "points", "放不下"]),
        ("manual_numeracy = 4 ", "manual_numeracy = 40 ", &["captain.toml", "points", "manual_numeracy"]),
        ("age_min = 16 ", "age_min = 50 ", &["captain.toml", "points", "年龄"]),
        ("age_default = 18 ", "age_default = 15 ", &["captain.toml", "points", "age_default = 15", "16"]),
        ("age_default = 18 ", "age_default = 46 ", &["captain.toml", "points", "age_default = 46", "45"]),
        // 不认识的字段
        ("birthday_morale = 5 ", "birthday_morale = 5\nluck = 3 ", &["captain.toml", "luck"]),
    ];
    for (from, to, expect) in cases {
        let e = corrupt(from, to);
        for part in *expect {
            assert!(e.contains(part), "{from} → {to}：错误应提到“{part}”，实际：\n{e}");
        }
    }
}

#[test]
fn without_captain_toml_there_is_no_background() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    std::fs::remove_file(tmp.path().join("captain.toml")).unwrap();
    std::fs::remove_file(tmp.path().join("locales").join("en").join("captain.toml")).unwrap();
    let defs = manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("{e}"));
    assert!(!defs.captain.enabled());
}

//! 英文译文的文字规范（2026-09-26 译文评审）：`data/locales/en/` 下所有文字统一的写法。
//!
//! - 省略号用 “…”，不用三个半角句点；显示文字里的引号用弯引号 “…”（存档错误等技术信息除外）。
//! - 拼写一律美式（gray、harbor、councilor、traveler……），专名 “the grey fever” 除外。
//! - 离线模板里商品名 `{good}` 可能是复数（Pearls、Spices、Cigars），不能直接作单数动词的主语；
//!   冠词 a / an 不能直接放在参数前面（元音开头的名字会写成 “a Armed…”）。
//! - 航海士的英文小传要保留中文小传里的外貌线索（发色、盘发、眼罩、鬓边的花……）：英文界面下头像按英文小传绘制，
//!   丢了线索，切换语言后脸就会变。线索词与前端 `art/portraits.ts` 的英文线索表认得的说法一致。
//!
//! 以后新增或修改的英文译文同样受这些检查约束。

use std::path::{Path, PathBuf};

fn data_dir() -> PathBuf {
    manifest_data::find_data_dir().expect("找到 data/")
}

/// 英文覆盖目录下的全部 TOML 文件（相对 `data/locales/en/` 的路径，按路径排序）。
fn english_files() -> Vec<(String, PathBuf)> {
    fn walk(root: &Path, d: &Path, out: &mut Vec<(String, PathBuf)>) {
        for e in std::fs::read_dir(d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(root, &p, out);
            } else if p.extension().is_some_and(|x| x == "toml") {
                let rel = p
                    .strip_prefix(root)
                    .unwrap()
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push((rel, p));
            }
        }
    }
    let root = data_dir().join("locales").join("en");
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    out.sort();
    assert!(!out.is_empty(), "data/locales/en/ 下没有文件");
    out
}

/// 一段英文文字及其位置（“文件 键路径”）。
struct Text {
    at: String,
    file: String,
    text: String,
}

fn collect(v: &toml::Value, file: &str, path: &str, out: &mut Vec<Text>) {
    match v {
        toml::Value::String(s) => {
            out.push(Text { at: format!("{file} {path}"), file: file.to_string(), text: s.clone() })
        }
        toml::Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                collect(x, file, &format!("{path}[{i}]"), out);
            }
        }
        toml::Value::Table(t) => {
            for (k, x) in t {
                let p = if path.is_empty() { k.clone() } else { format!("{path}.{k}") };
                collect(x, file, &p, out);
            }
        }
        _ => {}
    }
}

/// 英文覆盖目录下的全部文字。
fn english_texts() -> Vec<Text> {
    let mut out = Vec::new();
    for (rel, path) in english_files() {
        let src = std::fs::read_to_string(&path).unwrap();
        let table: toml::Table = toml::from_str(&src).unwrap_or_else(|e| panic!("{rel}：{e}"));
        collect(&toml::Value::Table(table), &rel, "", &mut out);
    }
    out
}

/// 小写的英文单词（按非字母切分）。
fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_ascii_alphabetic()).filter(|w| !w.is_empty()).map(|w| w.to_ascii_lowercase()).collect()
}

#[test]
fn english_uses_typographic_ellipses_and_quotes() {
    let mut bad = Vec::new();
    for t in english_texts() {
        if t.text.contains("...") {
            bad.push(format!("{}：用 “…” 代替 “...”", t.at));
        }
        // 提示词是写给模型的说明，不直接显示；存档错误里的格式名是技术信息，保留直引号
        let technical = t.file.starts_with("prompts/") || t.at == "texts.toml save.not_manifest";
        if !technical && t.text.contains('"') {
            bad.push(format!("{}：显示文字里的引号用 “…”：{}", t.at, t.text));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn english_spelling_is_american() {
    // 英式拼写 → 美式；“the grey fever” 是术语表里的专名，保留
    const BRITISH: &[(&str, &str)] = &[
        ("grey", "gray"),
        ("greyish", "grayish"),
        ("greying", "graying"),
        ("colour", "color"),
        ("colours", "colors"),
        ("coloured", "colored"),
        ("harbour", "harbor"),
        ("harbours", "harbors"),
        ("rumour", "rumor"),
        ("rumours", "rumors"),
        ("favour", "favor"),
        ("favoured", "favored"),
        ("honour", "honor"),
        ("labour", "labor"),
        ("neighbour", "neighbor"),
        ("armour", "armor"),
        ("defence", "defense"),
        ("offence", "offense"),
        ("licence", "license"),
        ("jewellery", "jewelry"),
        ("councillor", "councilor"),
        ("councillors", "councilors"),
        ("counsellor", "counselor"),
        ("counsellors", "counselors"),
        ("traveller", "traveler"),
        ("travellers", "travelers"),
        ("travelled", "traveled"),
        ("travelling", "traveling"),
        ("centre", "center"),
        ("theatre", "theater"),
        ("metre", "meter"),
        ("mould", "mold"),
        ("plough", "plow"),
        ("whilst", "while"),
        ("amongst", "among"),
    ];
    let mut bad = Vec::new();
    for t in english_texts() {
        let text = t.text.replace("grey fever", "").replace("Grey Fever", "");
        for w in words(&text) {
            if let Some((_, us)) = BRITISH.iter().find(|(gb, _)| *gb == w) {
                bad.push(format!("{}：{w} → {us}", t.at));
            }
        }
    }
    assert!(bad.is_empty(), "英文拼写统一用美式：\n{}", bad.join("\n"));
}

#[test]
fn english_templates_agree_with_plural_names_and_articles() {
    // 单数动词（第三人称单数）：商品名可能是复数，{good} 后面不能直接跟它们
    const SINGULAR_VERBS: &[&str] = &[
        "is", "has", "was", "costs", "takes", "sells", "grows", "becomes", "goes", "comes", "remains", "seems",
        "looks", "yields", "stands", "lies", "fetches",
    ];
    // 名词前的定语：“the {good} harvest” 遇到复数名会写成 “the Potatoes harvest”，改用 “the harvest of {good}”
    const ADJUNCT_NOUNS: &[&str] = &[
        "harvest",
        "harvests",
        "crop",
        "crops",
        "blight",
        "trade",
        "price",
        "prices",
        "market",
        "markets",
        "merchant",
        "merchants",
        "supply",
        "shortage",
        "boom",
        "craze",
        "fever",
    ];
    let mut bad = Vec::new();
    for t in english_texts() {
        if !t.file.starts_with("templates/") && t.file != "texts.toml" {
            continue;
        }
        let lower = t.text.to_ascii_lowercase();
        for (i, _) in lower.match_indices("{good} ") {
            // 参数后隔一个空格紧跟的词；参数前是介词时它不是主语（“the price of {good} has …”），不算
            let rest = &lower[i + "{good} ".len()..];
            let next: String = rest.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
            let before = lower[..i].trim_end().rsplit(|c: char| !c.is_ascii_alphabetic()).next().unwrap_or("");
            let object = matches!(before, "of" | "for" | "in" | "on" | "with" | "to" | "by" | "about" | "from");
            if !object && SINGULAR_VERBS.contains(&next.as_str()) {
                bad.push(format!("{}：“{{good}} {next}” 遇到复数商品名（Pearls、Spices）主谓不一致：{}", t.at, t.text));
            }
            if ADJUNCT_NOUNS.contains(&next.as_str()) {
                bad.push(format!("{}：“{{good}} {next}” 遇到复数商品名会写成 “Potatoes {next}”：{}", t.at, t.text));
            }
        }
        for (i, _) in lower.match_indices(" {") {
            let before = lower[..i].rsplit(|c: char| !c.is_ascii_alphabetic()).next().unwrap_or("");
            if before == "a" || before == "an" {
                bad.push(format!("{}：冠词 a / an 不能直接放在参数前（元音开头的名字会写错）：{}", t.at, t.text));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// 读取航海士的小传：中文 `data/mates.toml`（[[mates]] 的 key 与 bio）与英文覆盖 `[mates.<key>] bio`。
fn mate_bios() -> Vec<(String, String, String)> {
    let dir = data_dir();
    let zh: toml::Table = toml::from_str(&std::fs::read_to_string(dir.join("mates.toml")).unwrap()).unwrap();
    let en: toml::Table =
        toml::from_str(&std::fs::read_to_string(dir.join("locales").join("en").join("mates.toml")).unwrap()).unwrap();
    let en_mates = en.get("mates").and_then(|v| v.as_table()).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for m in zh.get("mates").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let key = m.get("key").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let bio_zh = m.get("bio").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let bio_en =
            en_mates.get(&key).and_then(|v| v.get("bio")).and_then(|v| v.as_str()).unwrap_or_default().to_string();
        out.push((key, bio_zh, bio_en));
    }
    assert!(!out.is_empty(), "data/mates.toml 里没有航海士");
    out
}

#[test]
fn english_mate_bios_keep_the_portrait_cues() {
    // （中文线索, 英文里必须出现其一的说法, 线索名）。英文说法取前端英文线索表认得的写法。
    const CUES: &[(&[&str], &[&str], &str)] = &[
        (&["红发", "赤发"], &["red hair", "red-haired", "auburn hair", "copper hair"], "红发"),
        (&["金发", "浅金", "金色的头发", "金色头发"], &["blond"], "金发"),
        (&["白发", "银发"], &["white hair", "white-haired", "silver hair", "silver-haired"], "白发"),
        (&["眼罩", "蒙着黑布", "独眼"], &["eyepatch", "eye patch", "one-eyed"], "眼罩"),
        (
            &["盘得", "盘着", "盘起", "发髻", "髻"],
            &["hair pinned up", "hair piled up", "hair coiled up", " bun", "topknot"],
            "盘发",
        ),
        (&["鬓边"], &["flower tucked", "flower behind", "flower in"], "鬓边的花"),
        (&["眼镜"], &["glasses", "spectacles"], "眼镜"),
        (&["伤疤", "刀疤"], &["scar"], "伤疤"),
        (&["烟斗"], &["pipe"], "烟斗"),
        (&["辫"], &["braid", "plait"], "发辫"),
        (&["斗篷"], &["cloak"], "斗篷"),
        (&["头巾", "缠头"], &["turban", "headscarf", "head wrap", "headwrap"], "头巾"),
        (&["胡子", "胡须", "络腮", "短须", "长须"], &["beard", "whiskers"], "胡须"),
        (&["八字胡"], &["mustache", "moustache"], "八字胡"),
        (&["精灵", "精裔", "尖耳"], &["elven", "elvish", "elf-blooded", "pointed ears"], "精灵血统"),
        (&["灰眼", "灰色的眼", "灰眼睛"], &["gray eyes", "gray-eyed", "grey eyes", "grey-eyed"], "灰眼睛"),
        (&["碧眼", "绿眼", "绿色的眼"], &["green eyes", "green-eyed"], "绿眼睛"),
        (&["蓝眼", "蓝色的眼"], &["blue eyes", "blue-eyed"], "蓝眼睛"),
        (&["卷发"], &["curly", "curls"], "卷发"),
    ];
    let mut bad = Vec::new();
    for (key, zh, en) in mate_bios() {
        if en.is_empty() {
            continue; // 缺英文由 english_covers_all_current_data 报告
        }
        let en_lower = en.to_ascii_lowercase();
        // 中文里出现线索，就要求英文里有对应说法
        for (zh_cues, en_cues, name) in CUES {
            let in_zh = zh_cues.iter().any(|c| zh.contains(c));
            if in_zh && !en_cues.iter().any(|c| en_lower.contains(c)) {
                bad.push(format!("{key}：中文小传写了{name}，英文小传要写成 {en_cues:?} 之一：{en}"));
            }
        }
        // 人称：中文用“她”的，英文也用 she / her（头像按人称画男女）
        let female_zh = zh.contains('她');
        let female_en = words(&en).iter().any(|w| matches!(w.as_str(), "she" | "her" | "hers" | "herself"));
        if female_zh != female_en {
            bad.push(format!("{key}：中文与英文小传的人称不一致（中文女性：{female_zh}，英文女性：{female_en}）"));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

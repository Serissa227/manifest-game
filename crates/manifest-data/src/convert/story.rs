//! `data/stories/*.toml`：剧情事件——推荐角色的故事线与所有船长都会遇到的奇遇（目录不存在时一切照旧）。
//! 另外负责把带主角的剧本（`scenarios/*.toml` 的 `story` 与 `[hero]`）接上故事线与主角身世并校验。

use super::{Issues, lookup};
use crate::worlds::EffectiveWorld;
use manifest_core::captain::{CaptainDefs, background_attrs};
use manifest_core::defs::{GoalKind, GoodDef, HERO_LOOK_MIN, HeroDef, MateDef, ScenarioDef};
use manifest_core::ids::*;
use manifest_core::mates::GENIUS_METHODS;
use manifest_core::story::{
    Check, ChoiceDef, Cond, EncounterDef, MAX_CHOICES, Place, Speaker, StoryDef, StoryDefs, StoryEffect, StoryRules,
};
use manifest_core::weather::Sky;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

/// 故事文件所在的目录（相对 data/）。
pub(super) const DIR: &str = "stories";

// 文字长度上限（字符）
const MAX_TITLE: usize = 24;
const MAX_TEXT: usize = 500;
const MAX_HINT: usize = 100;
const MAX_CHOICE: usize = 48;
const MAX_REPLY: usize = 400;
const MAX_SPEAKER: usize = 16;
const MAX_TAGLINE: usize = 40;
const MAX_BIO: usize = 300;
const MAX_HERO_NAME: usize = 12;
/// 效果“得到货物”的货值上限（金币，按基准价）。
const MAX_GOODS_VALUE: i64 = 8_000;

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoryFileRaw {
    /// 故事线的 key 与名字（只有奇遇的文件可以不写）
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    name: Option<String>,
    /// 奇遇的节奏（整个目录里只能写一次）
    #[serde(default)]
    rules: Option<RulesRaw>,
    #[serde(default)]
    chapters: Vec<ChapterRaw>,
    #[serde(default)]
    encounters: Vec<EncounterRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RulesRaw {
    encounter_chance: f64,
    gap_days: u32,
    first_day: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct WhenRaw {
    day: Option<u32>,
    wait: Option<u32>,
    docked: Option<Vec<String>>,
    at_sea: Option<Vec<String>>,
    cash: Option<i64>,
    net_worth: Option<i64>,
    fame: Option<i64>,
    ships: Option<u32>,
    sighted: Option<String>,
    flag: Option<String>,
    not_flag: Option<String>,
    /// 季节：spring / summer / autumn / winter 里的一个或几个
    season: Option<Vec<String>>,
    /// 舰队所在海区今天的天况：clear / cloudy / rain / fog / storm / snow 里的一个或几个（只对海上的舰队）
    sky: Option<Vec<String>>,
    /// 舰队所在海区今天的风力范围 [下限, 上限]（0–10，含两端；只对海上的舰队）
    wind: Option<[i64; 2]>,
    /// 舰队停靠的港口所属的文化圈（港口的 culture）里的一个或几个
    culture: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChapterRaw {
    key: String,
    title: String,
    text: String,
    #[serde(default)]
    hint: String,
    #[serde(default)]
    speaker: Option<String>,
    #[serde(default)]
    speaker_name: String,
    #[serde(default)]
    when: WhenRaw,
    choices: Vec<ChoiceRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EncounterRaw {
    key: String,
    title: String,
    text: String,
    #[serde(default)]
    speaker: Option<String>,
    #[serde(default)]
    speaker_name: String,
    place: String,
    #[serde(default)]
    when: WhenRaw,
    #[serde(default = "one")]
    weight: i64,
    #[serde(default)]
    once: bool,
    #[serde(default)]
    cooldown_days: u32,
    choices: Vec<ChoiceRaw>,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChoiceRaw {
    text: String,
    #[serde(default)]
    reply: String,
    #[serde(default)]
    cost: i64,
    #[serde(default)]
    give: Option<GiveRaw>,
    #[serde(default)]
    check: Option<CheckRaw>,
    #[serde(default)]
    effects: Vec<EffectRaw>,
    #[serde(default)]
    fail: Vec<EffectRaw>,
    #[serde(default)]
    fail_reply: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GiveRaw {
    good: String,
    qty: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckRaw {
    attr: String,
    base: i64,
    per: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EffectRaw {
    kind: String,
    #[serde(default)]
    value: Option<i64>,
    #[serde(default)]
    faction: Option<String>,
    #[serde(default)]
    good: Option<String>,
    #[serde(default)]
    qty: Option<i64>,
    #[serde(default)]
    discovery: Option<String>,
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    mate: Option<String>,
    #[serde(default)]
    attr: Option<String>,
    #[serde(default)]
    flag: Option<String>,
}

/// 一份旧式故事文件（故事线章节与奇遇，没有 `tracks`）里的条目 key：`(章节, 奇遇)`。
///
/// 用的就是生产加载器的 schema（[`StoryFileRaw`]，未知字段一律拒绝）；严格草稿检查与翻译登记靠它认这类文件，
/// 不另写一套更松的结构。港口、海区、货物、势力这些引用仍由完整加载（[`convert`]）检查。
pub(crate) fn classic_file_keys(text: &str) -> Result<(Vec<String>, Vec<String>), toml::de::Error> {
    let raw: StoryFileRaw = toml::from_str(text)?;
    Ok((raw.chapters.into_iter().map(|c| c.key).collect(), raw.encounters.into_iter().map(|e| e.key).collect()))
}

/// 读取 `stories/` 下的全部 .toml（按文件名排序；目录不存在时为空）。
pub(super) fn load(dir: &EffectiveWorld, is: &mut Issues) -> Vec<(String, StoryFileRaw)> {
    dir.files_in(DIR)
        .into_iter()
        .filter_map(|rel| {
            let text = super::read(dir, &rel, is)?;
            let raw = super::parse::<toml::Value>(&rel, &text, is)?;
            if raw.get("tracks").is_some() {
                return None;
            }
            super::parse::<StoryFileRaw>(&rel, &text, is).map(|f| (rel, f))
        })
        .collect()
}

/// 转换时需要的其他各表。
pub(super) struct Tables<'a> {
    pub captain: &'a CaptainDefs,
    pub port_ids: &'a BTreeMap<String, LocId>,
    pub region_ids: &'a BTreeMap<String, RegionId>,
    pub good_ids: &'a BTreeMap<String, GoodId>,
    pub goods: &'a [GoodDef],
    pub faction_ids: &'a BTreeMap<String, FactionId>,
    pub mate_ids: &'a BTreeMap<String, MateId>,
    pub mates: &'a [MateDef],
    pub discovery_ids: &'a BTreeMap<String, DiscoveryId>,
    /// 本世界港口用到的文化圈（`when.culture` 只能写其中的）
    pub cultures: &'a BTreeSet<String>,
}

/// 显示文字：非空（`required` 时）、不超过 `max` 个字符、不含控制字符。
fn text(v: &str, max: usize, required: bool, file: &str, item: &str, field: &str, is: &mut Issues) {
    if required && v.trim().is_empty() {
        is.push(file, item, format!("{field} 不能为空"));
    }
    if v.chars().count() > max {
        is.push(file, item, format!("{field} 不能超过 {max} 个字"));
    }
    if v.chars().any(|c| c.is_control() && c != '\n') {
        is.push(file, item, format!("{field} 不能包含控制字符"));
    }
}

fn flag_key(f: &str, file: &str, item: &str, is: &mut Issues) -> String {
    if f.is_empty() || !f.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        is.push(file, item, format!("故事标记“{f}”无效：只能用小写字母、数字与下划线"));
    }
    f.to_string()
}

fn conds(w: &WhenRaw, chapter: bool, t: &Tables, file: &str, item: &str, is: &mut Issues) -> Vec<Cond> {
    let mut out = Vec::new();
    if let Some(d) = w.day {
        if d > 7_200 {
            is.push(file, item, "when.day 不能超过 7200");
        }
        out.push(Cond::Day(d));
    }
    if let Some(d) = w.wait {
        if !chapter {
            is.push(file, item, "when.wait 只用于故事线的章节");
        }
        if d > 3_600 {
            is.push(file, item, "when.wait 不能超过 3600");
        }
        out.push(Cond::Wait(d));
    }
    if let Some(ports) = &w.docked {
        out.push(Cond::Docked(ports.iter().filter_map(|p| lookup(t.port_ids, p, file, item, "港口", is)).collect()));
    }
    if let Some(regions) = &w.at_sea {
        out.push(Cond::AtSea(regions.iter().filter_map(|r| lookup(t.region_ids, r, file, item, "海区", is)).collect()));
    }
    if w.docked.is_some() && w.at_sea.is_some() {
        is.push(file, item, "when.docked 与 when.at_sea 不能同时写（舰队不能既在港又在海上）");
    }
    for (name, v) in [("cash", w.cash), ("net_worth", w.net_worth)] {
        if let Some(m) = v {
            if !(0..=100_000_000).contains(&m) {
                is.push(file, item, format!("when.{name} 须在 0–100000000 之间"));
            }
            out.push(if name == "cash" { Cond::Cash(m) } else { Cond::NetWorth(m) });
        }
    }
    if let Some(f) = w.fame {
        if !(0..=10_000).contains(&f) {
            is.push(file, item, "when.fame 须在 0–10000 之间");
        }
        out.push(Cond::Fame(f));
    }
    if let Some(n) = w.ships {
        if !(1..=100).contains(&n) {
            is.push(file, item, "when.ships 须在 1–100 之间");
        }
        out.push(Cond::Ships(n));
    }
    if let Some(d) = &w.sighted
        && let Some(id) = lookup(t.discovery_ids, d, file, item, "发现物", is)
    {
        out.push(Cond::Sighted(id));
    }
    if let Some(f) = &w.flag {
        out.push(Cond::Flag(flag_key(f, file, item, is)));
    }
    if let Some(f) = &w.not_flag {
        out.push(Cond::NotFlag(flag_key(f, file, item, is)));
    }
    // 重复的条目多半是笔误；空列表会让这一条永远不成立。
    let listed = |name: &str, n: usize, unique: usize, is: &mut Issues| {
        if n == 0 {
            is.push(file, item, format!("when.{name} 不能是空列表"));
        } else if unique != n {
            is.push(file, item, format!("when.{name} 里有重复的条目"));
        }
    };
    if let Some(names) = &w.season {
        let seasons: Vec<u8> = names
            .iter()
            .filter_map(|s| match SEASONS.iter().position(|k| k == s) {
                Some(i) => Some(i as u8),
                None => {
                    is.push(file, item, format!("when.season“{s}”无效：应为 spring、summer、autumn 或 winter"));
                    None
                }
            })
            .collect();
        listed("season", names.len(), names.iter().collect::<BTreeSet<_>>().len(), is);
        out.push(Cond::Season(seasons));
    }
    if let Some(names) = &w.sky {
        let skies: Vec<Sky> = names
            .iter()
            .filter_map(|s| {
                let sky = Sky::from_key(s);
                if sky.is_none() {
                    is.push(file, item, format!("when.sky“{s}”无效：应为 clear、cloudy、rain、fog、storm 或 snow"));
                }
                sky
            })
            .collect();
        listed("sky", names.len(), names.iter().collect::<BTreeSet<_>>().len(), is);
        out.push(Cond::Sky(skies));
    }
    if let Some([lo, hi]) = w.wind {
        if !(0..=10).contains(&lo) || !(0..=10).contains(&hi) || lo > hi {
            is.push(file, item, "when.wind 须为 [下限, 上限]，0 ≤ 下限 ≤ 上限 ≤ 10");
        }
        out.push(Cond::Wind(lo, hi));
    }
    if (w.sky.is_some() || w.wind.is_some()) && w.docked.is_some() {
        is.push(file, item, "when.sky / when.wind 只对海上的舰队成立，不能与 when.docked 同时写");
    }
    if let Some(cultures) = &w.culture {
        for c in cultures {
            if !t.cultures.contains(c) {
                is.push(file, item, format!("when.culture“{c}”不是本世界任何港口的文化圈"));
            }
        }
        listed("culture", cultures.len(), cultures.iter().collect::<BTreeSet<_>>().len(), is);
        if w.at_sea.is_some() {
            is.push(file, item, "when.culture 看的是停靠的港口，不能与 when.at_sea 同时写");
        }
        out.push(Cond::Culture(cultures.clone()));
    }
    out
}

/// 季节的写法，按 [`manifest_core::calendar::Season::index`] 的顺序。
const SEASONS: [&str; 4] = ["spring", "summer", "autumn", "winter"];

fn speaker(raw: &Option<String>, name: &str, t: &Tables, file: &str, item: &str, is: &mut Issues) -> Speaker {
    text(name, MAX_SPEAKER, false, file, item, "speaker_name", is);
    let Some(s) = raw.as_deref() else { return Speaker::None };
    match s.split_once(':') {
        None if s == "captain" => Speaker::Captain,
        None if s == "none" => Speaker::None,
        Some(("mate", key)) => match lookup(t.mate_ids, key, file, item, "航海士", is) {
            Some(id) => Speaker::Mate(id),
            None => Speaker::None,
        },
        Some(("portrait", asset)) => {
            if asset.is_empty()
                || !asset.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
            {
                is.push(file, item, format!("speaker 的头像 id“{asset}”无效"));
            }
            if name.trim().is_empty() {
                is.push(file, item, "speaker 是某张头像时要写 speaker_name（说话人的名字）");
            }
            Speaker::Portrait(asset.to_string())
        }
        _ => {
            is.push(
                file,
                item,
                format!("speaker“{s}”无效：应为 captain、none、mate:<航海士 key> 或 portrait:<头像 id>"),
            );
            Speaker::None
        }
    }
}

fn effect(e: &EffectRaw, t: &Tables, file: &str, item: &str, is: &mut Issues) -> Option<StoryEffect> {
    let item = format!("{item}.{}", e.kind);
    let value = |lo: i64, hi: i64, nonzero: bool, is: &mut Issues| -> Option<i64> {
        match e.value {
            Some(v) if (lo..=hi).contains(&v) && (!nonzero || v != 0) => Some(v),
            Some(v) => {
                is.push(
                    file,
                    &item,
                    format!("value = {v} 须在 {lo}…{hi} 之间{}", if nonzero { "且不为 0" } else { "" }),
                );
                None
            }
            None => {
                is.push(file, &item, "缺少 value");
                None
            }
        }
    };
    match e.kind.as_str() {
        "cash" => value(-20_000, 20_000, true, is).map(StoryEffect::Cash),
        "fame" => value(-20, 50, true, is).map(StoryEffect::Fame),
        "reputation" => {
            let faction = match &e.faction {
                Some(f) => Some(lookup(t.faction_ids, f, file, &item, "势力", is)?),
                None => None,
            };
            value(-20, 20, true, is).map(|v| StoryEffect::Reputation(faction, v))
        }
        "morale" => value(-30, 30, true, is).map(StoryEffect::Morale),
        "goods" => {
            let good = lookup(t.good_ids, e.good.as_deref().unwrap_or(""), file, &item, "商品", is)?;
            match e.qty {
                Some(q) if (-500..=500).contains(&q) && q != 0 => {
                    let value = t.goods[good.idx()].base_price * q;
                    if value > MAX_GOODS_VALUE {
                        is.push(file, &item, format!("得到的货值 {value} 超过上限 {MAX_GOODS_VALUE}（按基准价）"));
                    }
                    Some(StoryEffect::Goods(good, q))
                }
                _ => {
                    is.push(file, &item, "qty 须在 −500…500 之间且不为 0");
                    None
                }
            }
        }
        "crew" => value(-10, 10, true, is).map(StoryEffect::Crew),
        "repair" => value(1, 100, true, is).map(StoryEffect::Repair),
        "damage" => value(1, 20, true, is).map(StoryEffect::Damage),
        "supplies" => value(-30, 30, true, is).map(StoryEffect::Supplies),
        "rumor" => Some(StoryEffect::Rumor),
        "reveal" => lookup(t.discovery_ids, e.discovery.as_deref().unwrap_or(""), file, &item, "发现物", is)
            .map(StoryEffect::Reveal),
        "chart" => {
            lookup(t.region_ids, e.region.as_deref().unwrap_or(""), file, &item, "海区", is).map(StoryEffect::Chart)
        }
        "mate" => {
            let id = lookup(t.mate_ids, e.mate.as_deref().unwrap_or(""), file, &item, "航海士", is)?;
            if t.mates[id.idx()].hidden {
                is.push(file, &item, format!("隐藏的航海士“{}”不能经由故事加入", t.mates[id.idx()].key));
                return None;
            }
            Some(StoryEffect::Mate(id))
        }
        "attr" => {
            let Some(i) = e.attr.as_deref().and_then(|k| t.captain.attribute_index(k)) else {
                is.push(file, &item, "attr 须为本世界已定义的属性");
                return None;
            };
            value(-2, 2, true, is).map(|v| StoryEffect::Attr(i, v))
        }
        "flag" => match &e.flag {
            Some(f) => Some(StoryEffect::Flag(flag_key(f, file, &item, is))),
            None => {
                is.push(file, &item, "缺少 flag");
                None
            }
        },
        other => {
            is.push(
                file,
                &item,
                format!(
                    "未知的效果“{other}”：应为 cash、fame、reputation、morale、goods、crew、repair、damage、supplies、rumor、reveal、chart、mate、attr 或 flag"
                ),
            );
            None
        }
    }
}

fn choices(raw: &[ChoiceRaw], t: &Tables, file: &str, item: &str, is: &mut Issues) -> Vec<ChoiceDef> {
    if raw.is_empty() || raw.len() > MAX_CHOICES {
        is.push(file, item, format!("choices 须有 1–{MAX_CHOICES} 个"));
    }
    raw.iter()
        .enumerate()
        .map(|(i, c)| {
            let item = format!("{item}.choices[{}]", i + 1);
            text(&c.text, MAX_CHOICE, true, file, &item, "text", is);
            text(&c.reply, MAX_REPLY, false, file, &item, "reply", is);
            text(&c.fail_reply, MAX_REPLY, false, file, &item, "fail_reply", is);
            if !(0..=50_000).contains(&c.cost) {
                is.push(file, &item, "cost 须在 0–50000 之间");
            }
            let give = c.give.as_ref().and_then(|g| {
                if !(1..=500).contains(&g.qty) {
                    is.push(file, &item, "give.qty 须在 1–500 之间");
                }
                lookup(t.good_ids, &g.good, file, &item, "商品", is).map(|id| (id, g.qty))
            });
            let check = c.check.as_ref().and_then(|k| {
                if !(0..=100).contains(&k.base) || !(0..=20).contains(&k.per) {
                    is.push(file, &item, "check.base 须在 0–100、check.per 须在 0–20 之间");
                }
                match t.captain.check_index(&k.attr) {
                    Some(attr) => Some(Check { attr, base_pct: k.base, per_pct: k.per }),
                    None => {
                        is.push(file, &item, "check.attr 须为本世界已定义的属性或评价");
                        None
                    }
                }
            });
            if check.is_none() && (!c.fail.is_empty() || !c.fail_reply.is_empty()) {
                is.push(file, &item, "没有 check 的选项不能写 fail 或 fail_reply");
            }
            let effects = c.effects.iter().filter_map(|e| effect(e, t, file, &item, is)).collect();
            let fail = c.fail.iter().filter_map(|e| effect(e, t, file, &item, is)).collect();
            ChoiceDef {
                text: c.text.clone(),
                reply: c.reply.clone(),
                cost: c.cost,
                give,
                check,
                effects,
                fail,
                fail_reply: c.fail_reply.clone(),
            }
        })
        .collect()
}

/// 转换全部故事文件。
pub(super) fn convert(files: Vec<(String, StoryFileRaw)>, t: &Tables, is: &mut Issues) -> StoryDefs {
    let mut defs = StoryDefs::default();
    let mut rules_seen = false;
    let mut story_keys = BTreeSet::new();
    let mut encounter_keys = BTreeSet::new();
    for (file, raw) in files {
        let file = file.as_str();
        if let Some(r) = &raw.rules {
            if rules_seen {
                is.push(file, "rules", "奇遇的 [rules] 只能写一次");
            }
            rules_seen = true;
            if !(0.0..=0.5).contains(&r.encounter_chance) {
                is.push(file, "rules", "encounter_chance 须在 0 到 0.5 之间");
            }
            if !(1..=720).contains(&r.gap_days) || r.first_day > 720 {
                is.push(file, "rules", "gap_days 须在 1–720、first_day 须在 0–720 之间");
            }
            defs.rules = StoryRules {
                encounter_bp: (r.encounter_chance * 10_000.0).round() as i64,
                gap_days: r.gap_days,
                first_day: r.first_day,
            };
        }
        if !raw.chapters.is_empty() || raw.key.is_some() {
            let key = raw.key.clone().unwrap_or_default();
            let name = raw.name.clone().unwrap_or_default();
            let item = format!("story[{key}]");
            if key.is_empty() || !key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                is.push(file, &item, "key 无效：只能用小写字母、数字与下划线");
            }
            if !story_keys.insert(key.clone()) {
                is.push(file, &item, "故事线的 key 重复");
            }
            text(&name, MAX_TITLE, true, file, &item, "name", is);
            if raw.chapters.is_empty() {
                is.push(file, &item, "故事线至少要有一章");
            }
            let mut chapter_keys = BTreeSet::new();
            let mut chapters = Vec::new();
            for c in &raw.chapters {
                let item = format!("chapters[{}]", c.key);
                if !chapter_keys.insert(c.key.clone()) {
                    is.push(file, &item, "章节的 key 重复");
                }
                text(&c.title, MAX_TITLE, true, file, &item, "title", is);
                text(&c.text, MAX_TEXT, true, file, &item, "text", is);
                text(&c.hint, MAX_HINT, true, file, &item, "hint", is);
                let speaker = speaker(&c.speaker, &c.speaker_name, t, file, &item, is);
                let when = conds(&c.when, true, t, file, &item, is);
                let choices = choices(&c.choices, t, file, &item, is);
                chapters.push(manifest_core::story::ChapterDef {
                    key: c.key.clone(),
                    title: c.title.clone(),
                    text: c.text.clone(),
                    hint: c.hint.clone(),
                    speaker,
                    speaker_name: c.speaker_name.clone(),
                    when,
                    choices,
                });
            }
            defs.stories.push(StoryDef { key, name, chapters });
        }
        for e in &raw.encounters {
            let item = format!("encounters[{}]", e.key);
            if e.key.is_empty() || !e.key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
                is.push(file, &item, "key 无效：只能用小写字母、数字与下划线");
            }
            if !encounter_keys.insert(e.key.clone()) {
                is.push(file, &item, "奇遇的 key 重复");
            }
            text(&e.title, MAX_TITLE, true, file, &item, "title", is);
            text(&e.text, MAX_TEXT, true, file, &item, "text", is);
            let place = match e.place.as_str() {
                "sea" => Place::Sea,
                "port" => Place::Port,
                other => {
                    is.push(file, &item, format!("place“{other}”无效：应为 sea 或 port"));
                    Place::Sea
                }
            };
            let when = conds(&e.when, false, t, file, &item, is);
            if (place == Place::Sea && e.when.docked.is_some()) || (place == Place::Port && e.when.at_sea.is_some()) {
                is.push(file, &item, "place 与 when.docked / when.at_sea 矛盾");
            }
            if place == Place::Sea && e.when.culture.is_some() {
                is.push(file, &item, "海上的奇遇不能写 when.culture（它看的是停靠的港口）");
            }
            if place == Place::Port && (e.when.sky.is_some() || e.when.wind.is_some()) {
                is.push(file, &item, "港口的奇遇不能写 when.sky / when.wind（它们只对海上的舰队成立）");
            }
            // 身无分文、舱里空空的玩家也要答得了：至少一个不花钱、不交货的选项（带检定不算门槛，输赢都结算）。
            if !e.choices.is_empty() && e.choices.iter().all(|c| c.cost > 0 || c.give.is_some()) {
                is.push(file, &item, "奇遇至少要有一个不花钱、不交货的选项");
            }
            if !(1..=100).contains(&e.weight) {
                is.push(file, &item, "weight 须在 1–100 之间");
            }
            if e.cooldown_days > 3_600 {
                is.push(file, &item, "cooldown_days 不能超过 3600");
            }
            let speaker = speaker(&e.speaker, &e.speaker_name, t, file, &item, is);
            let choices = choices(&e.choices, t, file, &item, is);
            defs.encounters.push(EncounterDef {
                key: e.key.clone(),
                title: e.title.clone(),
                text: e.text.clone(),
                speaker,
                speaker_name: e.speaker_name.clone(),
                place,
                when,
                weight: e.weight,
                once: e.once,
                cooldown_days: e.cooldown_days,
                choices,
            });
        }
    }
    if !defs.encounters.is_empty() && !rules_seen {
        is.push(DIR, "rules", "有奇遇时要写奇遇的 [rules]（encounter_chance、gap_days、first_day）");
    }
    check_flags(&defs, is);
    defs
}

/// 条件里用到的故事标记都要有选项会设下（防止拼写错误让一章永远不出现）。
fn check_flags(defs: &StoryDefs, is: &mut Issues) {
    let all_choices = defs
        .stories
        .iter()
        .flat_map(|s| s.chapters.iter().flat_map(|c| c.choices.iter()))
        .chain(defs.encounters.iter().flat_map(|e| e.choices.iter()));
    let set: BTreeSet<&str> = all_choices
        .flat_map(|c| c.effects.iter().chain(c.fail.iter()))
        .filter_map(|e| if let StoryEffect::Flag(f) = e { Some(f.as_str()) } else { None })
        .collect();
    let used = defs
        .stories
        .iter()
        .flat_map(|s| s.chapters.iter().map(move |c| (format!("{}.{}", s.key, c.key), &c.when)))
        .chain(defs.encounters.iter().map(|e| (e.key.clone(), &e.when)));
    for (item, when) in used {
        for c in when {
            if let Cond::Flag(f) | Cond::NotFlag(f) = c
                && !set.contains(f.as_str())
            {
                is.push(DIR, &item, format!("故事标记“{f}”没有任何选项会设下"));
            }
        }
    }
}

/// 带主角的剧本在转换时暂存的原始字段（等故事线与主角身世都转换好之后再接上、校验）。
pub(super) struct ScenarioLink {
    pub file: String,
    pub story: Option<String>,
    pub hero: Option<crate::raw::HeroRaw>,
}

/// 接上故事线与推荐角色：故事线存在；目标为 story 的剧本必须有故事线；推荐角色的姓名、外貌、生日、身世与属性都要合法
/// （与 `CreateCaptain` 的内核校验一致，开局时不会被拒）；只给某位推荐角色的身世选项必须指向一个带主角的剧本。
pub(super) fn link_scenarios(
    scenarios: &mut [ScenarioDef],
    links: Vec<ScenarioLink>,
    stories: &StoryDefs,
    captain: &CaptainDefs,
    calendar: &manifest_core::calendar::Calendar,
    attributes: &manifest_core::captain::AttributeRules,
    is: &mut Issues,
) {
    let mut looks: BTreeMap<u32, String> = BTreeMap::new();
    for (s, link) in scenarios.iter_mut().zip(links) {
        let file = link.file.as_str();
        let item = format!("scenario[{}]", s.key);
        s.story = match &link.story {
            Some(k) => {
                let i = stories.stories.iter().position(|x| &x.key == k);
                if i.is_none() {
                    is.push(file, &item, format!("引用了不存在的故事线“{k}”（data/stories/ 下没有这个 key）"));
                }
                i
            }
            None => None,
        };
        if s.goal.kind == GoalKind::Story && s.story.is_none() && s.protagonists.is_empty() && s.templates.is_empty() {
            is.push(file, &item, "目标为 story（走完故事线）的剧本必须写 story");
        }
        let Some(h) = link.hero else { continue };
        let item = format!("{item}.hero");
        let name = h.name.trim();
        if name.is_empty() || name.chars().count() > MAX_HERO_NAME || name.chars().any(char::is_control) {
            is.push(file, &item, format!("name 须为 1–{MAX_HERO_NAME} 个字"));
        }
        text(&h.tagline, MAX_TAGLINE, true, file, &item, "tagline", is);
        text(&h.bio, MAX_BIO, true, file, &item, "bio", is);
        let ordinary = h.look <= 24 && h.look != 12;
        if !(ordinary || h.look >= HERO_LOOK_MIN) || h.look == 25 {
            is.push(
                file,
                &item,
                format!("look = {} 无效：应为普通外貌（0–11、13–24）或 {HERO_LOOK_MIN} 以上的专属头像", h.look),
            );
        }
        if h.look >= HERO_LOOK_MIN
            && let Some(other) = looks.insert(h.look, s.key.clone())
        {
            is.push(file, &item, format!("专属外貌 {} 已经给了剧本“{other}”", h.look));
        }
        // 主角身世是可选的：没有 captain.toml 时开局不设身世，推荐角色的设定一并忽略（剧本照常可选）
        if !captain.enabled() {
            continue;
        }
        let p = &captain.points;
        let [month, day] = h.birthday;
        if !manifest_core::captain::MonthDay::new(month, day).is_valid_in(calendar) {
            is.push(file, &item, "birthday 须为世界日历中有效的 [月, 日]");
        }
        if h.age < p.age_min || h.age > p.age_max {
            is.push(file, &item, format!("age 须在 {}–{} 之间", p.age_min, p.age_max));
        }
        if h.answers.len() != captain.questions.len() {
            is.push(file, &item, format!("answers 须有 {} 个（每道身世问题一个）", captain.questions.len()));
        }
        let mut chosen = Vec::new();
        for (qi, key) in h.answers.iter().enumerate() {
            match captain.option(key) {
                Some(o) if o.question == qi && o.hero.as_deref().is_none_or(|x| x == s.key) => chosen.push(o),
                Some(_) => is.push(
                    file,
                    &item,
                    format!("answers 第 {} 个“{key}”不是这道问题的选项，或只给别的推荐角色用", qi + 1),
                ),
                None => is.push(file, &item, format!("answers 引用了不存在的身世选项“{key}”")),
            }
        }
        let sign = captain.sign_of_in(month, day, calendar);
        let bg = background_attrs(captain, &chosen, sign);
        match captain.allocated_attrs(&bg, &h.alloc) {
            Err(e) => is.push(file, &item, format!("alloc 无效：{e}")),
            Ok(attrs) => {
                if let Some(g) = &h.genius
                    && (captain.hook_value(&attrs, manifest_core::captain::AttrHook::MarketWindow, attributes)
                        < p.genius_numeracy
                        || !GENIUS_METHODS.contains(&g.as_str()))
                {
                    is.push(
                        file,
                        &item,
                        format!(
                            "genius “{g}”无效：算学须达到 {} 且方法须为 {GENIUS_METHODS:?} 之一",
                            p.genius_numeracy
                        ),
                    );
                }
            }
        }
        s.hero = Some(HeroDef {
            name: name.to_string(),
            look: h.look,
            tagline: h.tagline,
            bio: h.bio,
            month,
            day,
            age: h.age,
            answers: h.answers,
            alloc: h.alloc,
            genius: h.genius,
        });
    }
    // 只给某位推荐角色的身世选项：必须指向一个带主角的剧本
    for o in &captain.options {
        if let Some(h) = &o.hero
            && !scenarios.iter().any(|s| &s.key == h && s.hero.is_some())
        {
            is.push("captain.toml", format!("options[{}]", o.key), format!("hero = “{h}”不是带主角的剧本"));
        }
    }
}

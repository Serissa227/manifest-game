//! 语言覆盖文件：`data/locales/<语言>/` 下与原数据同名同路径的 TOML，只写要覆盖的显示字段。
//!
//! 格式（以英文为例）：
//! - 带 key 的表：`[<表名>.<key>]` 下写字段，例如 `goods.toml` 里的 `[goods.grain]`、`name = "Grain"`；
//!   表名与原文件中的数组表名相同（`[[goods]]` → `[goods.<key>]`，`world/overseas.toml` 有 `ports` 与 `sites` 两张表，
//!   `world/rivers.toml` 的 `[rivers.<key>]` 只有 `name`，`world/landmarks.toml` 的 `[landmarks.<key>]` 有 `name`、`lore`）；
//! - `rules.toml`：`[world]` 下的 `currency`、`era`；
//! - `scenarios/<文件名>.toml`：顶层的 `name`、`description`（文件名与原剧本文件相同）；带主角的剧本另有 `[hero]` 下的
//!   `name`、`tagline`、`bio`（推荐角色的姓名、一句话介绍与小传）；
//! - `stories/<文件名>.toml`（剧情事件）：顶层的 `name`（故事线的名字），`[chapters.<key>]` 与 `[encounters.<key>]` 下的
//!   `title`、`text`、`hint`（只有章节有）、`speaker_name`，以及各选项的 `choice_N`、`reply_N`、`fail_reply_N`（N 为 1–3，按选项顺序）；
//! - `goods.toml` 另有 `[categories]`：商品类别（中文，内部键）→ 显示名；
//! - `items.toml`：物品的 `name`、`desc`、`lore`，书类的 `name`，套装的 `name`、`title`；
//! - `texts.toml`：后端显示文字（键与 `data/texts.toml` 一一对应）；
//! - `templates/rumor.toml`、`bargain.toml`、`chronicle.toml`：整文件替换，小节与条数与中文一致（逐条对应）；
//! - `templates/composed.toml`：`sources` 列表与 `[archetypes.<key>]` 下的 `titles`、`narratives`（条数与中文一致）；
//! - `prompts/<类型>.toml`：整文件替换（结构与中文提示词相同）。
//!
//! 校验：覆盖的条目必须存在于原数据、字段必须是可覆盖的显示字段、文字不能为空、模板参数只能用中文模板允许的参数。

mod arcana;
mod authored;
mod cast;
mod creatures;
mod history;
mod ideas;
mod legend_ships;
mod lineages;
mod realms;
mod societies;
mod story2;
mod upbringing;
pub mod variant;

use super::source::Source;
use super::texts::{self, Texts};
use super::{ArchetypeText, Locale, LocaleBundle, TemplateText};
use crate::DataIssue;
use crate::ai_content::{AiContent, PromptTemplate, ProposalKind, archetype_vars, check_prompt, placeholders};
use manifest_core::StaticData;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;
use std::sync::Arc;
mod auction;

/// 一条缺失（回退到中文）的覆盖。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Missing {
    /// 覆盖文件（相对 data/），如 `locales/en/goods.toml`
    pub file: String,
    /// 条目与字段，如 `goods[grain].description`
    pub item: String,
}

/// 只做中文的世界里，已有英文的条目缺了也回退中文、不算不完整的字段：目前只有人物的一句话身份。
fn chinese_first_field(item: &str) -> bool {
    item.starts_with("persons[") && item.ends_with("].summary")
}

impl fmt::Display for Missing {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "data/{}：{}", self.file, self.item)
    }
}

/// 可覆盖的条目在静态数据中的位置。
#[derive(Clone, Copy, Debug)]
enum Slot {
    Good(usize),
    Ship(usize),
    Refit(usize),
    Faction(usize),
    Company(usize),
    Mate(usize),
    Animal(usize),
    Industry(usize),
    Recipe(usize),
    Exchange(usize),
    Event(usize),
    Effect(usize),
    Building(usize),
    Loc(usize),
    Region(usize),
    Discovery(usize),
    /// 河流（world/rivers.toml）
    Offstage(usize),
    OffstageRegion(usize),
    River(usize),
    /// 地标与奇观（world/landmarks.toml）
    Landmark(usize),
    Scenario(usize),
    World,
    /// 主角身世（captain.toml）：属性、星座（含旧版星宫）、问题、选项
    CaptainAttr(usize),
    CaptainGroup(usize),
    CaptainRating(usize),
    CaptainRole(usize),
    CaptainAbility(usize),
    CaptainSign(usize),
    CaptainQuestion(usize),
    CaptainOption(usize),
    /// 推荐角色（带主角的剧本的 [hero]）
    ScenarioHero(usize),
    /// 故事线的名字（stories/*.toml 顶层）
    StoryName(usize),
    /// 故事线的一章（故事线、章）
    Chapter(usize, usize),
    /// 一种奇遇
    Encounter(usize),
    /// 通用人物与往事名录的展示字段。
    Person(usize),
    PersonName(usize, usize),
    PersonLine(usize, usize, usize),
    Past(usize),
    Item(usize),
    ItemSet(usize),
    BookCategory(usize),
    Skill2(usize),
    Track2(usize),
    Chapter2(usize, usize),
    Choice2(usize, usize, usize),
    Variant2(usize, usize, usize),
    Objective2(usize, usize, usize),
    Branch2(usize, usize, story2::BranchSlot),
    Effect2(usize, usize, story2::BranchSlot, usize),
    Society(usize),
    Realm(usize),
    RealmRule(usize, usize),
    Lineage(usize),
    LineageWeakness(usize, usize),
    Creature(usize),
    CreatureOutcome(usize, manifest_core::creatures::Response),
    ArcanaSchool(usize),
    LegendShip(usize),
    LegendShipTrait(usize, usize),
    ArcanaSpell(usize),
    SocietyRank(usize, usize),
    Idea(usize),
    IdeaPort(usize),
    IdeaMode(usize, usize),
    IdeaNeed(usize, usize, usize),
    HistoryEvent(usize),
    HistoryReason(usize, usize),
    HistorySide(usize, usize),
    HistoryOutcome(usize, usize),
    HistoryLever(usize, usize),
    HistoryCampaign(usize),
    HistoryVar(usize, usize),
    UpbringingNative(upbringing::native::NativeSlot),
    HistoryOutlook(usize, usize),
    HistoryEnding(usize, usize),
    UpbringingFamily(usize),
    UpbringingStage(usize, usize),
    UpbringingActivity(usize),
    UpbringingExam(usize),
    UpbringingPath(usize),
    UpbringingEnding(usize),
    UpbringingExamTitle(usize, usize),
    UpbringingPathTitle(usize, usize),
    UpbringingEndingTitle(usize, usize),
    UpbringingContest(usize),
    ContestRaceLeg(usize, usize),
    ContestRaceOption(usize, usize, usize),
    ContestIdentifyClue(usize, usize, usize),
    ContestIdentifyAnswer(usize, usize),
    ContestDebateTopic(usize),
    ContestDebateOpponent(usize, usize),
    ContestDebateCard(usize, usize),
    ContestPoemTheme(usize),
    ContestPoemHint(usize, usize),
    ContestPoemPrompt(usize, usize),
    ContestPoemOption(usize, usize, usize),
    UpbringingAcademy(usize),
    UpbringingFamilyPlace(usize, usize),
    UpbringingAcademyPlace(usize, usize),
    UpbringingCalendar(usize, usize),
    UpbringingFestival(usize),
    UpbringingExcursion(usize),
    UpbringingNode(usize, usize),
    Figure(usize),
}

/// 剧情事件选项的可覆盖字段（按选项顺序，最多三个）。
const CHOICE_TEXT: [&str; 3] = ["choice_1", "choice_2", "choice_3"];
const CHOICE_REPLY: [&str; 3] = ["reply_1", "reply_2", "reply_3"];
const CHOICE_FAIL: [&str; 3] = ["fail_reply_1", "fail_reply_2", "fail_reply_3"];

/// 一章或一种奇遇的可覆盖字段：标题、叙事、提示（章节）、说话人，以及各选项的文字、回应与检定失败时的回应。
fn story_fields(
    title: &str,
    text: &str,
    hint: Option<&str>,
    speaker: &str,
    choices: &[manifest_core::story::ChoiceDef],
) -> Vec<(&'static str, String)> {
    let mut f = vec![("title", title.to_string()), ("text", text.to_string())];
    if let Some(h) = hint {
        f.push(("hint", h.to_string()));
    }
    f.push(("speaker_name", speaker.to_string()));
    for (i, c) in choices.iter().enumerate().take(3) {
        f.push((CHOICE_TEXT[i], c.text.clone()));
        f.push((CHOICE_REPLY[i], c.reply.clone()));
        f.push((CHOICE_FAIL[i], c.fail_reply.clone()));
    }
    f
}

/// 一个可覆盖的条目：key、可覆盖的字段（及其中文原文）与位置。
struct Entry {
    key: String,
    fields: Vec<(&'static str, String)>,
    slot: Slot,
}

mod native_display;
pub(crate) use native_display::{native_history_display, native_ideas_display, native_upbringing_display};

/// 一个覆盖文件的结构。
struct FileSpec {
    /// 相对原数据目录的路径（覆盖文件在语言目录下的同一路径）
    rel: String,
    /// 带 key 的表：表名 → 条目
    keyed: Vec<(&'static str, Vec<Entry>)>,
    /// 不带 key 的表（如 rules.toml 的 [world]）：表名 → 条目
    single: Vec<(&'static str, Entry)>,
    /// 顶层字段（剧本文件）
    top: Option<Entry>,
    /// 商品类别（goods.toml 的 [categories]）
    categories: Vec<String>,
}

impl FileSpec {
    fn new(rel: &str) -> FileSpec {
        FileSpec { rel: rel.to_string(), keyed: Vec::new(), single: Vec::new(), top: None, categories: Vec::new() }
    }

    fn table(mut self, name: &'static str, entries: Vec<Entry>) -> FileSpec {
        self.keyed.push((name, entries));
        self
    }
}

fn entry(key: &str, slot: Slot, fields: &[(&'static str, &String)]) -> Entry {
    Entry { key: key.to_string(), fields: fields.iter().map(|(f, v)| (*f, (*v).clone())).collect(), slot }
}

/// 读取原数据文件中某张数组表的 key 列表（只取 key，其余字段已由主加载流程校验过）。
fn raw_keys(dir: &Source<'_>, rel: &str, table: &str, issues: &mut Vec<DataIssue>) -> Vec<String> {
    let path = if rel.is_empty() { dir.clone() } else { dir.join(rel) };
    if !path.is_file() {
        return Vec::new();
    }
    let parsed = path.read().ok().and_then(|t| t.parse::<toml::Table>().ok());
    let Some(t) = parsed else {
        issues.push(DataIssue { file: rel.into(), item: String::new(), message: "无法读取原数据文件".into() });
        return Vec::new();
    };
    t.get(table)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|e| e.get("key").and_then(|k| k.as_str()).map(str::to_string)).collect())
        .unwrap_or_default()
}

/// 全部可覆盖的文件与条目（依据已加载的原数据）。
fn specs(dir: &Source<'_>, defs: &StaticData, issues: &mut Vec<DataIssue>) -> Vec<FileSpec> {
    let mut out = Vec::new();
    out.push(
        FileSpec::new("items.toml")
            .table(
                "items",
                defs.items
                    .items
                    .iter()
                    .enumerate()
                    .map(|(i, p)| {
                        entry(&p.key, Slot::Item(i), &[("name", &p.name), ("desc", &p.desc), ("lore", &p.lore)])
                    })
                    .collect(),
            )
            .table(
                "sets",
                defs.items
                    .sets
                    .iter()
                    .enumerate()
                    .map(|(i, p)| entry(&p.key, Slot::ItemSet(i), &[("name", &p.name), ("title", &p.title)]))
                    .collect(),
            )
            .table(
                "book_categories",
                defs.items
                    .book_categories
                    .iter()
                    .enumerate()
                    .map(|(i, p)| entry(&p.key, Slot::BookCategory(i), &[("name", &p.name)]))
                    .collect(),
            ),
    );
    out.extend(cast::specs(defs));
    let mut goods = FileSpec::new("goods.toml").table(
        "goods",
        defs.goods
            .iter()
            .enumerate()
            .map(|(i, g)| entry(&g.key, Slot::Good(i), &[("name", &g.name), ("description", &g.description)]))
            .collect(),
    );
    let mut cats: Vec<String> = Vec::new();
    for g in &defs.goods {
        if !cats.contains(&g.category) {
            cats.push(g.category.clone());
        }
    }
    goods.categories = cats;
    out.push(goods);
    out.push(
        FileSpec::new("ships.toml")
            .table(
                "ships",
                defs.ships
                    .iter()
                    .enumerate()
                    .map(|(i, s)| entry(&s.key, Slot::Ship(i), &[("name", &s.name), ("description", &s.description)]))
                    .collect(),
            )
            .table(
                "refits",
                defs.refits
                    .iter()
                    .enumerate()
                    .map(|(i, r)| entry(&r.key, Slot::Refit(i), &[("name", &r.name)]))
                    .collect(),
            ),
    );
    out.push(FileSpec::new("factions.toml").table(
        "factions",
        defs.factions.iter().enumerate().map(|(i, f)| entry(&f.key, Slot::Faction(i), &[("name", &f.name)])).collect(),
    ));
    out.push(
        FileSpec::new("companies.toml").table(
            "companies",
            defs.companies
                .iter()
                .enumerate()
                .map(|(i, c)| entry(&c.key, Slot::Company(i), &[("name", &c.name), ("persona", &c.persona)]))
                .collect(),
        ),
    );
    let mate_fragments = dir.table_fragments("mates.toml").unwrap_or_else(|message| {
        issues.push(DataIssue { file: "mates.toml".into(), item: "mates".into(), message });
        Vec::new()
    });
    if mate_fragments.is_empty() {
        out.push(
            FileSpec::new("mates.toml").table(
                "mates",
                defs.mates
                    .iter()
                    .enumerate()
                    .filter(|(_, m)| {
                        !m.hidden
                            || !defs
                                .cast
                                .persons
                                .iter()
                                .any(|p| p.key == m.key && p.mate.as_ref().is_some_and(|binding| binding.key.is_none()))
                    })
                    .map(|(i, m)| entry(&m.key, Slot::Mate(i), &[("name", &m.name), ("bio", &m.bio)]))
                    .collect(),
            ),
        );
    } else {
        // 显式登记的航海士沿物理来源翻译；自动派生的身份仍由 cast 覆盖同步。
        for (rel, source) in mate_fragments {
            let keys = raw_keys(&source, "", "mates", issues);
            out.push(
                FileSpec::new(&rel).table(
                    "mates",
                    defs.mates
                        .iter()
                        .enumerate()
                        .filter(|(_, mate)| keys.contains(&mate.key))
                        .map(|(i, mate)| entry(&mate.key, Slot::Mate(i), &[("name", &mate.name), ("bio", &mate.bio)]))
                        .collect(),
                ),
            );
        }
    }
    out.push(FileSpec::new("caravans.toml").table(
        "animals",
        defs.animals.iter().enumerate().map(|(i, a)| entry(&a.key, Slot::Animal(i), &[("name", &a.name)])).collect(),
    ));
    out.push(
        FileSpec::new("recipes.toml")
            .table(
                "industries",
                defs.industry_types
                    .iter()
                    .enumerate()
                    .map(|(i, t)| entry(&t.key, Slot::Industry(i), &[("name", &t.name)]))
                    .collect(),
            )
            .table(
                "recipes",
                defs.recipes
                    .iter()
                    .enumerate()
                    .map(|(i, r)| entry(&r.key, Slot::Recipe(i), &[("name", &r.name)]))
                    .collect(),
            ),
    );
    out.push(
        FileSpec::new("futures.toml").table(
            "exchanges",
            defs.exchanges
                .iter()
                .enumerate()
                .map(|(i, e)| entry(&e.key, Slot::Exchange(i), &[("name", &e.name)]))
                .collect(),
        ),
    );
    out.push(
        FileSpec::new("events.toml").table(
            "events",
            defs.events
                .iter()
                .enumerate()
                .map(|(i, e)| entry(&e.key, Slot::Event(i), &[("name", &e.name), ("description", &e.description)]))
                .collect(),
        ),
    );
    out.push(
        FileSpec::new("effects.toml").table(
            "effects",
            defs.composed
                .effects
                .iter()
                .enumerate()
                .map(|(i, b)| {
                    entry(b.effect.key(), Slot::Effect(i), &[("name", &b.name), ("description", &b.description)])
                })
                .collect(),
        ),
    );
    out.push(
        FileSpec::new("colony.toml").table(
            "buildings",
            defs.colony_buildings
                .iter()
                .enumerate()
                .map(|(i, b)| entry(&b.key, Slot::Building(i), &[("name", &b.name), ("description", &b.description)]))
                .collect(),
        ),
    );
    let mut rules = FileSpec::new("rules.toml");
    let w = &defs.rules.world;
    rules.single.push(("world", entry("", Slot::World, &[("currency", &w.currency), ("era", &w.era)])));
    out.push(rules);
    // 主角身世（data/captain.toml 存在时）：属性、星座（含旧版星宫）、问题与选项的显示文字
    let cap = &defs.captain;
    if cap.enabled() {
        out.push(
            FileSpec::new("captain.toml")
                .table(
                    "groups",
                    cap.groups
                        .iter()
                        .enumerate()
                        .filter(|_| !cap.legacy)
                        .map(|(i, g)| entry(&g.key, Slot::CaptainGroup(i), &[("name", &g.name)]))
                        .collect(),
                )
                .table(
                    "ratings",
                    cap.ratings
                        .iter()
                        .enumerate()
                        .map(|(i, r)| entry(&r.key, Slot::CaptainRating(i), &[("name", &r.name)]))
                        .collect(),
                )
                .table(
                    "roles",
                    cap.roles
                        .iter()
                        .enumerate()
                        .filter(|_| !cap.legacy)
                        // H01：岗位说明（desc）只在世界写了时才是可翻译的字段
                        .map(|(i, r)| {
                            if r.desc.is_empty() {
                                entry(&r.key, Slot::CaptainRole(i), &[("name", &r.name)])
                            } else {
                                entry(&r.key, Slot::CaptainRole(i), &[("name", &r.name), ("desc", &r.desc)])
                            }
                        })
                        .collect(),
                )
                .table(
                    "abilities",
                    cap.abilities
                        .iter()
                        .enumerate()
                        .skip(4)
                        .map(|(i, a)| entry(&a.key, Slot::CaptainAbility(i), &[("name", &a.name)]))
                        .collect(),
                )
                .table(
                    "attributes",
                    cap.attributes
                        .iter()
                        .enumerate()
                        .map(|(i, a)| entry(&a.key, Slot::CaptainAttr(i), &[("name", &a.name), ("desc", &a.desc)]))
                        .collect(),
                )
                .table(
                    "signs",
                    cap.signs
                        .iter()
                        .enumerate()
                        .map(|(i, x)| entry(&x.key, Slot::CaptainSign(i), &[("name", &x.name), ("desc", &x.desc)]))
                        .collect(),
                )
                .table(
                    "questions",
                    cap.questions
                        .iter()
                        .enumerate()
                        .map(|(i, q)| {
                            entry(&q.key, Slot::CaptainQuestion(i), &[("title", &q.title), ("prompt", &q.prompt)])
                        })
                        .collect(),
                )
                .table(
                    "options",
                    cap.options
                        .iter()
                        .enumerate()
                        .map(|(i, o)| entry(&o.key, Slot::CaptainOption(i), &[("name", &o.name), ("text", &o.text)]))
                        .collect(),
                ),
        );
    }
    out.push(FileSpec::new("world/regions.toml").table(
        "regions",
        defs.regions.iter().enumerate().map(|(i, r)| entry(&r.key, Slot::Region(i), &[("name", &r.name)])).collect(),
    ));
    out.push(
        FileSpec::new("world/discoveries.toml").table(
            "discoveries",
            defs.discoveries
                .iter()
                .enumerate()
                .map(|(i, d)| entry(&d.key, Slot::Discovery(i), &[("name", &d.name), ("lore", &d.lore)]))
                .collect(),
        ),
    );
    // 地理图层（EXPANSION §10.3）：河流名、地标名与传说。数据没有这两个文件时条目为空
    let geo = &defs.geography;
    out.push(
        FileSpec::new("offstage.toml")
            .table(
                "offstage",
                geo.places
                    .offstage
                    .iter()
                    .enumerate()
                    .map(|(i, p)| entry(&p.key, Slot::Offstage(i), &[("name", &p.name)]))
                    .collect(),
            )
            .table(
                "offstage_regions",
                geo.places
                    .offstage_regions
                    .iter()
                    .enumerate()
                    .map(|(i, p)| entry(&p.key, Slot::OffstageRegion(i), &[("name", &p.name)]))
                    .collect(),
            ),
    );
    out.push(FileSpec::new("world/rivers.toml").table(
        "rivers",
        geo.rivers.iter().enumerate().map(|(i, r)| entry(&r.key, Slot::River(i), &[("name", &r.name)])).collect(),
    ));
    out.push(
        FileSpec::new("world/landmarks.toml").table(
            "landmarks",
            geo.landmarks
                .iter()
                .enumerate()
                .map(|(i, l)| entry(&l.key, Slot::Landmark(i), &[("name", &l.name), ("lore", &l.lore)]))
                .collect(),
        ),
    );
    // 地点：按原文件分开（同一 key 只属于一个文件）
    let loc_entries = |keys: Vec<String>| -> Vec<Entry> {
        keys.iter()
            .filter_map(|k| {
                if defs.geography.places.authored.sites.contains_key(k) {
                    let i = defs.geography.landmarks.iter().position(|l| &l.key == k)?;
                    let l = &defs.geography.landmarks[i];
                    return Some(entry(k, Slot::Landmark(i), &[("name", &l.name), ("lore", &l.lore)]));
                }
                let i = defs.locations.iter().position(|l| &l.key == k)?;
                let l = &defs.locations[i];
                let mut fields = vec![("name", &l.name), ("lore", &l.lore)];
                if let Some(river) = defs.geography.places.authored.locations.get(k).and_then(|s| s.river.as_ref()) {
                    fields.push(("river", river));
                }
                Some(entry(k, Slot::Loc(i), &fields))
            })
            .collect()
    };
    let ports = raw_keys(dir, "world/ports.toml", "ports", issues);
    out.push(FileSpec::new("world/ports.toml").table("ports", loc_entries(ports)));
    let cities = raw_keys(dir, "world/cities.toml", "cities", issues);
    out.push(FileSpec::new("world/cities.toml").table("cities", loc_entries(cities)));
    let o_ports = raw_keys(dir, "world/overseas.toml", "ports", issues);
    let o_sites = raw_keys(dir, "world/overseas.toml", "sites", issues);
    out.push(
        FileSpec::new("world/overseas.toml").table("ports", loc_entries(o_ports)).table("sites", loc_entries(o_sites)),
    );
    // 剧本：每个剧本文件对应一个覆盖文件
    {
        let names = dir.join("scenarios").files();
        for n in names {
            let rel = format!("scenarios/{n}");
            let key = dir
                .join("scenarios")
                .join(&n)
                .read()
                .ok()
                .and_then(|t| t.parse::<toml::Table>().ok())
                .and_then(|t| t.get("key").and_then(|k| k.as_str()).map(str::to_string));
            let Some(i) = key.and_then(|k| defs.scenarios.iter().position(|s| s.key == k)) else { continue };
            let s = &defs.scenarios[i];
            let mut spec = FileSpec::new(&rel);
            spec.top = Some(entry(&s.key, Slot::Scenario(i), &[("name", &s.name), ("description", &s.description)]));
            if let Some(h) = &s.hero {
                spec.single.push((
                    "hero",
                    entry("", Slot::ScenarioHero(i), &[("name", &h.name), ("tagline", &h.tagline), ("bio", &h.bio)]),
                ));
            }
            out.push(spec);
        }
    }
    for source in defs.story2.skill_labels.iter().map(|s| &s.source).collect::<BTreeSet<_>>() {
        let entries = defs
            .story2
            .skill_labels
            .iter()
            .enumerate()
            .filter(|(_, s)| &s.source == source)
            .map(|(i, s)| entry(&s.key, Slot::Skill2(i), &[("name", &s.name), ("description", &s.description)]))
            .collect();
        out.push(FileSpec::new(source).table("skills", entries));
    }
    // 剧情事件：每个故事文件对应一个覆盖文件（故事线的名字、章节与文件里的奇遇）
    {
        let names = dir.join("stories").files();
        let st = &defs.stories;
        for n in names {
            let rel = format!("stories/{n}");
            // 同一个文件只解析一次：既看是不是新轨道格式，也取故事的 key（2026-11-03 启动提速）
            let table = dir.join(&rel).read().ok().and_then(|s| toml::from_str::<toml::Table>(&s).ok());
            if table.as_ref().is_some_and(|t| t.contains_key("tracks")) {
                continue;
            }
            let key = table.as_ref().and_then(|t| t.get("key").and_then(|k| k.as_str()).map(str::to_string));
            let mut spec = FileSpec::new(&rel);
            if let Some(si) = key.and_then(|k| st.stories.iter().position(|s| s.key == k)) {
                let s = &st.stories[si];
                spec.top = Some(entry(&s.key, Slot::StoryName(si), &[("name", &s.name)]));
                let chapters = s
                    .chapters
                    .iter()
                    .enumerate()
                    .map(|(ci, c)| Entry {
                        key: c.key.clone(),
                        fields: story_fields(&c.title, &c.text, Some(&c.hint), &c.speaker_name, &c.choices),
                        slot: Slot::Chapter(si, ci),
                    })
                    .collect();
                spec = spec.table("chapters", chapters);
            }
            let keys = raw_keys(dir, &rel, "encounters", issues);
            let encounters: Vec<Entry> = keys
                .iter()
                .filter_map(|k| {
                    let i = st.encounters.iter().position(|e| &e.key == k)?;
                    let e = &st.encounters[i];
                    Some(Entry {
                        key: k.clone(),
                        fields: story_fields(&e.title, &e.text, None, &e.speaker_name, &e.choices),
                        slot: Slot::Encounter(i),
                    })
                })
                .collect();
            if !encounters.is_empty() {
                spec = spec.table("encounters", encounters);
            }
            out.push(spec);
        }
    }
    // 新轨道按原分片覆盖；章节、选项以组合 key 避免不同轨道同名冲突。
    let sources: BTreeSet<_> = defs.story2.tracks.iter().map(|t| t.source.as_str()).filter(|s| !s.is_empty()).collect();
    for source in sources {
        out.push(story2::specs(defs, source));
    }
    for source in defs
        .history
        .events
        .iter()
        .map(|e| e.source.as_str())
        .chain(defs.history.campaigns.iter().map(|c| c.source.as_str()))
        .collect::<BTreeSet<_>>()
    {
        out.push(history::specs(defs, source));
    }
    if !defs.arcana.is_empty() {
        out.push(arcana::spec(defs));
    }
    if !defs.creatures.is_empty() {
        out.push(creatures::spec(defs));
    }
    if !defs.lineages.is_empty() {
        out.push(lineages::spec(defs));
    }
    if !defs.realms.is_empty() {
        out.push(realms::spec(defs));
    }
    if !defs.legend_ships.is_empty() {
        out.push(legend_ships::spec(defs));
    }
    if !defs.societies.is_empty() {
        out.push(societies::spec(defs));
    }
    if !defs.ideas.is_empty() {
        out.push(ideas::spec(defs));
    }
    for extra in upbringing::specs(defs) {
        if let Some(existing) = out.iter_mut().find(|s| s.rel == extra.rel) {
            for (name, entries) in extra.keyed {
                if let Some((_, old)) = existing.keyed.iter_mut().find(|(n, _)| *n == name) {
                    old.extend(entries);
                } else {
                    existing.keyed.push((name, entries));
                }
            }
        } else {
            out.push(extra);
        }
    }
    out
}

/// 没有显示文字、不需要翻译的数据文件（相对 data/）。
/// - `world/roads.toml`：道路只有两端地点与长度、地形（道路名写在注释里）；
/// - `world/layout.toml`：世界地理的设计骨架，只给 `cargo xtask worldgen` 读，游戏不加载它。其中的 `name`
///   只是说明（如“旧世界（环抱维斯塔海的大陆）”），生成器把河流与地标的名字写进 `rivers.toml`、`landmarks.toml`，
///   游戏里显示的是后两者（已登记，英文在 `locales/en/world/` 的同名文件）；
/// - `workshops.toml`：城镇工坊只有地点、配方与份额（显示用配方与商品的名字，已登记）。
/// - `world/anchors.toml`：生成的定位记录，name 仅供诊断；游戏名称取已翻译的港口/城市表。
/// - `world/mapgen.toml`、`world/sources.toml`：生成配置与来源审计，不进入游戏文案。
/// - `world/climate_regions.toml`：生成器的手写气候区，name 仅作说明；游戏只加载生成后的地貌码。
/// - `navigation.toml`：导航数值、投影与引用键；显示海区名取已登记的海区表。
pub const FILES_WITHOUT_DISPLAY_TEXT: &[&str] = &[
    "runtime_links.toml",
    "world/roads.toml",
    "world/layout.toml",
    "workshops.toml",
    "world/anchors.toml",
    "world/mapgen.toml",
    "world/sources.toml",
    "world/climate_regions.toml",
    "navigation.toml",
    // M01 细海图的说明（`maps/earth/fine/fine.toml`，xtask mapgen 生成）：只有格式、来源、校验和与计数，没有显示文字
    "world/fine/fine.toml",
];

/// 可以用语言覆盖文件翻译的数据文件（相对 data/，与覆盖文件同路径）。
/// 新增带显示文字的数据文件时，要在 [`specs`] 里登记它的表与字段（测试会检查 data/ 下没有漏登记的文件）。
pub fn data_files(dir: &Path, defs: &StaticData) -> Vec<String> {
    let mut issues = Vec::new();
    let mut files: Vec<_> = specs(&Source::directory(dir), defs, &mut issues).into_iter().map(|s| s.rel).collect();
    files.extend(super::fragments::registered(dir));
    // 这是全数据目录的显示 schema 清单；经典 StaticData 为空也不能漏掉完整世界的拍卖文件。
    files.extend([
        "auctions.toml".into(),
        "persons.toml".into(),
        "ideas.toml".into(),
        "societies.toml".into(),
        "legend_ships.toml".into(),
        "realms.toml".into(),
        "lineages.toml".into(),
        "creatures.toml".into(),
        "arcana.toml".into(),
        // H04 海上所见（仅中文，缺译回退中文）
        "sightings.toml".into(),
        // H08 甲板闲话（仅中文，缺译回退中文）
        "banter.toml".into(),
    ]);
    // 全部正式世界的已登记新故事都有同一路径的可执行覆盖 schema。
    if let Ok(worlds) = std::fs::read_dir(dir.join("worlds")) {
        for world in worlds.flatten().filter(|e| e.path().is_dir()) {
            files.extend(history::registered_files(&world.path()));
            let manifest = std::fs::read_to_string(world.path().join("world.toml"))
                .ok()
                .and_then(|s| toml::from_str::<crate::worlds::WorldManifest>(&s).ok());
            if let Some(manifest) = manifest {
                for rel in manifest.tables.get("upbringing").into_iter().flatten() {
                    if Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)))
                        && std::fs::read_to_string(world.path().join(rel))
                            .ok()
                            .and_then(|s| toml::from_str::<manifest_core::upbringing::UpbringingDefs>(&s).ok())
                            .is_some()
                    {
                        files.push(rel.clone());
                        // 完整世界按 [tables] 将物理分片映射到统一的养成显示表。
                        files.push("upbringing.toml".into());
                    }
                }
                for rel in manifest.tables.get("stories").into_iter().flatten() {
                    if Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)))
                        && std::fs::read_to_string(world.path().join(rel))
                            .ok()
                            .and_then(|s| toml::from_str::<manifest_core::story2::Story2Defs>(&s).ok())
                            .is_some_and(|d| !d.tracks.is_empty())
                    {
                        files.push(rel.clone());
                    }
                }
                // 旧式故事文件（奇遇、旧故事线；没有 tracks）登记在世界的 stories 表里时，覆盖 schema 就是上面
                // [`specs`] 的“剧情事件”一段（与经典世界 stories/ 下的文件同一套）；这里按生产 schema 认出它们。
                for rel in manifest.tables.get("stories").into_iter().flatten() {
                    if Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_)))
                        && std::fs::read_to_string(world.path().join(rel))
                            .ok()
                            .and_then(|s| crate::convert::story::classic_file_keys(&s).ok())
                            .is_some_and(|(chapters, encounters)| !chapters.is_empty() || !encounters.is_empty())
                    {
                        files.push(rel.clone());
                    }
                }
                // 完整世界的人物、物品等分片同样按 [tables] 映射到统一的显示表（逐条覆盖由该世界自己的 specs 处理；
                // 寰宇 2026-11-02 转为成品世界后，这些分片不再走草稿的分片登记）。
                if !manifest.draft {
                    for table in ["persons", "past", "ties", "skills", "items", "sets", "auctions", "figures"] {
                        if manifest.tables.get(table).is_some_and(|paths| !paths.is_empty()) {
                            files.push(format!("{table}.toml"));
                        }
                    }
                }
            }
        }
    }
    files.sort();
    files.dedup();
    files
}

/// 一条被接受的覆盖。
struct Override {
    slot: Slot,
    field: &'static str,
    value: String,
}

fn issue(issues: &mut Vec<DataIssue>, file: &str, item: impl Into<String>, msg: impl Into<String>) {
    issues.push(DataIssue { file: file.to_string(), item: item.into(), message: msg.into() });
}

/// 校验一个条目的字段覆盖。`covered` 记下已覆盖的“条目.字段”。
fn take_fields(
    file: &str,
    item: &str,
    e: &Entry,
    t: &toml::Table,
    out: &mut Vec<Override>,
    covered: &mut BTreeSet<String>,
    issues: &mut Vec<DataIssue>,
) {
    for (field, v) in t {
        let Some((f, _)) = e.fields.iter().find(|(f, _)| f == field) else {
            let allowed: Vec<&str> = e.fields.iter().map(|(f, _)| *f).collect();
            issue(issues, file, item, format!("字段 {field} 不能覆盖（可覆盖：{}）", allowed.join("、")));
            continue;
        };
        match v.as_str() {
            Some(s) if !s.trim().is_empty() => {
                if matches!(
                    e.slot,
                    Slot::UpbringingNative(
                        upbringing::native::NativeSlot::YouthName(_) | upbringing::native::NativeSlot::CallYou(..)
                    )
                ) && (s.chars().count() > 20 || s.chars().any(char::is_control))
                {
                    issue(issues, file, format!("{item}.{field}"), "少年称呼超过20字或含控制字符");
                    continue;
                }
                if s.chars().any(|c| c.is_control() && c != '\n') {
                    issue(issues, file, format!("{item}.{field}"), "不能包含控制字符");
                    continue;
                }
                if matches!(e.slot, Slot::Chapter2(..)) && *f == "hint" && s.chars().count() > 120 {
                    issue(issues, file, format!("{item}.{field}"), "章节 hint 超过120字");
                    continue;
                }
                out.push(Override { slot: e.slot, field: f, value: s.to_string() });
                covered.insert(format!("{item}.{f}"));
            }
            Some(_) => issue(issues, file, format!("{item}.{field}"), "不能为空"),
            None => issue(issues, file, format!("{item}.{field}"), "应为文字"),
        }
    }
}

fn read_table(path: &Source<'_>, file: &str, issues: &mut Vec<DataIssue>) -> Option<toml::Table> {
    let text = match path.read() {
        Ok(t) => t,
        Err(e) => {
            issue(issues, file, "", format!("无法读取文件：{e}"));
            return None;
        }
    };
    match text.parse::<toml::Table>() {
        Ok(t) => Some(t),
        Err(e) => {
            issue(issues, file, "", format!("TOML 格式错误：{}", e.to_string().trim()));
            None
        }
    }
}

/// 读取一个数据覆盖文件。
fn read_data_file(
    spec: &FileSpec,
    path: &Source<'_>,
    file: &str,
    out: &mut Vec<Override>,
    categories: &mut BTreeMap<String, String>,
    covered: &mut BTreeSet<String>,
    issues: &mut Vec<DataIssue>,
) {
    let Some(mut table) = read_table(path, file, issues) else { return };
    if spec.keyed.iter().any(|(name, _)| *name == "tracks") {
        story2::normalize(&mut table, file, issues);
    }
    if spec.keyed.iter().any(|(name, _)| *name == "persons") {
        cast::normalize(&mut table, file, issues);
    }
    if let Some(top) = &spec.top {
        // 顶层字段；不带 key 的表（剧本的 [hero]）与带 key 的表（故事文件的章节与奇遇）另行处理
        let mut rest = toml::Table::new();
        for (name, _) in spec.single.iter() {
            if let Some(v) = table.remove(*name) {
                rest.insert(name.to_string(), v);
            }
        }
        for (name, _) in spec.keyed.iter() {
            if let Some(v) = table.remove(*name) {
                rest.insert(name.to_string(), v);
            }
        }
        take_fields(file, "", top, &table, out, covered, issues);
        read_tables(spec, rest, file, out, categories, covered, issues);
        return;
    }
    read_tables(spec, table, file, out, categories, covered, issues);
}

/// 数据覆盖文件里的表：商品类别、不带 key 的表与带 key 的表。
fn read_tables(
    spec: &FileSpec,
    table: toml::Table,
    file: &str,
    out: &mut Vec<Override>,
    categories: &mut BTreeMap<String, String>,
    covered: &mut BTreeSet<String>,
    issues: &mut Vec<DataIssue>,
) {
    for (name, v) in &table {
        if name == "categories" && !spec.categories.is_empty() {
            let Some(t) = v.as_table() else {
                issue(issues, file, "categories", "应为一张表：中文类别 = 显示名");
                continue;
            };
            for (cat, name) in t {
                if !spec.categories.contains(cat) {
                    issue(issues, file, format!("categories[{cat}]"), "原数据中没有这个商品类别");
                    continue;
                }
                match name.as_str() {
                    Some(s) if !s.trim().is_empty() => {
                        categories.insert(cat.clone(), s.to_string());
                        covered.insert(format!("categories[{cat}]"));
                    }
                    _ => issue(issues, file, format!("categories[{cat}]"), "应为非空文字"),
                }
            }
            continue;
        }
        if let Some((_, e)) = spec.single.iter().find(|(t, _)| t == name) {
            match v.as_table() {
                Some(t) => take_fields(file, name, e, t, out, covered, issues),
                None => issue(issues, file, name.as_str(), "应为一张表"),
            }
            continue;
        }
        let Some((_, entries)) = spec.keyed.iter().find(|(t, _)| t == name) else {
            let mut allowed: Vec<&str> = spec.keyed.iter().map(|(t, _)| *t).collect();
            allowed.extend(spec.single.iter().map(|(t, _)| *t));
            if !spec.categories.is_empty() {
                allowed.push("categories");
            }
            issue(issues, file, name.as_str(), format!("没有这张表（可覆盖：{}）", allowed.join("、")));
            continue;
        };
        let Some(t) = v.as_table() else {
            issue(issues, file, name.as_str(), format!("应写成 [{name}.<key>] 形式的表"));
            continue;
        };
        for (key, fields) in t {
            let item = format!("{name}[{key}]");
            let Some(e) = entries.iter().find(|e| &e.key == key) else {
                issue(issues, file, &item, "原数据中没有这个条目（key 必须与原数据一致）");
                continue;
            };
            match fields.as_table() {
                Some(f) => take_fields(file, &item, e, f, out, covered, issues),
                None => issue(issues, file, &item, "应为一张表（字段 = 文字）"),
            }
        }
    }
}

/// 把覆盖写进显示用的数据副本。
fn apply(defs: &mut StaticData, o: &Override) {
    let v = o.value.clone();
    let set = |target: &mut String| *target = v.clone();
    match (o.slot, o.field) {
        (Slot::Item(i), "name") => set(&mut defs.items.items[i].name),
        (Slot::Item(i), "desc") => set(&mut defs.items.items[i].desc),
        (Slot::Item(i), "lore") => set(&mut defs.items.items[i].lore),
        (Slot::BookCategory(i), "name") => set(&mut defs.items.book_categories[i].name),
        (Slot::ItemSet(i), "name") => set(&mut defs.items.sets[i].name),
        (Slot::ItemSet(i), "title") => set(&mut defs.items.sets[i].title),
        (Slot::Good(i), "name") => set(&mut defs.goods[i].name),
        (Slot::Good(i), "description") => set(&mut defs.goods[i].description),
        (Slot::Ship(i), "name") => set(&mut defs.ships[i].name),
        (Slot::Ship(i), "description") => set(&mut defs.ships[i].description),
        (Slot::Refit(i), _) => set(&mut defs.refits[i].name),
        (Slot::Faction(i), _) => set(&mut defs.factions[i].name),
        (Slot::Company(i), "persona") => set(&mut defs.companies[i].persona),
        (Slot::Company(i), _) => set(&mut defs.companies[i].name),
        (Slot::Mate(i), "name") => set(&mut defs.mates[i].name),
        (Slot::Mate(i), "bio") => set(&mut defs.mates[i].bio),
        (Slot::Figure(i), "name") => set(&mut defs.cast.figures[i].name),
        (Slot::Person(i), "name") => set(&mut defs.cast.persons[i].name),
        (Slot::Person(i), "role") => set(&mut defs.cast.persons[i].role),
        (Slot::Person(i), "persona") => set(&mut defs.cast.persons[i].persona),
        (Slot::Person(i), "summary") => set(&mut defs.cast.persons[i].summary),
        (Slot::Person(i), "secret") => set(&mut defs.cast.persons[i].secret),
        (Slot::Person(i), "after") => set(&mut defs.cast.persons[i].after),
        (Slot::PersonName(i, j), "text") => set(&mut defs.cast.persons[i].names[j].name),
        (Slot::PersonLine(i, j, k), "text") => {
            if let Some(lines) = defs.cast.persons[i].lines.values_mut().nth(j) {
                set(&mut lines[k]);
            }
        }
        (Slot::Past(i), "name") => set(&mut defs.cast.past[i].name),
        (Slot::Past(i), "lore") => set(&mut defs.cast.past[i].lore),
        (Slot::Animal(i), _) => set(&mut defs.animals[i].name),
        (Slot::Industry(i), _) => set(&mut defs.industry_types[i].name),
        (Slot::Recipe(i), _) => set(&mut defs.recipes[i].name),
        (Slot::Exchange(i), _) => set(&mut defs.exchanges[i].name),
        (Slot::Event(i), "name") => set(&mut defs.events[i].name),
        (Slot::Event(i), "description") => set(&mut defs.events[i].description),
        (Slot::Effect(i), "name") => set(&mut defs.composed.effects[i].name),
        (Slot::Effect(i), "description") => set(&mut defs.composed.effects[i].description),
        (Slot::Building(i), "name") => set(&mut defs.colony_buildings[i].name),
        (Slot::Building(i), "description") => set(&mut defs.colony_buildings[i].description),
        (Slot::Loc(i), "name") => set(&mut defs.locations[i].name),
        (Slot::Loc(i), "lore") => set(&mut defs.locations[i].lore),
        (Slot::Loc(i), "river") => {
            if let Some(river) =
                defs.geography.places.authored.locations.get_mut(&defs.locations[i].key).and_then(|s| s.river.as_mut())
            {
                set(river);
            }
        }
        (Slot::Region(i), _) => set(&mut defs.regions[i].name),
        (Slot::Discovery(i), "name") => set(&mut defs.discoveries[i].name),
        (Slot::Discovery(i), "lore") => set(&mut defs.discoveries[i].lore),
        (Slot::Offstage(i), _) => set(&mut defs.geography.places.offstage[i].name),
        (Slot::OffstageRegion(i), _) => set(&mut defs.geography.places.offstage_regions[i].name),
        (Slot::River(i), _) => set(&mut defs.geography.rivers[i].name),
        (Slot::Landmark(i), "name") => set(&mut defs.geography.landmarks[i].name),
        (Slot::Landmark(i), "lore") => set(&mut defs.geography.landmarks[i].lore),
        (Slot::Scenario(i), "name") => set(&mut defs.scenarios[i].name),
        (Slot::Scenario(i), "description") => set(&mut defs.scenarios[i].description),
        (Slot::World, "currency") => set(&mut defs.rules.world.currency),
        (Slot::World, "era") => set(&mut defs.rules.world.era),
        (Slot::CaptainGroup(i), "name") => set(&mut defs.captain.groups[i].name),
        (Slot::CaptainRating(i), "name") => set(&mut defs.captain.ratings[i].name),
        (Slot::CaptainRole(i), "name") => set(&mut defs.captain.roles[i].name),
        (Slot::CaptainRole(i), "desc") => set(&mut defs.captain.roles[i].desc),
        (Slot::CaptainAbility(i), "name") => set(&mut defs.captain.abilities[i].name),
        (Slot::Skill2(i), "name") => set(&mut defs.story2.skill_labels[i].name),
        (Slot::Skill2(i), "description") => set(&mut defs.story2.skill_labels[i].description),
        (Slot::CaptainAttr(i), "name") => set(&mut defs.captain.attributes[i].name),
        (Slot::CaptainAttr(i), "desc") => set(&mut defs.captain.attributes[i].desc),
        (Slot::CaptainSign(i), "name") => set(&mut defs.captain.signs[i].name),
        (Slot::CaptainSign(i), "desc") => set(&mut defs.captain.signs[i].desc),
        (Slot::CaptainQuestion(i), "title") => set(&mut defs.captain.questions[i].title),
        (Slot::CaptainQuestion(i), "prompt") => set(&mut defs.captain.questions[i].prompt),
        (Slot::CaptainOption(i), "name") => set(&mut defs.captain.options[i].name),
        (Slot::CaptainOption(i), "text") => set(&mut defs.captain.options[i].text),
        (Slot::ScenarioHero(i), f) => {
            if let Some(h) = defs.scenarios[i].hero.as_mut() {
                match f {
                    "name" => set(&mut h.name),
                    "tagline" => set(&mut h.tagline),
                    "bio" => set(&mut h.bio),
                    _ => {}
                }
            }
        }
        (Slot::StoryName(i), _) => set(&mut defs.stories.stories[i].name),
        (Slot::UpbringingNative(slot), field) => upbringing::native::apply(defs, slot, field, v),
        (slot @ (Slot::ArcanaSchool(..) | Slot::ArcanaSpell(..)), field) => arcana::apply(defs, slot, field, v),
        (slot @ (Slot::LegendShip(_) | Slot::LegendShipTrait(_, _)), field) => {
            legend_ships::apply(defs, slot, field, v)
        }
        (slot @ (Slot::Creature(..) | Slot::CreatureOutcome(..)), field) => creatures::apply(defs, slot, field, v),
        (slot @ (Slot::Lineage(..) | Slot::LineageWeakness(..)), field) => lineages::apply(defs, slot, field, v),
        (slot @ (Slot::Realm(..) | Slot::RealmRule(..)), field) => realms::apply(defs, slot, field, v),
        (slot @ (Slot::Society(..) | Slot::SocietyRank(..)), field) => societies::apply(defs, slot, field, v),
        (slot @ (Slot::Idea(..) | Slot::IdeaPort(..) | Slot::IdeaMode(..) | Slot::IdeaNeed(..)), field) => {
            ideas::apply(defs, slot, field, v)
        }
        (Slot::UpbringingFamily(i), "name") => defs.upbringing.families[i].name = v,
        (Slot::UpbringingStage(i, j), "name") => defs.upbringing.families[i].stages[j].name = v,
        (Slot::UpbringingAcademy(i), "name") => defs.upbringing.academies[i].name = v,
        (Slot::UpbringingFamilyPlace(i, j), "name") => defs.upbringing.families[i].places[j].name = v,
        (Slot::UpbringingFamilyPlace(i, j), "hint") => defs.upbringing.families[i].places[j].hint = Some(v),
        (Slot::UpbringingAcademyPlace(i, j), "name") => defs.upbringing.academies[i].places[j].name = v,
        (Slot::UpbringingAcademyPlace(i, j), "hint") => defs.upbringing.academies[i].places[j].hint = Some(v),
        (Slot::UpbringingCalendar(i, j), "name") => defs.upbringing.academies[i].calendar[j].name = v,
        (Slot::UpbringingFestival(i), "name") => defs.upbringing.festivals[i].name = v,
        (Slot::UpbringingFestival(i), "customs") => defs.upbringing.festivals[i].customs = v,
        (Slot::UpbringingFestival(i), "gift_custom") => defs.upbringing.festivals[i].gift_custom = v,
        (Slot::UpbringingFestival(i), "date_note") => defs.upbringing.festivals[i].date_note = v,
        (Slot::UpbringingExcursion(i), "name") => defs.upbringing.excursions[i].name = v,
        (Slot::UpbringingNode(i, j), "name") => defs.upbringing.excursions[i].nodes[j].name = v,
        (Slot::UpbringingNode(i, j), "hint") => defs.upbringing.excursions[i].nodes[j].hint = Some(v),
        (Slot::UpbringingExam(i), "name") => defs.upbringing.exams[i].name = v,
        (Slot::UpbringingExam(i), "description") => defs.upbringing.exams[i].description = v,
        (Slot::UpbringingPath(i), "name") => defs.upbringing.paths[i].name = v,
        (Slot::UpbringingPath(i), "description") => defs.upbringing.paths[i].description = v,
        (Slot::UpbringingEnding(i), "title") => defs.upbringing.endings[i].title = v,
        (Slot::UpbringingEnding(i), "text") => defs.upbringing.endings[i].text = v,
        (Slot::UpbringingExamTitle(i, j), "text") => defs.upbringing.exams[i].award.titles[j] = v,
        (Slot::UpbringingPathTitle(i, j), "text") => defs.upbringing.paths[i].award.titles[j] = v,
        (Slot::UpbringingEndingTitle(i, j), "text") => defs.upbringing.endings[i].award.titles[j] = v,
        (Slot::UpbringingContest(i), "name") => defs.upbringing.contests[i].name = v,
        (Slot::ContestRaceLeg(i, j), "text") => {
            if let manifest_core::contests::Params::Race(p) = &mut defs.upbringing.contests[i].params {
                p.legs[j].text = v;
            }
        }
        (Slot::ContestRaceOption(i, j, k), "text") => {
            if let manifest_core::contests::Params::Race(p) = &mut defs.upbringing.contests[i].params {
                p.legs[j].options[k].text = v;
            }
        }
        (Slot::ContestIdentifyClue(i, j, k), "text") => {
            if let manifest_core::contests::Params::Identify(p) = &mut defs.upbringing.contests[i].params {
                p.samples[j].clues[k] = v;
            }
        }
        (Slot::ContestIdentifyAnswer(i, j), "name") => {
            if let manifest_core::contests::Params::Identify(p) = &mut defs.upbringing.contests[i].params {
                p.answers[j].name = v;
            }
        }
        (Slot::ContestDebateTopic(i), "text") => {
            if let manifest_core::contests::Params::Debate(p) = &mut defs.upbringing.contests[i].params {
                p.topic = v;
            }
        }
        (Slot::ContestDebateOpponent(i, j), "text") => {
            if let manifest_core::contests::Params::Debate(p) = &mut defs.upbringing.contests[i].params {
                p.rounds[j].opponent.text = v;
            }
        }
        (Slot::ContestDebateCard(i, j), "text") => {
            if let manifest_core::contests::Params::Debate(p) = &mut defs.upbringing.contests[i].params {
                p.hand[j].text = v;
            }
        }
        (Slot::ContestPoemTheme(i), "text") => {
            if let manifest_core::contests::Params::Poem(p) = &mut defs.upbringing.contests[i].params {
                p.theme = v;
            }
        }
        (Slot::ContestPoemHint(i, j), "text") => {
            if let manifest_core::contests::Params::Poem(p) = &mut defs.upbringing.contests[i].params {
                p.hints[j] = v;
            }
        }
        (Slot::ContestPoemPrompt(i, j), "text") => {
            if let manifest_core::contests::Params::Poem(p) = &mut defs.upbringing.contests[i].params {
                p.lines[j].prompt = v;
            }
        }
        (Slot::ContestPoemOption(i, j, k), "text") => {
            if let manifest_core::contests::Params::Poem(p) = &mut defs.upbringing.contests[i].params {
                p.lines[j].options[k] = v;
            }
        }
        (Slot::UpbringingActivity(i), "name") => defs.upbringing.activities[i].name = v,
        (Slot::UpbringingActivity(i), "description") => defs.upbringing.activities[i].description = v,
        (Slot::UpbringingActivity(i), "tier_name") => {
            if let Some(t) = &mut defs.upbringing.activities[i].tier {
                t.name = v;
            }
        }
        (Slot::Track2(t), "name") => defs.story2.tracks[t].name = v,
        (
            slot @ (Slot::HistoryEvent(..)
            | Slot::HistoryReason(..)
            | Slot::HistorySide(..)
            | Slot::HistoryOutcome(..)
            | Slot::HistoryLever(..)
            | Slot::HistoryCampaign(..)
            | Slot::HistoryVar(..)
            | Slot::HistoryOutlook(..)
            | Slot::HistoryEnding(..)),
            field,
        ) => history::apply(defs, slot, field, v),
        (Slot::Chapter2(t, c), f) => {
            let c = &mut defs.story2.tracks[t].chapters[c];
            match f {
                "hint" => c.hint = Some(v),
                "title" => c.title = v,
                "text" => c.text = v,
                "news" => c.news = Some(v),
                _ => {}
            }
        }
        (Slot::Choice2(t, c, o), f) => {
            let o = &mut defs.story2.tracks[t].chapters[c].choices[o];
            match f {
                "text" => o.text = v,
                "reply" => o.reply = v,
                "hint" => o.hint = Some(v),
                "news" => o.news = Some(v),
                _ => {}
            }
        }
        (slot @ (Slot::Variant2(..) | Slot::Objective2(..) | Slot::Branch2(..) | Slot::Effect2(..)), field) => {
            story2::apply(defs, slot, field, v)
        }
        (Slot::Chapter(s, c), f) => {
            let ch = &mut defs.stories.stories[s].chapters[c];
            match f {
                "title" => set(&mut ch.title),
                "text" => set(&mut ch.text),
                "hint" => set(&mut ch.hint),
                "speaker_name" => set(&mut ch.speaker_name),
                _ => set_choice(&mut ch.choices, f, &v),
            }
        }
        (Slot::Encounter(i), f) => {
            let e = &mut defs.stories.encounters[i];
            match f {
                "title" => set(&mut e.title),
                "text" => set(&mut e.text),
                "speaker_name" => set(&mut e.speaker_name),
                _ => set_choice(&mut e.choices, f, &v),
            }
        }
        _ => {}
    }
}

/// 剧情事件选项的字段（`choice_N`、`reply_N`、`fail_reply_N`）。
fn set_choice(choices: &mut [manifest_core::story::ChoiceDef], field: &str, v: &str) {
    for i in 0..3 {
        let Some(c) = choices.get_mut(i) else { return };
        if field == CHOICE_TEXT[i] {
            c.text = v.to_string();
        } else if field == CHOICE_REPLY[i] {
            c.reply = v.to_string();
        } else if field == CHOICE_FAIL[i] {
            c.fail_reply = v.to_string();
        }
    }
}

/// 缺失的数据覆盖：中文有内容、覆盖文件没有给出的字段。
fn missing_of(
    spec: &FileSpec,
    file: &str,
    covered: &BTreeSet<String>,
    optional_chapters: &BTreeSet<String>,
    out: &mut Vec<Missing>,
) {
    let mut check = |item: &str, e: &Entry| {
        if matches!(
            e.slot,
            Slot::Chapter2(..)
                | Slot::Choice2(..)
                | Slot::Variant2(..)
                | Slot::Objective2(..)
                | Slot::Branch2(..)
                | Slot::Effect2(..)
        ) && optional_chapters.contains(&e.key.split(':').take(2).collect::<Vec<_>>().join(":"))
        {
            return;
        }
        for (f, zh) in &e.fields {
            let key = if item.is_empty() { format!(".{f}") } else { format!("{item}.{f}") };
            if !zh.trim().is_empty() && !covered.contains(&key) {
                out.push(Missing { file: file.to_string(), item: key.trim_start_matches('.').to_string() });
            }
        }
    };
    if let Some(top) = &spec.top {
        check("", top);
    }
    for (name, e) in &spec.single {
        check(name, e);
    }
    for (name, entries) in &spec.keyed {
        for e in entries {
            check(&format!("{name}[{}]", e.key), e);
        }
    }
    for c in &spec.categories {
        let item = format!("categories[{c}]");
        if !covered.contains(&item) {
            out.push(Missing { file: file.to_string(), item });
        }
    }
}

/// 离线模板（传闻、议价、编年史）的整文件覆盖：小节与中文一致、条数一致、参数合法。
fn overlay_lines(
    path: &Source<'_>,
    file: &str,
    zh: &BTreeMap<String, Vec<String>>,
    allowed: &[&str],
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) -> BTreeMap<String, Vec<String>> {
    let mut out = zh.clone();
    if !path.is_file() {
        missing.extend(zh.keys().map(|k| Missing { file: file.into(), item: k.clone() }));
        return out;
    }
    let Some(table) = read_table(path, file, issues) else { return out };
    for (section, v) in &table {
        let Some(zh_lines) = zh.get(section) else {
            issue(issues, file, section.as_str(), "中文模板中没有这一小节");
            continue;
        };
        let lines: Option<Vec<String>> =
            v.as_array().and_then(|a| a.iter().map(|x| x.as_str().map(str::to_string)).collect());
        let Some(lines) = lines else {
            issue(issues, file, section.as_str(), "应为文字列表");
            continue;
        };
        if lines.len() != zh_lines.len() {
            issue(
                issues,
                file,
                section.as_str(),
                format!("应有 {} 条（与中文逐条对应），实际 {} 条", zh_lines.len(), lines.len()),
            );
            continue;
        }
        if check_lines(issues, file, section, &lines, allowed) {
            out.insert(section.clone(), lines);
        }
    }
    for k in zh.keys() {
        if !table.contains_key(k) {
            missing.push(Missing { file: file.into(), item: k.clone() });
        }
    }
    out
}

/// 检查一组模板：非空、只用允许的参数。全部合格时返回 true。
fn check_lines(issues: &mut Vec<DataIssue>, file: &str, item: &str, lines: &[String], allowed: &[&str]) -> bool {
    let before = issues.len();
    for l in lines {
        if l.trim().is_empty() {
            issue(issues, file, item, "模板不能为空字符串");
        }
        for p in placeholders(l) {
            if !allowed.contains(&p.as_str()) {
                issue(issues, file, item, format!("模板使用了不允许的参数 {{{p}}}（可用：{}）", allowed.join("、")));
            }
        }
    }
    issues.len() == before
}

/// 组合事件模板的覆盖：`sources` 与 `[archetypes.<key>]` 的 `titles`、`narratives`。
fn overlay_composed(
    path: &Source<'_>,
    file: &str,
    ai: &AiContent,
    zh: &TemplateText,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) -> (Vec<String>, BTreeMap<String, ArchetypeText>) {
    let mut sources = zh.composed_sources.clone();
    let mut arch = zh.composed.clone();
    if !path.is_file() {
        missing.push(Missing { file: file.into(), item: "sources".into() });
        missing.extend(zh.composed.keys().map(|k| Missing { file: file.into(), item: format!("archetypes[{k}]") }));
        return (sources, arch);
    }
    let Some(table) = read_table(path, file, issues) else { return (sources, arch) };
    let lines_of = |v: Option<&toml::Value>| -> Option<Vec<String>> {
        v?.as_array()?.iter().map(|x| x.as_str().map(str::to_string)).collect()
    };
    for (name, v) in &table {
        match name.as_str() {
            "sources" => match lines_of(Some(v)) {
                Some(l) if l.len() == sources.len() => {
                    if check_lines(issues, file, "sources", &l, &["loc", "date"]) {
                        sources = l;
                    }
                }
                Some(l) => issue(
                    issues,
                    file,
                    "sources",
                    format!("应有 {} 条（与中文逐条对应），实际 {} 条", sources.len(), l.len()),
                ),
                None => issue(issues, file, "sources", "应为文字列表"),
            },
            "archetypes" => {
                let Some(t) = v.as_table() else {
                    issue(issues, file, "archetypes", "应写成 [archetypes.<key>] 形式的表");
                    continue;
                };
                for (key, a) in t {
                    let item = format!("archetypes[{key}]");
                    let (Some(zh_a), Some(src)) =
                        (zh.composed.get(key), ai.templates.composed.archetypes.iter().find(|x| &x.key == key))
                    else {
                        issue(issues, file, &item, "中文模板中没有这个原型");
                        continue;
                    };
                    let Some(at) = a.as_table() else {
                        issue(issues, file, &item, "应为一张表（titles、narratives）");
                        continue;
                    };
                    for k in at.keys() {
                        if k != "titles" && k != "narratives" {
                            issue(issues, file, &item, format!("字段 {k} 不能覆盖（可覆盖：titles、narratives）"));
                        }
                    }
                    let vars = archetype_vars(src);
                    let mut next = zh_a.clone();
                    let mut ok = true;
                    for (field, zh_lines, target) in [
                        ("titles", &zh_a.titles, &mut next.titles),
                        ("narratives", &zh_a.narratives, &mut next.narratives),
                    ] {
                        match lines_of(at.get(field)) {
                            Some(l) if l.len() == zh_lines.len() => {
                                ok &= check_lines(issues, file, &format!("{item}.{field}"), &l, &vars);
                                *target = l;
                            }
                            Some(l) => {
                                ok = false;
                                issue(
                                    issues,
                                    file,
                                    format!("{item}.{field}"),
                                    format!("应有 {} 条（与中文逐条对应），实际 {} 条", zh_lines.len(), l.len()),
                                );
                            }
                            None => {
                                ok = false;
                                issue(issues, file, format!("{item}.{field}"), "缺少或不是文字列表");
                            }
                        }
                    }
                    if ok {
                        arch.insert(key.clone(), next);
                    }
                }
            }
            other => issue(issues, file, other, "没有这一项（可覆盖：sources、archetypes）"),
        }
    }
    if !table.contains_key("sources") {
        missing.push(Missing { file: file.into(), item: "sources".into() });
    }
    let given: Vec<&String> =
        table.get("archetypes").and_then(|v| v.as_table()).map(|t| t.keys().collect()).unwrap_or_default();
    for k in zh.composed.keys() {
        if !given.contains(&k) {
            missing.push(Missing { file: file.into(), item: format!("archetypes[{k}]") });
        }
    }
    (sources, arch)
}

/// 提示词的整文件覆盖。
fn overlay_prompts(
    root: &Source<'_>,
    prefix: &str,
    ai: &AiContent,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) -> BTreeMap<ProposalKind, PromptTemplate> {
    let mut out = ai.prompts.clone();
    for kind in ProposalKind::ALL {
        let rel = format!("prompts/{}.toml", kind.key());
        let file = format!("{prefix}/{rel}");
        let path = root.join("prompts").join(format!("{}.toml", kind.key()));
        if !path.is_file() {
            // 扩展类型的内置提示词使用统一语言指令，不要求经典世界新增文件。
            if kind.is_f9() {
                continue;
            }
            missing.push(Missing { file: file.clone(), item: kind.key().into() });
            continue;
        }
        let Ok(text) = path.read() else {
            issue(issues, &file, "", "无法读取文件");
            continue;
        };
        match toml::from_str::<PromptTemplate>(&text) {
            Ok(p) => {
                let before = issues.len();
                check_prompt(issues, &file, kind, &p);
                if issues.len() == before {
                    out.insert(kind, p);
                }
            }
            Err(e) => issue(issues, &file, "", format!("TOML 格式错误：{}", e.to_string().trim())),
        }
    }
    out
}

/// 语言目录下允许出现的文件（其余 .toml 文件视为拼写错误）。
fn check_unknown_files(root: &Source<'_>, prefix: &str, known: &BTreeSet<String>, issues: &mut Vec<DataIssue>) {
    let files = root.files();
    let mut fragments = root.fragment_translations(&files);
    for f in files {
        match fragments.remove(&f) {
            Some(Err(message)) => issue(issues, &format!("{prefix}/{f}"), "", message),
            None if !known.contains(&f) => {
                issue(issues, &format!("{prefix}/{f}"), "", "没有对应的原数据文件（覆盖文件须与原数据同名同路径）")
            }
            _ => {}
        }
    }
}

/// 读取并校验某语言的全部覆盖文件，生成显示内容。有问题的覆盖记入 `issues` 并跳过（回退到中文）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn load(
    dir: &Source<'_>,
    root: &Source<'_>,
    prefix: &str,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
    zh_texts: Texts,
    issues: &mut Vec<DataIssue>,
) -> LocaleBundle {
    load_with(dir, root, prefix, locale, defs, ai, zh_texts, true, issues)
}

/// 同 [`load`]；`file_checks` 为假时不做只为报告问题的文件级检查（覆盖文件有没有对应的原数据、分片译文的结构比对），
/// 显示内容相同（游戏运行时用，2026-11-03 启动提速）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn load_with(
    dir: &Source<'_>,
    root: &Source<'_>,
    prefix: &str,
    locale: Locale,
    defs: &Arc<StaticData>,
    ai: &AiContent,
    zh_texts: Texts,
    file_checks: bool,
    issues: &mut Vec<DataIssue>,
) -> LocaleBundle {
    if locale == Locale::ZhCnGemini && !root.is_memory() {
        return variant::load(dir, root, prefix, defs, ai, zh_texts, issues);
    }
    let specs = specs(dir, defs, issues);
    let mut overrides: Vec<Override> = Vec::new();
    let mut categories: BTreeMap<String, String> = BTreeMap::new();
    let mut missing: Vec<Missing> = Vec::new();
    let mut known: BTreeSet<String> = BTreeSet::new();
    if !defs.geography.places.authored.roads.is_empty() {
        known.insert("world/roads.toml".into());
    }
    // 世界目录的可选显示覆盖已由 resolve_world 按封闭字段校验，不要求经典包补文件。
    if dir.is_world() {
        known.insert("world.toml".into());
    }
    // 各文件的覆盖互不相干：分给几个线程读、校验（2026-11-03 启动提速：寰宇有几百个覆盖文件），
    // 再按原顺序合并——覆盖、类别、缺译与问题的先后都与逐个读时相同
    #[derive(Default)]
    struct SpecLoad {
        known: Vec<String>,
        overrides: Vec<Override>,
        categories: BTreeMap<String, String>,
        missing: Vec<Missing>,
        issues: Vec<DataIssue>,
    }
    let loaded = crate::worlds::par_map(&specs, |spec| {
        let mut r = SpecLoad::default();
        r.known.push(spec.rel.clone());
        let file = format!("{prefix}/{}", spec.rel);
        let mut covered = BTreeSet::new();
        for (name, path) in root.data_overlays(&spec.rel) {
            r.known.push(name.clone());
            if path.is_file() {
                read_data_file(
                    spec,
                    &path,
                    &format!("{prefix}/{name}"),
                    &mut r.overrides,
                    &mut r.categories,
                    &mut covered,
                    &mut r.issues,
                );
            }
        }
        let optional_chapters =
            if dir.requires_english() { BTreeSet::new() } else { story2::untranslated_chapters(spec, root) };
        missing_of(spec, &file, &covered, &optional_chapters, &mut r.missing);
        r
    });
    for r in loaded {
        known.extend(r.known);
        overrides.extend(r.overrides);
        categories.extend(r.categories);
        missing.extend(r.missing);
        issues.extend(r.issues);
    }
    for g in &defs.goods {
        categories.entry(g.category.clone()).or_insert_with(|| g.category.clone());
    }
    // 后端显示文字
    known.insert(texts::ZH_FILE.to_string());
    let texts = texts::load_overlay(
        &root.join(texts::ZH_FILE),
        &format!("{prefix}/{}", texts::ZH_FILE),
        &zh_texts,
        issues,
        &mut missing,
    );
    // 离线模板
    let zh_t = TemplateText::from_ai(ai);
    let mut templates = zh_t.clone();
    let tpl =
        |name: &str| (root.join("templates").join(format!("{name}.toml")), format!("{prefix}/templates/{name}.toml"));
    for name in ["rumor", "bargain", "chronicle", "composed"] {
        known.insert(format!("templates/{name}.toml"));
    }
    for (name, sections) in crate::ai_content::TEXT_TEMPLATES {
        known.insert(format!("templates/{name}.toml"));
        let (p, f) = tpl(name);
        let zh = zh_t.texts.get(name).cloned().unwrap_or_default();
        let mut vars: Vec<&str> = sections.iter().flat_map(|(_, v)| v.iter().copied()).collect();
        vars.sort_unstable();
        vars.dedup();
        let lines = overlay_lines(&p, &f, &zh, &vars, issues, &mut missing);
        templates.texts.insert(name.to_string(), lines);
    }
    for kind in ProposalKind::ALL.into_iter().filter(|kind| kind.is_f9()) {
        known.insert(format!("templates/{}.toml", kind.key()));
        let (path, file) = tpl(kind.key());
        // 可选覆盖，缺省沿用内置/世界正文；已有覆盖仍逐段、逐槽位检查。
        if path.is_file() {
            let original = zh_t.texts.get(kind.key()).cloned().unwrap_or_default();
            let mut vars =
                crate::ai_content::f9_sections(kind).iter().flat_map(|(_, v)| v.iter().copied()).collect::<Vec<_>>();
            vars.sort_unstable();
            vars.dedup();
            let lines = overlay_lines(&path, &file, &original, &vars, issues, &mut missing);
            templates.texts.insert(kind.key().into(), lines);
        }
    }
    let (p, f) = tpl("rumor");
    templates.rumor = overlay_lines(
        &p,
        &f,
        &zh_t.rumor,
        &["loc", "good", "faction_a", "faction_b", "status", "event"],
        issues,
        &mut missing,
    );
    let (p, f) = tpl("bargain");
    templates.bargain = overlay_lines(&p, &f, &zh_t.bargain, &["discount", "loc"], issues, &mut missing);
    let (p, f) = tpl("chronicle");
    templates.chronicle = overlay_lines(
        &p,
        &f,
        &zh_t.chronicle,
        &["year", "events", "wars", "bankrupt", "richest", "net_worth"],
        issues,
        &mut missing,
    );
    let (p, f) = tpl("composed");
    let (sources, composed) = overlay_composed(&p, &f, ai, &zh_t, issues, &mut missing);
    templates.composed_sources = sources;
    templates.composed = composed;
    // 提示词
    for kind in ProposalKind::ALL {
        known.insert(format!("prompts/{}.toml", kind.key()));
    }
    let prompts = overlay_prompts(root, prefix, ai, issues, &mut missing);
    if !defs.auctions.auctions.is_empty() {
        known.extend(["auctions.toml".into(), "persons.toml".into()]);
    }
    // 只为报告问题：运行时（file_checks 为假）不做，显示内容不受影响
    if file_checks {
        check_unknown_files(root, prefix, &known, issues);
    }
    let mut localized = (**defs).clone();
    for o in &overrides {
        apply(&mut localized, o);
    }
    auction::apply(root, prefix, &mut localized, issues, &mut missing);
    authored::apply(dir, root, prefix, &mut localized, issues, &mut missing);
    authored::derived_mates(&mut localized);
    // 改投学院的派生家庭照换过语言的家庭与学院重新生成，名字、称呼随语言。
    localized.upbringing.derive_routes();
    // 仅中文允许缺整份或未翻译的整章；已有章的缺字段仍是校验问题。
    // 例外：人物的一句话身份（summary）是 11-02 起只写中文补上的字段，已有英文的人物缺这一项时回退中文、不算不完整
    // 允许缺英文回退中文；同一人物缺名字、人设等别的字段仍报。缺译照旧记进 missing。
    if locale == Locale::En && !dir.requires_english() {
        for entry in missing.iter().filter(|e| !chinese_first_field(&e.item)) {
            if let Some(rel) = entry.file.strip_prefix(&format!("{prefix}/"))
                && root.join(rel).is_file()
            {
                issue(issues, &entry.file, &entry.item, "已有英文覆盖不完整");
            }
        }
    }
    missing.sort();
    if locale == Locale::ZhCnGemini {
        missing.clear();
    }
    LocaleBundle {
        locale,
        defs: Arc::new(localized),
        texts,
        templates,
        prompts,
        categories,
        missing,
        variant_coverage: Default::default(),
    }
}

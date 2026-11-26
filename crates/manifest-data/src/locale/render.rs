//! 按语言格式化：文字引用、日期、数字、外交状态、命令被拒绝的原因；找回离线组合事件的模板位置。
//!
//! 中文格式化的结果与内核、离线模板生成的原文逐字相同（测试核对），因此中文界面照常显示原文，
//! 其他语言按同一模板位置与参数重新格式化。

use super::LocaleBundle;
use manifest_core::calendar::{date_of, season_of};
use manifest_core::composed::ComposedRecord;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::error::{CommandError, Reason};
use manifest_core::ids::*;
use manifest_core::text::{TextArg, TextRef};
use std::collections::BTreeMap;

/// 按名称替换模板中的 `{name}`；没有给出的变量原样保留。
pub fn fill(template: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if vars.contains_key(&after[..end]) => {
                out.push_str(&vars[&after[..end]]);
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

impl LocaleBundle {
    /// 后端显示文字（缺失时为空串）。
    pub fn text(&self, key: &str) -> &str {
        self.texts.get(key).unwrap_or("")
    }

    /// 整数：中文原样，英文按千位分组（12,345）。
    pub fn number(&self, v: i64) -> String {
        if self.locale.is_chinese() {
            return v.to_string();
        }
        let digits = v.unsigned_abs().to_string();
        let mut out = String::new();
        for (i, c) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i).is_multiple_of(3) {
                out.push(',');
            }
            out.push(c);
        }
        if v < 0 { format!("-{out}") } else { out }
    }

    /// 百分比（万分之一）：3%、3.5%（与离线模板一致）。
    pub fn percent(&self, bp: i64) -> String {
        if bp % 100 == 0 { format!("{}%", bp / 100) } else { format!("{:.1}%", bp as f64 / 100.0) }
    }

    /// 季节名（0 春 1 夏 2 秋 3 冬）。
    pub fn season_name(&self, index: usize) -> String {
        self.texts.list("calendar.seasons").and_then(|l| l.get(index)).cloned().unwrap_or_default()
    }

    /// 纪年日期（中文与内核的 `world_date_text` 逐字相同，英文如 “13 Mar 1502 (Spring)”）。
    pub fn date_text(&self, day: u32) -> String {
        let d = date_of(day);
        let w = &self.defs.rules.world;
        let month_name =
            self.texts.list("calendar.months").and_then(|l| l.get(d.month as usize - 1)).cloned().unwrap_or_default();
        let mut vars = BTreeMap::new();
        vars.insert("era", w.era.clone());
        vars.insert("year", w.calendar_year(d.year).to_string());
        vars.insert("month", d.month.to_string());
        vars.insert("month_name", month_name);
        vars.insert("day", d.day.to_string());
        vars.insert("season", self.season_name(season_of(day).index()));
        fill(self.text("calendar.date"), &vars)
    }

    /// 纪年年份（年序从 0 开始）：中文“1502年”，英文“1502”。
    pub fn year_text(&self, year_index: u32) -> String {
        let mut vars = BTreeMap::new();
        vars.insert("year", self.defs.rules.world.calendar_year(year_index + 1).to_string());
        fill(self.text("calendar.year"), &vars)
    }

    /// 外交状态名。
    pub fn status_name(&self, s: DiploStatus) -> String {
        let key = match s {
            DiploStatus::Peace => "terms.peace",
            DiploStatus::Tension => "terms.tension",
            DiploStatus::War => "terms.war",
            DiploStatus::Truce => "terms.truce",
        };
        self.text(key).to_string()
    }

    /// 所有者名：玩家商号或商会名。
    pub fn owner_name(&self, owner: OwnerId) -> String {
        match owner {
            OwnerId::Player => self.text("terms.player").to_string(),
            OwnerId::Company(c) => self.defs.companies.get(c.idx()).map(|x| x.name.clone()).unwrap_or_default(),
        }
    }

    /// 事件效果的方向说明（键见内核 `summary::HINTS`）。
    pub fn hint(&self, key: &str) -> String {
        self.texts.get(&format!("hints.{key}")).unwrap_or(key).to_string()
    }

    /// 一个参数的文字。`composed` 把组合事件的中文标题换成当前语言（找不到时返回 None，显示原文）。
    pub fn arg_text(&self, a: &TextArg, composed: &dyn Fn(&str) -> Option<String>) -> String {
        let d = &self.defs;
        let name = |n: Option<&String>| n.cloned().unwrap_or_default();
        match a {
            TextArg::Text(s) => s.clone(),
            TextArg::Int(v) => self.number(*v),
            TextArg::Percent(bp) => self.percent(*bp),
            TextArg::Loc(l) => name(d.locations.get(l.idx()).map(|x| &x.name)),
            TextArg::Good(g) => name(d.goods.get(g.idx()).map(|x| &x.name)),
            TextArg::Faction(f) => name(d.factions.get(f.idx()).map(|x| &x.name)),
            TextArg::Region(r) => name(d.regions.get(r.idx()).map(|x| &x.name)),
            TextArg::Event(e) => name(d.events.get(e.idx()).map(|x| &x.name)),
            TextArg::Discovery(x) => name(d.discoveries.get(x.idx()).map(|x| &x.name)),
            TextArg::Ship(s) => name(d.ships.get(s.idx()).map(|x| &x.name)),
            TextArg::Building(b) => name(d.colony_buildings.get(b.idx()).map(|x| &x.name)),
            TextArg::Mate(m) => name(d.mates.get(m.idx()).map(|x| &x.name)),
            TextArg::Owner(o) => self.owner_name(*o),
            TextArg::Status(s) => self.status_name(*s),
            TextArg::Year(y) => self.year_text(*y),
            TextArg::Date(day) => self.date_text(*day),
            TextArg::Pair(a, b) => {
                let mut vars = BTreeMap::new();
                vars.insert("a", name(d.factions.get(a.idx()).map(|x| &x.name)));
                vars.insert("b", name(d.factions.get(b.idx()).map(|x| &x.name)));
                fill(self.text("terms.pair"), &vars)
            }
            TextArg::Composed(title) => composed(title).unwrap_or_else(|| title.clone()),
            TextArg::Term(key) => self.texts.get(&format!("terms.{key}")).unwrap_or(key).to_string(),
            TextArg::List(items) => {
                items.iter().map(|x| self.arg_text(x, composed)).collect::<Vec<_>>().join(self.text("terms.list_sep"))
            }
        }
    }

    /// 按本语言格式化一个文字引用；模板位置不存在时返回 None（调用方显示原文）。
    pub fn render(&self, r: &TextRef, composed: &dyn Fn(&str) -> Option<String>) -> Option<String> {
        let vars: BTreeMap<&str, String> =
            r.args.iter().map(|(k, a)| (k.as_str(), self.arg_text(a, composed))).collect();
        let mut parts = Vec::new();
        for p in &r.parts {
            let (file, section, index) = TextRef::split_part(p)?;
            parts.push(fill(self.templates.line(file, section, index)?, &vars));
        }
        Some(parts.join(self.text("terms.part_sep")).trim().to_string())
    }

    /// 带错误码的原因。
    pub fn reason_text(&self, r: &Reason) -> String {
        if self.locale.is_chinese() {
            return r.zh.clone();
        }
        let Some(t) = self.texts.get(&format!("reasons.{}", r.code)) else { return r.zh.clone() };
        let none = |_: &str| None;
        let vars: BTreeMap<&str, String> = r.args.iter().map(|(k, a)| (*k, self.arg_text(a, &none))).collect();
        fill(t, &vars)
    }

    /// 命令被拒绝的原因（中文与内核原文相同）。
    pub fn command_error(&self, e: &CommandError) -> String {
        if self.locale.is_chinese() {
            return e.to_string();
        }
        let mut vars: BTreeMap<&str, String> = BTreeMap::new();
        let key = match e.reason() {
            Some(r) => {
                vars.insert("reason", self.reason_text(r));
                match e {
                    CommandError::Range(_) => "errors.range".to_string(),
                    _ => "errors.rule".to_string(),
                }
            }
            None => {
                let none = |_: &str| None;
                for (k, a) in e.args() {
                    vars.insert(k, self.arg_text(&a, &none));
                }
                format!("errors.{}", e.code())
            }
        };
        match self.texts.get(&key) {
            Some(t) => fill(t, &vars),
            None => e.to_string(),
        }
    }

    /// 应用层提示 `app.<key>`（缺失时为 None）。
    pub fn app_text(&self, key: &str, args: &[(&str, String)]) -> Option<String> {
        let t = self.texts.get(&format!("app.{key}"))?;
        let vars: BTreeMap<&str, String> = args.iter().cloned().collect();
        Some(fill(t, &vars))
    }
}

/// 专名对照（写进提示词）：`text` 中出现的中文专名与它们在 `to` 语言中的写法，每行“中文 = 译名”，
/// 总长不超过 `max` 个字符。只列出两种写法不同的名称。
pub fn glossary(zh: &LocaleBundle, to: &LocaleBundle, text: &str, max: usize) -> String {
    let (a, b) = (&zh.defs, &to.defs);
    let mut pairs: Vec<(String, String)> = Vec::new();
    let mut add = |x: &str, y: &str| {
        if !x.is_empty() && x != y && text.contains(x) && !pairs.iter().any(|(p, _)| p == x) {
            pairs.push((x.to_string(), y.to_string()));
        }
    };
    let w = (&a.rules.world, &b.rules.world);
    add(&w.0.currency, &w.1.currency);
    add(&w.0.era, &w.1.era);
    macro_rules! table {
        ($f:ident) => {
            for (x, y) in a.$f.iter().zip(b.$f.iter()) {
                add(&x.name, &y.name);
            }
        };
    }
    table!(factions);
    table!(locations);
    table!(regions);
    table!(companies);
    table!(goods);
    table!(events);
    table!(discoveries);
    table!(colony_buildings);
    table!(mates);
    table!(ships);
    let mut out = String::new();
    for (x, y) in pairs {
        let line = format!("{x} = {y}\n");
        if out.chars().count() + line.chars().count() > max {
            break;
        }
        out.push_str(&line);
    }
    out.trim_end().to_string()
}

/// 找回的组合事件文字（某语言）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComposedText {
    pub title: String,
    pub text: String,
}

impl LocaleBundle {
    /// 规则触发的政策（组合事件，来源“规则”；ECONOMY.md 6.10）的标题与叙事：按第一条效果从 `[policy]` 的模板写成。
    pub fn policy_text(&self, rec: &ComposedRecord) -> Option<ComposedText> {
        let e = rec.effects.first()?;
        let p = &e.params;
        let key = e.effect.key();
        let title = self.texts.get(&format!("policy.{key}_title"))?;
        let text = self.texts.get(&format!("policy.{key}_text"))?;
        let mut vars: BTreeMap<&str, String> = BTreeMap::new();
        let faction = p.faction_a.and_then(|f| self.defs.factions.get(f.idx())).map(|f| f.name.clone());
        let good = p.good.and_then(|g| self.defs.goods.get(g.idx())).map(|g| g.name.clone());
        vars.insert("faction", faction.unwrap_or_default());
        vars.insert("good", good.unwrap_or_default());
        vars.insert("days", p.days.unwrap_or(0).to_string());
        vars.insert("mult", p.mult.map(manifest_core::composed::fx_short).unwrap_or_default());
        Some(ComposedText { title: fill(title, &vars), text: fill(text, &vars) })
    }
}

/// 组合事件模板参数的来源：记录中的效果。
struct ComposedParams {
    loc: Option<LocId>,
    good: Option<GoodId>,
    region: Option<RegionId>,
    faction_a: Option<FactionId>,
    faction_b: Option<FactionId>,
    discovery: Option<DiscoveryId>,
}

fn composed_params(zh: &LocaleBundle, rec: &ComposedRecord) -> ComposedParams {
    let defs = &zh.defs;
    let first =
        |f: &dyn Fn(&manifest_core::events::EventParams) -> Option<u16>| rec.effects.iter().find_map(|e| f(&e.params));
    let loc = rec.effects.iter().filter(|e| e.effect.needs_loc()).find_map(|e| e.params.loc);
    let good = rec.effects.iter().filter(|e| e.effect.needs_good()).find_map(|e| e.params.good);
    let discovery = first(&|p| p.discovery.map(|d| d.0)).map(DiscoveryId);
    let region = first(&|p| p.region.map(|r| r.0)).map(RegionId).or_else(|| {
        loc.and_then(|l| defs.locations.get(l.idx()))
            .and_then(|l| defs.map.region_of(l.cell))
            .or_else(|| discovery.and_then(|d| manifest_core::explore::discovery_region(defs, d)))
    });
    ComposedParams {
        loc,
        good,
        region,
        faction_a: first(&|p| p.faction_a.map(|f| f.0)).map(FactionId),
        faction_b: first(&|p| p.faction_b.map(|f| f.0)).map(FactionId),
        discovery,
    }
}

fn composed_vars(
    b: &LocaleBundle,
    p: &ComposedParams,
    loc: LocId,
    day: u32,
    colony: Option<&str>,
) -> BTreeMap<&'static str, String> {
    let d = &b.defs;
    let mut vars = BTreeMap::new();
    let mut put = |k: &'static str, v: Option<&String>| {
        if let Some(v) = v {
            vars.insert(k, v.clone());
        }
    };
    put("loc", d.locations.get(loc.idx()).map(|x| &x.name));
    put("good", p.good.and_then(|g| d.goods.get(g.idx())).map(|x| &x.name));
    put("region", p.region.and_then(|r| d.regions.get(r.idx())).map(|x| &x.name));
    put("faction_a", p.faction_a.and_then(|f| d.factions.get(f.idx())).map(|x| &x.name));
    put("faction_b", p.faction_b.and_then(|f| d.factions.get(f.idx())).map(|x| &x.name));
    put("discovery", p.discovery.and_then(|x| d.discoveries.get(x.idx())).map(|x| &x.name));
    if let Some(c) = colony {
        vars.insert("colony", c.to_string());
    }
    vars.insert("date", b.date_text(day));
    vars
}

/// 找回离线模板生成的组合事件的模板位置（原型、标题、史料出处、叙事的序号，以及作为背景的地点与日期），
/// 再按 `to` 的语言重新格式化标题与叙事。
///
/// 组合事件的命令只记录中文标题与叙事，但离线模板的输出完全由原型文字与效果参数决定：
/// 按效果组合找到原型，把各候选（标题、出处、叙事、背景港口、日期）用中文填好，与原文逐字比较，
/// 找到唯一对应的位置后用目标语言同一位置的模板填写。模型写的事件对不上任何模板，返回 None（显示原文）。
/// `zh` 为中文显示内容；`colony` 为效果所在殖民地的名称（玩家起的名字，两种语言相同）。
pub fn localize_composed(
    zh: &LocaleBundle,
    to: &LocaleBundle,
    rec: &ComposedRecord,
    colony: Option<&str>,
) -> Option<ComposedText> {
    let kinds: Vec<_> = rec.effects.iter().map(|e| e.effect).collect();
    let rules = &zh.defs.composed;
    let p = composed_params(zh, rec);
    let locs: Vec<LocId> = match p.loc {
        Some(l) => vec![l],
        None => zh.defs.port_ids().collect(),
    };
    let days: Vec<u32> = if rec.day > 0 { vec![rec.day - 1, rec.day] } else { vec![rec.day] };
    for (key, a) in zh.templates.composed.iter().filter(|(_, a)| a.kinds == kinds) {
        // 标题
        let mut title_hit: Option<(usize, Option<LocId>, Option<u32>)> = None;
        'titles: for (ti, t) in a.titles.iter().enumerate() {
            let loc_c: Vec<Option<LocId>> =
                if t.contains("{loc}") { locs.iter().copied().map(Some).collect() } else { vec![None] };
            let day_c: Vec<Option<u32>> =
                if t.contains("{date}") { days.iter().copied().map(Some).collect() } else { vec![None] };
            for l in &loc_c {
                for d in &day_c {
                    let vars = composed_vars(zh, &p, l.unwrap_or(locs[0]), d.unwrap_or(days[0]), colony);
                    if truncate(&fill(t, &vars), rules.max_title_chars) == rec.title {
                        title_hit = Some((ti, *l, *d));
                        break 'titles;
                    }
                }
            }
        }
        let Some((ti, title_loc, title_day)) = title_hit else { continue };
        // 史料出处 + 叙事
        let loc_c: Vec<LocId> = match title_loc {
            Some(l) => vec![l],
            None => locs.clone(),
        };
        let day_c: Vec<u32> = match title_day {
            Some(d) => vec![d],
            None => days.clone(),
        };
        for (si, s) in zh.templates.composed_sources.iter().enumerate() {
            for &l in &loc_c {
                for &d in &day_c {
                    let vars = composed_vars(zh, &p, l, d, colony);
                    let src = fill(s, &vars);
                    if !rec.text.starts_with(&truncate(&src, rules.max_text_chars)) {
                        continue;
                    }
                    for (ni, n) in a.narratives.iter().enumerate() {
                        let full = format!("{src}{}", fill(n, &vars));
                        if truncate(&full, rules.max_text_chars) != rec.text {
                            continue;
                        }
                        // 找到了：按目标语言的同一位置重新填写
                        let ta = to.templates.composed.get(key)?;
                        let tv = composed_vars(to, &p, l, d, colony);
                        let title = fill(ta.titles.get(ti)?, &tv);
                        let source = fill(to.templates.composed_sources.get(si)?, &tv);
                        let body = fill(ta.narratives.get(ni)?, &tv);
                        let sep = to.text("terms.part_sep");
                        let text = format!("{source}{sep}{body}").trim().to_string();
                        return Some(ComposedText { title, text });
                    }
                }
            }
        }
    }
    None
}

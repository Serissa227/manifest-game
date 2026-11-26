//! 主角身世与属性（`docs/ECONOMY.md` 第 5 节）。
//!
//! - 开局时由 [`crate::command::Command::CreateCaptain`] 立下主角档案：生日（按现实日期划分的十二星座）、身世五问的回答、六项属性、
//!   开局算学够高时自选的一种奇才之法。命令写入命令日志，重放一致。每局只能立一次。
//! - 星座由生日的月与日决定（[`CaptainDefs::sign_of`]）；早先按月份判定的十二个原创星宫是“旧版星宫”，
//!   只为旧存档保留（按 key 找得到名字，特性照常生效），不再参与判定。
//! - 属性按 ×10 换算成航海士的 1–100 能力尺度，与对应岗位的航海士**取较高者**：航海 → 旗舰航速，武艺 → 旗舰海战，
//!   交易 → 交易税折扣，管理 → 工资折扣；口才提高议价折扣、降低航海士的招募费；算学在行情窗口里起作用（应用层）。
//! - 开局效果（身世选项的 `effect`）只在第 0 天立档时生效：现金、声望、名声、士气、海图、发现物传闻、起始货物、贷款。
//! - 每年生日：旗舰船员士气增加；与算学奇才共事满一年、算学够高的主角学会他的一种方法。
//! - 算学奇才难得一见（ECONOMY.md 4.3.1）：没有受雇的奇才每季换一处港口的酒馆落脚（确定性随机）。
//!
//! 没有主角档案（无界面模拟、平衡 bot、旧存档）时一切照旧：所有加成为 0。

mod attributes;
pub use attributes::*;

use crate::bank::{self, BankPlan};
use crate::calendar::{Calendar, CalendarError, Date};
use crate::circulation::Sector;
use crate::error::{CommandError, Reason};
use crate::fixed::{Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::mates::GENIUS_METHODS;
use crate::rng::{Domain, Rng};
use crate::text::TextArg;
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 经典六项的兼容 key；新世界按 CaptainDefs.attributes 的顺序。
pub const ATTRIBUTES: [&str; 6] = ["seamanship", "commerce", "arms", "stewardship", "numeracy", "eloquence"];
pub const SEAMANSHIP: usize = 0;
pub const COMMERCE: usize = 1;
pub const ARMS: usize = 2;
pub const STEWARDSHIP: usize = 3;
pub const NUMERACY: usize = 4;
pub const ELOQUENCE: usize = 5;

// ───────────────────────────── 静态数据 ─────────────────────────────

/// 点数规则（`captain.toml [points]`）。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CaptainPoints {
    pub base: i64,
    pub free: i64,
    pub creation_cap: i64,
    pub max: i64,
    pub genius_numeracy: i64,
    /// 行情窗口手调参数与拟合窗口的算学门槛（应用层与界面使用）
    pub manual_numeracy: i64,
    pub learn_numeracy: i64,
    pub learn_days: u32,
    /// 开局年龄的范围（含两端）
    pub age_min: i64,
    pub age_max: i64,
    /// 开局向导里年龄的缺省值（界面使用；内核只校验范围）
    pub age_default: i64,
    pub birthday_morale: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttributeDef {
    pub group: String,
    pub hooks: Vec<HookDef>,
    pub hidden: bool,
    pub key: String,
    pub name: String,
    pub desc: String,
}

/// 航海历里的月与日（每月 30 天、一年 360 天）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MonthDay {
    /// 1–12
    pub month: u32,
    /// 1–30
    pub day: u32,
}

impl MonthDay {
    pub const fn new(month: u32, day: u32) -> MonthDay {
        MonthDay { month, day }
    }

    /// 是否是航海历里有的日子（月 1–12、日 1–30）。
    pub fn is_valid(self) -> bool {
        self.is_valid_in(&Calendar::default())
    }

    pub fn is_valid_in(self, calendar: &Calendar) -> bool {
        self.ordinal_in(calendar).is_ok()
    }

    pub fn ordinal_in(self, calendar: &Calendar) -> Result<u32, CalendarError> {
        calendar.day_of(Date { year: 1, month: self.month, day: self.day })
    }

    /// 一年里的第几天：1 月 1 日为 0，12 月 30 日为 359（只对合法的日子有意义）。
    pub fn ordinal(self) -> u32 {
        self.ordinal_in(&Calendar::default()).unwrap_or(0)
    }

    /// 一年里的第几天（按 360 取余）对应的月日。
    pub fn from_ordinal(n: u32) -> MonthDay {
        Self::from_ordinal_in(n, &Calendar::default())
    }

    pub fn from_ordinal_in(n: u32, calendar: &Calendar) -> MonthDay {
        let d = calendar.date_of(n % calendar.year_days());
        MonthDay::new(d.month, d.day)
    }
}

/// 星座。现行的十二星座按生日判定（`start` 为首日）；旧版星宫（`start` 为空）只为旧存档保留。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignDef {
    pub key: String,
    pub name: String,
    pub desc: String,
    /// 加一点的属性（世界属性表的下标）
    pub attribute: usize,
    /// 现行星座的首日：从这一天起、到下一个星座首日的前一天为止（首日最晚的那个跨过年末，例如摩羯座 12 月 22 日—1 月 19 日）。
    /// 为空的是旧版星宫：旧存档按 key 记着它，名字照常显示，但不参与按生日判定。
    pub start: Option<MonthDay>,
}

impl SignDef {
    /// 旧版星宫（不参与按生日判定）。
    pub fn is_legacy(&self) -> bool {
        self.start.is_none()
    }
}

/// 现行星座的日期区间：首日与末日（都含），共 `days` 天。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignSpan {
    pub first: MonthDay,
    pub last: MonthDay,
    pub days: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuestionDef {
    pub key: String,
    pub title: String,
    pub prompt: String,
}

/// 开局效果（封闭集合，范围在数据加载时校验）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StartEffect {
    /// 开局现金增减的百分比
    CashPct(i64),
    /// 起始港所属势力的声望
    Reputation(i64),
    Fame(i64),
    /// 旗舰船员士气
    Morale(i64),
    Chart(RegionId),
    /// 一条尚未发现的发现物传闻（按种子挑）
    Rumor,
    /// 旗舰货舱里的一批货
    Goods(GoodId, i64),
    /// 一笔银行贷款（带同额现金，照常计息）
    Loan {
        amount: Money,
        months: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionDef {
    pub key: String,
    /// 所属问题（下标）
    pub question: usize,
    pub name: String,
    pub text: String,
    /// 各属性加点（世界属性表的顺序）
    pub attrs: Vec<i64>,
    pub effect: Option<StartEffect>,
    /// 只给某位推荐角色用的选项（带主角的剧本的 key）：开局向导里不列出，别的剧本不能选
    pub hero: Option<String>,
}

/// 主角身世与属性的静态数据（`data/captain.toml`；没有这个文件时为空，开局不设身世）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptainDefs {
    pub points: CaptainPoints,
    pub attributes: Vec<AttributeDef>,
    pub groups: Vec<AttributeGroup>,
    pub ratings: Vec<RatingDef>,
    pub abilities: Vec<AbilityDef>,
    pub roles: Vec<RoleDef>,
    /// 旧格式由加载器生成兼容定义；不是存档字段。
    pub legacy: bool,
    /// 现行的十二星座与旧版星宫（按数据文件的顺序；key 各不相同）
    pub signs: Vec<SignDef>,
    pub questions: Vec<QuestionDef>,
    pub options: Vec<OptionDef>,
}

impl Default for CaptainDefs {
    fn default() -> Self {
        Self {
            points: CaptainPoints::default(),
            attributes: vec![],
            groups: vec![],
            ratings: vec![],
            abilities: classic_abilities(),
            roles: classic_roles(),
            legacy: true,
            signs: vec![],
            questions: vec![],
            options: vec![],
        }
    }
}

impl CaptainDefs {
    pub fn enabled(&self) -> bool {
        !self.attributes.is_empty()
    }

    /// 按 key 找星座（旧版星宫也找得到：旧存档按 key 记下主角的星座）。
    pub fn sign(&self, key: &str) -> Option<&SignDef> {
        self.signs.iter().find(|s| s.key == key)
    }

    /// 现行星座与它们首日在一年里的第几天（首日不合法的不算；数据加载时已报错）。
    fn zodiac(&self, calendar: &Calendar) -> impl Iterator<Item = (u32, &SignDef)> {
        self.signs.iter().filter_map(|s| Some((s.start?.ordinal_in(calendar).ok()?, s)))
    }

    /// 生日所在的星座：首日不晚于生日的现行星座里首日最晚的一个；生日早于所有首日（1 月上旬）时，
    /// 是首日最晚的那个——跨年的摩羯座。旧版星宫不参与；日子不合法或没有现行星座时为空。
    pub fn sign_of(&self, month: u32, day: u32) -> Option<&SignDef> {
        self.sign_of_in(month, day, &Calendar::default())
    }

    pub fn sign_of_in(&self, month: u32, day: u32, calendar: &Calendar) -> Option<&SignDef> {
        let at = MonthDay::new(month, day).ordinal_in(calendar).ok()?;
        self.zodiac(calendar)
            .filter(|(o, _)| *o <= at)
            .max_by_key(|(o, _)| *o)
            .or_else(|| self.zodiac(calendar).max_by_key(|(o, _)| *o))
            .map(|(_, s)| s)
    }

    /// 现行星座的日期区间，按首日在一年里的先后排列：每个从首日起、到下一个首日的前一天为止，
    /// 最后一个跨过年末接回第一个，所以区间首尾相接、合起来正好一年。两个星座首日相同时，排在前面的那个区间为空
    /// （`days = 0`，末日在首日之前），数据加载时据此报“重叠”。
    pub fn zodiac_spans(&self) -> Vec<(&SignDef, SignSpan)> {
        self.zodiac_spans_in(&Calendar::default())
    }

    pub fn zodiac_spans_in(&self, calendar: &Calendar) -> Vec<(&SignDef, SignSpan)> {
        let year_days = calendar.year_days();
        let mut signs: Vec<(u32, &SignDef)> = self.zodiac(calendar).collect();
        signs.sort_by_key(|(o, _)| *o);
        let n = signs.len();
        signs
            .iter()
            .enumerate()
            .map(|(i, &(start, s))| {
                let next = signs[(i + 1) % n].0;
                // 到下一个首日的天数（跨年时绕回）；只有一个星座时占满一年
                let days = if n == 1 { year_days } else { (next + year_days - start) % year_days };
                let first = MonthDay::from_ordinal_in(start, calendar);
                let last = MonthDay::from_ordinal_in(start + days + year_days - 1, calendar);
                (s, SignSpan { first, last, days })
            })
            .collect()
    }

    pub fn option(&self, key: &str) -> Option<&OptionDef> {
        self.options.iter().find(|o| o.key == key)
    }
}

// ───────────────────────────── 档案 ─────────────────────────────

/// 生日：航海历的年（纪年年份）、月（1–12）、日（1–30）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Birthday {
    pub year: i64,
    pub month: u32,
    pub day: u32,
}

/// 主角档案（保存在玩家的 [`crate::world::Agent`] 里）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptainProfile {
    pub birthday: Birthday,
    /// 星座 key（立档时按生日判定；旧存档里是旧版星宫的 key，照常认得）
    pub sign: String,
    /// 身世五问的回答（选项 key，按问题顺序）
    pub answers: Vec<String>,
    /// 属性值（世界属性表的顺序；经典存档仍为六项）
    pub attrs: Vec<i64>,
    /// 开局自选的奇才之法（算学够高时）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genius: Option<String>,
    /// 跟算学奇才学会的方法
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub learned: Vec<String>,
    /// 教过主角的奇才（每位只教一种，与 `learned` 一一对应）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub teachers: Vec<MateId>,
    /// 立档的日期
    pub created: u32,
}

impl CaptainProfile {
    pub fn attr(&self, i: usize) -> i64 {
        self.attrs.get(i).copied().unwrap_or(0)
    }

    /// 主角本人会的奇才之法（开局自选 + 学会的）。
    pub fn methods(&self) -> impl Iterator<Item = &str> {
        self.genius.iter().map(String::as_str).chain(self.learned.iter().map(String::as_str))
    }
}

/// 身世与星座加点之后（自由分配之前）的属性：起点 + 各选项加点 + 星座，单项夹在开局上限之内。
pub fn background_attrs(defs: &CaptainDefs, answers: &[&OptionDef], sign: Option<&SignDef>) -> Vec<i64> {
    let mut out: Vec<i64> =
        defs.attributes.iter().enumerate().map(|(i, _)| defs.group(i).map_or(defs.points.base, |g| g.start)).collect();
    for o in answers {
        for (v, add) in out.iter_mut().zip(&o.attrs) {
            *v = v.saturating_add(*add);
        }
    }
    if let Some(s) = sign
        && let Some(v) = out.get_mut(s.attribute)
    {
        *v = v.saturating_add(1);
    }
    for (i, v) in out.iter_mut().enumerate() {
        if let Some(g) = defs.group(i) {
            *v = (*v).clamp(g.range[0], g.creation_cap.max(g.range[0]));
        }
    }
    out
}

/// `CreateCaptain` 的预检结果。
pub struct CaptainPlan {
    profile: CaptainProfile,
    effects: Vec<StartEffect>,
}

fn range(code: &'static str, zh: &str) -> CommandError {
    Reason::new(code, zh).range()
}

/// 校验立档：没有档案、生日与年龄、每题一个回答、自由分配的点数与上限、奇才之法。
pub(crate) fn check_create(
    world: &World,
    owner: OwnerId,
    birthday: Birthday,
    answers: &[String],
    alloc: &[i64],
    genius: Option<&str>,
) -> Result<CaptainPlan, CommandError> {
    let defs = &world.defs.captain;
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    if !defs.enabled() {
        return Err(Reason::new("captain.disabled", "这份数据没有主角身世").rule());
    }
    let agent = world.agent(owner)?;
    if agent.captain.is_some() {
        return Err(Reason::new("captain.exists", "主角的身世已经立下，不能再改").rule());
    }
    let p = &defs.points;
    let start = world.defs.rules.world.calendar_year(world.defs.calendar.date_of(world.player_start_day()).year);
    let age = start - birthday.year;
    if world.state.protagonist.as_ref().is_some_and(|identity| identity.birthday() != birthday) {
        return Err(CommandError::Precondition("生日必须与选定主角的实际生日相同".into()));
    }
    if !MonthDay::new(birthday.month, birthday.day).is_valid_in(&world.defs.calendar)
        || age < p.age_min
        || age > p.age_max
    {
        return Err(Reason::new("captain.birthday", format!("生日不对：年龄须在 {}–{} 岁之间", p.age_min, p.age_max))
            .arg("min", TextArg::Int(p.age_min))
            .arg("max", TextArg::Int(p.age_max))
            .range());
    }
    if answers.len() != defs.questions.len() {
        return Err(range("captain.answers", "每道身世问题都要回答一个选项"));
    }
    let mut chosen = Vec::with_capacity(answers.len());
    // 推荐角色专属的选项只在它自己的剧本里能选
    let scenario = world.defs.scenarios.get(world.state.scenario.idx()).map(|s| s.key.as_str());
    for (qi, key) in answers.iter().enumerate() {
        match defs.option(key) {
            Some(o) if o.question == qi && o.hero.as_deref().is_none_or(|h| Some(h) == scenario) => chosen.push(o),
            _ => return Err(range("captain.answers", "每道身世问题都要回答一个选项")),
        }
    }
    // 星座按生日的月与日判定（旧版星宫不参与）
    let sign = defs.sign_of_in(birthday.month, birthday.day, &world.defs.calendar);
    let bg = background_attrs(defs, &chosen, sign);
    let attrs = defs.allocated_attrs(&bg, alloc)?;
    let genius = match genius {
        Some(m) => {
            if defs.hook_value(&attrs, AttrHook::MarketWindow, &world.defs.rules.attributes) < p.genius_numeracy
                || !GENIUS_METHODS.contains(&m)
            {
                return Err(Reason::new(
                    "captain.genius",
                    format!("算学达到 {} 才能自选一种奇才之法", p.genius_numeracy),
                )
                .arg("numeracy", TextArg::Int(p.genius_numeracy))
                .rule());
            }
            Some(m.to_string())
        }
        None => None,
    };
    // 开局效果只在第 0 天生效（旧存档补建身世时只给属性）
    let effects = if world.day() == world.player_start_day() {
        chosen.iter().filter_map(|o| o.effect.clone()).collect()
    } else {
        Vec::new()
    };
    Ok(CaptainPlan {
        profile: CaptainProfile {
            birthday,
            sign: sign.map(|s| s.key.clone()).unwrap_or_default(),
            answers: answers.to_vec(),
            attrs,
            genius,
            learned: Vec::new(),
            teachers: Vec::new(),
            created: world.day(),
        },
        effects,
    })
}

/// 立档并执行开局效果。
pub(crate) fn exec_create(world: &mut World, owner: OwnerId, plan: CaptainPlan) -> Result<(), CommandError> {
    world.agent_mut(owner)?.captain = Some(plan.profile);
    for e in plan.effects {
        apply_start_effect(world, owner, &e)?;
    }
    Ok(())
}

fn apply_start_effect(world: &mut World, owner: OwnerId, e: &StartEffect) -> Result<(), CommandError> {
    let day = world.state.day;
    let flagship = world.flagship(owner);
    match *e {
        StartEffect::CashPct(pct) => {
            let cash = world.agent(owner)?.cash.max(0);
            let delta = mul_div(cash, pct, 100);
            if delta > 0 {
                world.book_external(
                    owner,
                    Flow::Other,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Other, CashClass::Operating)
                        .dr(Account::Cash, delta)
                        .cr(Account::OtherIncome, delta),
                )?;
            } else if delta < 0 {
                world.book_external(
                    owner,
                    Flow::Other,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Other, CashClass::Operating)
                        .dr(Account::OtherExpense, -delta)
                        .cr(Account::Cash, -delta),
                )?;
            }
        }
        StartEffect::Reputation(v) => {
            if let Some(home) = world.defs.scenarios.get(world.state.scenario.idx()).map(|s| s.start) {
                let faction = world.defs.loc(home).faction;
                world.adjust_reputation(owner, faction, v);
            }
        }
        StartEffect::Fame(v) => {
            let a = world.agent_mut(owner)?;
            a.fame = (a.fame + v).max(0);
        }
        StartEffect::Morale(v) => {
            if let Some(f) = flagship.and_then(|id| world.state.fleets.get_mut(&id)) {
                f.morale = (f.morale + v).clamp(0, 100);
            }
        }
        StartEffect::Chart(region) => {
            if !world.state.explore.charts.contains(&region) {
                crate::explore::exec_chart(world, owner, crate::explore::ChartPlan { region, cost: 0 })?;
            }
        }
        StartEffect::Rumor => {
            let ids: Vec<DiscoveryId> =
                world.defs.discovery_ids().filter(|id| world.rumor_blocker(*id).is_none()).collect();
            if !ids.is_empty() {
                let mut rng = Rng::derive(world.state.seed, day, Domain::Captain, 1, 0);
                let i = rng.range(0, ids.len() as i64 - 1) as usize;
                world.record_rumor(ids[i]);
            }
        }
        StartEffect::Goods(good, qty) => {
            if let Some(id) = flagship {
                let room = world.state.fleets.get(&id).map(|f| f.free_capacity()).unwrap_or(0);
                let q = qty.min(room);
                if q > 0 {
                    world.holder_add(owner, Holder::Fleet(id), good, q)?;
                    world.agent_mut(owner)?.book.add(good, q, 0);
                }
            }
        }
        StartEffect::Loan { amount, months } => {
            let rate = world.loan_rate(owner);
            bank::exec(world, owner, BankPlan::Borrow { amount, months, rate, guarantee: false })?;
        }
    }
    Ok(())
}

// ───────────────────────────── 属性的效果 ─────────────────────────────

impl World {
    /// 主角档案（只有玩家有）。
    pub fn captain_profile(&self, owner: OwnerId) -> Option<&crate::captain::CaptainProfile> {
        self.state.agents.get(&owner).and_then(|a| a.captain.as_ref())
    }

    /// 主角某项属性（没有档案时为 0）。
    pub fn captain_attr(&self, owner: OwnerId, attr: usize) -> i64 {
        if self.defs.items.enabled() {
            return self.wearer_attrs(owner, "captain").get(attr).copied().unwrap_or(0);
        }
        self.captain_profile(owner).map(|c| c.attr(attr)).unwrap_or(0)
    }

    /// 旗舰：主角亲自率领的舰队，即编号最小的一支。
    pub fn flagship(&self, owner: OwnerId) -> Option<FleetId> {
        self.fleets_of(owner).map(|f| f.id).min()
    }

    /// 世界属性定义的效果；没有主角档案时为零。比例单位为基点，数量类为整数。
    pub fn attr_hook(&self, owner: OwnerId, hook: AttrHook) -> i64 {
        let base = self
            .captain_profile(owner)
            .map_or(0, |c| self.defs.captain.hook_value(&c.attrs, hook, &self.defs.rules.attributes));
        base.saturating_add(self.equipment_attribute_hook(owner, "captain", hook))
            .saturating_add(self.item_hook(owner, "captain", hook, &Default::default()))
            .min(self.defs.rules.attributes.cap(hook))
    }

    /// 每日结算（账本日结之前）：主角生日时旗舰船员士气增加。
    pub(crate) fn captain_day(&mut self) {
        let day = self.state.day;
        let Some(c) = self.captain_profile(OwnerId::Player) else { return };
        let d = self.defs.calendar.date_of(day);
        if d.month != c.birthday.month || d.day != c.birthday.day {
            return;
        }
        let morale = self.defs.captain.points.birthday_morale;
        if let Some(f) = self.flagship(OwnerId::Player).and_then(|id| self.state.fleets.get_mut(&id)) {
            f.morale = (f.morale + morale).clamp(0, 100);
        }
        self.push_log(LogEvent { day, kind: LogKind::Birthday { owner: OwnerId::Player } });
    }

    /// 季末（每季的最后一天）：没有受雇的算学奇才换一处港口的酒馆落脚（按种子确定，不留在原处；隐藏的航海士不动）。
    /// 酒馆传闻偶尔透露他们的去向（应用层的港口视图）。
    pub(crate) fn geniuses_wander(&mut self) {
        let day = self.state.day;
        if !self.defs.calendar.season_end(day) {
            return;
        }
        let defs = self.defs.clone();
        let ports: Vec<LocId> =
            defs.locations.iter().enumerate().filter(|(_, l)| l.is_port()).map(|(i, _)| LocId::from_idx(i)).collect();
        if ports.len() < 2 {
            return;
        }
        let seed = self.state.seed;
        for (id, m) in self.state.mates.iter_mut() {
            let Some(d) = defs.mates.get(id.idx()) else { continue };
            if m.owner.is_some() || d.hidden || d.methods.is_empty() {
                continue;
            }
            let others: Vec<LocId> = ports.iter().copied().filter(|p| *p != m.at).collect();
            let mut rng = Rng::derive(seed, day, Domain::Captain, 100 + id.0 as u64, 0);
            m.at = others[rng.range(0, others.len() as i64 - 1) as usize];
        }
    }

    /// 没有受雇的算学奇才与他们这一季落脚的港口（按编号；隐藏的航海士不算）。
    pub fn wandering_geniuses(&self) -> Vec<(MateId, LocId)> {
        self.state
            .mates
            .iter()
            .filter(|(id, m)| {
                m.owner.is_none() && self.defs.mates.get(id.idx()).is_some_and(|d| !d.hidden && !d.methods.is_empty())
            })
            .map(|(id, m)| (*id, m.at))
            .collect()
    }

    /// 月末：与算学奇才共事满一年、算学够高的主角学会他的一种方法（每位奇才只教一种，按他会的顺序取主角还不会的第一种；
    /// 同一个月末至多学会一种，编号小的奇才先教）。
    pub(crate) fn captain_month_end(&mut self) {
        let day = self.state.day;
        let p = self.defs.captain.points.clone();
        let Some(c) = self.captain_profile(OwnerId::Player) else { return };
        if self.attr_hook(OwnerId::Player, AttrHook::MarketWindow) < p.learn_numeracy {
            return;
        }
        let known: Vec<String> = c.methods().map(str::to_string).collect();
        let mut learn: Option<(MateId, String)> = None;
        for (id, m) in &self.state.mates {
            if m.owner != Some(OwnerId::Player) || c.teachers.contains(id) {
                continue;
            }
            let Some(since) = m.hired_on else { continue };
            if day < since + p.learn_days {
                continue;
            }
            let Some(d) = self.defs.mates.get(id.idx()) else { continue };
            if let Some(method) = d.methods.iter().find(|x| !known.contains(x)) {
                learn = Some((*id, method.clone()));
                break;
            }
        }
        if let Some((mate, method)) = learn
            && let Some(a) = self.state.agents.get_mut(&OwnerId::Player)
            && let Some(c) = a.captain.as_mut()
        {
            c.learned.push(method.clone());
            c.teachers.push(mate);
            self.push_log(LogEvent { day, kind: LogKind::CaptainLearned { owner: OwnerId::Player, mate, method } });
        }
    }
}

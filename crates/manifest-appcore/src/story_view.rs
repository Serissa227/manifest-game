//! 剧情事件的视图：开局界面的推荐角色、概览里等待回应的事件、上一次回应的结果与故事面板。文字都按当前语言。

use crate::views::{Ctx, PLAYER};
use manifest_core::World;
use manifest_core::defs::ScenarioDef;
use manifest_core::ids::*;
use manifest_core::story::{ChoiceDef, Speaker, StoryEventRef, StoryOutcome, StorySource};
use serde::Serialize;

/// 推荐角色（开局界面的“推荐选择”卡片与确认页）。
#[derive(Clone, Debug, Serialize)]
pub struct HeroView {
    pub name: String,
    /// 外貌编号（100 以上是只给这位角色的专属头像）
    pub look: u32,
    pub tagline: String,
    pub bio: String,
    /// 生日（月、日）与开局年龄
    pub month: u32,
    pub day: u32,
    pub age: i64,
    /// 身世五问的回答（选项 key，按问题顺序；名字与文字在身世数据里按 key 找）
    pub answers: Vec<String>,
    /// 按世界属性表顺序的自由分配点
    pub alloc: Vec<i64>,
    pub genius: Option<String>,
}

/// 剧本挂的故事线（开局界面用）。
#[derive(Clone, Debug, Serialize)]
pub struct StoryLineInfo {
    pub key: String,
    pub name: String,
    /// 章数
    pub chapters: u32,
}

pub fn hero_view(s: &ScenarioDef) -> Option<HeroView> {
    s.hero.as_ref().map(|h| HeroView {
        name: h.name.clone(),
        look: h.look,
        tagline: h.tagline.clone(),
        bio: h.bio.clone(),
        month: h.month,
        day: h.day,
        age: h.age,
        answers: h.answers.clone(),
        alloc: h.alloc.clone(),
        genius: h.genius.clone(),
    })
}

pub fn story_line_info(ctx: Ctx<'_>, s: &ScenarioDef) -> Option<StoryLineInfo> {
    let def = ctx.names.stories.stories.get(s.story?)?;
    Some(StoryLineInfo { key: def.key.clone(), name: def.name.clone(), chapters: def.chapters.len() as u32 })
}

/// 对话框里的说话人。
#[derive(Clone, Debug, Serialize)]
pub struct SpeakerView {
    /// none / captain / mate / portrait
    pub kind: &'static str,
    /// 航海士的 key（mate）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate: Option<String>,
    /// 头像素材 id（portrait）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub portrait: Option<String>,
    /// 名字（航海士取他的名字；主角由界面按主角的姓名显示，这里为空）
    pub name: String,
}

fn speaker_view(ctx: Ctx<'_>, ev: &StoryEventRef<'_>) -> SpeakerView {
    let d = ctx.names;
    match ev.speaker() {
        Speaker::None => {
            SpeakerView { person: None, portrait: None, kind: "none", mate: None, asset: None, name: String::new() }
        }
        Speaker::Captain => {
            SpeakerView { person: None, portrait: None, kind: "captain", mate: None, asset: None, name: String::new() }
        }
        Speaker::Mate(m) => {
            let def = d.mates.get(m.idx());
            SpeakerView {
                person: None,
                portrait: None,
                kind: "mate",
                mate: def.map(|x| x.key.clone()),
                asset: None,
                name: def.map(|x| x.name.clone()).unwrap_or_default(),
            }
        }
        Speaker::Portrait(asset) => SpeakerView {
            person: None,
            portrait: None,
            kind: "portrait",
            mate: None,
            asset: Some(asset.clone()),
            name: ev.speaker_name().to_string(),
        },
    }
}

/// 属性检定（界面写“成功率约 N%”）。
#[derive(Clone, Debug, Serialize)]
pub struct StoryCheckView {
    /// 属性 key
    pub attr: String,
    pub name: String,
    /// 对主角的成功率（%）
    pub pct: i64,
}

/// 一个选项。
#[derive(Clone, Debug, Serialize)]
pub struct StoryChoiceView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub text: String,
    /// 要付的金币（0 表示不用付）
    pub cost: i64,
    /// 要交出的货：[商品 id, 数量]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub give: Option<(u16, i64)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub check: Option<StoryCheckView>,
    /// 现在不能选的原因：cash（现金不够）/ cargo（货不够）；能选时为空
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
    /// U02 掷骰：只在世界打开掷骰规则时出现
    #[serde(flatten)]
    pub dice: ChoiceDiceView,
}

/// 选项的掷骰信息（U02；规则关闭的世界整块不出现）。
#[derive(Clone, Debug, Default, Serialize)]
pub struct ChoiceDiceView {
    /// 需要掷骰时的最终成功率（0–100，已含原检定并夹在 5–95）；不需要掷骰时没有这一项
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chance: Option<i64>,
    /// 没达到的数值门槛：差的是哪一项、现在多少、要多少
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub soft_gap: Vec<SoftGapView>,
    /// 本次事件里已经掷骰失败过；门槛真正达到之前不能再选（此时 blocked 也有原因）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub failed: bool,
}

/// 一项没达到的数值门槛（属性档位、评价分、成长点或技能经验，单位随 key 而定）。
#[derive(Clone, Debug, Serialize)]
pub struct SoftGapView {
    pub key: String,
    pub label: String,
    pub have: i64,
    pub need: i64,
}

/// 上一次回应的骰子（U02），供前端做骰子动画。
#[derive(Clone, Debug, Serialize)]
pub struct RollView {
    /// 成功率（%）
    pub chance: i64,
    /// 骰点 1–100，不大于成功率为成功
    pub roll: i64,
    pub success: bool,
    /// 选项的稳定 key
    pub choice: String,
}

/// 等待回应的事件。
#[derive(Clone, Debug, Serialize)]
pub struct StoryEventView {
    pub day: u32,
    pub fleet: u32,
    /// chapter / encounter
    pub kind: &'static str,
    /// 章节或奇遇的 key
    pub key: String,
    /// 章节：第几章（从 1 起）与总章数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    /// 故事线的名字（章节）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub story: Option<String>,
    pub title: String,
    pub text: String,
    pub speaker: SpeakerView,
    pub choices: Vec<StoryChoiceView>,
    #[serde(flatten)]
    pub extra: StoryEventExtra,
}

/// 实际发生的一条效果。
#[derive(Clone, Debug, Default, Serialize)]
pub struct StoryOutcomeView {
    /// cash / fame / reputation / morale / goods / crew / repair / damage / supplies / rumor / reveal / chart / mate / mate_busy / attr
    pub kind: &'static str,
    /// 数值（金币、名声、声望、士气、数量、水手、百分比、天数、属性点）；没有数值的为 0
    pub value: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub good: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faction: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovery: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<u16>,
    /// 航海士的 key 与名字
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mate_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub persons: Vec<String>,
    #[serde(flatten)]
    pub extra: StoryOutcomeExtra,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct StoryOutcomeExtra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flag: Option<String>,
    /// kind已是结果的判别字段，关系枚举放在relation避免重复JSON键。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation: Option<manifest_core::cast::relations::Relation>,
}

/// 上一次回应的结果。
#[derive(Clone, Debug, Serialize)]
pub struct StoryResultView {
    pub day: u32,
    pub kind: &'static str,
    pub key: String,
    pub title: String,
    /// 选了哪个选项的文字；当天没有回应（奇遇作罢）时为空
    pub choice: Option<String>,
    /// 选了之后的叙事（检定失败时是失败的叙事）
    pub reply: String,
    pub success: Option<bool>,
    pub outcomes: Vec<StoryOutcomeView>,
    pub speaker: SpeakerView,
    /// 这一章走完之后故事线结束了
    pub ended: bool,
}

/// 故事面板的一条记录。
#[derive(Clone, Debug, Serialize)]
pub struct StoryJournalView {
    pub day: u32,
    pub kind: &'static str,
    pub title: String,
    pub choice: String,
    pub success: Option<bool>,
}

/// 故事线的进度。
#[derive(Clone, Debug, Serialize)]
pub struct StoryLineView {
    pub key: String,
    pub name: String,
    pub done: u32,
    pub total: u32,
    /// 下一章的提示（走完时为空）
    pub hint: Option<String>,
}

/// 概览里的剧情事件。
#[derive(Clone, Debug, Serialize)]
pub struct StoryView {
    /// 本局挂的故事线；没有时为空
    pub line: Option<StoryLineView>,
    pub pending: Option<StoryEventView>,
    pub last: Option<StoryResultView>,
    /// 回应过的章节与奇遇（新的在后）
    pub journal: Vec<StoryJournalView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub news_unread: Option<usize>,
    /// U02：`last` 是故事回应且掷过骰时的骰子；规则关闭的世界没有这一项
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_roll: Option<RollView>,
}

/// 按当前语言找到事件的内容（显示用数据与原数据下标一致）。
fn event_in<'a>(ctx: Ctx<'a>, world: &World, source: &StorySource) -> Option<StoryEventRef<'a>> {
    let d = ctx.names;
    match source {
        StorySource::Chapter(i) => {
            let s = d.scenarios.get(world.state.scenario.idx())?.story?;
            d.stories.stories.get(s)?.chapters.get(*i as usize).map(StoryEventRef::Chapter)
        }
        StorySource::Encounter(key) => d.stories.encounter(key).map(StoryEventRef::Encounter),
    }
}

fn source_parts(source: &StorySource, ev: &StoryEventRef<'_>) -> (&'static str, String) {
    match (source, ev) {
        (StorySource::Chapter(_), StoryEventRef::Chapter(c)) => ("chapter", c.key.clone()),
        (StorySource::Encounter(k), _) => ("encounter", k.clone()),
        (StorySource::Chapter(_), StoryEventRef::Encounter(e)) => ("chapter", e.key.clone()),
    }
}

fn choice_view(ctx: Ctx<'_>, world: &World, fleet: FleetId, c: &ChoiceDef) -> StoryChoiceView {
    let blocked = world.story_choice_blocker(fleet, c).map(|e| match e {
        manifest_core::CommandError::InsufficientCash { .. } => "cash",
        _ => "cargo",
    });
    StoryChoiceView {
        key: None,
        text: c.text.clone(),
        cost: c.cost,
        give: c.give.map(|(g, q)| (g.0, q)),
        check: c.check.map(|k| StoryCheckView {
            attr: ctx.names.captain.check_key(k.attr).to_string(),
            name: ctx.names.captain.check_name(k.attr).to_string(),
            pct: world.story_check_pct(&k),
        }),
        blocked: blocked.map(str::to_owned),
        hint: None,
        requires: Vec::new(),
        dice: ChoiceDiceView::default(),
    }
}

fn outcome_view(ctx: Ctx<'_>, o: &StoryOutcome) -> StoryOutcomeView {
    let mut v = StoryOutcomeView {
        kind: "",
        value: 0,
        good: None,
        faction: None,
        discovery: None,
        region: None,
        mate: None,
        mate_name: None,
        attr: None,
        text: None,
        persons: Vec::new(),
        extra: StoryOutcomeExtra::default(),
    };
    let mate = |m: &MateId| ctx.names.mates.get(m.idx()).map(|d| (d.key.clone(), d.name.clone()));
    match o {
        StoryOutcome::Cash(x) => (v.kind, v.value) = ("cash", *x),
        StoryOutcome::Fame(x) => (v.kind, v.value) = ("fame", *x),
        StoryOutcome::Reputation(f, x) => (v.kind, v.value, v.faction) = ("reputation", *x, Some(f.0)),
        StoryOutcome::Morale(x) => (v.kind, v.value) = ("morale", *x),
        StoryOutcome::Goods(g, q) => (v.kind, v.value, v.good) = ("goods", *q, Some(g.0)),
        StoryOutcome::Crew(x) => (v.kind, v.value) = ("crew", *x),
        StoryOutcome::Repair(x) => (v.kind, v.value) = ("repair", *x),
        StoryOutcome::Damage(x) => (v.kind, v.value) = ("damage", *x),
        StoryOutcome::Supplies(x) => (v.kind, v.value) = ("supplies", *x),
        StoryOutcome::Rumor(d) => (v.kind, v.discovery) = ("rumor", Some(d.0)),
        StoryOutcome::Reveal(d) => (v.kind, v.discovery) = ("reveal", Some(d.0)),
        StoryOutcome::Chart(r) => (v.kind, v.region) = ("chart", Some(r.0)),
        StoryOutcome::Mate(m) | StoryOutcome::MateBusy(m) => {
            v.kind = if matches!(o, StoryOutcome::Mate(_)) { "mate" } else { "mate_busy" };
            if let Some((key, name)) = mate(m) {
                v.mate = Some(key);
                v.mate_name = Some(name);
            }
        }
        StoryOutcome::Attr(i, x) => {
            (v.kind, v.value, v.attr) = ("attr", *x, Some(ctx.names.captain.check_key(*i as usize).to_string()))
        }
    }
    v
}

/// 概览里的剧情事件；没有故事线、也什么都没发生过时为空。
pub fn story_view_in(ctx: Ctx<'_>, world: &World) -> Option<StoryView> {
    let s = &world.state.story;
    let d = ctx.names;
    let story =
        d.scenarios.get(world.state.scenario.idx()).and_then(|sc| sc.story).and_then(|i| d.stories.stories.get(i));
    if story.is_none() && s.is_pristine() && world.defs.story2.tracks.is_empty() && world.state.creatures.is_empty() {
        return None;
    }
    let line = story.map(|def| {
        let total = def.chapters.len() as u32;
        let done = s.chapter.min(total);
        StoryLineView {
            key: def.key.clone(),
            name: def.name.clone(),
            done,
            total,
            hint: def.chapters.get(done as usize).map(|c| c.hint.clone()),
        }
    });
    let pending = s.pending.as_ref().and_then(|p| {
        let ev = event_in(ctx, world, &p.source)?;
        let (kind, key) = source_parts(&p.source, &ev);
        let (chapter, total, story_name) = match p.source {
            StorySource::Chapter(i) => {
                (Some(i + 1), story.map(|x| x.chapters.len() as u32), story.map(|x| x.name.clone()))
            }
            StorySource::Encounter(_) => (None, None, None),
        };
        let fleet = match world.state.fleets.get(&p.fleet) {
            Some(f) if f.owner == PLAYER => p.fleet,
            _ => world.flagship(PLAYER).unwrap_or(p.fleet),
        };
        Some(StoryEventView {
            day: p.day,
            fleet: p.fleet.0,
            kind,
            key,
            chapter,
            total,
            story: story_name,
            title: ev.title().to_string(),
            text: ev.text().to_string(),
            speaker: speaker_view(ctx, &ev),
            choices: ev.choices().iter().map(|c| choice_view(ctx, world, fleet, c)).collect(),
            extra: Default::default(),
        })
    });
    let last = s.last.as_ref().and_then(|r| {
        let ev = event_in(ctx, world, &r.source)?;
        let (kind, key) = source_parts(&r.source, &ev);
        let c = r.choice.and_then(|i| ev.choices().get(i as usize));
        let reply = match (c, r.success) {
            (Some(c), Some(false)) => c.fail_reply.clone(),
            (Some(c), _) => c.reply.clone(),
            (None, _) => String::new(),
        };
        let ended =
            matches!(r.source, StorySource::Chapter(i) if story.is_some_and(|x| i + 1 >= x.chapters.len() as u32));
        Some(StoryResultView {
            day: r.day,
            kind,
            key,
            title: ev.title().to_string(),
            choice: c.map(|c| c.text.clone()),
            reply,
            success: r.success,
            outcomes: r.outcomes.iter().map(|o| outcome_view(ctx, o)).collect(),
            speaker: speaker_view(ctx, &ev),
            ended,
        })
    });
    let journal = s
        .journal
        .iter()
        .filter_map(|e| {
            let ev = event_in(ctx, world, &e.source)?;
            let (kind, _) = source_parts(&e.source, &ev);
            Some(StoryJournalView {
                day: e.day,
                kind,
                title: ev.title().to_string(),
                choice: ev.choices().get(e.choice as usize).map(|c| c.text.clone()).unwrap_or_default(),
                success: e.success,
            })
        })
        .collect();
    let mut view = StoryView { line, pending, last, journal, news_unread: None, last_roll: None };
    crate::story2_view::extend(ctx, world, &mut view);
    if view.pending.is_none() {
        view.pending = crate::creatures_view::pending(ctx, world);
    }
    if let Some(last) = crate::creatures_view::last(ctx, world)
        && view.last.as_ref().is_none_or(|old| old.day <= last.day)
    {
        view.last = Some(last);
        view.last_roll = None;
    }
    crate::navigation_view::visibility::redact_story(ctx, world, &mut view);
    Some(view)
}

/// 日志里剧情事件的标题与所选选项（按当前语言）。
pub fn log_texts(ctx: Ctx<'_>, world: &World, source: &StorySource, choice: Option<u32>) -> (String, String) {
    match event_in(ctx, world, source) {
        Some(ev) => (
            ev.title().to_string(),
            choice.and_then(|i| ev.choices().get(i as usize)).map(|c| c.text.clone()).unwrap_or_default(),
        ),
        None => (String::new(), String::new()),
    }
}

/// I5/I5b 的可选事件字段，经典故事不输出空扩展。
#[derive(Clone, Debug, Default, Serialize)]
pub struct StoryEventExtra {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub night: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue: Option<usize>,
    /// 今天是这件事的最后一天（过了今天它就不再等着；`World::pacing_last_chance`）。只在开了节奏规则的世界、出海之后给出，
    /// 而且只在为真时输出：界面据此把玩家收起（“稍后再说”）的对话框重新交到面前，并写明“过了今天就错过”。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_day: Option<bool>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cast: Vec<StoryCastView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub figure: Option<StoryFigureView>,
}
#[derive(Clone, Debug, Serialize)]
pub struct StoryCastView {
    pub person: String,
    pub name: String,
    pub portrait: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct StoryFigureView {
    pub key: String,
    pub name: String,
}

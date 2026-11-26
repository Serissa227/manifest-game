//! U04 工作包 4：活动列表的折叠计数、解锁差项与解锁通知。只读世界。
use super::*;
use manifest_core::{StaticData, upbringing::unlocks};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

type Deadlines = Arc<BTreeMap<String, Option<u32>>>;

/// 提示属于应用层：随 meta 保存，查询不会改变内核哈希或命令重放。
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UnlockNotices {
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    shown: BTreeSet<String>,
    /// 本次显示的一批留到过期或下一批出现；读档不恢复，界面仍可自行关闭。
    #[serde(skip)]
    active: BTreeSet<String>,
}

impl UnlockNotices {
    pub(crate) fn restore(saved: Option<Self>, w: &World) -> Self {
        saved.unwrap_or_else(|| Self {
            shown: w.state.upbringing.iter().flat_map(|s| s.unlocks.keys().cloned()).collect(),
            active: BTreeSet::new(),
        })
    }

    pub(crate) fn filter(&mut self, view: &mut Value) {
        let Some(notices) = view["unlocked_now"].as_array_mut() else { return };
        let key = |notice: &Value| -> Option<String> {
            notice["label"].as_str().filter(|label| !label.is_empty())?;
            let mut id = format!("{}:{}", notice["kind"].as_str()?, notice["key"].as_str()?);
            if let Some(rank) = notice["rank"].as_str() {
                id.push(':');
                id.push_str(rank);
            }
            Some(id)
        };
        let current: BTreeSet<_> = notices.iter().filter_map(key).collect();
        let new: BTreeSet<_> = current.iter().filter(|key| self.shown.insert((*key).clone())).cloned().collect();
        if !new.is_empty() {
            self.active = new;
        }
        self.active.retain(|key| current.contains(key));
        notices.retain(|notice| key(notice).is_some_and(|key| self.active.contains(&key)));
    }
}

/// 每个活动“最晚还能开始的日子”只依赖定义与家庭：按定义（持有同一个 Arc，避免地址复用）和家庭缓存最近一份。
static CACHE: Mutex<Option<(Arc<StaticData>, String, Deadlines)>> = Mutex::new(None);

pub(super) fn deadlines(w: &World, family: &str) -> Deadlines {
    if let Ok(cache) = CACHE.lock()
        && let Some((defs, key, value)) = cache.as_ref()
        && Arc::ptr_eq(defs, &w.defs)
        && key == family
    {
        return value.clone();
    }
    let value: Deadlines = Arc::new(unlocks::activity_deadlines(&w.defs, family));
    if let Ok(mut cache) = CACHE.lock() {
        *cache = Some((w.defs.clone(), family.to_owned(), value.clone()));
    }
    value
}

/// 这一局再也排不上：静态判定说永远不行，或者最晚能开始的日子已经过了。
pub(super) fn never(deadlines: &BTreeMap<String, Option<u32>>, w: &World, a: &ActivityDef) -> bool {
    deadlines.get(&a.key).is_some_and(|d| d.is_none_or(|d| w.day() > d))
}

/// 差项里能靠练出来的：属性、成长、技能、评价、现款、年龄、学年。
fn numeric(key: &str) -> bool {
    ["attr:", "growth:", "skill:", "rating:"].iter().any(|p| key.starts_with(p))
        || ["cash", "age:ge", "school_year"].contains(&key)
}

/// 没开放、但只差能练出来的项：给差项与“差一点”（各项都到了八成，年龄、学年只差一年）。其余为 null。
pub(super) fn gap(w: &World, a: &ActivityDef) -> (Value, bool) {
    let gaps = w.constraint_gaps(&unlocks::activity_constraints(&w.defs, a));
    if gaps.is_empty() || !gaps.iter().all(|g| numeric(&g.key)) {
        return (Value::Null, false);
    }
    let near = gaps.iter().all(|g| {
        if g.key == "age:ge" || g.key == "school_year" { g.need - g.have <= 1 } else { g.have * 100 >= g.need * 80 }
    });
    (json!(gaps), near)
}

fn place_name(ctx: Ctx<'_>, w: &World, key: &str) -> Option<String> {
    let f = w.upbringing_family()?;
    let display = ctx.names.upbringing.family(&f.key);
    display
        .into_iter()
        .flat_map(|f| &f.places)
        .chain(ctx.names.upbringing.academies.iter().flat_map(|a| &a.places))
        .find(|p| p.key == key)
        .map(|p| p.name.clone())
}

/// 最近开放的东西：`[{kind, key, label, date}]`，kind 为 activity / place / path / exam / rating。
pub(super) fn unlocked_now(ctx: Ctx<'_>, w: &World) -> Vec<Value> {
    let date = |day: u32| {
        let d = w.defs.calendar.date_of(day);
        [(w.defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
    };
    w.upbringing_unlocked_now()
        .into_iter()
        .filter_map(|(day, id)| {
            let (kind, rest) = id.split_once(':')?;
            let (key, label, extra) = match kind {
                "activity" => {
                    let a = ctx.names.upbringing.activity(rest);
                    (rest, a.map(|a| a.name.clone()).filter(|n| n != rest), Value::Null)
                }
                "place" => (rest, place_name(ctx, w, rest), Value::Null),
                "path" => (
                    rest,
                    ctx.names.upbringing.paths.iter().find(|p| p.key == rest).map(|p| p.name.clone()),
                    Value::Null,
                ),
                "exam" => (
                    rest,
                    ctx.names.upbringing.exams.iter().find(|e| e.key == rest).map(|e| e.name.clone()),
                    Value::Null,
                ),
                "rating" => {
                    let (key, rank) = rest.split_once(':')?;
                    (key, ctx.names.captain.ratings.iter().find(|r| r.key == key).map(|r| r.name.clone()), json!(rank))
                }
                _ => return None,
            };
            Some(json!({"kind":kind,"key":key,"label":label,"rank":extra,"date":date(day)}))
        })
        .collect()
}

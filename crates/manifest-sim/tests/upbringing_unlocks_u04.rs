//! U04 工作包 4：每家 7 个随属性、技能、年龄解锁的练习按中位成长曲线的公式生成（`tools/u04/unlock_activities.py`），
//! 门槛不会开局就满足、静态可达，而且不进中位曲线（所以 U02 的全部门槛不变）。
use manifest_core::{
    StaticData,
    upbringing::{ActivityKind, Reachability, unlocks::activity_constraints},
};
use manifest_sim::upbringing_curve::{GrowthCurve, Measure};
use std::sync::{Arc, OnceLock};

const OPEN_MONTHS: [usize; 7] = [3, 6, 9, 15, 21, 27, 33];

fn terra() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}

fn coef(key: &str) -> i64 {
    90 + (fnv(&format!("unlock:{key}")) % 21) as i64
}

#[test]
fn every_family_gets_seven_unlockable_practices_on_the_median_curve() {
    let d = terra();
    let r = Reachability::new(&d);
    for f in &d.upbringing.families {
        let c = GrowthCurve::new(&d, &f.key).unwrap();
        let flag = f.stages[0].entry_flag.clone().unwrap();
        for (i, m) in OPEN_MONTHS.iter().enumerate() {
            let key = format!("u04_unlock_{}_{}", f.key, i + 1);
            let a = d.upbringing.activity(&key).unwrap_or_else(|| panic!("缺少 {key}"));
            assert_eq!(a.kind, ActivityKind::Training, "{key}");
            // 名称与描述 11-04 按地区写好（日本 Opus、中国 Sonnet、其余 Haiku），不再是占位键。
            assert!(
                a.name != key && !a.name.trim().is_empty() && a.name.chars().count() <= 12,
                "{key}：名称 {}",
                a.name
            );
            assert!(!a.description.trim().is_empty(), "{key}：描述没写");
            assert_eq!(a.unlock.flag.as_deref(), Some(flag.as_str()), "{key}：本家专属");
            assert!(a.unlock.attrs.is_empty(), "{key}：只用 growth / skills 门槛，不碰 U02 的门槛生成");
            assert!(
                !a.unlock.growth.is_empty() || !a.unlock.skills.is_empty(),
                "{key}：要有成长或技能门槛（也因此不进中位曲线）"
            );
            for (attr, need) in &a.unlock.growth {
                let median = c.median_at(Measure::Growth, attr, *m);
                assert_eq!(*need, (median * coef(&key) / 100).max(1), "{key}：{attr} 第 {m} 月中位 {median}");
                assert!(*need > c.opening(attr), "{key}：{attr} 门槛 {need} 开局就满足");
            }
            for (skill, need) in &a.unlock.skills {
                let median = c.median_at(Measure::Skill, skill, *m);
                assert_eq!(*need, (median * coef(&key) / 100).max(1), "{key}：{skill} 第 {m} 月中位 {median}");
            }
            let earliest = r
                .earliest_for(&f.key, &activity_constraints(&d, a), 0, Some(true))
                .unwrap_or_else(|e| panic!("{key}：静态不可达：{e}"));
            assert!(earliest <= r.family_end(&f.key).unwrap(), "{key}");
            // 收益照练习活动的数量级：主练不超过已有练习的最高值。
            let best = d
                .upbringing
                .activities
                .iter()
                .filter(|o| o.kind == ActivityKind::Training && !o.key.starts_with("u04_unlock_"))
                .flat_map(|o| o.gains.values().map(|r| r[1]))
                .max()
                .unwrap();
            assert!(a.gains.values().all(|r| r[1] <= best), "{key}：收益高过已有练习");
        }
        assert_eq!(
            d.upbringing.activities.iter().filter(|a| a.key.starts_with(&format!("u04_unlock_{}_", f.key))).count(),
            7,
            "{}",
            f.key
        );
    }
}

#[test]
fn unlock_practices_are_not_reported_unreachable_by_validate_data() {
    let d = terra();
    let errors = Reachability::new(&d).unreachable();
    let mine: Vec<&String> = errors.iter().filter(|e| e.contains("u04_unlock_")).collect();
    assert!(mine.is_empty(), "{mine:?}");
}

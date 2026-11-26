//! 主角身世与属性（ECONOMY.md 第 5 节）：`CreateCaptain` 的校验与执行、开局年龄 16–45、按现实日期划分的十二星座
//! （每个星座的首日与末日、摩羯座跨年）、八种开局效果、补建身世不发放效果、属性加成与航海士取较高者、口才的议价与招募费、
//! 生日、跟算学奇才学法子（每位只教一种）、摩羯座与旧版提灯座的小特性、旧存档里的旧版星宫；
//! 没有主角档案时一切照旧；命令写入日志，只用日志重放一致；存档往返不丢档案。
//! 使用内核自带的小型世界（`testkit::captain_defs`，星座与 `data/captain.toml` 相同）。

use manifest_core::captain::{Birthday, MonthDay};
use manifest_core::log::LogKind;
use manifest_core::mates::MateRole;
use manifest_core::replay::{LogEntry, Source, StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::testkit::{captain_defs, check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const START_YEAR: i64 = 1502;

/// 记录命令并执行（与游戏会话相同），可只用日志重放。
struct Runner {
    defs: Arc<StaticData>,
    world: World,
    log: Vec<LogEntry>,
}

impl Runner {
    fn new(defs: Arc<StaticData>, seed: u64) -> Runner {
        let world = World::new(defs.clone(), ScenarioId(0), seed).expect("开局");
        Runner { defs, world, log: Vec::new() }
    }

    fn submit(&mut self, c: Command) -> Result<CommandOutcome, CommandError> {
        let r = c.apply(&mut self.world);
        if r.is_ok() {
            let seq = self.log.len() as u64;
            self.log.push(LogEntry { minute: None, tick: self.world.day(), seq, source: Source::Player, command: c });
        }
        r
    }

    fn days(&mut self, n: u32) {
        for _ in 0..n {
            self.world.end_day().unwrap();
        }
    }

    fn replay_hash(&self) -> String {
        let start = StartParams::new(ScenarioId(0), self.world.state.seed);
        replay(self.defs.clone(), start, &self.log, self.world.day()).unwrap().state_hash()
    }
}

fn create(answers: [&str; 3], alloc: [i64; 6], month: u32, day: u32, age: i64, genius: Option<&str>) -> Command {
    Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year: START_YEAR - age, month, day },
        answers: answers.iter().map(|s| s.to_string()).collect(),
        alloc: alloc.to_vec(),
        genius: genius.map(str::to_string),
    }
}

fn code(r: Result<CommandOutcome, CommandError>) -> &'static str {
    r.expect_err("应被拒绝").code()
}

fn flagship(w: &World) -> FleetId {
    w.flagship(OwnerId::Player).expect("玩家有旗舰")
}

fn cash(w: &World) -> Money {
    w.agent(OwnerId::Player).unwrap().cash
}

fn logs(w: &World, f: impl Fn(&LogKind) -> bool) -> usize {
    w.state.log.iter().filter(|e| f(&e.kind)).count()
}

// ───────────────────────────── 校验 ─────────────────────────────

#[test]
fn create_is_validated_and_rejections_do_not_change_the_state() {
    let mut w = World::new(captain_defs(), ScenarioId(0), 3).unwrap();
    let before = w.state_hash();
    let ok = [0, 2, 0, 0, 3, 0];
    let cases: Vec<(Command, &str)> = vec![
        // 生日：年龄 16–45、月 1–12、日 1–30
        (create(["merchant", "cadet", "debt"], ok, 3, 12, 15, None), "captain.birthday"),
        (create(["merchant", "cadet", "debt"], ok, 3, 12, 46, None), "captain.birthday"),
        (create(["merchant", "cadet", "debt"], ok, 13, 12, 20, None), "captain.birthday"),
        (create(["merchant", "cadet", "debt"], ok, 3, 31, 20, None), "captain.birthday"),
        (create(["merchant", "cadet", "debt"], ok, 3, 0, 20, None), "captain.birthday"),
        // 回答：每题一个属于这道题的选项
        (create(["cadet", "merchant", "debt"], ok, 3, 12, 20, None), "captain.answers"),
        (create(["merchant", "cadet", "nobody"], ok, 3, 12, 20, None), "captain.answers"),
        // 自由分配：正好 free 点、不为负、六项
        (create(["merchant", "cadet", "debt"], [0, 2, 0, 0, 2, 0], 3, 12, 20, None), "captain.points"),
        (create(["merchant", "cadet", "debt"], [-1, 3, 0, 0, 3, 0], 3, 12, 20, None), "captain.points"),
        // 上限：武艺 1 + 1（少年）+ 5 = 7 可以，交易 1 + 2 + 5 = 8 不行
        (create(["merchant", "cadet", "debt"], [0, 5, 0, 0, 0, 0], 3, 12, 20, None), "captain.cap"),
        // 奇才之法：算学不到 7，或者不认识的方法
        (create(["merchant", "cadet", "debt"], ok, 3, 12, 20, Some("ses")), "captain.genius"),
        (create(["scribes", "university", "debt"], [0, 0, 0, 0, 1, 4], 2, 12, 20, Some("astrology")), "captain.genius"),
    ];
    for (cmd, expect) in cases {
        assert_eq!(code(cmd.apply(&mut w)), expect, "{cmd:?}");
        assert_eq!(w.state_hash(), before, "被拒绝的命令不改变状态");
    }
    // 少了一项的分配
    let short = Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year: 1480, month: 3, day: 12 },
        answers: vec!["merchant".into(), "cadet".into(), "debt".into()],
        alloc: vec![0, 2, 0, 0, 3],
        genius: None,
    };
    assert_eq!(code(short.apply(&mut w)), "captain.points");
    // 只有玩家有主角
    let npc = Command::CreateCaptain {
        owner: OwnerId::Company(CompanyId(0)),
        birthday: Birthday { year: 1480, month: 3, day: 12 },
        answers: vec!["merchant".into(), "cadet".into(), "debt".into()],
        alloc: ok.to_vec(),
        genius: None,
    };
    assert!(npc.apply(&mut w).is_err());
    assert_eq!(w.state_hash(), before);

    // 合法的立档成功；每局只能立一次
    create(["merchant", "cadet", "debt"], ok, 3, 12, 20, None).apply(&mut w).unwrap();
    assert_eq!(code(create(["merchant", "cadet", "debt"], ok, 3, 12, 20, None).apply(&mut w)), "captain.exists");
    let p = w.captain_profile(OwnerId::Player).unwrap();
    // 起点 1；交易 +2；航海、武艺 +1（少年）；管理 +1（出海）；3 月 12 日双鱼座航海 +1；自由分配交易 +2、算学 +3
    assert_eq!(p.attrs, vec![3, 5, 2, 2, 4, 1]);
    assert_eq!(p.sign, "pisces");
    assert_eq!(p.birthday, Birthday { year: 1482, month: 3, day: 12 });
    assert_eq!(p.created, 0);
    check_invariants(&w).unwrap();
}

#[test]
fn the_starting_age_is_16_to_45() {
    // 年龄 = 开局年份 − 出生年份：15 与 46 被拒绝（状态不变），16 与 45 可以
    for (age, accepted) in [(15, false), (16, true), (45, true), (46, false)] {
        let mut w = World::new(captain_defs(), ScenarioId(0), 3).unwrap();
        let before = w.state_hash();
        let r = create(["merchant", "cadet", "debt"], [0, 2, 0, 0, 3, 0], 6, 1, age, None).apply(&mut w);
        if accepted {
            r.unwrap_or_else(|e| panic!("{age} 岁应当可以：{e:?}"));
            let p = w.captain_profile(OwnerId::Player).unwrap();
            assert_eq!(START_YEAR - p.birthday.year, age);
        } else {
            assert_eq!(code(r), "captain.birthday", "{age} 岁");
            assert_eq!(w.state_hash(), before, "{age} 岁：被拒绝的命令不改变状态");
            assert!(w.captain_profile(OwnerId::Player).is_none());
        }
    }
    let p = &captain_defs().captain.points;
    assert_eq!((p.age_min, p.age_max, p.age_default), (16, 45, 18));
}

// ───────────────────────────── 十二星座 ─────────────────────────────

/// 月日（月, 日）。
type Md = (u32, u32);
/// 星座的日期区间：key、首日、末日（都含）、天数。
type Span<'a> = (&'a str, Md, Md, u32);
/// 现行星座：日期区间与加点。
type Zodiac = (&'static str, Md, Md, u32, usize);

/// 现行的十二星座：key、首日、末日（都含）、天数、加点。
const ZODIAC: [Zodiac; 12] = {
    use manifest_core::captain::{ARMS, COMMERCE, ELOQUENCE, NUMERACY, SEAMANSHIP, STEWARDSHIP};
    [
        ("aquarius", (1, 20), (2, 18), 29, NUMERACY),
        ("pisces", (2, 19), (3, 20), 32, SEAMANSHIP),
        ("aries", (3, 21), (4, 19), 29, ARMS),
        ("taurus", (4, 20), (5, 20), 31, COMMERCE),
        ("gemini", (5, 21), (6, 21), 31, ELOQUENCE),
        ("cancer", (6, 22), (7, 22), 31, STEWARDSHIP),
        ("leo", (7, 23), (8, 22), 30, ELOQUENCE),
        ("virgo", (8, 23), (9, 22), 30, NUMERACY),
        ("libra", (9, 23), (10, 23), 31, COMMERCE),
        ("scorpio", (10, 24), (11, 22), 29, ARMS),
        ("sagittarius", (11, 23), (12, 21), 29, SEAMANSHIP),
        ("capricorn", (12, 22), (1, 19), 28, STEWARDSHIP),
    ]
};

fn sign_at(month: u32, day: u32) -> Option<String> {
    captain_defs().captain.sign_of(month, day).map(|s| s.key.clone())
}

#[test]
fn the_twelve_signs_follow_their_real_dates() {
    let defs = captain_defs();
    let c = &defs.captain;
    // 每个星座的首日与末日都属于它；首日的前一天属于上一个星座
    for (i, (key, first, last, _, _)) in ZODIAC.iter().enumerate() {
        assert_eq!(sign_at(first.0, first.1).as_deref(), Some(*key), "{key} 的首日 {first:?}");
        assert_eq!(sign_at(last.0, last.1).as_deref(), Some(*key), "{key} 的末日 {last:?}");
        let prev = ZODIAC[(i + ZODIAC.len() - 1) % ZODIAC.len()].0;
        let before = MonthDay::from_ordinal(MonthDay::new(first.0, first.1).ordinal() + 359);
        assert_eq!(sign_at(before.month, before.day).as_deref(), Some(prev), "{key} 首日的前一天 {before:?}");
    }
    // 摩羯座跨年：12 月 22 日—1 月 19 日；12 月 21 日还是射手座，1 月 20 日已是水瓶座
    for (m, d) in [(12, 22), (12, 30), (1, 1), (1, 19)] {
        assert_eq!(sign_at(m, d).as_deref(), Some("capricorn"), "{m} 月 {d} 日");
    }
    assert_eq!(sign_at(12, 21).as_deref(), Some("sagittarius"));
    assert_eq!(sign_at(1, 20).as_deref(), Some("aquarius"));
    // 2 月 18 日水瓶座、2 月 19 日双鱼座
    assert_eq!(sign_at(2, 18).as_deref(), Some("aquarius"));
    assert_eq!(sign_at(2, 19).as_deref(), Some("pisces"));
    // 航海历里没有的日子
    for (m, d) in [(0, 1), (13, 1), (3, 0), (3, 31)] {
        assert_eq!(sign_at(m, d), None, "{m} 月 {d} 日");
    }
    // 日期区间：按首日先后，首尾相接、合起来正好 360 天；一年里的每一天都恰好属于区间包含它的那个星座，从不落到旧版星宫
    let spans = c.zodiac_spans();
    let got: Vec<Span> = spans
        .iter()
        .map(|(s, x)| (s.key.as_str(), (x.first.month, x.first.day), (x.last.month, x.last.day), x.days))
        .collect();
    let want: Vec<Span> = ZODIAC.iter().map(|(k, f, l, n, _)| (*k, *f, *l, *n)).collect();
    assert_eq!(got, want);
    assert_eq!(spans.iter().map(|(_, x)| x.days).sum::<u32>(), 360);
    let mut per_sign = std::collections::BTreeMap::new();
    for n in 0..360 {
        let d = MonthDay::from_ordinal(n);
        let s = c.sign_of(d.month, d.day).expect("每一天都有星座");
        assert!(!s.is_legacy(), "{d:?} 落到了旧版星宫 {}", s.key);
        *per_sign.entry(s.key.clone()).or_insert(0u32) += 1;
    }
    for (key, _, _, days, _) in ZODIAC {
        assert_eq!(per_sign.get(key), Some(&days), "{key}");
    }
    // 加点：每项属性恰好两个星座；只有摩羯座带提灯的特性
    for (key, _, _, _, attribute) in ZODIAC {
        assert_eq!(c.sign(key).unwrap().attribute, attribute, "{key}");
    }
    for a in 0..6 {
        assert_eq!(ZODIAC.iter().filter(|z| z.4 == a).count(), 2);
    }
}

#[test]
fn a_new_captain_gets_the_sign_of_the_birthday() {
    // 同一天前后：星座不同，加的属性也不同（2 月 18 日水瓶座算学 +1，2 月 19 日双鱼座航海 +1）
    let make = |month: u32, day: u32| {
        let mut w = World::new(captain_defs(), ScenarioId(0), 3).unwrap();
        create(["plain", "university", "relative"], [0, 0, 0, 0, 0, 5], month, day, 20, None).apply(&mut w).unwrap();
        w.captain_profile(OwnerId::Player).cloned().unwrap()
    };
    let aquarius = make(2, 18);
    let pisces = make(2, 19);
    assert_eq!((aquarius.sign.as_str(), pisces.sign.as_str()), ("aquarius", "pisces"));
    // 航海 1（+1 出海）、算学 1 + 2（少年）
    assert_eq!(aquarius.attrs, vec![2, 1, 1, 1, 4, 6]);
    assert_eq!(pisces.attrs, vec![3, 1, 1, 1, 3, 6]);
    // 摩羯座跨年：12 月 25 日与 1 月 10 日都是摩羯座（管理 +1）
    assert_eq!(make(12, 25).sign, "capricorn");
    assert_eq!(make(1, 10).sign, "capricorn");
    assert_eq!(make(1, 10).attrs[manifest_core::captain::STEWARDSHIP], 2);
}

#[test]
fn data_without_backgrounds_rejects_the_command() {
    let mut w = World::new(tiny_defs(), ScenarioId(0), 3).unwrap();
    let before = w.state_hash();
    assert_eq!(
        code(create(["merchant", "cadet", "debt"], [0, 2, 0, 0, 3, 0], 3, 12, 20, None).apply(&mut w)),
        "captain.disabled"
    );
    assert_eq!(w.state_hash(), before);
}

#[test]
fn a_mathematical_prodigy_picks_a_method_at_creation() {
    let mut w = World::new(captain_defs(), ScenarioId(0), 3).unwrap();
    // 算学 1 + 2（家世）+ 2（少年）+ 1（2 月 12 日水瓶座）+ 1 = 7
    create(["scribes", "university", "debt"], [0, 0, 0, 0, 1, 4], 2, 12, 20, Some("ar1")).apply(&mut w).unwrap();
    let p = w.captain_profile(OwnerId::Player).unwrap();
    assert_eq!(p.attr(manifest_core::captain::NUMERACY), 7);
    assert_eq!(p.methods().collect::<Vec<_>>(), vec!["ar1"]);
}

// ───────────────────────────── 开局效果 ─────────────────────────────

#[test]
fn every_start_effect_is_applied_on_day_zero() {
    let home = FactionId(0);

    // 资金 +10%、发现物传闻
    let mut w = World::new(captain_defs(), ScenarioId(0), 5).unwrap();
    let (c0, rumors0) = (cash(&w), w.state.explore.rumors.len());
    create(["merchant", "university", "relative"], [0, 0, 0, 0, 0, 5], 1, 5, 20, None).apply(&mut w).unwrap();
    assert_eq!(cash(&w), c0 + c0 / 10, "资金 +10%");
    assert_eq!(w.state.explore.rumors.len(), rumors0 + 1, "得到一条传闻");
    check_invariants(&w).unwrap();

    // 声望 +8、士气 +10、旗舰货舱多 12 份香料
    let mut w = World::new(captain_defs(), ScenarioId(0), 5).unwrap();
    let f = flagship(&w);
    w.state.fleets.get_mut(&f).unwrap().morale = 50;
    let (rep0, spice0) =
        (w.reputation(OwnerId::Player, home), w.fleet(f).unwrap().cargo.get(&GoodId(2)).copied().unwrap_or(0));
    create(["noble", "cadet", "caravan"], [0, 0, 0, 0, 5, 0], 1, 5, 20, None).apply(&mut w).unwrap();
    assert_eq!(w.reputation(OwnerId::Player, home), rep0 + 8);
    assert_eq!(w.fleet(f).unwrap().morale, 60);
    assert_eq!(w.fleet(f).unwrap().cargo.get(&GoodId(2)).copied().unwrap_or(0), spice0 + 12);
    check_invariants(&w).unwrap();

    // 东海的海图、名声 +10、一笔 8000 的贷款（带同额现金）
    let mut w = World::new(captain_defs(), ScenarioId(0), 5).unwrap();
    let (c0, loans0) = (cash(&w), w.state.loans.len());
    assert!(!w.state.explore.charts.contains(&RegionId(1)));
    create(["scribes", "expedition", "debt"], [0, 0, 5, 0, 0, 0], 1, 5, 20, None).apply(&mut w).unwrap();
    assert!(w.state.explore.charts.contains(&RegionId(1)));
    assert_eq!(w.agent(OwnerId::Player).unwrap().fame, 10);
    assert_eq!(w.state.loans.len(), loans0 + 1);
    assert_eq!(cash(&w), c0 + 8_000);
    check_invariants(&w).unwrap();

    // 资金 −10%、声望 −5
    let mut w = World::new(captain_defs(), ScenarioId(0), 5).unwrap();
    let (c0, rep0) = (cash(&w), w.reputation(OwnerId::Player, home));
    create(["plain", "gambler", "privateer"], [0, 0, 0, 0, 0, 5], 1, 5, 20, None).apply(&mut w).unwrap();
    assert_eq!(cash(&w), c0 - c0 / 10);
    assert_eq!(w.reputation(OwnerId::Player, home), rep0 - 5);
    check_invariants(&w).unwrap();
}

#[test]
fn a_background_set_later_gives_attributes_but_no_start_effects() {
    let mut r = Runner::new(captain_defs(), 8);
    r.days(10);
    let (c0, loans0, fame0) = (cash(&r.world), r.world.state.loans.len(), r.world.agent(OwnerId::Player).unwrap().fame);
    r.submit(create(["merchant", "expedition", "debt"], [0, 0, 5, 0, 0, 0], 1, 5, 20, None)).unwrap();
    assert_eq!(cash(&r.world), c0);
    assert_eq!(r.world.state.loans.len(), loans0);
    assert_eq!(r.world.agent(OwnerId::Player).unwrap().fame, fame0);
    let p = r.world.captain_profile(OwnerId::Player).unwrap();
    assert_eq!(p.created, 10);
    // 航海 1 + 1、交易 1 + 2、武艺 1 + 5、管理 1 + 1 + 1（1 月 5 日摩羯座）、算学 1、口才 1 + 1
    assert_eq!(p.attrs, vec![2, 3, 6, 3, 1, 2]);
    assert_eq!(p.sign, "capricorn");
    check_invariants(&r.world).unwrap();
}

// ───────────────────────────── 属性的效果 ─────────────────────────────

#[test]
fn attributes_take_the_higher_of_captain_and_mate() {
    let mut w = World::new(captain_defs(), ScenarioId(0), 11).unwrap();
    let f = flagship(&w);
    // 开局：旗舰舰长是航海士 navigator（航海 70 → 7%，海战 40 → 20%）；没有交易员与会计
    assert_eq!(w.fleet_speed_bonus(f), Fx::from_pct(7));
    assert_eq!(w.fleet_combat_mult(f), Fx::from_pct(120));
    assert_eq!(w.trade_tax_discount(OwnerId::Player), Fx::ZERO);
    assert_eq!(w.wage_discount(OwnerId::Player), Fx::ZERO);
    let no_eloquence = w.bargain_outcome(OwnerId::Player, LocId(0), manifest_core::news::Intent::Discount).discount;

    // 航海 2、交易 6、武艺 7、管理 1、算学 1、口才 1（4 月 12 日白羊座武艺 +1）
    create(["merchant", "cadet", "privateer"], [0, 3, 2, 0, 0, 0], 4, 12, 20, None).apply(&mut w).unwrap();
    assert_eq!(w.captain_profile(OwnerId::Player).unwrap().sign, "aries");
    assert_eq!(w.captain_profile(OwnerId::Player).unwrap().attrs, vec![2, 6, 7, 1, 1, 1]);
    assert_eq!(w.fleet_speed_bonus(f), Fx::from_pct(7), "航海 2% 低于舰长的 7%：取舰长");
    assert_eq!(w.fleet_combat_mult(f), Fx::from_pct(135), "武艺 7 → 35%，高于舰长的 20%");
    assert_eq!(w.trade_tax_discount(OwnerId::Player), Fx::from_pct(6), "没有交易员：用主角的交易");
    assert_eq!(w.wage_discount(OwnerId::Player), Fx::from_pct(1));
    let with = w.bargain_outcome(OwnerId::Player, LocId(0), manifest_core::news::Intent::Discount).discount;
    assert_eq!(with - no_eloquence, Fx::from_bp(30), "口才每点议价 +0.3%");

    // 雇交易员（交易 70 → 7%）：取较高者；口才 1 → 招募费便宜 2%
    let trader = MateId(1);
    let c0 = cash(&w);
    Command::HireMate { owner: OwnerId::Player, mate: trader }.apply(&mut w).unwrap();
    assert_eq!(c0 - cash(&w), 800 - 16, "招募费 800 × 98%");
    Command::AssignMate { owner: OwnerId::Player, mate: trader, role: MateRole::Trader }.apply(&mut w).unwrap();
    assert_eq!(w.trade_tax_discount(OwnerId::Player), Fx::from_pct(7));
    // 只有旗舰享受主角的航海与武艺
    check_invariants(&w).unwrap();
}

#[test]
fn birthday_cheers_the_flagship_crew_once_a_year() {
    let run = |day: u32| {
        let mut r = Runner::new(captain_defs(), 13);
        r.submit(create(["merchant", "cadet", "debt"], [0, 2, 0, 0, 3, 0], 1, day, 20, None)).unwrap();
        r.days(4);
        let f = flagship(&r.world);
        r.world.state.fleets.get_mut(&f).unwrap().morale = 50;
        r.days(1);
        r
    };
    // 1 月 5 日是第 4 天：那天结束时生日；1 月 15 日生的对照组那天没有（两人都是摩羯座，属性相同，只差生日）
    let a = run(5);
    let b = run(15);
    assert_eq!(
        a.world.captain_profile(OwnerId::Player).unwrap().attrs,
        b.world.captain_profile(OwnerId::Player).unwrap().attrs
    );
    let fa = flagship(&a.world);
    assert_eq!(a.world.fleet(fa).unwrap().morale, b.world.fleet(flagship(&b.world)).unwrap().morale + 5);
    assert_eq!(logs(&a.world, |k| matches!(k, LogKind::Birthday { .. })), 1);
    assert_eq!(logs(&b.world, |k| matches!(k, LogKind::Birthday { .. })), 0);
    // 之后一年里只在下一个 1 月 5 日（第 364 天）再过一次（日志只保留最近的若干条，逐日看当天新增的）
    let mut a = a;
    let mut days = Vec::new();
    for _ in 0..400 {
        let d = a.world.day();
        a.days(1);
        if a.world.state.log.iter().any(|e| e.day == d && matches!(e.kind, LogKind::Birthday { .. })) {
            days.push(d);
        }
    }
    assert_eq!(days, vec![364]);
    check_invariants(&a.world).unwrap();
}

#[test]
fn a_captain_learns_one_method_from_each_prodigy_after_a_year() {
    // 算学 1 + 2 + 2 = 5：够学；航海士 navigator 开局即在麾下，会递减权重均价与最小二乘直线
    let mut r = Runner::new(captain_defs(), 17);
    r.submit(create(["scribes", "university", "debt"], [0, 0, 0, 0, 0, 5], 1, 5, 20, None)).unwrap();
    r.days(350);
    assert!(r.world.captain_profile(OwnerId::Player).unwrap().learned.is_empty(), "不满一年学不会");
    r.days(70);
    let p = r.world.captain_profile(OwnerId::Player).unwrap();
    assert_eq!(p.learned, vec!["ses".to_string()]);
    assert_eq!(p.teachers, vec![MateId(0)]);
    assert_eq!(logs(&r.world, |k| matches!(k, LogKind::CaptainLearned { method, .. } if method == "ses")), 1);
    // 每位奇才只教一种
    r.days(400);
    assert_eq!(r.world.captain_profile(OwnerId::Player).unwrap().learned, vec!["ses".to_string()]);
    assert_eq!(r.replay_hash(), r.world.state_hash(), "只用命令日志重放一致");

    // 开局已会递减权重均价的奇才：跟他学的是下一种
    let mut r = Runner::new(captain_defs(), 17);
    r.submit(create(["scribes", "university", "debt"], [0, 0, 0, 0, 1, 4], 2, 5, 20, Some("ses"))).unwrap();
    r.days(420);
    assert_eq!(r.world.captain_profile(OwnerId::Player).unwrap().methods().collect::<Vec<_>>(), vec!["ses", "linear"]);

    // 算学 4：学不会
    let mut r = Runner::new(captain_defs(), 17);
    r.submit(create(["scribes", "cadet", "debt"], [0, 0, 0, 0, 1, 4], 1, 5, 20, None)).unwrap();
    assert_eq!(r.world.captain_profile(OwnerId::Player).unwrap().attr(manifest_core::captain::NUMERACY), 4);
    r.days(420);
    assert!(r.world.captain_profile(OwnerId::Player).unwrap().learned.is_empty());
}

#[test]
fn an_old_save_with_a_legacy_sign_keeps_its_name() {
    // 旧版本按出生月份判定星宫：12 月 5 日生的主角记的是提灯座。现在同一天是射手座
    let mut r = Runner::new(captain_defs(), 29);
    r.submit(create(["merchant", "cadet", "debt"], [0, 2, 0, 0, 3, 0], 12, 5, 20, None)).unwrap();
    assert_eq!(r.world.captain_profile(OwnerId::Player).unwrap().sign, "sagittarius");
    // 旧版本写下的存档：档案里的星座是旧版星宫的 key
    let start = StartParams::new(ScenarioId(0), 29);
    let text = SaveFile::new(&r.defs, start, r.world.state.clone(), r.log.clone()).to_json().unwrap();
    let load = |key: &str| {
        let old = text.replace("\"sign\":\"sagittarius\"", &format!("\"sign\":\"{key}\""));
        assert_ne!(old, text, "存档里找得到主角的星座");
        let back = SaveFile::from_json(&old).unwrap();
        World::from_snapshot(r.defs.clone(), back.snapshot).unwrap()
    };
    let w = load("lantern");
    let p = w.captain_profile(OwnerId::Player).unwrap();
    assert_eq!(p.sign, "lantern", "读档不改记下的星座");
    let sign = w.defs.captain.sign(&p.sign).expect("旧版星宫按 key 找得到名字");
    assert!(sign.is_legacy());
    assert_eq!(sign.name.as_str(), "lantern");
    // 别的旧版星宫也找得到；旧版星宫不参与按生日判定
    let w = load("petrel");
    assert!(w.defs.captain.sign("petrel").is_some_and(|s| s.is_legacy()));
    assert_eq!(w.defs.captain.sign_of(12, 5).map(|s| s.key.as_str()), Some("sagittarius"));
    // 读档后照常推进
    let mut w = load("lantern");
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    check_invariants(&w).unwrap();
}

// ───────────────────────────── 确定性与存档 ─────────────────────────────

#[test]
fn backgrounds_without_a_profile_change_nothing() {
    // 数据里有身世、但没有立档：与没有身世数据的世界逐日相同
    let mut a = Runner::new(captain_defs(), 21);
    let mut b = Runner::new(tiny_defs(), 21);
    for _ in 0..200 {
        a.days(1);
        b.days(1);
        assert_eq!(
            manifest_core::world::state_hash("same", &a.world.state),
            manifest_core::world::state_hash("same", &b.world.state),
            "第 {} 天",
            a.world.day()
        );
    }
}

#[test]
fn the_command_is_replayable_and_survives_a_save() {
    let mut r = Runner::new(captain_defs(), 25);
    r.submit(create(["noble", "expedition", "caravan"], [2, 0, 1, 0, 2, 0], 9, 30, 33, None)).unwrap();
    r.days(90);
    assert_eq!(r.replay_hash(), r.world.state_hash());
    let start = StartParams::new(ScenarioId(0), 25);
    let text = SaveFile::new(&r.defs, start, r.world.state.clone(), r.log.clone()).to_json().unwrap();
    let back = SaveFile::from_json(&text).unwrap();
    let profile = r.world.captain_profile(OwnerId::Player).cloned();
    assert!(profile.is_some());
    assert_eq!(back.snapshot.agents.get(&OwnerId::Player).unwrap().captain, profile);
    assert_eq!(
        manifest_core::world::state_hash("x", &back.snapshot),
        manifest_core::world::state_hash("x", &r.world.state)
    );
}

// ───────────────────────────── 算学奇才的游历 ─────────────────────────────

#[test]
fn unemployed_prodigies_move_to_another_tavern_each_season() {
    // 航海士 fighter（在 beta 的酒馆，没有受雇）也是奇才；steward 不是奇才；navigator 是奇才但开局即受雇
    let mut d = (*captain_defs()).clone();
    d.mates[2].methods = vec!["holt".into()];
    let defs = Arc::new(d);
    let run = |seed: u64| {
        let mut w = World::new(defs.clone(), ScenarioId(0), seed).unwrap();
        let steward = w.state.mates[&MateId(3)].at;
        let mut path = vec![w.state.mates[&MateId(2)].at];
        assert_eq!(w.wandering_geniuses(), vec![(MateId(2), path[0])]);
        for season in 1..=8u32 {
            while w.day() < season * 90 - 1 {
                w.end_day().unwrap();
                assert_eq!(w.state.mates[&MateId(2)].at, *path.last().unwrap(), "季中不动（第 {} 天）", w.day());
            }
            w.end_day().unwrap();
            let at = w.state.mates[&MateId(2)].at;
            assert_ne!(Some(&at), path.last(), "每季换一处酒馆");
            assert!(w.defs.loc(at).is_port());
            assert_eq!(w.wandering_geniuses(), vec![(MateId(2), at)]);
            assert_eq!(w.state.mates[&MateId(3)].at, steward, "不是奇才的航海士不动");
            assert_eq!(w.state.mates[&MateId(0)].owner, Some(OwnerId::Player), "受雇的奇才跟着玩家");
            path.push(at);
        }
        path
    };
    let a = run(33);
    assert_eq!(run(33), a, "同一种子走同一条路");
    assert!(a.iter().collect::<std::collections::BTreeSet<_>>().len() >= 3, "三处港口都去过：{a:?}");
    assert_ne!(run(34), a, "不同种子走不同的路");
}

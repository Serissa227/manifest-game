//! 确定性随机数。
//!
//! 所有随机数都从世界种子派生：`(种子, 日期, 领域, 参数)` 经 blake3 得到 ChaCha 种子。
//! 不保存随机数状态，读档与重放天然一致。

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

/// 随机数的用途领域；不同领域互不干扰。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Domain {
    Market = 1,
    Voyage = 2,
    Company = 3,
    Events = 4,
    Futures = 5,
    Caravan = 6,
    Industry = 7,
    Combat = 8,
    Tavern = 9,
    Contracts = 10,
    Diplomacy = 11,
    Bank = 12,
    Scenario = 13,
    News = 14,
    Pirates = 15,
    /// 殖民地：袭击、疫病
    Colony = 16,
    /// 势力占领殖民点
    Claims = 17,
    /// 每日天气（风向锚点、天气系统）
    Weather = 18,
    /// 主角身世（开局的发现物传闻）与算学奇才在各港酒馆之间的游历
    Captain = 20,
    /// 剧情事件：推荐角色的故事线与奇遇（奇遇的发生、属性检定、传闻）
    Story = 22,
    /// 物品货架、掉落与物品事件；与已有随机域隔离。
    Items = 23,
    /// 年度拍品与逐轮竞价，不复用其他玩法的随机流。
    Auction = 24,
    /// 人物交谈与互动。
    Cast = 25,
    /// 养成：旬结算、活动、比赛与远足。
    Upbringing = 26,
    /// 时间线、泄密与战役链。
    History = 27,
    /// 登陆队的风险与内陆发现检定。
    Landing = 28,
    /// 信仰与思想的传播风险（A7 定为 28，与 B8 的 Landing 撞号；B8 先合入，Ideas 顺延为 29，两者都还没进过发布的存档）。
    Ideas = 29,
    /// 怪异的日期与独立条目抽签。
    Creatures = 30,
    /// 有名船只的一次性战利品。
    Salvage = 31,
    /// H02 船况：疲劳事故、哗变的落水货。
    Wear = 32,
    /// H05 岸上差事：采集、伐木的风险
    Shore = 33,
    /// H03 天气团：每段天气系统里团的个数、中心、半径与移速（编号跳到 40，给并行的包留出 32–39）。
    WeatherCells = 40,
    /// H04 海上所见：每天生成的所见。
    Sightings = 41,
    /// H06 喊话：虚张声势的检定。
    Hail = 42,
    /// H08 甲板闲话：说不说、说哪一句。
    Banter = 43,
    /// 商会跟投挑港口（T02；44–47 留给交易与投资改造）
    NpcInvest = 44,
    /// S02：名船震慑；保留 44–47 给交易与投资改造。
    LegendTraits = 48,
}

/// 确定性随机源。
pub struct Rng {
    inner: ChaCha8Rng,
}

impl Rng {
    pub fn derive(seed: u64, day: u32, domain: Domain, a: u64, b: u64) -> Rng {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"manifest-rng-v1");
        hasher.update(&seed.to_le_bytes());
        hasher.update(&day.to_le_bytes());
        hasher.update(&(domain as u32).to_le_bytes());
        hasher.update(&a.to_le_bytes());
        hasher.update(&b.to_le_bytes());
        let hash = hasher.finalize();
        Rng { inner: ChaCha8Rng::from_seed(*hash.as_bytes()) }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.inner.next_u64()
    }

    /// `[0, n)` 的整数；n 为 0 时返回 0。
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            return 0;
        }
        // 拒绝采样消除取模偏差
        let zone = u64::MAX - (u64::MAX % n);
        loop {
            let v = self.next_u64();
            if v < zone {
                return v % n;
            }
        }
    }

    /// `[lo, hi]` 闭区间整数。
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        let span = (hi - lo) as u64 + 1;
        lo + self.below(span) as i64
    }

    /// 以万分之 `bp` 的概率返回 true。
    pub fn chance_bp(&mut self, bp: i64) -> bool {
        if bp <= 0 {
            return false;
        }
        if bp >= 10_000 {
            return true;
        }
        (self.below(10_000) as i64) < bp
    }

    /// 按权重选择下标；权重全为 0 时返回 None。
    pub fn weighted(&mut self, weights: &[i64]) -> Option<usize> {
        let total: i64 = weights.iter().map(|w| (*w).max(0)).sum();
        if total <= 0 {
            return None;
        }
        let mut pick = self.below(total as u64) as i64;
        for (i, w) in weights.iter().enumerate() {
            let w = (*w).max(0);
            if pick < w {
                return Some(i);
            }
            pick -= w;
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_domain_values_are_unique() {
        let domains = [
            Domain::Market,
            Domain::Voyage,
            Domain::Company,
            Domain::Events,
            Domain::Futures,
            Domain::Caravan,
            Domain::Industry,
            Domain::Combat,
            Domain::Tavern,
            Domain::Contracts,
            Domain::Diplomacy,
            Domain::Bank,
            Domain::Scenario,
            Domain::News,
            Domain::Pirates,
            Domain::Colony,
            Domain::Claims,
            Domain::Weather,
            Domain::Captain,
            Domain::Story,
            Domain::Items,
            Domain::Auction,
            Domain::Cast,
            Domain::Upbringing,
            Domain::History,
            Domain::Landing,
            Domain::Ideas,
            Domain::Creatures,
            Domain::Salvage,
        ];
        let values: std::collections::BTreeSet<_> = domains.iter().map(|domain| *domain as u32).collect();
        assert_eq!(values.len(), domains.len());
        assert_eq!(Domain::Auction as u32, 24);
        assert_eq!(Domain::Cast as u32, 25);
        assert_eq!(Domain::Upbringing as u32, 26);
        assert_eq!(Domain::History as u32, 27);
        assert_eq!(Domain::Landing as u32, 28);
        assert_eq!(Domain::Ideas as u32, 29);
        assert_eq!(Domain::Creatures as u32, 30);
        assert_eq!(Domain::Salvage as u32, 31);
    }

    #[test]
    fn derivation_is_deterministic_and_domain_separated() {
        let mut a = Rng::derive(42, 10, Domain::Market, 1, 2);
        let mut b = Rng::derive(42, 10, Domain::Market, 1, 2);
        let mut c = Rng::derive(42, 10, Domain::Voyage, 1, 2);
        let va: Vec<u64> = (0..8).map(|_| a.next_u64()).collect();
        let vb: Vec<u64> = (0..8).map(|_| b.next_u64()).collect();
        let vc: Vec<u64> = (0..8).map(|_| c.next_u64()).collect();
        assert_eq!(va, vb);
        assert_ne!(va, vc);
    }

    #[test]
    fn ranges_stay_in_bounds() {
        let mut r = Rng::derive(1, 2, Domain::Events, 3, 4);
        for _ in 0..1000 {
            let v = r.range(-3, 5);
            assert!((-3..=5).contains(&v));
        }
        assert_eq!(r.weighted(&[0, 0]), None);
        assert_eq!(r.weighted(&[0, 5]), Some(1));
    }
}

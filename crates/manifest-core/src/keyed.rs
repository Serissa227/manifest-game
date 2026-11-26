//! 按 key 查定义：懒建的排序次序，代替“逐条比较 key”。
//!
//! 静态定义多是 `Vec<T>` 加一个字符串 key，查的时候 `iter().find(|t| t.key == key)`。条目上百之后，
//! “对每一条再按 key 查一条”就是平方级的——寰宇有八百多条故事轨道、五百多个人物，这样的查找每天要做几十万次。
//! 而且各条目的 key 散在堆上：一轮查找前别的结算刚把缓存冲过一遍，光把几百个 key 挨个读进来就要零点几毫秒。
//! [`KeyOrder`] 记下按 key 排好序的下标（第一次用到时建），并把排好序的 key 首尾相接抄一份：
//! 查找在这一块连续的内存上二分，“与另一张按 key 排序的表并排走一遍”也只读它。
//!
//! 结果与逐条比较相同：key 重复时取靠前的那一条（稳定排序 + 取第一个不小于 key 的位置）。
//!
//! 它只是缓存：不参与相等比较；拷贝出来的定义从头再建。运行中的定义放在 `Arc` 里不再改动；
//! 测试里若在建好次序之后又就地改了定义（增、删、挪、换 key），也不会查错：
//! - 查单条（[`KeyOrder::find`] / [`KeyOrder::position`]）：条目数变了就逐条比较；查到的那一项当场比对它现在的 key，
//!   对不上就退回逐条比较；没查到时先核对次序还作不作数（见下），不作数同样退回逐条比较。
//! - 要整张次序（[`KeyOrder::sorted`]）：先核对每个条目 key 的地址与长度都和建的时候一样（只读条目本身那一排连续的内存，
//!   不碰散在堆上的 key），有一处不一样就交不出来，调用方走逐条的老路。
//!
//! 核对不出来的只剩这样的改法：条目数不变，建好之后把更靠前的另一条就地换成同一个 key（那得先有重复的 key，
//! 数据校验不允许）；或者把某个 key 原地改写成等长的另一串字节、换成的新串恰好落在原地址且等长（没有代码这样做）。
//! 不涉及 IO、时间、随机数与浮点。
use std::sync::OnceLock;

/// 按 key 排好序的下标与抄下来的 key（见模块说明）。
#[derive(Default)]
pub struct KeyOrder(OnceLock<Built>);

/// 它只是缓存：与相等比较一样，Debug 也不印里面的东西。建没建、建在哪里取决于之前有没有人查过、
/// 内存落在哪里（`heads` 记的是 key 的地址），印出来会让两份内容相同的定义 Debug 输出不同
/// （2026-11-11 统一验证：`load_speed` 按 Debug 摘要比对两份静态数据，每次摘要都不同即因此）。
impl std::fmt::Debug for KeyOrder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("KeyOrder")
    }
}

#[derive(Debug)]
struct Built {
    /// 按 key 排好序的下标（key 相同的保持原来的先后）
    order: Vec<u32>,
    /// 排好序的 key 首尾相接抄一份
    arena: String,
    /// `arena` 里按排序次序第 i 个 key 的结束位置
    ends: Vec<u32>,
    /// 建的时候各条目（按原来的次序）key 的地址与长度：整张次序还作不作数靠它核对
    heads: Vec<(usize, usize)>,
}

impl Built {
    fn new<T>(items: &[T], key_of: &impl Fn(&T) -> &str) -> Built {
        let mut order: Vec<u32> = (0..items.len() as u32).collect();
        // 稳定排序：key 相同的保持原来的先后
        order.sort_by(|a, b| key_of(&items[*a as usize]).cmp(key_of(&items[*b as usize])));
        let mut arena = String::new();
        let mut ends = Vec::with_capacity(order.len());
        for i in &order {
            arena.push_str(key_of(&items[*i as usize]));
            ends.push(arena.len() as u32);
        }
        Built { order, arena, ends, heads: items.iter().map(|t| head(key_of(t))).collect() }
    }

    /// 排序次序里第 `pos` 个 key（抄下来的那一份）。
    fn key(&self, pos: usize) -> &str {
        let start = if pos == 0 { 0 } else { self.ends.get(pos - 1).map_or(0, |e| *e as usize) };
        let end = self.ends.get(pos).map_or(start, |e| *e as usize);
        self.arena.get(start..end).unwrap_or("")
    }

    /// 每个条目的 key 都还是建的时候那一个（地址与长度都没变）。
    fn fresh<T>(&self, items: &[T], key_of: &impl Fn(&T) -> &str) -> bool {
        self.heads.len() == items.len() && items.iter().zip(&self.heads).all(|(t, h)| head(key_of(t)) == *h)
    }

    /// 第一个不小于 `key` 的位置（在抄下来的 key 上二分）。
    fn lower_bound(&self, key: &str) -> usize {
        let (mut lo, mut hi) = (0, self.order.len());
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.key(mid) < key {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }
}

/// 一个 key 此刻的地址与长度。
fn head(key: &str) -> (usize, usize) {
    (key.as_ptr() as usize, key.len())
}

impl Clone for KeyOrder {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl PartialEq for KeyOrder {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

impl Eq for KeyOrder {}

impl KeyOrder {
    fn built<T>(&self, items: &[T], key_of: &impl Fn(&T) -> &str) -> &Built {
        self.0.get_or_init(|| Built::new(items, key_of))
    }

    /// 第一条 key 相同的项的下标：与 `items.iter().position(|t| key_of(t) == key)` 相同。
    pub fn position<T>(&self, items: &[T], key: &str, key_of: impl Fn(&T) -> &str) -> Option<usize> {
        let built = self.built(items, &key_of);
        // 条目数变了（建好之后增删过）：次序不作数，逐条比较
        if built.order.len() == items.len() {
            let at = built.lower_bound(key);
            if at < built.order.len() && built.key(at) == key {
                // 查到了：当场比对这一项现在的 key
                if let Some(i) = built.order.get(at).map(|i| *i as usize)
                    && items.get(i).is_some_and(|t| key_of(t) == key)
                {
                    return Some(i);
                }
            } else if built.fresh(items, &key_of) {
                // 没查到，而每个条目的 key 都还是建的时候那一个：确实没有
                return None;
            }
        }
        items.iter().position(|t| key_of(t) == key)
    }

    /// 第一条 key 相同的项：与 `items.iter().find(|t| key_of(t) == key)` 相同。
    pub fn find<'a, T>(&self, items: &'a [T], key: &str, key_of: impl Fn(&T) -> &str) -> Option<&'a T> {
        self.position(items, key, key_of).and_then(|i| items.get(i))
    }

    /// 全部条目按 key 从小到大（key 相同的保持原来的先后），连同各自的 key（抄下来的那一份，读它不用去碰条目的 key）；
    /// 次序与当前的 `items` 对不上时为 None。给“与另一张同样按 key 排序的表并排走一遍”用。
    pub fn sorted<'a, T>(
        &'a self,
        items: &'a [T],
        key_of: impl Fn(&T) -> &str,
    ) -> Option<impl Iterator<Item = (&'a str, &'a T)> + Clone + 'a> {
        let built = self.built(items, &key_of);
        if !built.fresh(items, &key_of) {
            return None;
        }
        Some(
            built
                .order
                .iter()
                .enumerate()
                .filter_map(move |(pos, i)| items.get(*i as usize).map(|t| (built.key(pos), t))),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::KeyOrder;

    #[derive(Clone, Debug, PartialEq)]
    struct Item {
        key: String,
        n: u32,
    }

    fn items(keys: &[&str]) -> Vec<Item> {
        keys.iter().enumerate().map(|(n, k)| Item { key: (*k).into(), n: n as u32 }).collect()
    }

    fn key(t: &Item) -> &str {
        &t.key
    }

    fn check(order: &KeyOrder, list: &[Item], probes: &[&str]) {
        for probe in probes {
            assert_eq!(order.position(list, probe, key), list.iter().position(|t| t.key == *probe), "{probe:?}");
            assert_eq!(order.find(list, probe, key), list.iter().find(|t| t.key == *probe), "{probe:?}");
        }
    }

    #[test]
    fn finds_the_first_item_with_the_key_like_a_linear_scan() {
        // 有重复、有空串、有互为前缀的 key
        let list = items(&["m", "b", "", "zz", "b", "a", "ab", "z", "m", "a"]);
        check(&KeyOrder::default(), &list, &["", "a", "ab", "abc", "b", "c", "m", "z", "zz", "zzz", "\u{4e2d}"]);
        // 首尾相接抄下来的 key 不会串到相邻的一条上
        let glued = items(&["ab", "c", "a", "bc", "abc"]);
        check(&KeyOrder::default(), &glued, &["a", "ab", "abc", "b", "bc", "c", "abcc", "bca", ""]);
        let empty: Vec<Item> = Vec::new();
        assert_eq!(KeyOrder::default().find(&empty, "a", key), None);
        assert_eq!(KeyOrder::default().find(&empty, "", key), None);
    }

    #[test]
    fn sorted_is_ascending_and_stable_and_carries_the_keys() {
        let list = items(&["m", "b", "", "zz", "b", "a"]);
        let order = KeyOrder::default();
        let got: Vec<(&str, u32)> = order.sorted(&list, key).expect("次序可用").map(|(k, t)| (k, t.n)).collect();
        assert_eq!(got, [("", 2), ("a", 5), ("b", 1), ("b", 4), ("m", 0), ("zz", 3)]);
        assert!(order.sorted(&list, key).expect("再取一次").all(|(k, t)| k == t.key));
    }

    #[test]
    fn edits_after_the_order_was_built_still_give_linear_scan_results() {
        let probes = ["a", "b", "c", "d", "e", "q", "x", "z", ""];
        // 追加
        let mut list = items(&["d", "b", "a", "c"]);
        let order = KeyOrder::default();
        assert_eq!(order.find(&list, "a", key).map(|t| t.n), Some(2));
        list.push(Item { key: "e".into(), n: 9 });
        check(&order, &list, &probes);
        assert!(order.sorted(&list, key).is_none());
        // 插到最前、删除
        list.insert(0, Item { key: "a".into(), n: 7 });
        list.remove(2);
        check(&order, &list, &probes);
        // 长度不变、换一个 key（新串另占一处内存）
        let mut same_len = items(&["a", "b", "c"]);
        let order = KeyOrder::default();
        assert!(order.sorted(&same_len, key).is_some());
        same_len[0].key = "z".to_string();
        check(&order, &same_len, &probes);
        assert!(order.sorted(&same_len, key).is_none());
        // 长度不变、调换两条
        let mut swapped = items(&["a", "b", "c"]);
        let order = KeyOrder::default();
        assert!(order.sorted(&swapped, key).is_some());
        swapped.swap(0, 2);
        check(&order, &swapped, &probes);
        assert!(order.sorted(&swapped, key).is_none());
        // 整张换掉（新表先建好、旧表后丢）
        let mut replaced = items(&["a", "b", "c"]);
        let order = KeyOrder::default();
        assert!(order.sorted(&replaced, key).is_some());
        replaced = items(&["c", "a", "x"]);
        check(&order, &replaced, &probes);
        assert!(order.sorted(&replaced, key).is_none());
        // 拷贝不带次序、相等比较不看次序
        assert_eq!(order.clone(), KeyOrder::default());
    }
}

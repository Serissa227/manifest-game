//! 写时复制的共享值：让“整份世界拷一遍”便宜下来。
//!
//! 内核里有几处要先把整个世界拷一份再试着改：剧情选项能不能选（[`crate::story2`] 的 `check_answer`，每个选项试算一遍）、
//! 手动航行按分钟的只读投影（`navigation_projection`，在海上时每次取概览、取航行视图都要一份）、回应剧情时的原子结算。
//! 寰宇的世界状态里，各地的市场（`WorldState::locations`）占了八成五、行情情报（`InfoState::known`）又占一成
//! （2026-11-10 实测：出海四年的存档，状态 JSON 53.6 MB，其中 locations 45.6 MB、info 5.6 MB），
//! 而上面这些试算几乎从不碰它们——却每次都要整块拷一遍，一次一百多毫秒；待答的剧情有三个选项时，
//! 每建一次概览就要拷六次，将近一秒。
//!
//! [`Shared<T>`] 把这样的大块包进 `Arc`：`clone` 只加一次引用计数；要改的时候（`DerefMut`）才看是不是独占，
//! 不是就先拷一份自己的再改（`Arc::make_mut`）。平时世界只有一份，独占，改起来不拷；试算的那一份不改这些块，也就一直不拷。
//!
//! 对外完全透明：读、写、下标、遍历都照原来的写法（`Deref` / `DerefMut` / `IntoIterator`），
//! 序列化与原来逐字节相同（存档格式、状态哈希都不变），相等按值比较。不涉及 IO、时间、随机数与浮点。
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

/// 写时复制的共享值（见模块说明）。
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Shared<T>(Arc<T>);

impl<T> Shared<T> {
    pub fn new(value: T) -> Self {
        Self(Arc::new(value))
    }

    /// 两个值是不是还共用着同一份（没有哪一边改过）。给测试与诊断用。
    pub fn same(a: &Self, b: &Self) -> bool {
        Arc::ptr_eq(&a.0, &b.0)
    }
}

impl<T> Clone for Shared<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<T> From<T> for Shared<T> {
    fn from(value: T) -> Self {
        Self::new(value)
    }
}

impl<T> Deref for Shared<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: Clone> DerefMut for Shared<T> {
    fn deref_mut(&mut self) -> &mut T {
        Arc::make_mut(&mut self.0)
    }
}

impl<'a, T> IntoIterator for &'a Shared<T>
where
    &'a T: IntoIterator,
{
    type Item = <&'a T as IntoIterator>::Item;
    type IntoIter = <&'a T as IntoIterator>::IntoIter;

    fn into_iter(self) -> Self::IntoIter {
        self.deref().into_iter()
    }
}

impl<'a, T: Clone> IntoIterator for &'a mut Shared<T>
where
    &'a mut T: IntoIterator,
{
    type Item = <&'a mut T as IntoIterator>::Item;
    type IntoIter = <&'a mut T as IntoIterator>::IntoIter;

    fn into_iter(self) -> Self::IntoIter {
        self.deref_mut().into_iter()
    }
}

impl<T: Serialize> Serialize for Shared<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.deref().serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Shared<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        T::deserialize(deserializer).map(Self::new)
    }
}

#[cfg(test)]
mod tests {
    use super::Shared;
    use std::collections::BTreeMap;

    #[test]
    fn clone_shares_until_written() {
        let mut a: Shared<Vec<u32>> = vec![1, 2, 3].into();
        let b = a.clone();
        assert!(Shared::same(&a, &b));
        // 只读（下标、遍历、方法）不拆开
        assert_eq!(a[1], 2);
        assert_eq!(a.iter().sum::<u32>(), 6);
        assert_eq!((&a).into_iter().count(), 3);
        assert!(Shared::same(&a, &b));
        // 一写就各有一份，另一边不受影响
        a[1] = 20;
        assert!(!Shared::same(&a, &b));
        assert_eq!(*a, vec![1, 20, 3]);
        assert_eq!(*b, vec![1, 2, 3]);
    }

    #[test]
    fn unique_owner_writes_in_place() {
        let mut a: Shared<Vec<u32>> = vec![0; 4].into();
        let before = a.as_ptr();
        for x in &mut a {
            *x += 1;
        }
        a[0] = 9;
        // 独占时改的就是原来那一份（没有另拷）
        assert_eq!(a.as_ptr(), before);
        assert_eq!(*a, vec![9, 1, 1, 1]);
    }

    #[test]
    fn compares_by_value() {
        let a: Shared<Vec<u32>> = vec![1, 2].into();
        let b: Shared<Vec<u32>> = vec![1, 2].into();
        let c: Shared<Vec<u32>> = vec![1, 3].into();
        assert!(!Shared::same(&a, &b));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(Shared::<Vec<u32>>::default(), Shared::new(Vec::new()));
    }

    #[test]
    fn serializes_transparently() {
        let mut map = BTreeMap::new();
        map.insert("a".to_string(), vec![1u32, 2]);
        let plain = serde_json::to_string(&map).unwrap();
        let shared: Shared<BTreeMap<String, Vec<u32>>> = map.clone().into();
        // 与不包这一层逐字节相同：存档格式与状态哈希都不变
        assert_eq!(serde_json::to_string(&shared).unwrap(), plain);
        let back: Shared<BTreeMap<String, Vec<u32>>> = serde_json::from_str(&plain).unwrap();
        assert_eq!(*back, map);
    }
}

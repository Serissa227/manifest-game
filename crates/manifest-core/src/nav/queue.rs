//! 非负整数 Dijkstra 的单调优先队列。复合键保持原来的（代价、格下标）平局顺序。

pub(super) struct MinQueue {
    last: u128,
    buckets: [Vec<u128>; 97],
}

impl MinQueue {
    pub fn new() -> Self {
        Self { last: 0, buckets: std::array::from_fn(|_| Vec::new()) }
    }

    fn bucket(&self, key: u128) -> usize {
        (128 - (key ^ self.last).leading_zeros()) as usize
    }

    pub fn push(&mut self, cost: i64, cell: u32) {
        let key = ((cost as u128) << 32) | u128::from(cell);
        debug_assert!(cost >= 0 && key >= self.last, "Dijkstra 的新增代价必须单调");
        let bucket = self.bucket(key);
        self.buckets[bucket].push(key);
    }

    pub fn pop(&mut self) -> Option<(i64, u32)> {
        if self.buckets[0].is_empty() {
            let bucket = self.buckets.iter().position(|b| !b.is_empty())?;
            self.last = *self.buckets[bucket].iter().min()?;
            // pop 保留原桶容量；重分配只落到更低的桶，不反复分配临时数组。
            while let Some(key) = self.buckets[bucket].pop() {
                let target = self.bucket(key);
                self.buckets[target].push(key);
            }
        }
        let key = self.buckets[0].pop()?;
        Some(((key >> 32) as i64, key as u32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;

    #[test]
    fn monotone_queue_matches_binary_heap_including_ties_and_large_costs() {
        let mut queue = MinQueue::new();
        let mut reference = BinaryHeap::new();
        for cell in (0..80).rev() {
            let cost = if cell < 40 { 1 } else { i64::MAX / 2 };
            queue.push(cost, cell);
            reference.push(Reverse((cost, cell)));
        }
        for i in 0..5000 {
            let expected = reference.pop().map(|Reverse(x)| x);
            assert_eq!(queue.pop(), expected);
            let (cost, _) = expected.expect("仍有待访问的格");
            for k in 0..2 {
                let pair = (cost + 1 + i64::from((i * 31 + k) % 73), i * 2 + k + 100);
                queue.push(pair.0, pair.1);
                reference.push(Reverse(pair));
            }
        }
        while let Some(Reverse(expected)) = reference.pop() {
            assert_eq!(queue.pop(), Some(expected));
        }
        assert_eq!(queue.pop(), None);
        assert_eq!(queue.pop(), None);
    }
}

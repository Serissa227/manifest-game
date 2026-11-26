//! I3 迷雾同步：会话 epoch + 内核版本，窗口内只传行区间，否则传低位在前的连续位图。

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use manifest_core::World;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FogDelta {
    pub epoch: String,
    pub rev: u32,
    pub full: Option<String>,
    pub runs: Vec<[u16; 3]>,
}

pub fn delta(world: &World, epoch: String, since: u64, previous_epoch: Option<&str>) -> FogDelta {
    let explore = &world.state.explore;
    let rev = explore.fog_revision();
    let runs = (previous_epoch == Some(epoch.as_str())).then(|| explore.fog_runs_since(since)).flatten();
    let (full, runs) = match runs {
        Some(runs) => (None, runs),
        None => {
            let len = usize::from(world.defs.map.width) * usize::from(world.defs.map.height);
            (Some(full_bitmap(&explore.cells, len)), Vec::new())
        }
    };
    FogDelta { epoch, rev, full, runs }
}

fn full_bitmap(cells: &[u64], len: usize) -> String {
    let mut bytes = vec![0u8; len.div_ceil(8)];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = cells.get(index / 8).map(|word| (word >> ((index % 8) * 8)) as u8).unwrap_or(0);
    }
    if !len.is_multiple_of(8)
        && let Some(last) = bytes.last_mut()
    {
        *last &= (1u8 << (len % 8)) - 1;
    }
    STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_bitmap_is_lsb_first_and_truncates_word_and_byte_padding() {
        assert_eq!(STANDARD.decode(full_bitmap(&[0xff81], 9)).unwrap(), vec![0x81, 1]);
        assert_eq!(STANDARD.decode(full_bitmap(&[1, 1], 65)).unwrap(), vec![1, 0, 0, 0, 0, 0, 0, 0, 1]);
        assert_eq!(full_bitmap(&[u64::MAX], 0), "");
        assert_eq!(STANDARD.decode(full_bitmap(&[], 9)).unwrap(), vec![0, 0]);
    }
}

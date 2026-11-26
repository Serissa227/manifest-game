//! 寰宇 C3/C4 分片使用与内核相同的严格结构，避免前端接上后才发现字段丢失。
use manifest_core::items::ItemsDefs;

#[test]
fn terra16_books_equipment_and_sets_use_the_engine_schema() {
    let root = manifest_data::find_data_dir().unwrap();
    let mut count = (0, 0, 0);
    for entry in std::fs::read_dir(root.join("worlds/terra16/items")).unwrap() {
        let path = entry.unwrap().path();
        let defs: ItemsDefs = toml::from_str(&std::fs::read_to_string(&path).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        count.0 += defs.items.len();
        count.1 += defs.sets.len();
        count.2 += defs.book_categories.len();
        for item in defs.items.iter().filter(|i| i.read.is_some()) {
            assert!(item.work.is_some());
            assert!(item.published.is_some());
            assert!(item.basis.is_some());
            assert!(!item.sources.is_empty());
            assert!(!item.lore.is_empty());
        }
    }
    // 2026-11-04：辨识类比赛第 1 名的六件新奖品（items/items_gift_u04.toml），709 → 715。
    // U06C / U06C3：养成小物与剧情物品新增 19 件，套装与书类不变。
    // 公开版拿掉 9 件物品：929 → 920。
    assert_eq!(count, (920, 18, 15));
}

#[test]
fn classic_keeps_items_disabled_and_its_data_hash() {
    let defs = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    assert!(!defs.items.enabled());
    assert_eq!(defs.meta.hash, "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35");
}

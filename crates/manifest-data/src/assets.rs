//! 发布资源的引用审计。读取生成清单，不执行前端代码，也不把程序绘图当作缺失文件。

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};

#[derive(Debug, thiserror::Error)]
#[error("资源清单：{0}")]
pub struct AssetError(pub String);

#[derive(Clone, Debug, Serialize)]
pub struct AssetFile {
    pub path: String,
    pub dimensions: Option<(u32, u32)>,
    /// 独立裁切的补丁没有固定尺寸，但必须是有效 WebP 且不超出原画布。
    pub max_dimensions: Option<(u32, u32)>,
    pub bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Asset {
    pub key: String,
    pub category: String,
    pub world: String,
    pub files: Vec<AssetFile>,
    /// 只有清单明确预留或前端实际存在回退分支时才填写。
    pub fallback: Option<String>,
    pub license: Option<String>,
    pub attribution: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AssetReference {
    pub world: String,
    pub source: String,
    pub key: String,
    pub asset: Option<String>,
    pub fallback: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Budget {
    pub name: String,
    pub prefix: String,
    pub exclude: Option<String>,
    pub limit: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct AssetManifest {
    pub assets: Vec<Asset>,
    pub references: Vec<AssetReference>,
    pub budgets: Vec<Budget>,
    pub issues: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct AssetReport {
    pub issues: Vec<String>,
    /// 相对 public/ 的路径；哈希与 P02 一样为完整 BLAKE3。
    pub files: BTreeMap<String, FileInfo>,
    pub budget_bytes: BTreeMap<String, u64>,
    pub fallbacks: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileInfo {
    pub hash: String,
    pub bytes: u64,
}

fn read(path: &Path) -> Result<String, AssetError> {
    std::fs::read_to_string(path).map_err(|e| AssetError(format!("{}：{e}", path.display())))
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}

fn string(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

/// 只接受生成清单使用的数据字面量；拒绝函数、展开表达式和重复对象键。
/// 不通过执行 JS 获取数据，避免检查带来副作用。
struct Literal<'a> {
    text: &'a str,
}

impl Literal<'_> {
    fn space(&mut self) -> Result<(), AssetError> {
        loop {
            self.text = self.text.trim_start();
            if let Some(t) = self.text.strip_prefix("//") {
                self.text = t.split_once('\n').map(|(_, rest)| rest).unwrap_or_default();
            } else if let Some(t) = self.text.strip_prefix("/*") {
                self.text = t.split_once("*/").ok_or_else(|| AssetError("注释未结束".into()))?.1;
            } else {
                return Ok(());
            }
        }
    }

    fn quoted(&mut self) -> Result<String, AssetError> {
        let mut escaped = false;
        for (i, c) in self.text.char_indices().skip(1) {
            if c == '"' && !escaped {
                let value = serde_json::from_str(&self.text[..=i]).map_err(|e| AssetError(format!("字符串：{e}")))?;
                self.text = &self.text[i + 1..];
                return Ok(value);
            }
            escaped = c == '\\' && !escaped;
        }
        Err(AssetError("字符串未结束".into()))
    }

    fn take(&mut self, c: char) -> Result<(), AssetError> {
        self.space()?;
        self.text = self.text.strip_prefix(c).ok_or_else(|| AssetError(format!("应为 {c}")))?;
        Ok(())
    }

    fn value(&mut self) -> Result<Value, AssetError> {
        self.space()?;
        match self.text.chars().next() {
            Some('"') => Ok(Value::String(self.quoted()?)),
            Some('[') => {
                self.take('[')?;
                let mut values = Vec::new();
                loop {
                    self.space()?;
                    if self.text.starts_with(']') {
                        break;
                    }
                    values.push(self.value()?);
                    self.space()?;
                    if self.text.starts_with(']') {
                        break;
                    }
                    self.take(',')?;
                }
                self.take(']')?;
                Ok(Value::Array(values))
            }
            Some('{') => {
                self.take('{')?;
                let mut values = Map::new();
                loop {
                    self.space()?;
                    if self.text.starts_with('}') {
                        break;
                    }
                    let key = if self.text.starts_with('"') {
                        self.quoted()?
                    } else {
                        let n = self.text.bytes().take_while(|c| c.is_ascii_alphanumeric() || *c == b'_').count();
                        if n == 0 {
                            return Err(AssetError("对象键不是字面量".into()));
                        }
                        let key = self.text[..n].to_owned();
                        self.text = &self.text[n..];
                        key
                    };
                    self.take(':')?;
                    if values.insert(key.clone(), self.value()?).is_some() {
                        return Err(AssetError(format!("重复 key：{key}")));
                    }
                    self.space()?;
                    if self.text.starts_with('}') {
                        break;
                    }
                    self.take(',')?;
                }
                self.take('}')?;
                Ok(Value::Object(values))
            }
            _ => {
                let n = self.text.bytes().take_while(|c| c.is_ascii_alphanumeric() || b"+-.".contains(c)).count();
                let value =
                    serde_json::from_str(&self.text[..n]).map_err(|e| AssetError(format!("非数据字面量：{e}")))?;
                self.text = &self.text[n..];
                Ok(value)
            }
        }
    }
}

fn constant(root: &Path, file: &str, name: &str) -> Result<Value, AssetError> {
    optional_constant(root, file, name)?.ok_or_else(|| AssetError(format!("{file} 缺少 {name}")))
}

fn optional_constant(root: &Path, file: &str, name: &str) -> Result<Option<Value>, AssetError> {
    let text = read(&root.join(file))?;
    let prefix = format!("const {name}");
    let Some(start) = text.find(&prefix) else { return Ok(None) };
    let (_, text) = text[start..].split_once('=').ok_or_else(|| AssetError(format!("{file} 缺少赋值")))?;
    Literal { text }.value().map(Some).map_err(|e| AssetError(format!("{file} {name}：{e}")))
}

/// 曲目编号：`TRACK_IDS` 的末尾展开多写的曲目 `...MORE_TRACK_IDS`（第九批 A01，`tracks/more.ts`）。
/// 字面量解析仍拒绝展开表达式；这里只认这一处、在这个位置的展开，把它换成 `more.ts` 里的那张字面量表，
/// 别的展开照旧报错。
fn track_ids(root: &Path) -> Result<Vec<String>, AssetError> {
    const FILE: &str = "frontend/src/audio/tracks/index.ts";
    const MORE_FILE: &str = "frontend/src/audio/tracks/more.ts";
    const SPREAD: &str = "...MORE_TRACK_IDS";
    let text = read(&root.join(FILE))?;
    let start = text.find("const TRACK_IDS").ok_or_else(|| AssetError(format!("{FILE} 缺少 TRACK_IDS")))?;
    let (_, body) = text[start..].split_once('=').ok_or_else(|| AssetError(format!("{FILE} 缺少赋值")))?;
    // 只认“数组的最后一项”这一个位置：展开后面只能跟可选的逗号与收尾的 ]
    let (body, spread) = match body.split_once(SPREAD) {
        Some((head, tail)) if tail.trim_start().trim_start_matches(',').trim_start().starts_with(']') => {
            (format!("{head}{}", tail.trim_start().trim_start_matches(',')), true)
        }
        _ => (body.to_owned(), false),
    };
    let base = Literal { text: &body }.value().map_err(|e| AssetError(format!("{FILE} TRACK_IDS：{e}")))?;
    let mut ids = strings(&base);
    if spread {
        ids.extend(strings(&constant(root, MORE_FILE, "MORE_TRACK_IDS")?));
    }
    Ok(ids)
}

fn strings(value: &Value) -> Vec<String> {
    array(value).iter().map(|v| string(v).to_owned()).collect()
}

/// 可选的字符串表（如缺原图、保留旧尺寸的 `*_LEGACY` / `SCENE_LOWRES`）；清单里没有这一项时为空。
fn string_set(root: &Path, file: &str, name: &str) -> Result<BTreeSet<String>, AssetError> {
    Ok(optional_constant(root, file, name)?.map(|v| strings(&v)).unwrap_or_default().into_iter().collect())
}

impl AssetManifest {
    fn add(&mut self, category: &str, key: &str, world: &str, files: Vec<AssetFile>) {
        self.assets.push(Asset {
            key: format!("{category}/{key}"),
            category: category.into(),
            world: world.into(),
            files,
            fallback: None,
            license: None,
            attribution: None,
        });
    }

    fn reference(&mut self, world: &str, source: &str, key: &str, asset: Option<String>, fallback: Option<&str>) {
        self.references.push(AssetReference {
            world: world.into(),
            source: source.into(),
            key: key.into(),
            asset,
            fallback: fallback.map(str::to_owned),
        });
    }
}

fn picture(path: String, width: u32, height: u32) -> AssetFile {
    AssetFile { path, dimensions: Some((width, height)), max_dimensions: None, bytes: None }
}

fn required_strings(value: &Value, name: &str) -> Result<Vec<String>, AssetError> {
    value
        .as_array()
        .ok_or_else(|| AssetError(format!("{name} 必须是字符串数组")))?
        .iter()
        .map(|v| {
            v.as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
                .ok_or_else(|| AssetError(format!("{name} 包含空或非字符串的 key")))
        })
        .collect()
}

/// 版本的首列是文件名，其余列是前端使用的时段、天气或季节标签。
fn variant_files(value: &Value, columns: usize, name: &str) -> Result<Vec<String>, AssetError> {
    let rows = value.as_array().filter(|v| !v.is_empty()).ok_or_else(|| AssetError(format!("{name} 没有版本")))?;
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();
    for row in rows {
        let fields = required_strings(row, name)?;
        if fields.len() != columns {
            return Err(AssetError(format!("{name} 的版本应有 {columns} 列")));
        }
        let file = fields[0].clone();
        if !seen.insert(file.clone()) {
            return Err(AssetError(format!("重复资源版本：{name}/{file}")));
        }
        files.push(file);
    }
    Ok(files)
}

/// 场景大图的尺寸（活动场景、回忆、港口、船、秘境、生物、历史事件）。2026-11-11 用图像接口重画后由 768×336 改为 1152×504
/// （只做桌面版以后，画面常比 768 宽；美术规格换了，不是放宽）。2026-11-12 第十轮 A02 按重画的原图（1536×672）原尺寸导出，
/// 中图、小图各放大一倍（给 1.5–2 倍屏）：大图 1152×504 → 1536×672，中图 384×168 → 768×336，小图 200×88 → 400×176。
const SCENE_LARGE: (u32, u32) = (1536, 672);
const SCENE_MEDIUM: (u32, u32) = (768, 336);
const SCENE_SMALL: (u32, u32) = (400, 176);
/// 没有重画原图、保留旧尺寸的场景图（`sceneLive.ts` 的 `SCENE_LOWRES`）按旧尺寸核对：不放大凑数。
const SCENE_LOWRES_LARGE: (u32, u32) = (1152, 504);
const SCENE_LOWRES_MEDIUM: (u32, u32) = (384, 168);
const SCENE_LOWRES_SMALL: (u32, u32) = (200, 88);
/// 会动的场景的权重图：上下两半各 384×168（上：水、随风、天；下：光源）。
const SCENE_RIG: (u32, u32) = (384, 336);

/// 场景图三种尺寸（大、中、小）：没有原图的按旧尺寸。
fn scene_sizes(lowres: &BTreeSet<String>, file: &str) -> [(u32, u32); 3] {
    if lowres.contains(file) {
        [SCENE_LOWRES_LARGE, SCENE_LOWRES_MEDIUM, SCENE_LOWRES_SMALL]
    } else {
        [SCENE_LARGE, SCENE_MEDIUM, SCENE_SMALL]
    }
}

fn collect_lore(
    out: &mut AssetManifest,
    value: &Value,
    no_medium: &[String],
    lowres: &BTreeSet<String>,
) -> Result<Vec<String>, AssetError> {
    let entries: Vec<(String, Vec<String>)> = if let Some(variants) = value.as_object() {
        variants
            .iter()
            .map(|(key, rows)| {
                if key.trim().is_empty() {
                    return Err(AssetError("LORE_ART 包含空 key".into()));
                }
                Ok((key.clone(), variant_files(rows, 3, &format!("LORE_ART/{key}"))?))
            })
            .collect::<Result<_, AssetError>>()?
    } else {
        required_strings(value, "LORE_ART")?.into_iter().map(|key| (key.clone(), vec![key])).collect()
    };
    let mut keys = Vec::new();
    for (key, variants) in entries {
        let mut files = Vec::new();
        for file in variants {
            let [large, medium, _] = scene_sizes(lowres, &file);
            files.push(picture(format!("scenes/{file}.webp"), large.0, large.1));
            // 新清单的港口只交付大图；生物、船、秘境、历史事件每版仍须有中图。
            if !no_medium.iter().any(|prefix| file.starts_with(prefix)) {
                files.push(picture(format!("scenes/{file}-m.webp"), medium.0, medium.1));
            }
        }
        out.add("lore", &key, "terra16", files);
        keys.push(key);
    }
    Ok(keys)
}

fn collect_scenes(
    out: &mut AssetManifest,
    keys: &[String],
    seasons: &Value,
    lowres: &BTreeSet<String>,
) -> Result<(), AssetError> {
    let seasons = seasons.as_object().ok_or_else(|| AssetError("SCENE_SEASONS 必须是映射".into()))?;
    for key in seasons.keys().filter(|key| !keys.contains(key)) {
        out.issues.push(format!("季节场景未登记：{key}"));
    }
    for key in keys {
        // 无月份时前端始终取基础文件；季节表不能代替基础图。
        let mut variants = vec![key.clone()];
        if let Some(rows) = seasons.get(key) {
            for file in variant_files(rows, 2, &format!("SCENE_SEASONS/{key}"))? {
                if file != *key {
                    variants.push(file);
                }
            }
        }
        let files = variants
            .into_iter()
            .flat_map(|file| {
                let [large, _, small] = scene_sizes(lowres, &file);
                [
                    picture(format!("scenes/{file}.webp"), large.0, large.1),
                    picture(format!("scenes/{file}-s.webp"), small.0, small.1),
                ]
            })
            .collect();
        out.add("scene", key, "terra16", files);
    }
    Ok(())
}

const PORTRAITS: &str = "frontend/src/art/portraitAssets.ts";

/// 从生成清单及世界的有效 TOML（含继承、隐藏世界）收集引用，不构建航线表。
pub fn collect(root: &Path) -> Result<AssetManifest, AssetError> {
    let mut out = AssetManifest::default();
    let metadata: Value =
        serde_json::from_str(&read(&root.join("art-src/portraits.json"))?).map_err(|e| AssetError(e.to_string()))?;
    let mut portrait_ids = BTreeSet::new();
    let mut looks = BTreeMap::new();
    // 缺原图、保留旧尺寸图的人物（tools/portraits/build.py 生成）：按旧尺寸核对，不放大凑数
    let legacy = string_set(root, PORTRAITS, "LEGACY_PORTRAITS")?;
    for name in ["PORTRAIT_ASSETS", "STORY_PORTRAITS", "PENDING_PORTRAITS"] {
        for p in array(&constant(root, PORTRAITS, name)?) {
            let id = string(&p["id"]);
            if let Some(look) = p["look"].as_i64().or_else(|| p["meta"]["index"].as_i64())
                && looks.insert(look, format!("portrait/{id}")).is_some()
            {
                out.issues.push(format!("重复外貌编号：{look}"));
            }
            portrait_ids.insert(id.to_owned());
            let file = string(&p["file"]);
            let world = if id.starts_with("t16-") { "terra16" } else { "shared" };
            // 2026-11-12 第十轮 A02 按原图（1024²）重新导出：配角 320 → 512、专属头像 384 → 768、胸像 256 → 512、
            // 脸部特写 128 → 256；缺原图的（LEGACY_PORTRAITS）仍按旧尺寸
            let old = legacy.contains(id);
            let size = match (file.contains("/npc/"), name == "STORY_PORTRAITS", old) {
                (true, _, false) => 512,
                (true, _, true) => 320,
                (false, true, false) => 768,
                (false, true, true) => 384,
                (false, false, false) => 512,
                (false, false, true) => 256,
            };
            let face = if old { 128 } else { 256 };
            let files = if name == "PENDING_PORTRAITS" {
                Vec::new()
            } else {
                vec![picture(file.into(), size, size), picture(string(&p["face"]).into(), face, face)]
            };
            out.add("portrait", id, world, files);
            if name == "PENDING_PORTRAITS"
                && let Some(a) = out.assets.last_mut()
            {
                a.fallback = Some("生成清单明确预留，程序头像回退".into());
            }
        }
    }
    // 原始生成清单里的条目必须在生成后的前端表里，防止整条被误删后掩盖缺图。
    for p in array(&metadata["items"]).iter().chain(array(&metadata["story"]["items"])) {
        let id = string(&p["id"]);
        if !portrait_ids.contains(id) {
            out.issues.push(format!("头像生成清单未接线：{id}"));
        }
    }
    // 会动的专属头像（寰宇主角）：底图就是专属头像本身，另有眨眼补丁与形变权重图；必须对得上一张专属头像。
    if let Some(live) = optional_constant(root, PORTRAITS, "STORY_LIVE")? {
        for (id, art) in live.as_object().ok_or_else(|| AssetError("STORY_LIVE".into()))? {
            if !portrait_ids.contains(id.as_str()) {
                out.issues.push(format!("会动的头像没有对应的专属头像：{id}"));
            }
            let world = if id.starts_with("t16-") { "terra16" } else { "shared" };
            collect_live(&mut out, &format!("STORY_LIVE/{id}"), art, world);
        }
    }
    let look_source = "frontend/src/art/portraits.ts";
    let captain_span = constant(root, look_source, "CAPTAIN_LOOK_SPAN")?.as_i64().unwrap_or(0);
    // 空着不用的外貌编号：归到 0 号（前端 art/portraits.ts 的 normalizeLook 同此）
    let vacant_look = constant(root, look_source, "VACANT_LOOK")?.as_i64().unwrap_or(-1);
    if captain_span <= 0 {
        return Err(AssetError("普通外貌编号范围必须为正数".into()));
    }
    let strip = constant(root, PORTRAITS, "GUIDE_CROW_ART")?;
    let w = strip["width"].as_u64().unwrap_or(0) as u32 * array(&strip["frames"]).len() as u32;
    let h = strip["height"].as_u64().unwrap_or(0) as u32;
    out.add(
        "live",
        "GUIDE_CROW_ART",
        "shared",
        vec![
            picture(format!("portraits/{}", string(&strip["file"])), w, h),
            picture(format!("portraits/{}", string(&strip["file2x"])), w * 2, h * 2),
        ],
    );
    let scene_file = "frontend/src/components/upbringing/sceneAssets.ts";
    let scenes = required_strings(&constant(root, scene_file, "SCENE_FILES")?, "SCENE_FILES")?;
    let seasons = optional_constant(root, scene_file, "SCENE_SEASONS")?.unwrap_or(Value::Object(Map::new()));
    let scene_lowres = string_set(root, "frontend/src/art/sceneLive.ts", "SCENE_LOWRES")?;
    collect_scenes(&mut out, &scenes, &seasons, &scene_lowres)?;
    let lore_value = constant(root, "frontend/src/art/loreArt.ts", "LORE_ART")?;
    let expanded_lore = lore_value.is_object();
    let no_medium = if expanded_lore {
        required_strings(&constant(root, "frontend/src/art/lore.ts", "NO_MEDIUM")?, "NO_MEDIUM")?
    } else {
        Vec::new()
    };
    let lore = collect_lore(&mut out, &lore_value, &no_medium, &scene_lowres)?;
    // 图标：2026-11-12 第十轮 A02 由 128×128 改为 256×256（原图 384×384）；没有原图的（*_LEGACY）仍是 128×128
    let icon_size = |legacy: &BTreeSet<String>, key: &str| if legacy.contains(key) { 128 } else { 256 };
    let item_file = "frontend/src/components/items/itemIcons.ts";
    let icons = strings(&constant(root, item_file, "ITEM_ICON_KEYS")?);
    let item_legacy = string_set(root, item_file, "ITEM_ICON_KEYS_LEGACY")?;
    for key in &icons {
        let s = icon_size(&item_legacy, key);
        out.add("item", key, "terra16", vec![picture(format!("items/{key}.webp"), s, s)]);
    }
    // 交易品的手绘图标（新界面用；没有图的货按 key 或类别画 16×16 的像素图样，不算缺资源）
    let good_file = "frontend/src/art/goodArt.ts";
    let goods = strings(&constant(root, good_file, "GOOD_ART_KEYS")?);
    let good_legacy = string_set(root, good_file, "GOOD_ART_KEYS_LEGACY")?;
    for key in &goods {
        let s = icon_size(&good_legacy, key);
        out.add("good", key, "terra16", vec![picture(format!("goods/{key}.webp"), s, s)]);
    }
    // 会动的场景：有权重图的大图（前端的着色器按它让水面、云、树与旗帜、灯火动起来）
    let rigs = strings(&constant(root, "frontend/src/art/sceneLive.ts", "SCENE_RIGS")?);
    for name in &rigs {
        out.add(
            "scene-rig",
            name,
            "terra16",
            vec![picture(format!("scenes/{name}-rig.webp"), SCENE_RIG.0, SCENE_RIG.1)],
        );
    }
    for (kind, name, field, attribution) in [
        ("orchestra", "SAMPLE_SETS", "zones", "VS Chamber Orchestra: Community Edition"),
        ("sfx", "SFX_SAMPLES", "files", "Kenney"),
    ] {
        let file = format!("frontend/src/audio/{kind}/samples.ts");
        let text = read(&root.join(&file))?;
        if !text.contains("CC0 1.0") || !text.contains(attribution) {
            out.issues.push(format!("{file}：许可或署名为空／与既有来源不符"));
        }
        let sets = constant(root, &file, name)?;
        for (key, set) in sets.as_object().ok_or_else(|| AssetError(file.clone()))? {
            let attribution = if kind == "orchestra" || key.starts_with("war.cannon") {
                "VS Chamber Orchestra: Community Edition；Versilian Studios；Sam Gossner；Simon Dalzell；Elan Hickler / Soundemote"
            } else if key == "war.splash" {
                // 该音效全由脚本合成，不把其余外部素材的 CC0 声明套给它。
                ""
            } else {
                attribution
            };
            // 炮声的完整录音署名由同源管弦清单提供。
            let source = if key.starts_with("war.cannon") {
                read(&root.join("frontend/src/audio/orchestra/samples.ts"))?
            } else {
                text.clone()
            };
            if !attribution.is_empty() && attribution.split('；').any(|part| !source.contains(part)) {
                out.issues.push(format!("{file}/{key}：署名与生成清单不符"));
            }
            let files = array(&set[field])
                .iter()
                .map(|v| AssetFile {
                    path: format!("audio/{kind}/{}", string(&v["file"])),
                    dimensions: None,
                    max_dimensions: None,
                    bytes: v["bytes"].as_u64(),
                })
                .collect();
            out.add(kind, key, "shared", files);
            if let Some(a) = out.assets.last_mut() {
                a.license = (!attribution.is_empty()).then(|| "CC0 1.0".into());
                a.attribution = (!attribution.is_empty()).then(|| attribution.into());
            }
        }
    }
    let aliases = constant(root, "frontend/src/components/upbringing/ubKit.ts", "SCENE_ALIASES")?;
    let mut ship_keys = strings(&constant(root, "frontend/src/art/ships.ts", "CLASSIC_SHIP_KEYS")?);
    ship_keys.extend(strings(&constant(root, "frontend/src/art/ships16.ts", "T16_KEYS")?));
    let mut styles = strings(&constant(root, "frontend/src/art/buildings.ts", "ARCH_STYLES")?);
    styles.extend(strings(&constant(root, "frontend/src/art/buildings.ts", "CULTURE_STYLES")?));
    let style_aliases = constant(root, "frontend/src/art/buildings.ts", "TOWN_ALIASES")?;
    if let Some(values) = style_aliases.as_object() {
        styles.extend(values.keys().cloned());
    }
    let music = constant(root, "frontend/src/audio/zones.ts", "MUSIC_ZONE_TRACK")?;
    let tracks = track_ids(root)?;
    for track in &tracks {
        out.add("music", track, "shared", Vec::new());
    }
    if let Some(zones) = music.as_object() {
        for (zone, track) in zones {
            if !tracks.iter().any(|t| t == string(track)) {
                out.issues.push(format!("配乐分区引用缺失：{zone} → {}", string(track)));
            }
        }
    }
    let catalogs = Catalogs {
        portraits: portrait_ids,
        scenes,
        lore,
        expanded_lore,
        icons,
        aliases,
        ship_keys,
        styles,
        music,
        tracks,
        looks,
        captain_span,
        vacant_look,
    };
    let data = root.join("data");
    for key in crate::worlds::all_world_keys(&data).map_err(|e| AssetError(e.to_string()))? {
        let world = crate::resolve_world(&data, &key).map_err(|e| AssetError(e.to_string()))?;
        for style in &world.manifest.art.styles {
            style_reference(&mut out, &catalogs, &key, "world.toml", style);
        }
        for file in world.files.keys().filter(|f| f.ends_with(".toml") && !f.starts_with("locales/")) {
            let text = world.read(file).map_err(|e| AssetError(e.to_string()))?;
            let value: toml::Value = toml::from_str(&text).map_err(|e| AssetError(format!("{key}/{file}：{e}")))?;
            walk_data(&mut out, &catalogs, &key, file, &value);
        }
    }
    out.budgets = vec![
        Budget {
            name: "classic/shared portraits".into(),
            prefix: "portraits/".into(),
            exclude: Some("portraits/story/t16/".into()),
            // 2026-11-12 第十轮 A02 按原图重新导出：15 MiB → 20 MiB，约为新实际体积（9.63 MiB）的 2 倍
            limit: 20 * 1024 * 1024,
        },
        Budget {
            name: "terra16 portraits".into(),
            prefix: "portraits/story/t16/".into(),
            exclude: None,
            // 2026-11-12 由 24 MiB 提到 64 MiB（BALANCE 同日）：桌面优先，这条预算原为网页版的下载量定的；
            // 同日第十轮 A02 按原图重新导出（专属头像 768、配角 512、脸部 256）：64 MiB → 144 MiB，约为新实际体积（71.77 MiB）的 2 倍
            limit: 144 * 1024 * 1024,
        },
        Budget { name: "shared orchestra".into(), prefix: "audio/orchestra/".into(), exclude: None, limit: 15_000_000 },
        Budget { name: "shared sfx".into(), prefix: "audio/sfx/".into(), exclude: None, limit: 2_000_000 },
    ];
    Ok(out)
}

fn collect_live(out: &mut AssetManifest, key: &str, art: &Value, world: &str) {
    let w = art["width"].as_u64().unwrap_or(0) as u32;
    let h = art["height"].as_u64().unwrap_or(0) as u32;
    let mut files = vec![picture(format!("portraits/{}", string(&art["file"])), w, h)];
    if let Some(f) = art["file2x"].as_str() {
        files.push(picture(format!("portraits/{f}"), w * 2, h * 2));
    }
    let blink = &art["blink"];
    let bw = blink["w"].as_u64().unwrap_or(0) as u32;
    let bh = blink["h"].as_u64().unwrap_or(0) as u32;
    files.push(picture(format!("portraits/{}", string(&blink["file"])), bw, bh));
    if let Some(f) = blink["file2x"].as_str() {
        // build_live_chibi 在两个分辨率分别求差分包围框，并非放大一倍补丁。
        files.push(AssetFile {
            path: format!("portraits/{f}"),
            dimensions: None,
            max_dimensions: Some((w * 2, h * 2)),
            bytes: None,
        });
    }
    if blink["x"].as_u64().unwrap_or(0) + u64::from(bw) > u64::from(w)
        || blink["y"].as_u64().unwrap_or(0) + u64::from(bh) > u64::from(h)
    {
        out.issues.push(format!("眨眼补丁越界：{key}"));
    }
    // 骨架（有它才做网格形变）：一张比底图小的形变权重图，脸的圆与颈根两个支点都得落在画面里、颈根在脸的下方。
    let rig = &art["rig"];
    if !rig.is_null() {
        match rig["file"].as_str() {
            Some(f) if !f.is_empty() => files.push(AssetFile {
                path: format!("portraits/{f}"),
                dimensions: None,
                max_dimensions: Some((w, h)),
                bytes: None,
            }),
            _ => out.issues.push(format!("骨架缺形变权重图：{key}")),
        }
        let at = |v: &Value| v.as_u64();
        let inside = |x: Option<u64>, y: Option<u64>| matches!((x, y), (Some(x), Some(y)) if x < u64::from(w) && y < u64::from(h));
        let face = &rig["face"];
        let neck = &rig["neck"];
        let ok = inside(at(&face[0]), at(&face[1]))
            && inside(at(&neck[0]), at(&neck[1]))
            && at(&face[2]).is_some_and(|r| r > 0)
            && at(&neck[1]) > at(&face[1]);
        if !ok {
            out.issues.push(format!("骨架支点不对：{key}"));
        }
    }
    out.add("live", key, world, files);
}

#[derive(Default)]
struct Catalogs {
    portraits: BTreeSet<String>,
    scenes: Vec<String>,
    lore: Vec<String>,
    /// 多版本前端同时接入港口、历史事件与活动／回忆插画。
    expanded_lore: bool,
    icons: Vec<String>,
    aliases: Value,
    ship_keys: Vec<String>,
    styles: Vec<String>,
    music: Value,
    tracks: Vec<String>,
    looks: BTreeMap<i64, String>,
    captain_span: i64,
    vacant_look: i64,
}

fn style_reference(out: &mut AssetManifest, c: &Catalogs, world: &str, source: &str, style: &str) {
    out.reference(
        world,
        source,
        &format!("style/{style}"),
        None,
        Some(if c.styles.iter().any(|s| s == style) { "程序街景" } else { "前端默认建筑风格" }),
    );
}

fn lore_reference(out: &mut AssetManifest, c: &Catalogs, world: &str, source: &str, art: &str) {
    let found = c.lore.iter().any(|key| key == art);
    out.reference(
        world,
        source,
        &format!("lore/{art}"),
        found.then(|| format!("lore/{art}")),
        (!found).then_some("清单未收录，前端不显示插画"),
    );
}

fn scene_key<'a>(c: &'a Catalogs, scene: &'a str) -> Option<&'a str> {
    let resolved = if c.scenes.iter().any(|s| s == scene) { scene } else { string(&c.aliases[scene]) };
    c.scenes.iter().any(|s| s == resolved).then_some(resolved)
}

fn story_reference(out: &mut AssetManifest, c: &Catalogs, world: &str, source: &str, art: &str) {
    if c.expanded_lore
        && !c.lore.iter().any(|key| key == art)
        && let Some(scene) = scene_key(c, art)
    {
        out.reference(world, source, &format!("lore/{art}"), Some(format!("scene/{scene}")), None);
    } else {
        lore_reference(out, c, world, source, art);
    }
}

fn port_reference(out: &mut AssetManifest, c: &Catalogs, world: &str, source: &str, port: &str) {
    let realm = format!("realm_{port}");
    let art = if c.lore.contains(&realm) { realm } else { format!("port_{port}") };
    lore_reference(out, c, world, source, &art);
}

fn walk_data(out: &mut AssetManifest, c: &Catalogs, world: &str, source: &str, value: &toml::Value) {
    match value {
        toml::Value::Array(values) => {
            for (i, v) in values.iter().enumerate() {
                walk_data(out, c, world, &format!("{source}[{i}]"), v);
            }
        }
        toml::Value::Table(t) => {
            let key = t.get("key").and_then(toml::Value::as_str).unwrap_or("");
            let source = if key.is_empty() { source.to_owned() } else { format!("{source}({key})") };
            if let Some(look) = t.get("look").and_then(toml::Value::as_integer) {
                let wrapped = (c.captain_span > 0).then(|| {
                    let n = look.rem_euclid(c.captain_span);
                    if n == c.vacant_look { 0 } else { n }
                });
                let asset = c.looks.get(&look).or_else(|| wrapped.and_then(|n| c.looks.get(&n))).cloned();
                out.reference(
                    world,
                    &source,
                    &format!("look/{look}"),
                    asset.clone(),
                    asset.is_none().then_some("按外貌编号取共用头像或程序回退"),
                );
            }
            if let Some(portrait) = t.get("portrait").and_then(toml::Value::as_str) {
                let asset = match portrait {
                    "" => None,
                    id => Some(format!("portrait/{id}")),
                };
                out.reference(
                    world,
                    &source,
                    &format!("portrait/{portrait}"),
                    asset,
                    portrait.is_empty().then_some("未指定肖像，程序头像回退"),
                );
            }
            if !key.is_empty() {
                let prefix = if source.starts_with("mates.toml") {
                    Some("mate")
                } else if source.starts_with("companies.toml") {
                    Some("company")
                } else if source.starts_with("factions.toml") {
                    Some("ruler")
                } else {
                    None
                };
                if let Some(prefix) = prefix {
                    let id = format!("{prefix}-{key}");
                    let asset = c.portraits.contains(&id).then(|| format!("portrait/{id}"));
                    out.reference(
                        world,
                        &source,
                        &id,
                        asset.clone(),
                        asset.is_none().then_some("前端按文化／身份选择共用头像或程序回退"),
                    );
                }
            }
            if let Some(portraits) = t.get("portraits").and_then(toml::Value::as_array)
                && portraits.is_empty()
            {
                out.reference(
                    world,
                    &source,
                    &format!("portrait/{key}"),
                    None,
                    Some("数据未指定年龄头像，程序头像回退"),
                );
            }
            if let Some(music) = t.get("music").and_then(toml::Value::as_str) {
                let (normalized, _) = music.trim().to_lowercase().chars().fold(
                    (String::new(), false),
                    |(mut name, previous_separator), c| {
                        let separator = c.is_whitespace() || c == '-';
                        if !separator || !previous_separator {
                            name.push(if separator { '_' } else { c });
                        }
                        (name, separator)
                    },
                );
                let track = if c.tracks.iter().any(|t| t == music.trim()) {
                    music.trim()
                } else {
                    string(&c.music[&normalized])
                };
                out.reference(
                    world,
                    &source,
                    &format!("music/{music}"),
                    (!track.is_empty()).then(|| format!("music/{track}")),
                    track.is_empty().then_some("前端按海区与文化选择默认配乐"),
                );
            }
            if let Some(asset) = t.get("asset").and_then(toml::Value::as_str)
                && t.contains_key("from_age")
            {
                if world == "testbed" && matches!(asset, "test_child" | "test_adult") {
                    // 两个名字来自 testbed/cast 的年龄选择夹具，不是待交付美术。
                    // 仅限这两个已知 key；隐藏世界的新缺图仍然报错。
                    out.reference(world, &source, asset, None, Some("隐藏测试世界的年龄选择夹具，程序头像回退"));
                } else {
                    if !c.portraits.contains(asset)
                        || out.assets.iter().any(|a| a.key == format!("portrait/{asset}") && a.files.is_empty())
                    {
                        out.issues.push(format!("年龄段缺图：{world}/{source} → {asset}"));
                    }
                    out.reference(world, &source, asset, Some(format!("portrait/{asset}")), None);
                }
            }
            if let Some(scene) = t.get("scene").and_then(toml::Value::as_str) {
                let resolved = scene_key(c, scene);
                out.reference(
                    world,
                    &source,
                    &format!("scene/{scene}"),
                    resolved.map(|key| format!("scene/{key}")),
                    resolved.is_none().then_some("活动底色与图标"),
                );
            }
            if let Some(art) = t.get("art").and_then(toml::Value::as_str) {
                // 老版只查 LORE_ART；多版本前端增加活动／回忆插画作为第二来源。
                story_reference(out, c, world, &source, art);
            }
            if !key.is_empty() && source.starts_with("items.toml") && t.contains_key("kind") {
                let icon = t.get("icon").and_then(toml::Value::as_str).unwrap_or("");
                let book = t
                    .get("read")
                    .filter(|_| t.get("kind").and_then(toml::Value::as_str) == Some("book"))
                    .and_then(|b| b.get("category"))
                    .and_then(toml::Value::as_str)
                    .map(|s| format!("book_{s}"))
                    .unwrap_or_default();
                let resolved = [icon, key, key.strip_suffix("_master").unwrap_or(key), &book]
                    .into_iter()
                    .find(|v| c.icons.iter().any(|k| k == v));
                out.reference(
                    world,
                    &source,
                    &format!("item/{key}"),
                    resolved.map(|v| format!("item/{v}")),
                    resolved.is_none().then_some("按物品类别绘制图标"),
                );
            }
            if !key.is_empty() {
                if c.expanded_lore {
                    if source.starts_with("world/")
                        && (source.contains(".ports[") || source.contains(".cities["))
                        && (t.contains_key("pos") || t.contains_key("lonlat"))
                    {
                        port_reference(out, c, world, &source, key);
                    }
                    if source.starts_with("history/") && t.contains_key("history") && t.contains_key("date") {
                        lore_reference(out, c, world, &source, &format!("event_{key}"));
                    }
                }
                let prefix = if source.starts_with("creatures.toml") {
                    Some("creature_")
                } else if source.starts_with("legend_ships.toml") && t.contains_key("hull") {
                    Some("ship_")
                } else if source.starts_with("realms.toml") && t.contains_key("veil") {
                    Some("realm_")
                } else {
                    None
                };
                if let Some(prefix) = prefix {
                    let art = format!("{prefix}{key}");
                    lore_reference(out, c, world, &source, &art);
                }
                if source.starts_with("realms.toml")
                    && t.contains_key("veil")
                    && let Some(ports) = t.get("ports").and_then(toml::Value::as_array)
                {
                    // 秘境卡片按秘境 key 取图，港口标题另按每个港口 key 取街景。
                    for port in ports.iter().filter_map(toml::Value::as_str) {
                        if c.expanded_lore {
                            port_reference(out, c, world, &format!("{source}.ports"), port);
                        } else {
                            lore_reference(out, c, world, &format!("{source}.ports"), &format!("realm_{port}"));
                        }
                    }
                }
                if source.starts_with("ships.toml") && t.contains_key("sail") {
                    out.reference(
                        world,
                        &source,
                        &format!("ship/{key}"),
                        None,
                        Some(if c.ship_keys.iter().any(|s| s == key) {
                            "程序船型"
                        } else {
                            "按帆型绘制通用船"
                        }),
                    );
                }
            }
            for field in ["style", "town_style"] {
                if let Some(style) = t.get(field).and_then(toml::Value::as_str) {
                    style_reference(out, c, world, &source, style);
                }
            }
            for (field, v) in t {
                walk_data(out, c, world, &format!("{source}.{field}"), v);
            }
        }
        _ => {}
    }
}

/// 校验一个已收集的清单；失败逐条累积，回退项按世界分类并保留全部 key。
pub fn validate(public: &Path, manifest: &AssetManifest, credits: &str) -> AssetReport {
    let mut report = AssetReport { issues: manifest.issues.clone(), ..AssetReport::default() };
    let mut keys = BTreeSet::new();
    for asset in &manifest.assets {
        if !keys.insert(asset.key.clone()) {
            report.issues.push(format!("重复 key：{}", asset.key));
        }
        for (name, value) in [("许可", &asset.license), ("署名", &asset.attribution)] {
            if let Some(value) = value
                && value.split('；').any(|part| part.trim().is_empty() || !credits.contains(part))
            {
                report.issues.push(format!("{}：{name}为空或与 docs/CREDITS.md 不符", asset.key));
            }
        }
        if let Some(reason) = &asset.fallback {
            report.fallbacks.entry(asset.world.clone()).or_default().push(format!("{}：{reason}", asset.key));
        }
        for file in &asset.files {
            let path = Path::new(&file.path);
            if path.is_absolute()
                || path.components().any(|c| !matches!(c, Component::Normal(_)))
                || file.path.contains('\\')
            {
                report.issues.push(format!("资源路径越界：{}", file.path));
                continue;
            }
            match std::fs::read(public.join(path)) {
                Err(e) => report.issues.push(format!("缺资源：{}：{e}", file.path)),
                Ok(data) => {
                    if data.is_empty() {
                        report.issues.push(format!("空资源：{}", file.path));
                    }
                    if let Some(expected) = file.dimensions
                        && webp_dimensions(&data) != Some(expected)
                    {
                        report.issues.push(format!(
                            "尺寸不对：{} 应为 {expected:?}，实际 {:?}",
                            file.path,
                            webp_dimensions(&data)
                        ));
                    }
                    if let Some((width, height)) = file.max_dimensions
                        && webp_dimensions(&data).is_none_or(|(w, h)| w > width || h > height)
                    {
                        report.issues.push(format!("补丁尺寸不对：{} 超出 {width}×{height} 画布或损坏", file.path));
                    }
                    if let Some(expected) = file.bytes
                        && expected != data.len() as u64
                    {
                        report.issues.push(format!("大小不对：{} 应为 {expected}，实际 {}", file.path, data.len()));
                    }
                    report.files.insert(
                        file.path.clone(),
                        FileInfo { hash: blake3::hash(&data).to_hex().to_string(), bytes: data.len() as u64 },
                    );
                }
            }
        }
    }
    for r in &manifest.references {
        if let Some(asset) = &r.asset
            && !keys.contains(asset)
        {
            report.issues.push(format!("引用缺失：{}/{}/{} → {asset}", r.world, r.source, r.key));
        }
        if let Some(reason) = &r.fallback {
            report.fallbacks.entry(r.world.clone()).or_default().push(format!("{}：{reason}", r.key));
        }
    }
    // 预算包括目录内未被引用的残留文件，避免移除清单项就能绕过预算。
    let mut disk = BTreeMap::new();
    if let Err(e) = disk_files(public, public, &mut disk) {
        report.issues.push(e.to_string());
    }
    for budget in &manifest.budgets {
        let bytes = disk
            .iter()
            .filter(|(p, _)| {
                p.starts_with(&budget.prefix) && !budget.exclude.as_ref().is_some_and(|e| p.starts_with(e))
            })
            .map(|(_, n)| n)
            .sum();
        report.budget_bytes.insert(budget.name.clone(), bytes);
        if bytes > budget.limit {
            report.issues.push(format!("预算超限：{} {bytes} > {}", budget.name, budget.limit));
        }
    }
    for values in report.fallbacks.values_mut() {
        values.sort();
        values.dedup();
    }
    report.issues.sort();
    report.issues.dedup();
    report
}

fn disk_files(root: &Path, dir: &Path, out: &mut BTreeMap<String, u64>) -> Result<(), AssetError> {
    for entry in std::fs::read_dir(dir).map_err(|e| AssetError(e.to_string()))? {
        let entry = entry.map_err(|e| AssetError(e.to_string()))?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| AssetError(e.to_string()))?;
        if metadata.is_dir() {
            disk_files(root, &path, out)?;
        } else if let Ok(relative) = path.strip_prefix(root) {
            out.insert(relative.to_string_lossy().replace('\\', "/"), metadata.len());
        }
    }
    Ok(())
}

/// WebP 三种头部的尺寸；检查 RIFF 总长和块边界，损坏或截断的文件返回 None。
pub fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let le = |b: &[u8]| b.iter().enumerate().fold(0u32, |n, (i, v)| n | (u32::from(*v) << (8 * i)));
    if bytes.get(..4)? != b"RIFF"
        || bytes.get(8..12)? != b"WEBP"
        || u64::from(le(bytes.get(4..8)?)) + 8 != bytes.len() as u64
    {
        return None;
    }
    let mut pos = 12usize;
    let mut size = None;
    while pos < bytes.len() {
        let kind = bytes.get(pos..pos + 4)?;
        let len = le(bytes.get(pos + 4..pos + 8)?) as usize;
        let data = bytes.get(pos + 8..pos.checked_add(8)?.checked_add(len)?)?;
        if kind == b"VP8X" {
            size = Some((le(data.get(4..7)?) + 1, le(data.get(7..10)?) + 1));
        } else if kind == b"VP8L" && size.is_none() {
            if data.first()? != &0x2f {
                return None;
            }
            let v = le(data.get(1..5)?);
            size = Some(((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1));
        } else if kind == b"VP8 " && size.is_none() {
            if data.get(3..6)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            size = Some((le(data.get(6..8)?) & 0x3fff, le(data.get(8..10)?) & 0x3fff));
        }
        pos = pos.checked_add(8)?.checked_add(len)?.checked_add(len % 2)?;
    }
    if pos != bytes.len() {
        return None;
    }
    size.filter(|(w, h)| *w > 0 && *h > 0)
}

pub fn check_repository(root: &Path) -> Result<(AssetManifest, AssetReport), AssetError> {
    let manifest = collect(root)?;
    let credits = read(&root.join("docs/CREDITS.md"));
    let mut report = validate(&root.join("frontend/public"), &manifest, credits.as_deref().unwrap_or_default());
    if let Err(error) = credits {
        report.issues.push(error.to_string());
    }
    Ok((manifest, report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_literals_allow_comments_and_escaped_strings() {
        let parsed = Literal {
            text: r#"["one", /* 生成说明 */ {file: "a\"b", bytes: 12}, // 尾注
        ] as const"#,
        }
        .value()
        .unwrap();
        assert_eq!(parsed[1]["file"], "a\"b");
        assert_eq!(parsed[1]["bytes"], 12);
    }

    #[test]
    fn duplicate_object_keys_and_executable_expressions_are_rejected() {
        assert!(Literal { text: r#"{file: "one", file: "two"}"# }.value().is_err());
        assert!(Literal { text: "[{file: makeFile()}]" }.value().is_err());
        assert!(Literal { text: "[...otherAssets]" }.value().is_err());
    }

    #[test]
    fn lore_variants_require_every_picture_and_ports_only_require_large_pictures() {
        let mut manifest = AssetManifest::default();
        let value = serde_json::json!({
            "creature_example": [["creature_example", "day", "clear"], ["creature_example--night-fog", "night", "fog"]],
            "port_example": [["port_example", "day", "clear"]]
        });
        let keys = collect_lore(&mut manifest, &value, &["port_".into()], &BTreeSet::new()).unwrap();
        assert_eq!(keys, ["creature_example", "port_example"]);
        assert_eq!(manifest.assets[0].files.len(), 4);
        assert_eq!(manifest.assets[1].files.len(), 1);
        let missing = tempfile::tempdir().unwrap();
        let report = validate(missing.path(), &manifest, "");
        assert_eq!(report.issues.len(), 5);
        assert!(report.issues.iter().any(|s| s.contains("creature_example--night-fog-m.webp")));
        assert!(!report.issues.iter().any(|s| s.contains("port_example-m.webp")));
        let mut legacy = AssetManifest::default();
        collect_lore(&mut legacy, &serde_json::json!(["creature_example"]), &[], &BTreeSet::new()).unwrap();
        assert_eq!(legacy.assets[0].files.len(), 2, "单版本数组清单仍要求两种尺寸");
    }

    #[test]
    fn malformed_or_duplicate_lore_variants_cannot_silently_become_an_empty_catalog() {
        for value in [
            serde_json::json!(42),
            serde_json::json!({"example": []}),
            serde_json::json!({"example": [["example", "night"]]}),
            serde_json::json!({"example": [["example", "night", ""]]}),
            serde_json::json!({"example": [["example", "day", "clear"], ["example", "night", "fog"]]}),
        ] {
            assert!(collect_lore(&mut AssetManifest::default(), &value, &[], &BTreeSet::new()).is_err(), "{value}");
        }
    }

    #[test]
    fn seasonal_scenes_keep_the_base_and_require_each_registered_variant() {
        let mut manifest = AssetManifest::default();
        collect_scenes(
            &mut manifest,
            &["dock".into()],
            &serde_json::json!({"dock": [["dock", "summer"], ["dock--winter", "winter"]]}),
            &BTreeSet::new(),
        )
        .unwrap();
        assert_eq!(manifest.assets[0].files.len(), 4);
        let missing = tempfile::tempdir().unwrap();
        let report = validate(missing.path(), &manifest, "");
        assert_eq!(report.issues.len(), 4);
        assert!(report.issues.iter().any(|s| s.contains("dock--winter-s.webp")));
        let mut unknown = AssetManifest::default();
        collect_scenes(&mut unknown, &[], &serde_json::json!({"dock": [["dock--winter", "winter"]]}), &BTreeSet::new())
            .unwrap();
        assert!(unknown.issues.iter().any(|s| s.contains("季节场景未登记")));
    }

    #[test]
    fn age_fixture_exemption_is_limited_to_two_testbed_keys() {
        let catalogs = Catalogs::default();
        for (world, key, fallback) in [
            ("testbed", "test_child", true),
            ("testbed", "test_adult", true),
            ("testbed", "missing", false),
            ("terra16", "test_child", false),
        ] {
            let value: toml::Value = toml::from_str(&format!("from_age = 0\nasset = \"{key}\"\n")).unwrap();
            let mut manifest = AssetManifest::default();
            walk_data(&mut manifest, &catalogs, world, "cast.toml", &value);
            assert_eq!(manifest.issues.is_empty(), fallback);
            assert_eq!(manifest.references[0].fallback.is_some(), fallback);
        }
    }

    #[test]
    fn story_art_uses_lore_manifest_without_borrowing_activity_scenes() {
        let catalogs =
            Catalogs { scenes: vec!["court_jp".into()], lore: vec!["creature_example".into()], ..Catalogs::default() };
        for (art, fallback) in [("court_jp", true), ("creature_example", false)] {
            let value: toml::Value = toml::from_str(&format!("art = \"{art}\"\n")).unwrap();
            let mut manifest = AssetManifest::default();
            walk_data(&mut manifest, &catalogs, "terra16", "stories.toml", &value);
            assert_eq!(manifest.references.len(), 1);
            assert_eq!(manifest.references[0].key, format!("lore/{art}"));
            assert_eq!(manifest.references[0].fallback.is_some(), fallback);
            assert_eq!(manifest.references[0].asset.is_none(), fallback);
        }
    }

    #[test]
    fn expanded_story_art_prefers_lore_then_activity_and_memory_scenes() {
        let catalogs = Catalogs {
            scenes: vec!["court_jp".into(), "memory".into()],
            lore: vec!["court_jp".into()],
            aliases: serde_json::json!({"remember": "memory"}),
            expanded_lore: true,
            ..Catalogs::default()
        };
        for (art, asset) in [
            ("court_jp", Some("lore/court_jp")),
            ("memory", Some("scene/memory")),
            ("remember", Some("scene/memory")),
            ("unpainted", None),
        ] {
            let value: toml::Value = toml::from_str(&format!("art = \"{art}\"\n")).unwrap();
            let mut manifest = AssetManifest::default();
            walk_data(&mut manifest, &catalogs, "terra16", "stories/example.toml", &value);
            assert_eq!(manifest.references[0].asset.as_deref(), asset);
            assert_eq!(manifest.references[0].fallback.is_some(), asset.is_none());
        }
    }

    #[test]
    fn expanded_port_and_history_references_follow_the_actual_frontend_keys() {
        let catalogs = Catalogs {
            lore: vec!["port_harbor".into(), "realm_island".into(), "port_island".into(), "event_event".into()],
            expanded_lore: true,
            ..Catalogs::default()
        };
        for coordinate in ["pos", "lonlat"] {
            for (key, asset) in
                [("harbor", Some("lore/port_harbor")), ("island", Some("lore/realm_island")), ("empty", None)]
            {
                let value: toml::Value = toml::from_str(&format!("key = \"{key}\"\n{coordinate} = [1, 1]\n")).unwrap();
                let mut manifest = AssetManifest::default();
                walk_data(&mut manifest, &catalogs, "terra16", "world/ports.toml.ports[0]", &value);
                assert_eq!(manifest.references.len(), 1);
                assert_eq!(manifest.references[0].asset.as_deref(), asset);
                assert_eq!(manifest.references[0].fallback.is_some(), asset.is_none());
            }
        }
        let event: toml::Value = toml::from_str("key = \"event\"\ndate = [1557, 1, 1]\nhistory = {}\n").unwrap();
        let mut manifest = AssetManifest::default();
        walk_data(&mut manifest, &catalogs, "terra16", "history/example.toml.events[0]", &event);
        assert_eq!(manifest.references[0].asset.as_deref(), Some("lore/event_event"));
    }

    #[test]
    fn realm_ports_have_their_own_street_scene_references_and_fallbacks() {
        let catalogs =
            Catalogs { lore: vec!["realm_islands".into(), "realm_first_port".into()], ..Catalogs::default() };
        let value: toml::Value =
            toml::from_str("key = \"islands\"\nveil = {}\nports = [\"first_port\", \"second_port\"]\n").unwrap();
        let mut manifest = AssetManifest::default();
        walk_data(&mut manifest, &catalogs, "terra16", "realms.toml", &value);
        assert_eq!(manifest.references.len(), 3);
        assert_eq!(manifest.references[1].asset.as_deref(), Some("lore/realm_first_port"));
        assert_eq!(manifest.references[2].key, "lore/realm_second_port");
        assert!(manifest.references[2].fallback.is_some());
    }

    #[test]
    fn captain_looks_resolve_regular_special_and_wrapped_portraits() {
        let catalogs = Catalogs {
            captain_span: 25,
            vacant_look: 12,
            looks: [
                (0, "portrait/captain-00"),
                (23, "portrait/captain-23"),
                (24, "portrait/captain-24"),
                (101, "portrait/story-example"),
            ]
            .into_iter()
            .map(|(key, value)| (key, value.into()))
            .collect(),
            ..Catalogs::default()
        };
        for (look, asset) in [
            (23, "portrait/captain-23"),
            (-1, "portrait/captain-24"),
            (37, "portrait/captain-00"),
            (12, "portrait/captain-00"),
            (25, "portrait/captain-00"),
            (101, "portrait/story-example"),
        ] {
            let value: toml::Value = toml::from_str(&format!("look = {look}\n")).unwrap();
            let mut manifest = AssetManifest::default();
            walk_data(&mut manifest, &catalogs, "classic", "scenarios.toml", &value);
            assert_eq!(manifest.references[0].asset.as_deref(), Some(asset));
            assert!(manifest.references[0].fallback.is_none());
        }
    }

    #[test]
    fn live_art_registers_the_weight_map_and_rejects_bad_pivots() {
        let art = |rig: &str| -> Value {
            serde_json::from_str(&format!(
                r#"{{"file":"story/t16/a.webp","width":384,"height":384,
                    "blink":{{"file":"story/t16/a-blink.webp","x":150,"y":80,"w":90,"h":50}}{rig}}}"#
            ))
            .unwrap()
        };
        // 没有骨架：只有底图与眨眼补丁
        let mut out = AssetManifest::default();
        collect_live(&mut out, "STORY_LIVE/t16-a", &art(""), "terra16");
        assert!(out.issues.is_empty());
        assert_eq!(out.assets[0].world, "terra16");
        assert_eq!(out.assets[0].files.len(), 2);
        // 有骨架：多一张权重图，尺寸只要求不超过底图
        let mut out = AssetManifest::default();
        collect_live(
            &mut out,
            "STORY_LIVE/t16-a",
            &art(r#","rig":{"file":"story/t16/a-rig.webp","face":[195,125,60],"neck":[195,200]}"#),
            "terra16",
        );
        assert!(out.issues.is_empty(), "{:?}", out.issues);
        let rig = &out.assets[0].files[2];
        assert_eq!(rig.path, "portraits/story/t16/a-rig.webp");
        assert_eq!((rig.dimensions, rig.max_dimensions), (None, Some((384, 384))));
        // 支点出了画面、颈根不在脸下方、半径为 0、缺权重图：都报出来
        for bad in [
            r#","rig":{"file":"story/t16/a-rig.webp","face":[400,125,60],"neck":[195,200]}"#,
            r#","rig":{"file":"story/t16/a-rig.webp","face":[195,125,60],"neck":[195,120]}"#,
            r#","rig":{"file":"story/t16/a-rig.webp","face":[195,125,0],"neck":[195,200]}"#,
            r#","rig":{"face":[195,125,60],"neck":[195,200]}"#,
        ] {
            let mut out = AssetManifest::default();
            collect_live(&mut out, "STORY_LIVE/t16-a", &art(bad), "terra16");
            assert_eq!(out.issues.len(), 1, "{bad}：{:?}", out.issues);
        }
    }

    #[test]
    fn explicit_portraits_are_references_even_when_the_key_is_unknown() {
        for (portrait, asset) in [("unknown", Some("portrait/unknown")), ("", None)] {
            let value: toml::Value = toml::from_str(&format!("portrait = \"{portrait}\"\n")).unwrap();
            let mut manifest = AssetManifest::default();
            walk_data(&mut manifest, &Catalogs::default(), "terra16", "persons.toml", &value);
            assert_eq!(manifest.references.len(), 1);
            assert_eq!(manifest.references[0].asset.as_deref(), asset);
            assert_eq!(manifest.references[0].fallback.is_some(), asset.is_none());
        }
    }
}

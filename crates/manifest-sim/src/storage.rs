//! 存档文件读写：JSON，可选 zstd 压缩（按文件头自动识别）。

use crate::SimError;
use manifest_core::SaveFile;
use std::io::Read;
use std::path::Path;

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// 序列化存档为字节。
pub fn encode(save: &SaveFile, compress: bool) -> Result<Vec<u8>, SimError> {
    let json = save.to_json()?;
    if compress {
        Ok(ruzstd::encoding::compress_to_vec(json.as_bytes(), ruzstd::encoding::CompressionLevel::Fastest))
    } else {
        Ok(json.into_bytes())
    }
}

/// 从字节解析存档（自动识别是否压缩，并迁移旧版本）。
pub fn decode(bytes: &[u8]) -> Result<SaveFile, SimError> {
    let text = if bytes.starts_with(&ZSTD_MAGIC) {
        let mut dec = ruzstd::decoding::StreamingDecoder::new(bytes)
            .map_err(|e| SimError::Storage(format!("zstd 解压失败：{e}")))?;
        let mut out = Vec::new();
        dec.read_to_end(&mut out).map_err(|e| SimError::Storage(format!("zstd 解压失败：{e}")))?;
        String::from_utf8(out).map_err(|e| SimError::Storage(format!("存档不是 UTF-8：{e}")))?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|e| SimError::Storage(format!("存档不是 UTF-8：{e}")))?
    };
    Ok(SaveFile::from_json(&text)?)
}

pub fn write(path: &Path, save: &SaveFile, compress: bool) -> Result<(), SimError> {
    let bytes = encode(save, compress)?;
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|e| SimError::Storage(format!("无法创建目录：{e}")))?;
    }
    // 先写临时文件再改名，避免写到一半时损坏旧存档
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| SimError::Storage(format!("写入存档失败：{e}")))?;
    std::fs::rename(&tmp, path).map_err(|e| SimError::Storage(format!("保存存档失败：{e}")))?;
    Ok(())
}

pub fn read(path: &Path) -> Result<SaveFile, SimError> {
    let bytes = std::fs::read(path).map_err(|e| SimError::Storage(format!("读取存档失败：{e}")))?;
    decode(&bytes)
}

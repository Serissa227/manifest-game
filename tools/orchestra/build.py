#!/usr/bin/env python3
"""管弦版配乐的采样流水线：从 VSCO 2 Community Edition（CC0 1.0）的原始 WAV 做出游戏里用的 MP3 与采样清单。

用法（在仓库根目录）：
    python tools/orchestra/build.py fetch              # 下载 sources.json 里列出的原始 WAV 到 .tools/vsco2/（已有且大小对的跳过）
    python tools/orchestra/build.py fetch --proxy http://127.0.0.1:8080
    python tools/orchestra/build.py analyze            # 逐个采样量音高、响度与长度，核对文件名里的音名（八度约定）
    python tools/orchestra/build.py build              # 选采样点、裁剪、做循环、统一响度、编码 MP3，写 samples.ts
    python tools/orchestra/build.py build --only vn.sus,harp

详见同目录的 README.md。
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import math
import os
import re
import shutil
import struct
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCES = HERE / "sources.json"
RAW_DIR = ROOT / ".tools" / "vsco2"
OUT_DIR = ROOT / "frontend" / "public" / "audio" / "orchestra"
MANIFEST = ROOT / "frontend" / "src" / "audio" / "orchestra" / "samples.ts"

#: 游戏里新增音频的预算（字节）：超过 BUDGET 给出警告，超过 HARD_LIMIT 直接失败
BUDGET = 15 * 1000 * 1000
HARD_LIMIT = 20 * 1000 * 1000
#: 响度的参考值（dB，K 计权）：清单里的 gain 把每个采样都校到这个响度。力度层只管音色（弱奏柔、强奏亮），响度由力度曲线决定——
REF_DB = -20.0
#: VSCO 的“弱”层并不总是弱（圆号最高两个音只有 v1，却是强奏），各层校到一样响，采样器换层时音量不会跳。LAYER_KEEP 为层间保留的原有响度差（0 为不保留）
LAYER_KEEP = 0.0
#: 起音前留多长（秒），并在这段里淡入
LEAD = 0.002
#: 起音的判定：包络第一次超过峰值的这么多倍
ONSET_REL = 0.01
#: 浏览器解码后找起音用的阈值（相对峰值），与前端 bank.ts 的 MARK_REL 一致
MARK_REL = 0.005

NOTE_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


# ───────────────────────────── 采样组的配置
#
# 每个采样组（清单里的一个键）来自 VSCO 的一个文件夹：
# - kind：sustain 长音（弓弦、吹奏、铜管、颤弓、滚奏：找一段能循环的持续部分），shot 一次性（拨奏、竖琴、定音鼓、钟琴……），hit 无音高的打击乐；
# - rx：文件名的正则，命名组 note（音名）、layer（力度层标签）、rr（轮换标签）；
# - layers：力度层标签 → 序号（0 最弱）；没写时都是 0；
# - octave：文件名里音名的八度约定，"yamaha"（C3 = 中央 C，VSCO 的大多数乐器）或 "spn"（C4 = 中央 C，竖琴、钟琴……）；
#   analyze 会逐个量实际音高核对；"detect" 为文件名里没有音名、按实测音高（定音鼓）；None 为无音高；
# - keep：起音之后最多留多长（秒）；mono：混成单声道（独奏乐器）；q：MP3 的 VBR 质量（LAME 的 V 值，越小越好越大）；
# - xf：循环接缝的交叉淡化长度（秒，长音才有）；minloop：循环段至少多长（秒）。


@dataclass
class SetSpec:
    key: str
    folder: str
    rx: str
    kind: str
    octave: str | None
    keep: float
    mono: bool
    q: int = 5
    layers: dict[str, int] = field(default_factory=dict)
    xf: float = 0.12
    minloop: float = 1.0
    fade: float = 0.25
    #: 只取这些音（MIDI 编号，空为全部）
    only: tuple[int, ...] = ()
    #: 音名 → 手写的音高（文件名与实测都靠不住时）
    fix: dict[str, float] = field(default_factory=dict)
    note: str = ""


SETS: list[SetSpec] = [
    # 弦乐组
    SetSpec("vn.sus", "Strings/Violin Section/susVib", r"VlnEns_susVib_(?P<note>[A-G]#?\d)_v(?P<layer>\d)\.wav", "sustain", "yamaha", 3.0, False, 4,
            {"1": 0, "2": 1}, xf=0.15, minloop=1.2, note="小提琴组，揉弦长音，两个力度层"),
    SetSpec("vn.trem", "Strings/Violin Section/Trem", r"VlnEns_Trem_(?P<note>[A-G]#?\d)_v2\.wav", "sustain", "yamaha", 2.6, False, 4,
            xf=0.1, minloop=1.0, note="小提琴组，颤弓"),
    SetSpec("vn.pizz", "Strings/Violin Section/Pizz", r"VlnEns_Pizz_(?P<note>[A-G]#?\d)_v2_rr(?P<rr>\d)\.wav", "shot", "yamaha", 0.9, False, 4,
            fade=0.45, note="小提琴组，拨奏，两个轮换"),
    SetSpec("vn.spic", "Strings/Violin Section/Spic", r"VlnEns_Spic_(?P<note>[A-G]#?\d)_v2_rr(?P<rr>\d)\.wav", "shot", "yamaha", 0.55, False, 4,
            fade=0.5, note="小提琴组，跳弓，两个轮换"),
    SetSpec("va.sus", "Strings/Viola Section/susvib", r"ViolaEns_susvib_(?P<note>[A-G]#?\d)_v1_1\.wav", "sustain", "yamaha", 2.7, False, 4,
            xf=0.15, minloop=1.0, note="中提琴组，揉弦长音"),
    SetSpec("vc.sus", "Strings/Cello Section/susvib", r"susvib_(?P<note>[A-G]#?\d)_v(?P<layer>[13])_1\.wav", "sustain", "yamaha", 2.7, False, 4,
            {"1": 0, "3": 1}, xf=0.15, minloop=1.0, note="大提琴组，揉弦长音，两个力度层（弱的一层每隔一个采样点）"),
    SetSpec("vc.pizz", "Strings/Cello Section/pizzT", r"pizzT_(?P<note>[A-G]#?\d)_v2_RR(?P<rr>\d)\.wav", "shot", "yamaha", 1.3, False, 4,
            fade=0.45, note="大提琴组，拨奏，两个轮换"),
    SetSpec("vc.spic", "Strings/Cello Section/spic", r"spic_(?P<note>[A-G]#?\d)_v2_RR1\.wav", "shot", "yamaha", 0.6, False, 4,
            fade=0.5, note="大提琴组，跳弓"),
    SetSpec("cb.sus", "Strings/Solo Contrabass/SusVib", r"BKCtbss_SusVib_(?P<note>[A-G]#?\d)_v1_rr1\.wav", "sustain", "yamaha", 2.7, True, 5,
            xf=0.12, minloop=1.0, note="低音提琴，揉弦长音（与大提琴组叠低八度）"),
    SetSpec("cb.pizz", "Strings/Solo Contrabass/Pizz", r"BKCtbss_Pizz_(?P<note>[A-G]#?\d)_v1_rr(?P<rr>\d)\.wav", "shot", "yamaha", 1.3, True, 5,
            fade=0.45, note="低音提琴，拨奏，两个轮换"),
    SetSpec("harp", "Strings/Harp", r"KSHarp_(?P<note>[A-G]#?\d)_(?P<layer>mp|mf|f)\.wav", "shot", "spn", 2.4, True, 5,
            {"mp": 0, "mf": 0, "f": 0}, fade=0.5, note="竖琴"),
    # 铜管
    SetSpec("hn.sus", "Brass/F Horn/sus", r"MOHorn_sus_(?P<note>[A-G]#?\d)_v(?P<layer>[13])_1\.wav", "sustain", "yamaha", 2.7, True, 5,
            {"1": 0, "3": 1}, xf=0.1, minloop=1.0, note="圆号，长音，两个力度层"),
    SetSpec("tp.sus", "Brass/Trumpet/sus", r"Sum_SHTrumpet_sus_(?P<note>[A-G]#?\d)_v3_rr1\.wav", "sustain", "yamaha", 2.5, True, 5,
            xf=0.08, minloop=0.9, note="小号，长音"),
    SetSpec("tb.sus", "Brass/Tenor Trombone/sus", r"tenortbn_sus_(?P<note>[A-G]#?\d)_v2_1\.wav", "sustain", "yamaha", 2.5, True, 5,
            xf=0.1, minloop=0.9, note="长号，长音"),
    # 木管
    SetSpec("fl.sus", "Woodwinds/Flute/susvib", r"LDFlute_susvib_(?P<note>[A-G]#?\d)_v1_1\.wav", "sustain", "yamaha", 2.7, True, 5,
            xf=0.08, minloop=1.0, note="长笛，揉音长音"),
    SetSpec("ob.sus", "Woodwinds/Oboe/Vib", r"Oboe_Vib_(?P<note>[A-G]#?\d)_v(?P<layer>[13])_Main\.wav", "sustain", "yamaha", 2.6, True, 5,
            {"1": 0, "3": 1}, xf=0.08, minloop=1.0, note="双簧管，揉音长音，两个力度层"),
    SetSpec("cl.sus", "Woodwinds/Clarinet/susLong", r"DCClar_susLong_(?P<note>[A-G]#?\d)_v2_rr1_sum\.wav", "sustain", "yamaha", 2.6, True, 5,
            xf=0.08, minloop=1.0, note="单簧管，长音"),
    SetSpec("bn.sus", "Woodwinds/Bassoon/vib", r"PSBassoon_(?P<note>[A-G]#?\d)_v(?P<layer>[12])_1\.wav", "sustain", "yamaha", 2.6, True, 5,
            {"1": 0, "2": 0}, xf=0.08, minloop=1.0, note="大管，揉音长音"),
    # 打击乐（有音高）
    SetSpec("timp.hit", "Percussion/Timpani", r"Timpani(?P<note>\d)_Hit_v(?P<layer>[34])_rr(?P<rr>\d)_Sum\.wav", "shot", "detect", 2.4, True, 5,
            {"3": 0, "4": 1}, fade=0.5, note="定音鼓，单击（五只鼓），两个力度层"),
    # 滚奏是一串击打叠在一起，频谱里模态糊成一片：第 2、3 只鼓按频谱手工定（2 号 (2,1) 模态 186.6 Hz ÷ 1.5；3 号与它的单击一致）
    SetSpec("timp.roll", "Percussion/Timpani/Rolls", r"Timpani(?P<note>\d)_Roll_v3_rr1_Sum\.wav", "sustain", "detect", 3.0, True, 5,
            xf=0.12, minloop=1.0, fix={"2": 47.1, "3": 49.4}, note="定音鼓，滚奏（五只鼓）"),
    SetSpec("glock", "Percussion/Glock", r"glock_medium_(?P<note>[A-G]#?\d)\.wav", "shot", "yamaha", 2.0, True, 5, fade=0.5, note="钟琴"),
    SetSpec("marimba", "Percussion/Marimba", r"Marimba_hit_Outrigger_(?P<note>[A-G]#?\d)_loud_01\.wav", "shot", "yamaha", 1.3, True, 5, fade=0.5, note="马林巴"),
    SetSpec("tubular", "Percussion", r"TB_hit_(?P<note>[A-G]#?\d)_v\d_rr1\.wav", "shot", "spn", 3.2, True, 5, fade=0.5, note="管钟（船钟、钟楼）"),
    # 打击乐（无音高）
    SetSpec("perc.snare", "Percussion", r"Snare2-HitSN_v(?P<layer>[357])_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.6, True, 5,
            {"3": 0, "5": 1, "7": 2}, fade=0.5, note="军鼓"),
    SetSpec("perc.snareroll", "Percussion", r"Snare2-rollSN_v3_rr1_Sum\.wav", "sustain", None, 2.4, True, 5, xf=0.1, minloop=1.0, note="军鼓滚奏"),
    SetSpec("perc.bd", "Percussion", r"BDrumNewhit_v(?P<layer>[46])_rr(?P<rr>\d)_Sum\.wav", "hit", None, 1.6, True, 5, {"4": 0, "6": 1}, fade=0.5, note="大鼓"),
    SetSpec("perc.crash", "Percussion", r"cymbal-crash1_(?P<layer>mf|ff)_rr1\.wav", "hit", None, 3.0, False, 5, {"mf": 0, "ff": 1}, fade=0.5, note="对击钹"),
    SetSpec("perc.swell", "Percussion", r"susCymb1-cresc-Median_v1\.wav", "hit", None, 5.6, False, 5, fade=0.35, note="吊镲渐强（约 3.3 秒后最响）"),
    SetSpec("perc.tamb", "Percussion", r"Tamb1-Hit_v(?P<layer>[12])_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.6, True, 5, {"1": 0, "2": 1}, fade=0.5, note="铃鼓，击"),
    SetSpec("perc.shake", "Percussion", r"Tamb1-Shake_v1_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.6, True, 5, fade=0.5, note="铃鼓，摇"),
    SetSpec("perc.tri", "Percussion", r"Triangle3-HitM_v(?P<layer>[12])_rr1_Sum\.wav", "hit", None, 1.6, True, 5, {"1": 0, "2": 1}, fade=0.5, note="三角铁"),
    SetSpec("perc.claves", "Percussion", r"Claves1_Hit_v2_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.3, True, 5, fade=0.5, note="响棒"),
    SetSpec("perc.loghi", "Percussion", r"LogDrumHi_MedM_v2_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.5, True, 5, fade=0.5, note="木鼓（高）"),
    SetSpec("perc.loglo", "Percussion", r"LogDrumLo_MedM_v2_rr(?P<rr>\d)_Sum\.wav", "hit", None, 0.5, True, 5, fade=0.5, note="木鼓（低）"),
    SetSpec("perc.gong", "Percussion", r"gongHit_mf\.wav", "hit", None, 6.0, False, 5, fade=0.5, note="大锣"),
    SetSpec("perc.shaker", "VSCO 1 Percussion/varWood/Camo's Shaker", r"shake(?P<rr>\d)\.wav", "hit", None, 0.35, True, 5, fade=0.5, note="沙锤"),
]


# ───────────────────────────── 下载


def load_sources() -> dict:
    with open(SOURCES, encoding="utf-8") as f:
        return json.load(f)


def fetch(args: argparse.Namespace) -> None:
    src = load_sources()
    raw = Path(args.src)
    handlers = []
    if args.proxy:
        handlers.append(urllib.request.ProxyHandler({"http": args.proxy, "https": args.proxy}))
    opener = urllib.request.build_opener(*handlers)
    todo = []
    for rel, size in src["files"]:
        dst = raw / rel
        if dst.exists() and dst.stat().st_size == size:
            continue
        todo.append((rel, size))
    total = sum(s for _, s in src["files"])
    need = sum(s for _, s in todo)
    print(f"共 {len(src['files'])} 个文件 {total / 1e6:.1f} MB，需要下载 {len(todo)} 个 {need / 1e6:.1f} MB", flush=True)

    def one(item: tuple[str, int]) -> tuple[str, str | None]:
        rel, size = item
        url = f"https://raw.githubusercontent.com/{src['repo']}/{src['commit']}/{urllib.parse.quote(rel)}"
        dst = raw / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".part")
        err = None
        for attempt in range(4):
            try:
                with opener.open(url, timeout=120) as r, open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                if tmp.stat().st_size != size:
                    raise OSError(f"大小不对：{tmp.stat().st_size} ≠ {size}")
                os.replace(tmp, dst)
                return rel, None
            except Exception as e:  # noqa: BLE001 — 网络错误都重试
                err = str(e)
                time.sleep(1.5 * (attempt + 1))
        return rel, err

    done = 0
    failed = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for rel, err in pool.map(one, todo):
            done += 1
            if err:
                failed.append((rel, err))
                print(f"[{done}/{len(todo)}] 失败 {rel}：{err}", flush=True)
            elif done % 20 == 0 or done == len(todo):
                print(f"[{done}/{len(todo)}] {rel}", flush=True)
    if failed:
        print(f"{len(failed)} 个文件下载失败，重跑 fetch 会接着下", file=sys.stderr)
        sys.exit(1)
    print("下载完成")


# ───────────────────────────── 读 WAV 与基本分析


def np():  # 延迟导入：fetch 不需要 numpy
    import numpy

    return numpy


def read_wav(path: Path):
    """读 PCM（16 / 24 / 32 位整数或 32 位浮点）WAV，返回 (float32 数组 [帧, 声道], 采样率)。"""
    N = np()
    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError(f"不是 WAV：{path}")
    pos = 12
    fmt = None
    frames = None
    while pos + 8 <= len(data):
        cid = data[pos : pos + 4]
        size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            tag, ch, sr, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 0xFFFE:  # WAVE_FORMAT_EXTENSIBLE：子格式在后面
                tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, sr, bits)
        elif cid == b"data":
            frames = body
        pos += 8 + size + (size & 1)
    if fmt is None or frames is None:
        raise ValueError(f"WAV 缺少 fmt 或 data：{path}")
    tag, ch, sr, bits = fmt
    if tag == 3 and bits == 32:
        x = N.frombuffer(frames, dtype="<f4").astype(N.float32)
    elif tag == 1 and bits == 16:
        x = N.frombuffer(frames, dtype="<i2").astype(N.float32) / 32768.0
    elif tag == 1 and bits == 24:
        b = N.frombuffer(frames, dtype=N.uint8)
        b = b[: len(b) // 3 * 3].reshape(-1, 3)
        v = (b[:, 0].astype(N.int32) | (b[:, 1].astype(N.int32) << 8) | (b[:, 2].astype(N.int32) << 16))
        v = N.where(v & 0x800000, v - 0x1000000, v)
        x = v.astype(N.float32) / 8388608.0
    elif tag == 1 and bits == 32:
        x = N.frombuffer(frames, dtype="<i4").astype(N.float32) / 2147483648.0
    else:
        raise ValueError(f"不支持的 WAV 格式 {fmt}：{path}")
    x = x[: len(x) // ch * ch].reshape(-1, ch)
    return x, sr


def note_midi(name: str, octave: str) -> int:
    m = re.fullmatch(r"([A-G])(#?)(-?\d)", name)
    if not m:
        raise ValueError(f"音名不对：{name}")
    pc = NOTE_PC[m.group(1)] + (1 if m.group(2) else 0)
    octv = int(m.group(3))
    return 12 * (octv + (2 if octave == "yamaha" else 1)) + pc


def midi_name(m: int) -> str:
    names = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"]
    return f"{names[m % 12]}{m // 12 - 1}"


def envelope(m, sr: int, win: float = 0.02, hop: float = 0.01):
    """RMS 包络：返回 (每帧的起点秒数, RMS)。"""
    N = np()
    w = max(1, int(win * sr))
    h = max(1, int(hop * sr))
    if len(m) < w:
        return N.array([0.0]), N.array([math.sqrt(float(N.mean(m * m))) if len(m) else 0.0])
    c = N.concatenate([[0.0], N.cumsum(m.astype(N.float64) ** 2)])
    starts = N.arange(0, len(m) - w + 1, h)
    rms = N.sqrt((c[starts + w] - c[starts]) / w)
    return starts / sr, rms


def onset_index(m, rel: float = ONSET_REL) -> int:
    """起音：|x| 第一次超过峰值的 rel 倍的位置。"""
    N = np()
    a = N.abs(m)
    pk = float(a.max()) if len(a) else 0.0
    if pk <= 0:
        return 0
    return int(N.argmax(a >= pk * rel))


def k_weighted(m, sr: int):
    """近似的 K 计权（ITU-R BS.1770 的预滤波：约 60 Hz 高通 + 1.5 kHz 以上 +4 dB），在频域里做。"""
    N = np()
    n = len(m)
    size = 1 << max(1, (n - 1).bit_length())
    X = N.fft.rfft(m, size)
    f = N.fft.rfftfreq(size, 1 / sr)
    hp = f**4 / (f**4 + 60.0**4 + 1e-12)
    shelf = 1 + (10 ** (4 / 20) - 1) * (f**2 / (f**2 + 1500.0**2))
    y = N.fft.irfft(X * N.sqrt(hp) * shelf, size)[:n]
    return y


def loudness_db(m, sr: int, span: tuple[float, float] | None = None) -> float:
    """响度（dB）：span 给出时为这一段 K 计权的均方根，否则为 400 毫秒窗口里最响的一个。"""
    N = np()
    y = k_weighted(m, sr)
    if span:
        a, b = int(span[0] * sr), int(span[1] * sr)
        seg = y[a:b]
        return 10 * math.log10(float(N.mean(seg * seg)) + 1e-20)
    w = int(0.4 * sr)
    if len(y) <= w:
        return 10 * math.log10(float(N.mean(y * y)) * len(y) / w + 1e-20)
    c = N.concatenate([[0.0], N.cumsum(y.astype(N.float64) ** 2)])
    best = float(N.max(c[w:] - c[:-w])) / w
    return 10 * math.log10(best + 1e-20)


def spectrum(m, sr: int, t0: float, t1: float):
    N = np()
    a, b = int(t0 * sr), int(t1 * sr)
    seg = m[a:b]
    if len(seg) < 256:
        seg = m[: max(256, len(m))]
    seg = seg * N.hanning(len(seg))
    size = 1 << max(16, (len(seg) * 4 - 1).bit_length())
    X = N.abs(N.fft.rfft(seg, size))
    f = N.fft.rfftfreq(size, 1 / sr)
    return f, X


def band_peak(f, X, target: float, cents: float = 50.0) -> tuple[float, float]:
    """target 附近 ±cents 音分内的最大值与它的（插值后的）频率。"""
    N = np()
    lo = target * 2 ** (-cents / 1200)
    hi = target * 2 ** (cents / 1200)
    i0 = int(N.searchsorted(f, lo))
    i1 = int(N.searchsorted(f, hi))
    if i1 <= i0 + 1 or i1 >= len(X) - 1:
        return 0.0, target
    k = i0 + int(N.argmax(X[i0:i1]))
    a, b, c = X[k - 1], X[k], X[k + 1]
    den = a - 2 * b + c
    d = 0.5 * (a - c) / den if den != 0 else 0.0
    d = max(-0.5, min(0.5, float(d)))
    return float(b), float(f[k] + d * (f[1] - f[0]))


def harmonic_sum(f, X, f0: float, sr: int) -> float:
    """谐波和：f0 的前十个谐波（各取 ±20 音分内的最大值）开方后加权相加。基频弱、第二谐波强的音（拨奏、圆号低音）也认得出来。"""
    s = 0.0
    for k in range(1, 11):
        fk = f0 * k
        if fk > min(9000.0, sr / 2 - 200):
            break
        a, _ = band_peak(f, X, fk, 20)
        s += math.sqrt(a) / k**0.2
    return s


def detect_pitch(m, sr: int, nominal: float, t0: float, t1: float) -> tuple[float, float]:
    """在 t0–t1 秒里量音高：在 nominal（按文件名与这一组的八度约定）上下 150 音分里找谐波和最大的基频，
    再用各谐波峰值的插值细调。返回 (MIDI 音高，可有小数；低八度与本八度的谐波和之比——大于 1 说明可能标错了八度)。"""
    N = np()
    f, X = spectrum(m, sr, t0, t1)
    X = X / (float(X.max()) + 1e-20)
    grid = nominal * 2 ** (N.arange(-150, 151, 3) / 1200)
    scores = [harmonic_sum(f, X, float(g), sr) for g in grid]
    g = float(grid[int(N.argmax(scores))])
    ests = []
    for k in range(1, 9):
        if g * k > sr / 2 - 200:
            break
        amp, fk = band_peak(f, X, g * k, 25)
        if amp > 0.01:
            ests.append((amp, fk / k))
    f0 = g
    if ests:
        ests.sort(key=lambda e: e[1])
        total = sum(a for a, _ in ests)
        acc = 0.0
        for a, v in ests:  # 按幅度加权的中位数
            acc += a
            if acc >= total / 2:
                f0 = v
                break
    below = harmonic_sum(f, X, f0 / 2, sr) / (harmonic_sum(f, X, f0, sr) + 1e-12)
    return 69 + 12 * math.log2(f0 / 440.0), below


def peaks(f, X, lo: float, hi: float, n: int = 10) -> list[tuple[float, float]]:
    """lo–hi 之间最强的 n 个局部峰（40 音分以内只留一个）：[(频率, 相对最强峰的幅度)]。"""
    N = np()
    i0 = int(N.searchsorted(f, lo))
    i1 = int(N.searchsorted(f, hi))
    idx = [i for i in range(max(1, i0), min(len(X) - 1, i1)) if X[i] > X[i - 1] and X[i] >= X[i + 1]]
    idx.sort(key=lambda i: -X[i])
    keep: list[int] = []
    for i in idx:
        if all(abs(1200 * math.log2(f[i] / f[j])) > 40 for j in keep):
            keep.append(i)
        if len(keep) >= n:
            break
    if not keep:
        return []
    top = max(X[i] for i in keep)
    return [(float(f[i]), float(X[i] / top)) for i in keep]


#: 定音鼓鼓皮的几个主要模态相对主音（(1,1) 模态）的频率比与权重：(2,1) 常常最响，(3,1)、(4,1) 较弱
TIMPANI_MODES = ((1.0, 1.0), (1.5, 1.0), (1.98, 0.7), (2.44, 0.4))


def detect_drum_pitch(m, sr: int, roll: bool) -> float:
    """定音鼓的主音（(1,1) 模态）：在 70–260 Hz 里找一个 p，使 p、1.5p、1.98p、2.44p 附近（±30 音分）的峰加权最强，且 p 处本身有峰。"""
    N = np()
    f, X = spectrum(m, sr, 0.5 if roll else 0.05, 1.5 if roll else 0.6)
    X = X / (float(X.max()) + 1e-20)
    best = (-1.0, 100.0)
    for p in 70.0 * 2 ** (N.arange(0, 1200 * math.log2(260 / 70), 5) / 1200):
        a0 = band_peak(f, X, float(p), 30)[0]
        if a0 < 0.1:
            continue
        s = sum(w * band_peak(f, X, float(p) * r, 30)[0] for r, w in TIMPANI_MODES)
        if s > best[0]:
            best = (s, float(p))
    _, fk = band_peak(f, X, best[1], 30)
    return 69 + 12 * math.log2(fk / 440.0)


@dataclass
class Item:
    spec: SetSpec
    path: Path
    note: str | None
    layer: int
    rr: int
    midi: int | None


def items_of(spec: SetSpec, raw: Path) -> list[Item]:
    folder = raw / spec.folder
    out = []
    if not folder.exists():
        return out
    for p in sorted(folder.iterdir()):
        if not p.is_file():
            continue
        mt = re.fullmatch(spec.rx, p.name)
        if not mt:
            continue
        gd = mt.groupdict()
        note = gd.get("note")
        layer = spec.layers.get(gd["layer"], 0) if gd.get("layer") is not None else 0
        rr = int(gd["rr"]) - 1 if gd.get("rr") else 0
        midi = note_midi(note, spec.octave) if note and spec.octave in ("yamaha", "spn") else None
        if spec.only and midi is not None and midi not in spec.only:
            continue
        out.append(Item(spec, p, note, layer, rr, midi))
    return out


def analyze(args: argparse.Namespace) -> None:
    N = np()
    raw = Path(args.src)
    only = set(args.only.split(",")) if args.only else None
    report = {}
    for spec in SETS:
        if only and spec.key not in only:
            continue
        rows = []
        for it in items_of(spec, raw):
            x, sr = read_wav(it.path)
            m = x.mean(axis=1)
            on = onset_index(m)
            dur = (len(m) - on) / sr
            pk = float(N.abs(x).max())
            corr = float(N.corrcoef(x[on:, 0], x[on:, 1])[0, 1]) if x.shape[1] == 2 and len(m) - on > 100 else 1.0
            row = {"file": it.path.name, "layer": it.layer, "rr": it.rr, "sr": sr, "ch": x.shape[1], "dur": round(dur, 2),
                   "onset": round(on / sr, 3), "peak_db": round(20 * math.log10(pk + 1e-12), 1), "lr_corr": round(corr, 2)}
            if spec.octave in ("yamaha", "spn") and it.note:
                want = note_midi(it.note, spec.octave)
                nominal = 440 * 2 ** ((want - 69) / 12)
                t0 = on / sr + (0.6 if spec.kind == "sustain" else 0.05)
                t1 = min(len(m) / sr, t0 + (1.5 if spec.kind == "sustain" else 0.5))
                got, below = detect_pitch(m, sr, nominal, t0, t1)
                row.update(name=it.note, want=want, detected=round(got, 2), below=round(below, 2),
                           ok=abs(got - want) < 0.3)
            elif spec.octave == "detect":
                row.update(detected=round(detect_drum_pitch(m[on:], sr, spec.kind == "sustain"), 2))
            rows.append(row)
        report[spec.key] = rows
        bad = [r for r in rows if r.get("ok") is False]
        print(f"{spec.key:14s} {len(rows):3d} 个  需要留意 {len(bad)}")
        for r in rows:
            flag = "" if r.get("ok", True) else "  ← 音准偏了 30 音分以上，或低八度的谐波和更大"
            det = f"实测 {r['detected']:6.2f}" if "detected" in r else ""
            nm = f"{r.get('name', ''):4s} 应为 {r.get('want', ''):>3} 低八度比 {r.get('below', 0):4.2f}" if "name" in r else ""
            print(f"    {r['file']:48s} {nm} {det} 长 {r['dur']:5.2f}s 峰 {r['peak_db']:6.1f} 左右相关 {r['lr_corr']:5.2f}{flag}")
    out = raw / "analysis.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"写入 {out}")


# ───────────────────────────── 循环点


def find_loop(m, sr: int, spec: SetSpec, length: float, att: float) -> tuple[float, float, float, float]:
    """在奏稳之后的持续部分找循环段 [S, E]：接缝两边（各 xf 长）的波形最相关、响度最接近，循环尽量长。
    返回 (S, E, xf, 相关系数)，秒，相对文件开头。播放时接缝处按这个相关系数选交叉淡化的曲线（见 sampler.ts）。"""
    N = np()
    xf = int(spec.xf * sr)
    n = min(len(m), int(length * sr))
    t, env = envelope(m[:n], sr)
    envdb = 20 * N.log10(env + 1e-9)
    s_lo = max(att + 0.1, 0.3)
    e_hi = (n / sr) - 0.06
    s_hi = e_hi - spec.minloop
    if s_hi <= s_lo:
        s_lo = max(0.2, min(s_lo, e_hi - spec.minloop * 0.8))
        s_hi = s_lo + 0.01
    best = None
    for s in N.arange(s_lo, s_hi, 0.02):
        S = int(s * sr)
        a = m[S - xf : S].astype(N.float64)
        na = float(N.sqrt(N.sum(a * a))) + 1e-12
        E_lo = S + int(spec.minloop * sr)
        E_hi = int(e_hi * sr)
        if E_hi <= E_lo:
            continue
        seg = m[E_lo - xf : E_hi].astype(N.float64)
        size = 1 << (len(seg) + xf).bit_length()
        num = N.fft.irfft(N.fft.rfft(seg, size) * N.conj(N.fft.rfft(a, size)), size)[: len(seg) - xf + 1]
        c = N.concatenate([[0.0], N.cumsum(seg * seg)])
        den = N.sqrt(c[xf:] - c[:-xf])[: len(num)] * na + 1e-12
        corr = num / den
        # 响度差（dB）与循环长度的加分
        ends = N.arange(len(corr)) + E_lo
        e_idx = N.clip(((ends / sr - 0.01) / 0.01).astype(int), 0, len(envdb) - 1)
        s_idx = min(len(envdb) - 1, max(0, int((S / sr - 0.01) / 0.01)))
        ediff = N.abs(envdb[e_idx] - envdb[s_idx])
        score = corr - 0.08 * ediff + 0.04 * (ends - S) / sr
        k = int(N.argmax(score))
        if best is None or score[k] > best[0]:
            best = (float(score[k]), S, int(ends[k]), float(corr[k]))
    if best is None:
        S = int(s_lo * sr)
        return S / sr, (n / sr) - 0.06, spec.xf, 0.0
    _, S, E, rho = best
    return S / sr, E / sr, spec.xf, rho


# ───────────────────────────── 编码


def encode_mp3(y, sr: int, q: int) -> bytes:
    """编码成 MP3（LAME 的 VBR，质量 q）。y 为 [帧, 声道]。"""
    import av  # PyAV（自带 FFmpeg 与 libmp3lame）

    N = np()
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="mp3")
    layout = "stereo" if y.shape[1] == 2 else "mono"
    st = out.add_stream("libmp3lame", rate=sr, layout=layout)
    st.codec_context.qscale = True
    st.codec_context.options = {"global_quality": str(q * 118)}
    planar = N.ascontiguousarray(y.T.astype(N.float32))
    frame = av.AudioFrame.from_ndarray(planar, format="fltp", layout=layout)
    frame.sample_rate = sr
    for p in st.encode(frame):
        out.mux(p)
    for p in st.encode(None):
        out.mux(p)
    out.close()
    return buf.getvalue()


def decode_mp3(data: bytes):
    import av

    N = np()
    c = av.open(io.BytesIO(data))
    parts = [f.to_ndarray() for f in c.decode(audio=0)]
    c.close()
    return N.concatenate(parts, axis=1).T


# ───────────────────────────── 构建


@dataclass
class Zone:
    set: str
    file: str
    pitch: float | None
    layer: int
    rr: int
    gain: float
    length: float
    mark: float
    loop: tuple[float, float, float, float] | None
    bytes: int
    hash: str
    loud: float
    peak: float
    attack: float
    source: str


def attack_time(m0, sr: int, on: int) -> float:
    """长音从起音到“奏稳”（包络第一次到达持续部分典型响度的 70%）要多久（秒）。
    VSCO 的弱奏长音有的要一两秒才渐强上来：采样器据此跳过过慢的渐强，连奏的音从这里接进来。"""
    N = np()
    t, env = envelope(m0[on:], sr, 0.05, 0.01)
    body = env[(t >= 0.3) & (t <= 6.0)]
    if len(body) == 0:
        return 0.0
    ref = float(N.median(body))
    hit = N.nonzero(env >= 0.7 * ref)[0]
    return float(t[hit[0]]) + 0.025 if len(hit) else 0.0


def process(it: Item) -> tuple[Zone, bytes]:
    N = np()
    spec = it.spec
    x, sr = read_wav(it.path)
    m0 = x.mean(axis=1)
    on = onset_index(m0)
    start = max(0, on - int(LEAD * sr))
    keep = spec.keep
    att = 0.0
    if spec.kind == "sustain":
        att = attack_time(m0, sr, on) + LEAD
        # 渐强慢的采样多留一点，保证奏稳之后还有一段够长的循环
        keep = min(4.2, max(keep, att + spec.minloop + 0.45))
    end = min(len(x), start + int((keep + LEAD) * sr))
    y = x[start:end].astype(N.float64)
    if spec.mono and y.shape[1] == 2:
        y = y.mean(axis=1, keepdims=True)
    n = len(y)
    # 头部淡入（起音前的 2 毫秒）
    lead = min(n, max(1, on - start))
    y[:lead] *= (0.5 - 0.5 * N.cos(N.linspace(0, math.pi, lead)))[:, None]
    m = y.mean(axis=1)
    loop = None
    _t, _e = envelope(m, sr)
    peak_at = float(_t[int(N.argmax(_e))]) + 0.01
    if spec.kind == "sustain":
        loop = find_loop(m, sr, spec, n / sr, att)
        # 循环段之后留一小段（交叉淡化用不到，只防越界），其余淡出
        tail_start = min(n, int((loop[1] + 0.03) * sr))
    else:
        tail_start = int(n * (1 - spec.fade))
    if tail_start < n:
        k = n - tail_start
        y[tail_start:] *= (0.5 + 0.5 * N.cos(N.linspace(0, math.pi, k)))[:, None]
    # 响度：长音按循环段的均方根，其余按最响的 400 毫秒
    loud = loudness_db(m, sr, (loop[0], loop[1]) if loop else None)
    # 音高
    pitch = None
    if it.note and it.note in spec.fix:
        pitch = spec.fix[it.note]
    elif spec.octave in ("yamaha", "spn") and it.note:
        want = note_midi(it.note, spec.octave)
        nominal = 440 * 2 ** ((want - 69) / 12)
        # 用原始文件量（裁剪前更长，长音避开起音）；只在文件名的音上下 150 音分里找
        t0 = on / sr + (0.6 if spec.kind == "sustain" else 0.05)
        t1 = min(len(m0) / sr, t0 + (1.5 if spec.kind == "sustain" else 0.5))
        pitch, _ = detect_pitch(m0, sr, nominal, t0, t1)
        if abs(pitch - want) > 0.3:
            print(f"    注意：{it.path.name} 实测 {pitch:.2f}，文件名是 {want}（按实测）", flush=True)
    elif spec.octave == "detect":
        pitch = detect_drum_pitch(m0[on:], sr, spec.kind == "sustain")
    # 峰值归一到 −1 dBFS 再编码
    pk = float(N.abs(y).max()) + 1e-12
    s = 0.891 / pk
    y *= s
    data = encode_mp3(y, sr, spec.q)
    # 起音标记：与前端找起音的算法相同（各声道平均后 |x| 第一次超过峰值的 MARK_REL 倍），在最终的信号上量；
    # 浏览器解码后量同一个位置，差值就是解码器多出来的延迟
    mark_src = onset_index(y.mean(axis=1), MARK_REL) / sr
    dec = decode_mp3(data)
    mark_dec = onset_index(dec.mean(axis=1), MARK_REL) / sr
    label = midi_name(round(pitch)) if pitch is not None and spec.octave != "detect" else (f"drum{it.note}" if it.note else "hit")
    fname = f"{spec.key.replace('.', '-')}/{label}-l{it.layer}-r{it.rr}.mp3"
    zone = Zone(set=spec.key, file=fname, pitch=None if pitch is None else round(pitch, 3), layer=it.layer, rr=it.rr, gain=0.0,
                length=round(n / sr, 3), mark=round(mark_src, 4), peak=round(peak_at, 3), attack=round(att, 3),
                loop=None if loop is None else (round(loop[0], 4), round(loop[1], 4), loop[2], round(loop[3], 3)),
                bytes=len(data), hash=hashlib.sha1(data).hexdigest()[:8], loud=loud, source=f"{spec.folder}/{it.path.name}")
    zone.gain = 1.0 / s  # 先记下“还原到原始电平”的倍数，响度校正在 build() 里乘上
    if abs(mark_dec - mark_src) > 0.004:
        print(f"    注意：{fname} 解码后的起音偏了 {1000 * (mark_dec - mark_src):.1f} 毫秒", flush=True)
    return zone, data


def build(args: argparse.Namespace) -> None:
    raw = Path(args.src)
    only = set(args.only.split(",")) if args.only else None
    old = {}
    if only and (raw / "zones.json").exists():
        old = {z["file"]: z for z in json.loads((raw / "zones.json").read_text(encoding="utf-8"))}
    zones: list[Zone] = []
    jobs = []
    for spec in SETS:
        if only and spec.key not in only:
            continue
        its = items_of(spec, raw)
        if not its:
            raise SystemExit(f"{spec.key}：{raw / spec.folder} 里没有采样，先运行 fetch")
        jobs.extend(its)
    print(f"处理 {len(jobs)} 个采样……", flush=True)
    results: list[tuple[Zone, bytes]] = []
    with cf.ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for z, data in pool.map(process, jobs):
            results.append((z, data))
    # 响度校正：每个采样校到 REF_DB（层与层之间保留 LAYER_KEEP 的原有差别）
    by_set: dict[str, list[Zone]] = {}
    for z, _ in results:
        by_set.setdefault(z.set, []).append(z)
    for key, zs in by_set.items():
        layers = sorted({z.layer for z in zs})
        mean = {l: sum(z.loud for z in zs if z.layer == l) / len([z for z in zs if z.layer == l]) for l in layers}
        top = mean[layers[-1]]
        for z in zs:
            target = REF_DB + (mean[z.layer] - top) * LAYER_KEEP
            z.gain = round(z.gain * 10 ** ((target - z.loud) / 20), 4)
    # 写文件：只重做 --only 的组时，其余组的清单沿用上次的
    keys = {spec.key for spec in SETS if not only or spec.key in only}
    for key in keys:
        d = OUT_DIR / key.replace(".", "-")
        if d.exists():
            shutil.rmtree(d)
    for z, data in results:
        p = OUT_DIR / z.file
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        zones.append(z)
    for f, zd in old.items():
        if zd["set"] not in keys:
            zones.append(Zone(**{**zd, "loop": tuple(zd["loop"]) if zd["loop"] else None}))
    zones.sort(key=lambda z: (z.set, z.pitch if z.pitch is not None else 0, z.layer, z.rr, z.file))
    (raw / "zones.json").write_text(json.dumps([z.__dict__ for z in zones], ensure_ascii=False, indent=0), encoding="utf-8")
    write_manifest(zones)
    total = sum(z.bytes for z in zones)
    sizes: dict[str, int] = {}
    for z in zones:
        sizes[z.set] = sizes.get(z.set, 0) + z.bytes
    for k in sorted(sizes):
        print(f"  {k:14s} {sizes[k] / 1e6:6.2f} MB  {len([z for z in zones if z.set == k]):3d} 个")
    print(f"合计 {total / 1e6:.2f} MB（预算 {BUDGET / 1e6:.0f} MB，上限 {HARD_LIMIT / 1e6:.0f} MB）")
    if total > HARD_LIMIT:
        raise SystemExit("超过上限")
    if total > BUDGET:
        print("警告：超过预算", file=sys.stderr)


def ts_num(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def write_manifest(zones: list[Zone]) -> None:
    specs = {s.key: s for s in SETS}
    lines = [
        "// 生成文件：由 tools/orchestra/build.py 写出，不要手改（改采样的挑选与处理请改那个脚本，再重新运行）。",
        "//",
        "// 管弦版配乐的采样清单。采样来自 VS Chamber Orchestra: Community Edition（VSCO 2 CE，CC0 1.0 公有领域），",
        "// Versilian Studios 出品：Sam Gossner、Simon Dalzell 录音，Elan Hickler / Soundemote 剪辑；",
        "// https://github.com/sgossner/VSCO-2-CE（提交 4403009）。CC0 不要求署名，这里照样写明出处。",
        "// 文件在 frontend/public/audio/orchestra/ 下；时间都以秒计、从文件开头算，浏览器解码后按 mark 对齐（见 bank.ts）。",
        "",
        "/** 一个采样。 */",
        "export interface SampleZone {",
        "  /** 文件（相对 public/audio/orchestra/） */",
        "  file: string;",
        "  /** 音高（MIDI，可有小数：按实测的音准）；无音高的打击乐为 null */",
        "  pitch: number | null;",
        "  /** 力度层（0 最弱） */",
        "  layer: number;",
        "  /** 轮换序号（同一个音的几次录音轮流用） */",
        "  rr: number;",
        "  /** 播放时乘的增益：把这个采样校到这一组统一的响度 */",
        "  gain: number;",
        "  /** 长度（秒） */",
        "  length: number;",
        "  /** 起音标记：|x| 第一次超过峰值 0.5% 的时刻（秒）。解码后的位置减去它就是解码器多出来的延迟 */",
        "  mark: number;",
        "  /** 奏稳的时刻（秒）：长音的包络第一次到达持续部分典型响度的 70%（渐强慢的弱奏要一两秒）；其余为 0 */",
        "  attack: number;",
        "  /** 最响处（秒）：吊镲渐强这类要把最响处对准拍子 */",
        "  peak: number;",
        "  /** 循环段：[起点, 终点, 接缝交叉淡化的长度, 接缝两边的相关系数]（长音才有） */",
        "  loop: readonly [number, number, number, number] | null;",
        "  /** 文件字节数 */",
        "  bytes: number;",
        "  /** 内容哈希（前 8 位，URL 上带着它，换了采样浏览器不会用旧缓存） */",
        "  hash: string;",
        "}",
        "",
        "/** 一组采样（一件乐器的一种奏法）。 */",
        "export interface SampleSet {",
        "  /** 长音（可循环）、一次性、无音高的打击乐 */",
        "  kind: \"sustain\" | \"shot\" | \"hit\";",
        "  /** 立体声 */",
        "  stereo: boolean;",
        "  zones: readonly SampleZone[];",
        "}",
        "",
        "export const SAMPLE_SETS: Readonly<Record<string, SampleSet>> = {",
    ]
    by_set: dict[str, list[Zone]] = {}
    for z in zones:
        by_set.setdefault(z.set, []).append(z)
    for key in sorted(by_set):
        spec = specs.get(key)
        kind = spec.kind if spec else "shot"
        stereo = "false" if (spec and spec.mono) else "true"
        lines.append(f"  /** {spec.note if spec else key} */")
        lines.append(f'  "{key}": {{')
        lines.append(f'    kind: "{kind}",')
        lines.append(f"    stereo: {stereo},")
        lines.append("    zones: [")
        for z in by_set[key]:
            loop = "null" if not z.loop else "[" + ", ".join(ts_num(v) for v in z.loop) + "]"
            pitch = "null" if z.pitch is None else ts_num(z.pitch)
            lines.append(
                f'      {{ file: "{z.file}", pitch: {pitch}, layer: {z.layer}, rr: {z.rr}, gain: {ts_num(z.gain)}, length: {ts_num(z.length)}, '
                f'mark: {ts_num(z.mark)}, peak: {ts_num(z.peak)}, attack: {ts_num(z.attack)}, loop: {loop}, bytes: {z.bytes}, hash: "{z.hash}" }},'
            )
        lines.append("    ],")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"写入 {MANIFEST.relative_to(ROOT)}")


# ───────────────────────────── 入口


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(RAW_DIR), help="原始 WAV 所在目录（缺省 .tools/vsco2/）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="下载原始 WAV")
    f.add_argument("--proxy", default=os.environ.get("VSCO_PROXY"), help="HTTP 代理，例如 http://127.0.0.1:8080")
    f.add_argument("--jobs", type=int, default=8)
    a = sub.add_parser("analyze", help="量音高、响度与长度，核对文件名")
    a.add_argument("--only", default="", help="只看这些组（逗号分隔）")
    b = sub.add_parser("build", help="处理、编码、写清单")
    b.add_argument("--only", default="", help="只重做这些组（逗号分隔），其余沿用上次的结果")
    b.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()
    if args.cmd == "fetch":
        fetch(args)
    elif args.cmd == "analyze":
        analyze(args)
    elif args.cmd == "build":
        build(args)


if __name__ == "__main__":
    main()

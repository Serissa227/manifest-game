#!/usr/bin/env python3
"""游戏音效的素材管线：从 Kenney 的五个 CC0 音效包（另加仓库里已有的管弦采样与程序合成）做出游戏里用的 MP3 与素材清单。

用法（在仓库根目录）：
    python tools/sfx/build.py fetch                 # 下载 sources.json 里的五个音效包到 .tools/kenney/（已有且校验对的跳过）
    python tools/sfx/build.py fetch --proxy http://127.0.0.1:8080
    python tools/sfx/build.py build                 # 解压、按配方裁剪、滤波、变调、叠层、统一响度、编码 MP3，写 samples.ts
    python tools/sfx/build.py sheet                 # 把做好的音效画成频谱图拼板（.tools/kenney/sheet-*.png），检查用

详见同目录的 README.md。
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import shutil
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCES = HERE / "sources.json"
RAW = ROOT / ".tools" / "kenney"
ORCH = ROOT / "frontend" / "public" / "audio" / "orchestra"
OUT_DIR = ROOT / "frontend" / "public" / "audio" / "sfx"
MANIFEST = ROOT / "frontend" / "src" / "audio" / "sfx" / "samples.ts"

#: 输出的采样率（MP3 最通用的 44.1 kHz；浏览器解码时换算成音频上下文的采样率）
SR = 44100
#: 游戏里音效的预算（字节）：超过就失败（任务要求“总量尽量 ≤ 2 MB”）
BUDGET = 2_000_000
#: 响度的参考值（dB，K 计权后最响的 LOUD_WIN 秒的均方根）：清单里的 gain 把每个文件都校到这个响度，
#: 各事件的音量（前端 sfx/events.ts 的 level）都相对它来写
REF_DB = -20.0
#: 起音前留多长（秒），并在这段里淡入
LEAD = 0.003
#: 起音的判定：|x| 第一次超过峰值的这么多倍
ONSET_REL = 0.02
#: 浏览器解码后找起音用的阈值（相对峰值），与前端 orchestra/bank.ts 的 MARK_REL 一致
MARK_REL = 0.005


# ───────────────────────────── 配方
#
# 一种素材（清单里的一个键，例如 "ui.click"）有几个变体，播放时轮流随机挑；一个变体由一层或几层素材叠成：
# - src：素材。"<包>/<文件名>"（包：rpg、casino、impact、ui、iface，见 sources.json）；
#   "orch/<相对 frontend/public/audio/orchestra/ 的路径>"（管弦采样的 MP3，VSCO 2 CE，CC0）；"synth/<名字>"（程序合成，见 SYNTH）。
# - at：这一层在成品里的起点（秒）；start：从素材的起音往后跳过多少（秒，负数为起音前多留）；dur：取素材的多长（秒，0 为到结尾）；
# - rate：快慢（同时变调，0.5 为低八度、慢一倍）；hp / lp：高通 / 低通（Hz，二阶巴特沃斯的幅度，零相位）；
# - gain：这一层的音量（dB，相对“这一层峰值归一到 1”）；fade：末尾淡出的长度（秒）；env：附加的音量包络 [(秒, 倍数)……]。


@dataclass
class L:
    src: str
    at: float = 0.0
    start: float = 0.0
    dur: float = 0.0
    rate: float = 1.0
    hp: float = 0.0
    lp: float = 0.0
    gain: float = 0.0
    fade: float = 0.02
    env: tuple = ()
    params: dict = field(default_factory=dict)


@dataclass
class Sample:
    key: str
    note: str
    variants: list
    #: LAME 的 VBR 质量（V 值，越小越好越大）
    q: int = 4
    #: 量响度的窗口（秒）：短促的声音用 50 毫秒，长的用 200 毫秒
    loud_win: float = 0.05
    #: 尾部截到比峰值低这么多 dB
    tail_db: float = -58.0
    #: 一组变体之间怎样统一音量："loud" 按响度；"mix" 响度与峰值各算一半（极短的“嗒”“咔”：
    #: 只按响度统一时，瞬态尖的变体峰值会高出好几 dB，听起来忽轻忽重）
    norm: str = "loud"


def chain_layers(seed: int, pulls: int = 4) -> list:
    """起锚：绞盘一下下地绞（每绞一下，木头的棘爪“咔”一声、绞盘吱呀），铁链随之一截截卡过锚链孔——
    每一截是一记沉的金属撞击，后面跟着几下链环互相磕碰的细碎声；越绞越顺，最后一截轻一些。"""
    import random

    r = random.Random(seed)
    heavy = [f"impact/impactMetal_heavy_00{i}" for i in range(5)]
    light = [f"impact/impactMetal_light_00{i}" for i in range(5)] + [f"impact/impactMetal_medium_00{i}" for i in range(5)]
    layers = []
    t = 0.02
    for p in range(pulls):
        last = p == pulls - 1
        base = -1.5 if p < pulls - 1 else -4.5
        # 绞盘的吱呀（第一下与第三下）
        if p % 2 == 0:
            layers.append(L("rpg/creak3", at=t, rate=0.55 + r.random() * 0.08, hp=150, lp=2200, gain=-10 + (r.random() - 0.5) * 2, fade=0.12))
        # 一截铁链：沉的一记
        layers.append(L(r.choice(heavy), at=t + 0.03, dur=0.16, rate=0.5 + r.random() * 0.12, hp=160, lp=3000, gain=base + (r.random() - 0.5) * 2, fade=0.1))
        # 链环的细碎磕碰：一下比一下轻
        k = r.randint(4, 6) if not last else 3
        tt = t + 0.05
        for i in range(k):
            tt += 0.018 + r.random() * 0.03
            layers.append(L(r.choice(light), at=tt, dur=0.06, rate=0.72 + r.random() * 0.3, hp=500, lp=5500, gain=base - 8 - i * 1.5 + (r.random() - 0.5) * 2, fade=0.045))
        t += 0.25 + r.random() * 0.05
    # 细的铁环声打底
    layers.append(L("rpg/beltHandle1", at=0.1, rate=0.78, hp=1800, lp=6500, gain=-17, fade=0.1))
    layers.append(L("rpg/beltHandle2", at=0.5, rate=0.72, hp=1800, lp=6500, gain=-19, fade=0.12))
    return layers


def cannon_layers(seed: int, far: bool = False) -> list:
    """炮声：一声短促的爆裂（白噪声）+ 火药的轰（粉红噪声）+ 大鼓降低音高做的“咚” + 在海面上滚开的低沉余响与两次回声。远处的炮声没有爆裂、更暗。"""
    bd = ["orch/perc-bd/hit-l1-r0", "orch/perc-bd/hit-l1-r1", "orch/perc-bd/hit-l0-r0"][seed % 3]
    rate = [0.62, 0.58, 0.66][seed % 3]
    if far:
        return [
            L("synth/noise", params={"color": "pink", "attack": 0.004, "tau": 0.09, "dur": 0.5, "seed": seed}, lp=700, hp=40, gain=-4),
            L(bd, rate=rate * 0.92, lp=260, gain=0, fade=0.3),
            L("synth/noise", at=0.03, params={"color": "brown", "attack": 0.08, "tau": 0.8, "dur": 2.4, "seed": seed + 7, "am": (2.6, 0.35)}, lp=240, hp=30, gain=-3, fade=0.5),
            L("synth/noise", at=0.42, params={"color": "brown", "attack": 0.1, "tau": 0.6, "dur": 1.6, "seed": seed + 9}, lp=200, hp=30, gain=-12, fade=0.4),
        ]
    return [
        L("synth/noise", params={"color": "white", "attack": 0.0006, "tau": 0.007, "dur": 0.06, "seed": seed}, hp=900, lp=7500, gain=-3),
        L("synth/noise", params={"color": "pink", "attack": 0.002, "tau": 0.075, "dur": 0.45, "seed": seed + 3}, lp=1400, hp=60, gain=-2),
        L(bd, rate=rate, lp=500, gain=0, fade=0.3),
        L("synth/noise", at=0.02, params={"color": "brown", "attack": 0.05, "tau": 0.75, "dur": 2.3, "seed": seed + 5, "am": (3.1, 0.3)}, lp=320, hp=30, gain=-4, fade=0.5),
        L("synth/noise", at=0.33, params={"color": "brown", "attack": 0.06, "tau": 0.5, "dur": 1.4, "seed": seed + 11}, lp=260, hp=30, gain=-11, fade=0.4),
    ]


def splash_layers(seed: int) -> list:
    """炮弹落水：一声闷的“扑通”（下滑的正弦）、水花的主体（带通的粉红噪声）与四溅的水滴（一串随机的高频小脉冲）。"""
    return [
        L("synth/thump", params={"f0": 150, "f1": 60, "tau": 0.08, "dur": 0.3}, gain=-4),
        L("synth/noise", at=0.005, params={"color": "pink", "attack": 0.012, "tau": 0.2, "dur": 0.9, "seed": seed}, hp=350, lp=3200, gain=0, fade=0.3),
        L("synth/droplets", at=0.03, params={"rate": 110, "tau": 0.22, "dur": 0.75, "seed": seed + 1}, hp=1800, lp=7500, gain=-10, fade=0.25),
    ]


def hit_layers(seed: int) -> list:
    """炮弹打中船身：劈开木头的一击、船板的闷响与飞溅的木屑。"""
    planks = ["impact/impactPlank_medium_001", "impact/impactPlank_medium_002", "impact/impactPlank_medium_004"]
    return [
        L("rpg/chop", rate=[0.72, 0.66, 0.78][seed % 3], hp=80, lp=6000, gain=0, fade=0.08),
        L(planks[seed % 3], rate=[0.72, 0.68, 0.76][seed % 3], hp=40, lp=1600, gain=-1, fade=0.2),
        L("synth/droplets", at=0.012, params={"rate": 70, "tau": 0.12, "dur": 0.45, "seed": seed + 21, "low": 1400, "high": 4200}, hp=1200, lp=7000, gain=-11, fade=0.15),
        L("rpg/creak3", at=0.09, dur=0.2, rate=0.5, hp=100, lp=2000, gain=-18, fade=0.1),
    ]


SAMPLES: list[Sample] = [
    # ── 界面（很轻、很短，高频操作）
    Sample("ui.click", "按钮：黏土筹码落在呢面上的一下“嗒”，削掉高频（筹码的脆响）与低频，只剩轻轻的、偏木头的一点", [
        [L("casino/chip-lay-1", dur=0.045, hp=450, lp=3800, fade=0.025)],
        [L("casino/chip-lay-2", dur=0.045, hp=450, lp=3800, fade=0.025)],
        [L("casino/chips-collide-4", dur=0.04, hp=450, lp=3800, fade=0.022)],
        [L("casino/chips-collide-2", dur=0.04, hp=450, lp=3800, fade=0.022)],
    ], norm="mix"),
    Sample("ui.tab", "切换页签：翻一页纸", [
        [L("rpg/bookFlip3", dur=0.2, hp=400, lp=7500, fade=0.07)],
        [L("rpg/bookFlip2", dur=0.22, hp=400, lp=7500, fade=0.08)],
        [L("casino/card-slide-4", dur=0.22, hp=350, lp=7000, fade=0.08)],
    ], norm="mix"),
    Sample("ui.open", "打开窗口：一张纸滑出来", [
        [L("casino/card-slide-3", dur=0.28, hp=300, lp=7000, fade=0.1)],
        [L("casino/card-slide-5", dur=0.28, hp=300, lp=7000, fade=0.1)],
        [L("casino/card-shove-1", dur=0.28, hp=300, lp=7000, fade=0.1)],
    ], loud_win=0.1, norm="mix"),
    Sample("ui.close", "关上窗口：一本薄册子轻轻放下", [
        [L("rpg/bookPlace1", dur=0.17, hp=120, lp=3000, fade=0.08)],
        [L("rpg/bookPlace2", dur=0.17, hp=120, lp=3000, fade=0.08)],
        [L("rpg/bookPlace3", dur=0.17, hp=120, lp=3000, fade=0.08)],
    ], norm="mix"),
    Sample("ui.toggle", "开关：黄铜小搭扣“咔哒”一下", [
        [L("rpg/metalLatch", dur=0.12, hp=600, lp=6000, fade=0.06)],
        [L("rpg/metalLatch", dur=0.1, rate=1.09, hp=650, lp=6000, fade=0.05)],
        [L("rpg/metalClick", dur=0.08, hp=600, lp=6000, fade=0.04)],
    ], norm="mix"),
    Sample("ui.tick", "滑条的档位：极短的一下", [
        [L("casino/chips-collide-4", dur=0.022, hp=900, lp=5000, fade=0.012)],
        [L("casino/chips-stack-2", dur=0.022, hp=900, lp=5000, fade=0.012)],
        [L("casino/chip-lay-1", dur=0.022, hp=900, lp=5000, fade=0.012)],
    ], norm="mix"),
    Sample("ui.error", "操作被拒：两下闷闷的“咚咚”，第二下低一点", [
        [L("rpg/bookPlace1", dur=0.14, rate=0.9, hp=100, lp=2200, fade=0.07),
         L("rpg/bookPlace3", at=0.13, dur=0.14, rate=0.8, hp=100, lp=2000, gain=-3, fade=0.08)],
        [L("rpg/bookPlace2", dur=0.14, rate=0.9, hp=100, lp=2200, fade=0.07),
         L("rpg/bookPlace1", at=0.13, dur=0.14, rate=0.8, hp=100, lp=2000, gain=-3, fade=0.08)],
    ]),
    Sample("ui.notify", "提示：一张纸条放在桌上", [
        [L("casino/card-place-4", dur=0.25, hp=400, lp=6500, fade=0.1)],
        [L("casino/card-place-3", dur=0.25, hp=400, lp=6500, fade=0.1)],
    ], loud_win=0.1, norm="mix"),
    # ── 交易
    Sample("coin.pay", "付钱（买入）：几枚金币放上柜台", [
        [L("rpg/handleCoins", dur=0.32, hp=500, lp=11000, fade=0.1)],
        [L("rpg/handleCoins", start=0.39, dur=0.34, hp=500, lp=11000, fade=0.12)],
        [L("rpg/handleCoins2", hp=500, lp=11000, fade=0.08)],
        [L("rpg/handleCoins", start=0.08, dur=0.25, rate=1.06, hp=500, lp=11000, fade=0.1)],
    ], loud_win=0.1),
    Sample("coin.take", "收钱（卖出）：金币叮当落进钱袋", [
        [L("rpg/handleCoins2", hp=500, lp=11000, fade=0.08), L("rpg/handleSmallLeather", at=0.14, hp=150, lp=3000, gain=-6, fade=0.08)],
        [L("rpg/handleCoins", start=0.08, dur=0.22, hp=500, lp=11000, fade=0.08), L("rpg/handleSmallLeather2", at=0.16, hp=150, lp=3500, gain=-6, fade=0.08)],
        [L("rpg/handleCoins", start=0.39, dur=0.2, hp=500, lp=11000, fade=0.08), L("rpg/handleSmallLeather", at=0.12, hp=150, lp=3000, gain=-6, fade=0.08)],
    ], loud_win=0.1),
    Sample("coin.pour", "全部卖出：一大把金币哗啦啦倒进钱箱", [
        [L("rpg/handleCoins", hp=450, lp=11000, fade=0.15), L("rpg/handleCoins2", at=0.28, hp=450, lp=11000, gain=-3, fade=0.08),
         L("casino/chips-handle-5", at=0.05, rate=0.9, hp=800, lp=9000, gain=-9, fade=0.2), L("rpg/handleSmallLeather", at=0.86, hp=150, lp=3000, gain=-8, fade=0.08)],
        [L("rpg/handleCoins", start=0.08, hp=450, lp=11000, fade=0.15), L("rpg/handleCoins2", at=0.12, hp=450, lp=11000, gain=-2, fade=0.08),
         L("rpg/handleCoins", at=0.45, start=0.39, hp=450, lp=11000, gain=-4, fade=0.12), L("rpg/handleSmallLeather2", at=0.9, hp=150, lp=3500, gain=-8, fade=0.08)],
    ], loud_win=0.2),
    Sample("coin.purse", "钱不够：空钱袋软软地一拍，没有钱币声", [
        [L("rpg/handleSmallLeather2", hp=150, lp=4000, fade=0.08), L("rpg/dropLeather", at=0.1, rate=1.1, hp=90, lp=1500, gain=-4, fade=0.1)],
        [L("rpg/handleSmallLeather", hp=150, lp=4000, fade=0.08), L("rpg/dropLeather", at=0.08, hp=90, lp=1500, gain=-5, fade=0.1)],
    ], loud_win=0.1),
    # ── 航海与港口
    Sample("sea.chain", "起锚：铁链一环环卡过锚链孔，绞盘吱呀", [chain_layers(7), chain_layers(19)], loud_win=0.2),
    Sample("sea.sail", "升帆：厚帆布抖开、吃满了风", [
        [L("rpg/cloth1", rate=0.6, hp=90, lp=2500, fade=0.2), L("rpg/cloth3", at=0.12, rate=0.55, hp=90, lp=2200, gain=-3, fade=0.2),
         L("synth/noise", params={"color": "pink", "attack": 0.28, "tau": 0.35, "dur": 1.1, "seed": 31}, hp=250, lp=900, gain=-12, fade=0.3)],
        [L("rpg/cloth2", rate=0.62, hp=90, lp=2500, fade=0.2), L("rpg/cloth4", at=0.1, rate=0.58, hp=90, lp=2200, gain=-3, fade=0.2),
         L("synth/noise", params={"color": "pink", "attack": 0.3, "tau": 0.4, "dur": 1.2, "seed": 37}, hp=250, lp=900, gain=-12, fade=0.3)],
    ], loud_win=0.2),
    Sample("sea.rope", "抛缆：缆绳甩出去、落在码头上", [
        [L("rpg/cloth4", rate=0.85, hp=200, lp=5000, gain=-2, fade=0.1), L("rpg/dropLeather", at=0.22, rate=0.9, hp=80, lp=2000, fade=0.12)],
        [L("rpg/cloth2", rate=0.85, hp=200, lp=5000, gain=-2, fade=0.1), L("rpg/dropLeather", at=0.2, hp=80, lp=2000, fade=0.12),
         L("rpg/handleSmallLeather", at=0.45, hp=150, lp=3000, gain=-8, fade=0.08)],
    ], loud_win=0.2),
    Sample("sea.dock", "靠岸：船舷碰上码头的木桩，船板吱呀一声", [
        [L("impact/impactPlank_medium_000", rate=0.8, hp=45, lp=1500, fade=0.25), L("rpg/creak3", at=0.12, rate=0.6, hp=120, lp=2500, gain=-9, fade=0.12)],
        [L("impact/impactPlank_medium_002", rate=0.75, hp=45, lp=1500, fade=0.25), L("rpg/creak2", at=0.1, start=0.3, dur=0.3, rate=0.6, hp=120, lp=2500, gain=-10, fade=0.12)],
        [L("impact/impactPlank_medium_003", rate=0.82, hp=45, lp=1500, fade=0.25), L("rpg/creak1", at=0.1, start=0.12, dur=0.35, rate=0.62, hp=120, lp=2500, gain=-10, fade=0.12)],
    ], loud_win=0.1),
    Sample("sea.hammer", "修船、造船厂：锤子敲在木头上（有的带一点钉子的金属声）", [
        [L("rpg/chop", hp=150, lp=6000, fade=0.08), L("impact/impactWood_medium_000", rate=1.3, gain=-6, fade=0.08)],
        [L("rpg/chop", rate=1.08, hp=150, lp=6000, fade=0.08), L("impact/impactWood_medium_001", rate=1.4, gain=-6, fade=0.08),
         L("impact/impactMetal_light_002", rate=1.6, hp=2000, gain=-20, fade=0.06)],
        [L("rpg/chop", rate=0.94, hp=150, lp=6000, fade=0.08), L("impact/impactWood_medium_002", rate=1.2, gain=-5, fade=0.08)],
        [L("rpg/footstep08", rate=1.2, hp=150, lp=5000, fade=0.08), L("impact/impactWood_medium_003", rate=1.35, gain=-4, fade=0.08),
         L("impact/impactMetal_light_004", rate=1.7, hp=2000, gain=-20, fade=0.06)],
    ], norm="mix"),
    Sample("sea.step", "脚步：踩在甲板上（雇船员时几个人走上船）", [
        [L("rpg/footstep00", dur=0.2, hp=100, lp=5000, fade=0.08)],
        [L("rpg/footstep01", dur=0.2, hp=100, lp=5000, fade=0.08)],
        [L("rpg/footstep03", dur=0.2, hp=100, lp=5000, fade=0.08)],
        [L("rpg/footstep07", dur=0.2, hp=100, lp=5000, fade=0.08)],
    ], norm="mix"),
    Sample("sea.crate", "补给：粮袋落地、水桶磕一下", [
        [L("rpg/dropLeather", hp=70, lp=2500, fade=0.1), L("impact/impactWood_heavy_000", at=0.2, rate=1.6, hp=60, lp=2500, gain=-3, fade=0.1)],
        [L("impact/impactSoft_heavy_000", rate=1.3, hp=60, lp=2000, fade=0.12), L("rpg/dropLeather", at=0.18, rate=0.95, hp=70, lp=2500, gain=-3, fade=0.1)],
    ], loud_win=0.1),
    # ── 存档、读档、时间
    Sample("log.close", "存档：合上航海日志", [
        [L("rpg/bookClose", hp=60, lp=5000, fade=0.08)],
        [L("rpg/bookClose", rate=0.94, hp=60, lp=5000, fade=0.08)],
    ]),
    Sample("log.open", "读档：翻开航海日志、翻一页", [
        [L("rpg/bookOpen", hp=80, lp=6000, fade=0.05), L("rpg/bookFlip3", at=0.12, hp=400, lp=7000, gain=-4, fade=0.07)],
        [L("rpg/bookOpen", rate=0.95, hp=80, lp=6000, fade=0.05), L("rpg/bookFlip2", at=0.1, dur=0.25, hp=400, lp=7000, gain=-4, fade=0.08)],
    ], loud_win=0.1),
    Sample("time.stop", "暂停：闷闷地扣上搭扣", [
        [L("rpg/metalLatch", rate=0.82, hp=200, lp=3500, fade=0.08)],
        [L("rpg/metalLatch", rate=0.76, hp=200, lp=3000, fade=0.08), L("rpg/bookPlace3", dur=0.12, hp=120, lp=1800, gain=-12, fade=0.06)],
    ], norm="mix"),
    Sample("time.go", "继续：拨开搭扣", [
        [L("rpg/metalClick", dur=0.12, hp=400, lp=6000, fade=0.06)],
        [L("rpg/metalLatch", dur=0.1, rate=1.05, hp=700, lp=6500, fade=0.05)],
    ], norm="mix"),
    # ── 海战
    Sample("war.cannon", "开炮（近处）", [cannon_layers(0), cannon_layers(1), cannon_layers(2)], q=5, loud_win=0.2),
    Sample("war.cannonFar", "远处的炮声（自动结算的海战）", [cannon_layers(3, far=True), cannon_layers(4, far=True)], q=5, loud_win=0.2),
    Sample("war.hit", "命中：炮弹打穿船板、木屑飞溅", [hit_layers(0), hit_layers(1), hit_layers(2)], loud_win=0.1),
    Sample("war.splash", "落水：炮弹没打中、落进海里（沉船时也用）", [splash_layers(41), splash_layers(43)], loud_win=0.2),
    Sample("war.clash", "接舷：刀剑相碰", [
        [L("rpg/drawKnife3", hp=700, lp=9000, fade=0.08), L("rpg/knifeSlice", at=0.06, hp=800, lp=9000, gain=-4, fade=0.1)],
        [L("rpg/knifeSlice2", hp=800, lp=9000, fade=0.1), L("rpg/drawKnife1", at=0.08, hp=700, lp=9000, gain=-6, fade=0.08)],
        [L("rpg/knifeSlice", hp=800, lp=9000, fade=0.1), L("rpg/drawKnife2", at=0.05, hp=700, lp=9000, gain=-5, fade=0.08)],
    ], loud_win=0.1),
]


# ───────────────────────────── 下载与解压


def load_sources() -> dict:
    with open(SOURCES, encoding="utf-8") as f:
        return json.load(f)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def zip_path(pack: dict) -> Path:
    return RAW / pack["url"].rsplit("/", 1)[-1]


def fetch(args: argparse.Namespace) -> None:
    handlers = []
    if args.proxy:
        handlers.append(urllib.request.ProxyHandler({"http": args.proxy, "https": args.proxy}))
    opener = urllib.request.build_opener(*handlers)
    RAW.mkdir(parents=True, exist_ok=True)
    for pack in load_sources()["packs"]:
        dst = zip_path(pack)
        if dst.exists() and dst.stat().st_size == pack["bytes"] and sha256(dst) == pack["sha256"]:
            print(f"  已有 {dst.name}")
            continue
        print(f"  下载 {pack['url']}", flush=True)
        tmp = dst.with_suffix(".part")
        with opener.open(pack["url"], timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
        if tmp.stat().st_size != pack["bytes"] or sha256(tmp) != pack["sha256"]:
            tmp.unlink()
            raise SystemExit(f"{dst.name}：大小或校验和不对（包可能更新了，请核对 sources.json）")
        os.replace(tmp, dst)
    print("下载完成")


def unpack() -> None:
    """把各包 Audio/ 下的 OGG 解压到 .tools/kenney/<包>/（已解压的跳过）。"""
    for pack in load_sources()["packs"]:
        zp = zip_path(pack)
        if not zp.exists():
            raise SystemExit(f"缺少 {zp}，先运行 fetch")
        if zp.stat().st_size != pack["bytes"] or sha256(zp) != pack["sha256"]:
            raise SystemExit(f"{zp.name} 的校验和与 sources.json 不一致")
        dst = RAW / pack["dir"]
        dst.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zp) as z:
            for n in z.namelist():
                if n.startswith("Audio/") and n.endswith(".ogg"):
                    p = dst / Path(n).name
                    if not p.exists():
                        p.write_bytes(z.read(n))


# ───────────────────────────── 读取与基本处理


def np():  # 延迟导入：fetch 不需要 numpy
    import numpy

    return numpy


PACK_DIRS: dict[str, str] = {}
_cache: dict[str, object] = {}


def decode_file(path: Path):
    """解码 OGG / MP3，返回 (float64 数组 [帧, 声道], 采样率)。"""
    import av

    N = np()
    c = av.open(str(path))
    sr = c.streams.audio[0].codec_context.sample_rate
    parts = []
    for f in c.decode(audio=0):
        a = f.to_ndarray()
        if f.format.is_planar:
            parts.append(a)
        else:  # 交错格式：[1, 帧 × 声道]
            parts.append(a.reshape(-1, len(f.layout.channels)).T)
    c.close()
    x = N.concatenate(parts, axis=1).T.astype(N.float64)
    return x, sr


def resample(x, rate: float):
    """变速变调：把信号当作以 SR × rate 采样的，重采样回 SR（长度变成 1/rate）。用频域的带限重采样，前后补零免得首尾相接。"""
    N = np()
    if abs(rate - 1.0) < 1e-6:
        return x
    n = len(x)
    m = max(1, int(round(n / rate)))
    pad = 1 << (max(n, m) * 2 - 1).bit_length()
    X = N.fft.rfft(N.concatenate([x, N.zeros(pad - n)]))
    mp = int(round(pad / rate))
    Y = N.zeros(mp // 2 + 1, dtype=complex)
    k = min(len(X), len(Y))
    Y[:k] = X[:k]
    y = N.fft.irfft(Y, mp) * (mp / pad)
    return y[:m]


def to_mono(x):
    """立体声混成单声道：两个声道相关高时取平均；相关低（宽的立体声录音，平均会抵消）时取较响的一个声道。"""
    N = np()
    if x.shape[1] == 1:
        return x[:, 0]
    l, r = x[:, 0], x[:, 1]
    if N.std(l) == 0 or N.std(r) == 0:
        return (l + r) / 2
    corr = float(N.corrcoef(l, r)[0, 1])
    if corr > 0.3:
        return (l + r) / 2
    return l if float(N.mean(l * l)) >= float(N.mean(r * r)) else r


def load(src: str):
    """读一个素材（单声道、SR）。"""
    if src in _cache:
        return _cache[src]
    pack, rest = src.split("/", 1)
    if pack == "orch":
        path = ORCH / f"{rest}.mp3"
    else:
        if not PACK_DIRS:
            for p in load_sources()["packs"]:
                PACK_DIRS[p["key"]] = p["dir"]
        if pack not in PACK_DIRS:
            raise SystemExit(f"不认识的素材包：{src}")
        path = RAW / PACK_DIRS[pack] / f"{rest}.ogg"
    if not path.exists():
        raise SystemExit(f"找不到素材 {path}（先运行 fetch）")
    x, sr = decode_file(path)
    m = to_mono(x)
    if sr != SR:
        m = resample(m, sr / SR)
    _cache[src] = m
    return m


def onset(m, rel: float = ONSET_REL) -> int:
    N = np()
    a = N.abs(m)
    pk = float(a.max()) if len(a) else 0.0
    if pk <= 0:
        return 0
    return int(N.argmax(a >= pk * rel))


def butter(x, kind: str, fc: float, order: int = 2):
    """二阶巴特沃斯的幅度响应（零相位），在频域里做。"""
    N = np()
    n = len(x)
    size = 1 << (n * 2 - 1).bit_length()
    X = N.fft.rfft(x, size)
    f = N.fft.rfftfreq(size, 1 / SR)
    r = (f / fc) ** (2 * order)
    H = 1 / N.sqrt(1 + r) if kind == "lp" else N.sqrt(r / (1 + r))
    return N.fft.irfft(X * H, size)[:n]


def fade(x, head: float, tail: float):
    N = np()
    n = len(x)
    h = min(n, int(head * SR))
    if h > 1:
        x[:h] *= 0.5 - 0.5 * N.cos(N.linspace(0, math.pi, h))
    t = min(n, int(tail * SR))
    if t > 1:
        x[n - t :] *= 0.5 + 0.5 * N.cos(N.linspace(0, math.pi, t))
    return x


# ───────────────────────────── 程序合成（确定的：同样的参数与种子，结果逐采样相同）


def synth_noise(p: dict):
    """一团噪声：白 / 粉红 / 布朗，attack 秒线性起、之后按 tau 指数衰减，可加慢的起伏（am = (频率, 深度)）。"""
    N = np()
    rng = N.random.default_rng(int(p.get("seed", 0)))
    n = int(p["dur"] * SR)
    w = rng.standard_normal(n)
    color = p.get("color", "white")
    if color != "white":
        W = N.fft.rfft(w)
        f = N.fft.rfftfreq(n, 1 / SR)
        f[0] = f[1]
        W *= (1 / N.sqrt(f)) if color == "pink" else (1 / f)
        w = N.fft.irfft(W, n)
    w /= float(N.max(N.abs(w))) + 1e-12
    t = N.arange(n) / SR
    a = max(1e-4, float(p.get("attack", 0.001)))
    env = N.where(t < a, t / a, N.exp(-(t - a) / float(p.get("tau", 0.1))))
    if "am" in p:
        fr, depth = p["am"]
        env *= 1 - depth * (0.5 + 0.5 * N.sin(2 * math.pi * fr * t + 1.3))
    return w * env


def synth_thump(p: dict):
    """一声闷响：从 f0 滑到 f1 的正弦，指数衰减。"""
    N = np()
    n = int(p["dur"] * SR)
    t = N.arange(n) / SR
    tau = float(p["tau"])
    f = p["f1"] + (p["f0"] - p["f1"]) * N.exp(-t / (tau * 0.6))
    ph = 2 * math.pi * N.cumsum(f) / SR
    env = N.minimum(1, t / 0.002) * N.exp(-t / tau)
    return N.sin(ph) * env


def synth_droplets(p: dict):
    """一串随机的小脉冲（水滴、木屑）：每一下是一个很快衰减的正弦，频率在 low–high 之间随机；密度按 tau 指数减少。"""
    N = np()
    rng = N.random.default_rng(int(p.get("seed", 0)))
    n = int(p["dur"] * SR)
    y = N.zeros(n)
    t = 0.0
    lo, hi = float(p.get("low", 1800)), float(p.get("high", 6500))
    rate0, tau = float(p["rate"]), float(p["tau"])
    while True:
        lam = rate0 * math.exp(-t / tau)
        if lam < 2:
            break
        t += rng.exponential(1 / lam)
        if t >= p["dur"] - 0.02:
            break
        i = int(t * SR)
        f = lo * (hi / lo) ** rng.random()
        d = 0.002 + rng.random() * 0.004
        k = min(n - i, int(d * 6 * SR))
        tt = N.arange(k) / SR
        amp = (0.3 + 0.7 * rng.random()) * math.exp(-t / tau)
        y[i : i + k] += amp * N.sin(2 * math.pi * f * tt + rng.random() * 6) * N.exp(-tt / d)
    return y


SYNTH = {"noise": synth_noise, "thump": synth_thump, "droplets": synth_droplets}


# ───────────────────────────── 做一个变体


def render_layer(l: L):
    N = np()
    if l.src.startswith("synth/"):
        name = l.src.split("/", 1)[1]
        x = SYNTH[name](l.params).astype(N.float64)
    else:
        m = load(l.src)
        on = onset(m)
        a = max(0, on + int((l.start - LEAD) * SR))
        b = len(m) if l.dur <= 0 else min(len(m), a + int((l.dur + LEAD) * SR))
        x = m[a:b].copy()
        fade(x, LEAD, 0)
    x = resample(x, l.rate)
    if l.hp > 0:
        x = butter(x, "hp", l.hp)
    if l.lp > 0:
        x = butter(x, "lp", l.lp)
    if l.env:
        t = N.arange(len(x)) / SR
        ts = [p[0] for p in l.env]
        gs = [p[1] for p in l.env]
        x *= N.interp(t, ts, gs)
    fade(x, 0.0015, l.fade)
    pk = float(N.abs(x).max()) + 1e-12
    return x / pk * 10 ** (l.gain / 20)


def render_variant(layers: list):
    N = np()
    parts = [(int(round(l.at * SR)), render_layer(l)) for l in layers]
    n = max(a + len(x) for a, x in parts)
    y = N.zeros(n)
    for a, x in parts:
        y[a : a + len(x)] += x
    return y


def trim_tail(y, tail_db: float):
    N = np()
    a = N.abs(y)
    pk = float(a.max())
    idx = N.nonzero(a >= pk * 10 ** (tail_db / 20))[0]
    end = int(idx[-1]) + 1 if len(idx) else len(y)
    end = min(len(y), end + int(0.01 * SR))
    y = y[:end].copy()
    fade(y, 0, min(0.012, len(y) / SR / 4))
    return y


def k_weighted(m):
    """近似的 K 计权（ITU-R BS.1770 的预滤波：约 60 Hz 高通 + 1.5 kHz 以上 +4 dB），在频域里做。"""
    N = np()
    n = len(m)
    size = 1 << max(1, (n * 2 - 1).bit_length())
    X = N.fft.rfft(m, size)
    f = N.fft.rfftfreq(size, 1 / SR)
    hp = f**4 / (f**4 + 60.0**4 + 1e-12)
    shelf = 1 + (10 ** (4 / 20) - 1) * (f**2 / (f**2 + 1500.0**2))
    return N.fft.irfft(X * N.sqrt(hp) * shelf, size)[:n]


def loudness_db(m, win: float) -> float:
    """响度（dB）：K 计权后，win 秒窗口里最响的一段的均方根（比窗口短的声音按窗口长度折算）。"""
    N = np()
    y = k_weighted(m)
    w = int(win * SR)
    c = N.concatenate([[0.0], N.cumsum(y * y)])
    if len(y) <= w:
        return 10 * math.log10(float(c[-1]) / w + 1e-20)
    return 10 * math.log10(float(N.max(c[w:] - c[:-w])) / w + 1e-20)


def encode_mp3(y, q: int) -> bytes:
    """编码成单声道 MP3（LAME 的 VBR，质量 q）。"""
    import av

    N = np()
    buf = io.BytesIO()
    out = av.open(buf, mode="w", format="mp3")
    st = out.add_stream("libmp3lame", rate=SR, layout="mono")
    st.codec_context.qscale = True
    st.codec_context.options = {"global_quality": str(q * 118)}
    frame = av.AudioFrame.from_ndarray(N.ascontiguousarray(y[None, :].astype(N.float32)), format="fltp", layout="mono")
    frame.sample_rate = SR
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
    return N.concatenate(parts, axis=1)[0]


# ───────────────────────────── 构建


@dataclass
class Zone:
    key: str
    file: str
    gain: float
    length: float
    mark: float
    bytes: int
    hash: str
    peak_db: float
    loud_db: float


def build(args: argparse.Namespace) -> None:
    N = np()
    unpack()
    keys = [s.key for s in SAMPLES]
    if len(set(keys)) != len(keys):
        raise SystemExit("素材的键有重复")
    for s in SAMPLES:
        # 每种素材 2–4 个变体（播放时随机轮换，同一个声音连着响也不会一模一样）
        if not 2 <= len(s.variants) <= 4:
            raise SystemExit(f"{s.key}：变体要有 2–4 个，现在 {len(s.variants)} 个")
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)
    zones: list[Zone] = []
    for s in SAMPLES:
        ys = []
        for i, layers in enumerate(s.variants):
            y = trim_tail(render_variant(layers), s.tail_db)
            if not N.all(N.isfinite(y)):
                raise SystemExit(f"{s.key}#{i}：出现了非数")
            ys.append(y)
        louds = [loudness_db(y, s.loud_win) for y in ys]
        peaks = [20 * math.log10(float(N.abs(y).max()) + 1e-12) for y in ys]
        # 每个变体校到的目标（dB）：按响度时都到 REF_DB；“mix” 时让 (响度 + 峰值) / 2 一样，整组的平均响度仍是 REF_DB
        if s.norm == "mix":
            ref_mix = REF_DB + sum((p - l) / 2 for p, l in zip(peaks, louds)) / len(ys)
            adjust = [ref_mix - (l + p) / 2 for l, p in zip(louds, peaks)]
        else:
            adjust = [REF_DB - l for l in louds]
        for i, y in enumerate(ys):
            pk = 10 ** (peaks[i] / 20)
            scale = 0.891 / pk  # 峰值归一到 −1 dBFS 再编码（编码的精度最高）
            y = y * scale
            data = encode_mp3(y, s.q)
            mark = onset(y, MARK_REL) / SR
            dec = decode_mp3(data)
            mark_dec = onset(dec, MARK_REL) / SR
            if abs(mark_dec - mark) > 0.004:
                print(f"    注意：{s.key}#{i} 解码后的起音偏了 {1000 * (mark_dec - mark):.1f} 毫秒", flush=True)
            name = f"{s.key.replace('.', '-')}-{i + 1}.mp3"
            (OUT_DIR / name).write_bytes(data)
            # 播放时乘的增益：先还原到做好时的电平（除以 scale），再校到这一组统一的响度
            gain = (1 / scale) * 10 ** (adjust[i] / 20)
            zones.append(Zone(s.key, name, round(gain, 4), round(len(y) / SR, 3), round(mark, 4), len(data), hashlib.sha1(data).hexdigest()[:8],
                              round(peaks[i] + adjust[i], 1), round(louds[i] + adjust[i], 1)))
    write_manifest(zones)
    total = sum(z.bytes for z in zones)
    for s in SAMPLES:
        zs = [z for z in zones if z.key == s.key]
        print(f"  {s.key:16s} {len(zs)} 个  {sum(z.bytes for z in zs) / 1024:6.1f} KB  长 {', '.join(f'{z.length:.2f}' for z in zs)} 秒"
              f"  校准后峰值 {', '.join(f'{z.peak_db:.1f}' for z in zs)}  响度 {', '.join(f'{z.loud_db:.1f}' for z in zs)} dB")
    print(f"合计 {len(zones)} 个文件 {total / 1e6:.3f} MB（预算 {BUDGET / 1e6:.1f} MB）")
    if total > BUDGET:
        raise SystemExit("超过预算")


def ts_num(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s if s not in ("-0", "") else "0"


def write_manifest(zones: list[Zone]) -> None:
    packs = load_sources()["packs"]
    lines = [
        "// 生成文件：由 tools/sfx/build.py 写出，不要手改（改素材的挑选与处理请改那个脚本的配方，再重新运行）。",
        "//",
        "// 游戏音效的素材清单。素材来自 Kenney（www.kenney.nl）的五个音效包，许可均为 CC0 1.0（公有领域，不要求署名，这里照样写明出处）：",
    ]
    for p in packs:
        lines.append(f"//   {p['title']}：{p['url']}")
    lines += [
        "// 炮声的“咚”用了管弦采样里的大鼓（VS Chamber Orchestra: Community Edition，CC0 1.0，见 tools/orchestra/README.md）；",
        "// 炮声的轰鸣与余响、落水与木屑是程序合成的。",
        "// 文件在 frontend/public/audio/sfx/ 下（单声道 MP3，44.1 kHz）；浏览器解码后按 mark 对齐起音（与管弦采样同一个办法，见 orchestra/bank.ts）。",
        "",
        "/** 一个文件（一种素材的一个变体）。 */",
        "export interface SfxFile {",
        "  /** 文件名（相对 public/audio/sfx/） */",
        "  file: string;",
        "  /** 播放时乘的增益：把这个文件校到统一的参考响度（K 计权后最响一段的均方根 −20 dB），各事件的音量都相对它来写 */",
        "  gain: number;",
        "  /** 长度（秒） */",
        "  length: number;",
        "  /** 起音标记：|x| 第一次超过峰值 0.5% 的时刻（秒）。解码后的位置减去它就是解码器多出来的延迟 */",
        "  mark: number;",
        "  /** 文件字节数 */",
        "  bytes: number;",
        "  /** 内容哈希（前 8 位，URL 上带着它，换了素材浏览器不会用旧缓存） */",
        "  hash: string;",
        "}",
        "",
        "/** 一种素材：几个变体，播放时随机轮换。 */",
        "export interface SfxSampleSet {",
        "  /** 这是什么声音 */",
        "  note: string;",
        "  files: readonly SfxFile[];",
        "}",
        "",
        "export const SFX_SAMPLES = {",
    ]
    notes = {s.key: s.note for s in SAMPLES}
    for s in SAMPLES:
        lines.append(f'  "{s.key}": {{')
        lines.append(f'    note: "{notes[s.key]}",')
        lines.append("    files: [")
        for z in zones:
            if z.key != s.key:
                continue
            lines.append(
                f'      {{ file: "{z.file}", gain: {ts_num(z.gain)}, length: {ts_num(z.length)}, mark: {ts_num(z.mark)}, bytes: {z.bytes}, hash: "{z.hash}" }},'
            )
        lines.append("    ],")
        lines.append("  },")
    lines.append("} as const satisfies Readonly<Record<string, SfxSampleSet>>;")
    lines.append("")
    lines.append("/** 素材的键。 */")
    lines.append("export type SfxSampleId = keyof typeof SFX_SAMPLES;")
    lines.append("")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"写入 {MANIFEST.relative_to(ROOT)}")


# ───────────────────────────── 检查用的频谱图


def sheet(args: argparse.Namespace) -> None:
    from PIL import Image, ImageDraw

    N = np()
    files = sorted(OUT_DIR.glob("*.mp3"))
    tiles = []
    for p in files:
        m = decode_mp3(p.read_bytes()).astype(N.float64)
        nfft = 512
        w = min(900, max(80, int(len(m) / SR * 600)))
        hop = len(m) / w
        cols = []
        for i in range(w):
            s = int(i * hop) - nfft // 2
            seg = N.zeros(nfft)
            a, b = max(0, s), min(len(m), s + nfft)
            if b > a:
                seg[a - s : b - s] = m[a:b]
            cols.append(N.abs(N.fft.rfft(seg * N.hanning(nfft))))
        S = N.array(cols).T
        f = N.fft.rfftfreq(nfft, 1 / SR)
        ys = N.geomspace(50, 18000, 110)
        rows = N.array([S[min(len(f) - 1, int(N.searchsorted(f, yy)))] for yy in ys])[::-1]
        db = 20 * N.log10(rows + 1e-9)
        db -= db.max()
        img = (N.clip((db + 70) / 70, 0, 1) * 255).astype(N.uint8)
        tiles.append((p.name, img))
    W = 920
    per = 18
    for page in range(0, len(tiles), per):
        chunk = tiles[page : page + per]
        H = sum(t[1].shape[0] + 14 for t in chunk)
        im = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(im)
        y = 0
        for name, img in chunk:
            dr.text((2, y), name, fill=255)
            im.paste(Image.fromarray(img), (0, y + 14))
            y += img.shape[0] + 14
        out = RAW / f"sheet-{page // per}.png"
        im.save(out)
        print(f"写入 {out}")


def list_sources(args: argparse.Namespace) -> None:
    """列出每种素材用到的原始文件（写文档用）。"""
    used: set[str] = set()
    for s in SAMPLES:
        srcs = []
        for layers in s.variants:
            for l in layers:
                if l.src not in srcs:
                    srcs.append(l.src)
        used.update(x for x in srcs if not x.startswith("synth/"))
        print(f"{s.key}\t{len(s.variants)}\t{s.note}\t{', '.join(srcs)}")
    packs = {}
    for u in sorted(used):
        packs.setdefault(u.split("/", 1)[0], []).append(u)
    print()
    for k, v in packs.items():
        print(f"{k}: {len(v)} 个文件")


# ───────────────────────────── 入口


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch", help="下载五个音效包")
    f.add_argument("--proxy", default=os.environ.get("SFX_PROXY"), help="HTTP 代理，例如 http://127.0.0.1:8080")
    sub.add_parser("build", help="解压、处理、编码、写清单")
    sub.add_parser("sheet", help="画出做好的音效的频谱图")
    sub.add_parser("list", help="列出每种素材用到的原始文件")
    args = ap.parse_args()
    if args.cmd == "fetch":
        fetch(args)
    elif args.cmd == "build":
        build(args)
    elif args.cmd == "sheet":
        sheet(args)
    elif args.cmd == "list":
        list_sources(args)


if __name__ == "__main__":
    main()

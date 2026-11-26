// 公共资源的地址（桌面版）：图片（publicImage、portraitFile）带统一的版本号，管弦采样（sampleUrl）与音效（sfxUrl）带各自的内容哈希，
// 都以部署的挂载路径开头。
import { describe, expect, it } from "vitest";
import { portraitFile, publicImage, withVersion } from "../art/imageUrl";
import { sampleUrl } from "../audio/orchestra/bank";
import { SAMPLE_SETS } from "../audio/orchestra/samples";
import { sfxUrl } from "../audio/sfx/player";
import { SFX_SAMPLES } from "../audio/sfx/samples";

const BASE = import.meta.env.BASE_URL;

describe("公共资源的地址", () => {
  const zone = SAMPLE_SETS["vn.sus"].zones[0];
  const sfxFile = SFX_SAMPLES["ui.click"].files[0];

  it("采样与音效带原来的短哈希，图片带统一的版本号", () => {
    expect(sampleUrl(zone.file)).toBe(`${BASE}audio/orchestra/${zone.file}?v=${zone.hash}`);
    expect(sfxUrl(sfxFile)).toBe(`${BASE}audio/sfx/${sfxFile.file}?v=${sfxFile.hash}`);
    expect(publicImage("scenes/harbor_eu.webp")).toBe(withVersion(`${BASE}scenes/harbor_eu.webp`));
    expect(portraitFile("captain-00.webp")).toBe(withVersion(`${BASE}portraits/captain-00.webp`));
  });
});

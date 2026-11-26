import { describe, expect, it } from "vitest";
import { P } from "../art/palette";
import { Px, rgba } from "../art/px";
import { extendSky } from "./extend";

describe("向上延伸天空", () => {
  it("街景贴底，上方逐列接着街景最上一行的颜色，越往上越多深色天空", () => {
    const scene = new Px(8, 4).fill("#6f95d6").rect(0, 3, 8, 1, "#3a7d3a");
    const tall = extendSky(scene, 24);
    expect([tall.w, tall.h]).toEqual([8, 24]);
    // 底部就是原街景
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) expect(tall.get(x, 20 + y)).toBe(scene.get(x, y));
    // 延伸部分只有两种颜色：街景顶行色与深天色；最上面几行深色更多
    const deep = rgba(P.sky[0]);
    const top = rgba("#6f95d6");
    const count = (y: number) => [...Array(8).keys()].filter((x) => tall.get(x, y) === deep).length;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) expect([deep, top]).toContain(tall.get(x, y));
    expect(count(0)).toBeGreaterThan(count(10));
    expect(count(19)).toBe(0);
  });

  it("高度不超过街景时原样返回；尺寸合适的缓冲区被复用", () => {
    const scene = new Px(4, 4).fill("#fff");
    expect(extendSky(scene, 4)).toBe(scene);
    const buf = new Px(4, 10);
    expect(extendSky(scene, 10, buf)).toBe(buf);
  });
});

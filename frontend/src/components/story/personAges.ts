// FIX5F：人物的年纪（取立绘用）。人物视图（persons，cast_view.rs 的 relation_card）给每位认识的人 age（按当下的世界日期算，
// 没有生年时为 0；主角自己与还不认识的人不在里面）。这里每到新的一年问一次、记下来，取立绘时照它推年纪；
// 要取的人不在表里（刚认识）时，这一年里为这个人再问一次。问不到（模块没开、旧后端、还没回来）时为空，
// 取立绘的地方退回原来的办法（同龄人按年份推、别的人取最早的一张）。
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "../../ipc/api";

interface PersonAges {
  /** 这份年纪是哪一年问的（世界年份）；没问过为 null */
  year: number | null;
  /** 人物键 → 那一年的年纪（只记大于 0 的） */
  ages: Readonly<Record<string, number>>;
}

export const usePersonAgeStore = create<PersonAges>(() => ({ year: null, ages: {} }));

let inflight: Promise<void> | null = null;
/** 这一年里已经为谁补问过（不在表里的人每年只补问一次） */
let retried = { year: null as number | null, keys: new Set<string>() };

function fetchAges(year: number): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .persons()
    .then((r) => {
      const ages: Record<string, number> = {};
      for (const p of r?.persons ?? []) if (typeof p.age === "number" && p.age > 0) ages[p.key] = p.age;
      usePersonAgeStore.setState({ year, ages });
    })
    .catch(() => {
      if (usePersonAgeStore.getState().year !== year) usePersonAgeStore.setState({ year, ages: {} });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 这一年还没问过就问一次；给了 person 而表里没有他时，这一年为他补问一次。 */
export function ensurePersonAges(year: number | undefined, person?: string | null): void {
  if (year === undefined) return;
  const s = usePersonAgeStore.getState();
  if (s.year !== year) {
    void fetchAges(year);
    return;
  }
  if (!person || s.ages[person] !== undefined) return;
  if (retried.year !== year) retried = { year, keys: new Set() };
  if (retried.keys.has(person)) return;
  retried.keys.add(person);
  void fetchAges(year);
}

/** 这个人在 year 这一年几岁（人物视图给过的才有；问的那年与 year 不同时按差的年数推）。 */
export function knownAge(person: string, year: number | undefined): number | undefined {
  const s = usePersonAgeStore.getState();
  const age = s.ages[person];
  if (age === undefined) return undefined;
  if (year === undefined || s.year === null) return age;
  return Math.max(0, age + (year - s.year));
}

/** 取立绘的组件里用：这一年的年纪表（换年、换了不在表里的人时去问；回来后重渲染）。返回值只用来触发重渲染。 */
export function usePersonAges(year: number | undefined, person?: string | null): Readonly<Record<string, number>> {
  const ages = usePersonAgeStore((s) => s.ages);
  const askedYear = usePersonAgeStore((s) => s.year);
  useEffect(() => ensurePersonAges(year, person), [year, person, askedYear]);
  return ages;
}

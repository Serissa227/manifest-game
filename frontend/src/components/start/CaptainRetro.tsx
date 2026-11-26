// 补建身世（旧存档）：没有主角档案的存档可以补立一次——生日 → 身世五问 → 属性 → 确认，提交 CreateCaptain。
// 开局效果不再发放（内核只在第 0 天发放），汇总里也不列。窗口沿用标题画面的羊皮纸与木框。
import { useEffect, useId, useState } from "react";
import { DEFAULT_START_YEAR, t } from "../../i18n";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { Kbd } from "../feedback";
import CaptainCard from "./CaptainCard";
import { AttributesStep, BackgroundStep, BirthdayStep, DraftSummary, Stepper } from "./CaptainSteps";
import { useCaptainDraft } from "./useCaptainDraft";
import { useWizardNav } from "./useWizardNav";
import { answersOk, birthdayOk, creationOf, optionOf, type StepKey } from "./wizard";
import { windowSkin } from "./windowSkin";

const STEPS: StepKey[] = ["birthday", "background", "attrs", "confirm"];

export default function CaptainRetro({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("day", "captain");
  const submitCommand = useGame((s) => s.submit);
  const defs = statics?.captain ?? null;
  const draftApi = useCaptainDraft(defs, overview?.day ?? 0);
  const [busy, setBusy] = useState(false);
  const [style] = useState(windowSkin);
  const v2 = useIsV2();
  const startYear = statics?.world?.start_year ?? DEFAULT_START_YEAR;
  const ready = (step: StepKey): boolean => {
    if (!defs) return false;
    if (step === "birthday") return birthdayOk(defs, draftApi.draft);
    if (step === "background") return answersOk(defs, draftApi.draft.answers);
    if (step === "attrs") return draftApi.left === 0;
    return true;
  };
  const nav = useWizardNav({
    steps: STEPS,
    questions: defs?.questions.length ?? 0,
    ready,
    answered: (q) => !!defs && optionOf(defs, q, draftApi.draft.answers[q]) !== undefined,
  });

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!defs || !overview) return null;
  const name = overview.captain?.name?.trim() || t("shellCaptainDefault");
  const look = overview.captain?.portrait ?? 0;
  const creation = creationOf(defs, draftApi.draft, startYear);
  const pos = nav.pos;
  const heading =
    pos.step === "birthday"
      ? t("cap.head.birthday")
      : pos.step === "background"
        ? (defs.questions[pos.q]?.title ?? t("cap.step.background"))
        : pos.step === "attrs"
          ? t("cap.head.attrs")
          : t("cap.head.confirm");

  const commit = async () => {
    if (!creation || busy) return;
    setBusy(true);
    const r = await submitCommand({ CreateCaptain: { owner: "player", ...creation } });
    setBusy(false);
    if (r) {
      useGame.getState().notify(t("cap.retro.done"));
      onClose();
    }
  };

  return (
    <div className="cw-retro-backdrop" style={style}>
      <section className="ts-window cw-retro" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
        <div className="ts-plaque">
          <h2 id={`${uid}-title`}>{t("cap.retro.title")}</h2>
        </div>
        <form
          className="ts-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (nav.isLast) void commit();
            else nav.next();
          }}
        >
          <Stepper steps={STEPS} nav={nav} />
          <div className="ts-body">
            <div className="cw-layout">
              <section className="cw-main" aria-labelledby={`${uid}-step`}>
                <p className="ts-lead">{t("cap.retro.lead", { name })}</p>
                <h3 id={`${uid}-step`} className="ts-heading">
                  {heading}
                </h3>
                {pos.step === "birthday" && <BirthdayStep api={draftApi} startYear={startYear} era={statics?.world?.era} />}
                {pos.step === "background" && <BackgroundStep key={pos.q} api={draftApi} qi={pos.q} statics={statics} />}
                {pos.step === "attrs" && <AttributesStep api={draftApi} />}
                {pos.step === "confirm" && (
                  <DraftSummary api={draftApi} statics={statics} startYear={startYear} withEffects={false} onEdit={nav.goTo} />
                )}
              </section>
              <CaptainCard
                defs={defs}
                data={{
                  name,
                  look,
                  birthday: { month: draftApi.draft.month, day: draftApi.draft.day, age: draftApi.draft.age },
                  answers: draftApi.draft.answers,
                  attrs: draftApi.attrs,
                  alloc: draftApi.alloc,
                  methods: draftApi.method ? [draftApi.method] : [],
                }}
                foldable={v2}
              />
            </div>
          </div>
          <footer className="ts-launch">
            <div className="ts-launch-row">
              <button type="button" className="ts-btn" onClick={onClose}>
                {t("cancel")}
                {/* 新界面：按钮旁写出快捷键（Esc 关闭，见上面的 keydown）；旧界面与触屏不显示 */}
                <Kbd k="Esc" />
              </button>
              <div className="cw-nav">
                <button type="button" className="ts-btn" onClick={nav.prev} disabled={nav.index === 0 && pos.q === 0}>
                  {t("cap.prev")}
                </button>
                {nav.isLast ? (
                  <button type="submit" className="ts-btn ts-btn-go" disabled={!creation || busy}>
                    {t("cap.retro.submit")}
                  </button>
                ) : (
                  <button type="submit" className="ts-btn ts-btn-next" disabled={!nav.canNext}>
                    {t("cap.next")}
                  </button>
                )}
              </div>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

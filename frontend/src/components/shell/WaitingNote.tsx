// 对话框里的操作迟迟没有回音时：过一会儿说一声“正在等候回音”，免得看起来像卡住了。
// 只在等着的时候渲染（{busy && <WaitingNote />}）：挂上时开始计时，回音到了就随对话框的状态一起消失。
import { useEffect, useState } from "react";
import { t } from "../../i18n";

/** 等这么久还没回音才出声（毫秒）：快的时候一闪而过的提示反而干扰。 */
export const WAIT_NOTE_MS = 700;

export function WaitingNote({ className }: { className?: string }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLate(true), WAIT_NOTE_MS);
    return () => clearTimeout(id);
  }, []);
  if (!late) return null;
  return (
    <p className={className ? `wait-note ${className}` : "wait-note"} role="status" data-testid="waiting-note">
      {t("waitingReply")}
    </p>
  );
}

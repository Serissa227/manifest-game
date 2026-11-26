// 旧档提示（契约 5：视图给 act_old_save = true）：本家已经换成行动制，但这是行动制以前的存档——养成照原来的方式走完。
// 挂在原来的养成画面顶上一条，点“知道了”收起（只在这一次打开里记住，不进设置与存档）。
import { useState } from "react";
import { ta } from "./actText";

export function ActOldSave() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <p className="ua-oldsave" role="status" data-testid="ua-old-save">
      <span>{ta("old.save")}</span>
      <button type="button" className="ts-btn ts-btn-small" onClick={() => setHidden(true)}>
        {ta("old.dismiss")}
      </button>
    </p>
  );
}

// 测试 13：设置（模拟的 Tauri IPC）。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import SettingsPanel from "../components/panels/SettingsPanel";
import type { AppSettings } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, settingsView, startedGame } from "./fixtures";

const KEY = "sk-ui-test-7c21";

describe("设置", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc({
      set_api_key: () => ({ ...settingsView, keys: [["Anthropic", true], ["OpenAiCompatible", false]] }),
    });
    startedGame();
  });

  it("选择提供商与档位、保存密钥到凭据管理器、保存设置时不包含密钥", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    expect(await screen.findByText(/API 密钥（未设置）/)).toBeInTheDocument();
    expect(screen.getByText("当前构建未包含 Jev（需以 jev 特性编译）")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("AI 模式"), "Live");
    await user.selectOptions(screen.getByLabelText("模型档位"), "Quality");
    await user.selectOptions(screen.getByLabelText("模型提供商"), "OpenAiCompatible");
    await user.selectOptions(screen.getByLabelText("模型提供商"), "Anthropic");

    const key = screen.getByLabelText("API 密钥");
    expect(key).toHaveAttribute("type", "password");
    await user.type(key, KEY);
    await user.click(screen.getByRole("button", { name: "保存密钥" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_api_key", { provider: "Anthropic", key: KEY }));
    expect(await screen.findByText(/API 密钥（已保存在系统凭据管理器中）/)).toBeInTheDocument();
    expect(screen.getByLabelText("API 密钥")).toHaveValue("");

    const calls2 = screen.getByLabelText("每游戏月调用次数上限");
    await user.clear(calls2);
    await user.type(calls2, "30");
    await user.click(screen.getByLabelText("启用 Jev"));
    await user.click(screen.getByLabelText("开发模式（显示调试面板）"));
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.ai.mode).toBe("Live");
    expect(saved.ai.tier).toBe("Quality");
    expect(saved.ai.provider).toBe("Anthropic");
    expect(saved.ai.monthly_calls).toBe(30);
    expect(saved.ai.jev_enabled).toBe(true);
    expect(saved.dev_mode).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(useGame.getState().message).toBe("设置已保存");
  });

  it("抵达时自动暂停：后端有这一项时可以选（旗舰队 / 任何一支舰队 / 不暂停），保存时带上；旧后端没有时不显示", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SettingsPanel />);
    await screen.findByText(/API 密钥（未设置）/);
    expect(screen.queryByLabelText("抵达时自动暂停")).toBeNull();
    unmount();

    calls = installIpc({
      get_settings: () => ({ ...settingsView, settings: { ...settingsView.settings, arrival_pause: "flagship" } }),
    });
    render(<SettingsPanel />);
    const select = await screen.findByLabelText("抵达时自动暂停");
    expect(select).toHaveValue("flagship");
    expect(screen.getByRole("option", { name: "任何一支舰队抵达时" })).toBeInTheDocument();
    await user.selectOptions(select, "off");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("save_settings", expect.anything()));
    const saved = calls.mock.calls.find(([cmd]) => cmd === "save_settings")?.[1].settings as AppSettings;
    expect(saved.arrival_pause).toBe("off");
  });
});

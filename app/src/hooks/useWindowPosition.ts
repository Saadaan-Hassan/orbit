import { invoke } from "@tauri-apps/api/core";

export function useWindowPosition() {
  const positionWindow = async (
    mode: "collapsed" | "expanded" | "center"
  ): Promise<void> => {
    await invoke("position_window", { mode });
  };
  return { positionWindow };
}

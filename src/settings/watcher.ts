import { watch } from "node:fs";
import { getSettingsFilePath, loadSettings } from "./loader.ts";
import type { GlobalSettings } from "./types.ts";

export function watchSettings(
  memoryDir: string,
  callback: (settings: GlobalSettings) => void,
): () => void {
  const filePath = getSettingsFilePath(memoryDir);
  let timer: any = null;

  try {
    const watcher = watch(filePath, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const store = loadSettings(memoryDir);
          callback(store.global);
        } catch {}
      }, 100);
    });

    return () => {
      clearTimeout(timer);
      watcher.close();
    };
  } catch {
    return () => {};
  }
}

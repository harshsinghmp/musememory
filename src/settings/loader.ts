import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GlobalSettings, ProjectSettings, SettingsStore } from "./types.ts";
import { DEFAULT_SETTINGS, DEFAULT_SETTINGS_STORE } from "./defaults.ts";
import { validateSettings } from "./schema.ts";

export function getSettingsFilePath(memoryDir: string): string {
  return join(memoryDir, "settings.json");
}

export function loadSettings(memoryDir: string): SettingsStore {
  const filePath = getSettingsFilePath(memoryDir);
  if (!existsSync(filePath)) {
    return {
      version: 1,
      global: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      projects: {},
    };
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      global: { ...DEFAULT_SETTINGS, ...(parsed.global || {}) },
      projects: parsed.projects || {},
    };
  } catch {
    return {
      version: 1,
      global: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      projects: {},
    };
  }
}

export function saveSettings(store: SettingsStore, memoryDir: string): void {
  mkdirSync(memoryDir, { recursive: true });
  const filePath = getSettingsFilePath(memoryDir);
  writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function getSettings(memoryDir: string): GlobalSettings {
  return loadSettings(memoryDir).global;
}

export function setSettings(memoryDir: string, partial: Partial<GlobalSettings>): GlobalSettings {
  const check = validateSettings(partial);
  if (!check.valid) {
    throw new Error(`Invalid settings: ${check.errors.join("; ")}`);
  }

  const store = loadSettings(memoryDir);
  store.global = deepMerge(store.global, partial);
  saveSettings(store, memoryDir);
  return store.global;
}

export function getProjectSettings(memoryDir: string, project: string): ProjectSettings {
  const store = loadSettings(memoryDir);
  const proj = store.projects[project] ?? { project };
  return { ...store.global, ...proj, project };
}

export function setProjectSettings(
  memoryDir: string,
  project: string,
  partial: Partial<ProjectSettings>,
): ProjectSettings {
  const check = validateSettings(partial as Partial<GlobalSettings>);
  if (!check.valid) {
    throw new Error(`Invalid project settings: ${check.errors.join("; ")}`);
  }

  const store = loadSettings(memoryDir);
  const existing = store.projects[project] ?? { project };
  store.projects[project] = deepMerge(existing, partial);
  saveSettings(store, memoryDir);
  return store.projects[project];
}

export function resetSettings(memoryDir: string): GlobalSettings {
  const store = loadSettings(memoryDir);
  store.global = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  saveSettings(store, memoryDir);
  return store.global;
}

export function resetProjectSettings(memoryDir: string, project: string): void {
  const store = loadSettings(memoryDir);
  delete store.projects[project];
  saveSettings(store, memoryDir);
}

export function exportSettings(memoryDir: string): string {
  const store = loadSettings(memoryDir);
  return JSON.stringify(store, null, 2);
}

export function importSettings(memoryDir: string, json: string): SettingsStore {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid settings payload: expected object");
  }

  const store = loadSettings(memoryDir);
  if (parsed.global) {
    const check = validateSettings(parsed.global);
    if (!check.valid) {
      throw new Error(`Invalid global settings in import: ${check.errors.join("; ")}`);
    }
    store.global = deepMerge(store.global, parsed.global);
  }
  if (parsed.projects && typeof parsed.projects === "object") {
    store.projects = { ...store.projects, ...parsed.projects };
  }
  saveSettings(store, memoryDir);
  return store;
}

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sVal = (source as any)[key];
    const tVal = (target as any)[key];
    if (sVal !== undefined) {
      if (typeof sVal === "object" && sVal !== null && !Array.isArray(sVal) && typeof tVal === "object" && tVal !== null && !Array.isArray(tVal)) {
        (result as any)[key] = deepMerge(tVal, sVal);
      } else {
        (result as any)[key] = sVal;
      }
    }
  }
  return result;
}

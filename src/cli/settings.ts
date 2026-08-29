import { writeFileSync, readFileSync } from "node:fs";
import { requireRoot, type ParsedArgs } from "./shared.ts";
import {
  getSettings,
  setSettings,
  getProjectSettings,
  setProjectSettings,
  resetSettings,
  resetProjectSettings,
  exportSettings,
  importSettings,
} from "../settings.ts";

export function handleSettingsCommand(parsed: ParsedArgs): number {
  const ctx = requireRoot(parsed.flags);
  if (!ctx) return 1;
  const memoryDir = ctx.memoryDir;
  const sub = parsed.positional[0] ?? "get";
  const project = parsed.flags.project as string | undefined;

  if (sub === "get") {
    const key = parsed.positional[1];
    const settings = project ? getProjectSettings(memoryDir, project) : getSettings(memoryDir);

    if (key) {
      const parts = key.split(".");
      let val: any = settings;
      for (const p of parts) {
        val = val?.[p];
      }
      if (val === undefined) {
        console.error(`Error: setting key "${key}" not found.`);
        return 1;
      }
      console.log(typeof val === "object" ? JSON.stringify(val, null, 2) : val);
      return 0;
    }

    console.log(JSON.stringify(settings, null, 2));
    return 0;
  }

  if (sub === "set") {
    const key = parsed.positional[1];
    const rawVal = parsed.positional[2];

    if (!key || rawVal === undefined) {
      console.error("Error: please specify key and value (e.g. `memory settings set retrieval.defaultMode tree`)");
      return 2;
    }

    let parsedVal: any = rawVal;
    if (rawVal === "true") parsedVal = true;
    else if (rawVal === "false") parsedVal = false;
    else if (!isNaN(Number(rawVal)) && rawVal.trim() !== "") parsedVal = Number(rawVal);
    else {
      try {
        parsedVal = JSON.parse(rawVal);
      } catch {}
    }

    const parts = key.split(".");
    const updateObj: Record<string, any> = {};
    let cur = updateObj;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = parsedVal;

    try {
      if (project) {
        setProjectSettings(memoryDir, project, updateObj);
        console.log(`Updated project "${project}" settings: ${key} = ${JSON.stringify(parsedVal)}`);
      } else {
        setSettings(memoryDir, updateObj);
        console.log(`Updated global settings: ${key} = ${JSON.stringify(parsedVal)}`);
      }
      return 0;
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
  }

  if (sub === "reset") {
    if (project) {
      resetProjectSettings(memoryDir, project);
      console.log(`Reset settings for project "${project}".`);
    } else {
      resetSettings(memoryDir);
      console.log("Reset global settings to defaults.");
    }
    return 0;
  }

  if (sub === "export") {
    const out = parsed.flags.out as string | undefined;
    const json = exportSettings(memoryDir);
    if (out) {
      writeFileSync(out, json, "utf8");
      console.log(`Exported settings to ${out}`);
    } else {
      console.log(json);
    }
    return 0;
  }

  if (sub === "import") {
    const file = parsed.positional[1];
    if (!file) {
      console.error("Error: please specify a JSON file to import (e.g. `memory settings import team-settings.json`)");
      return 2;
    }
    try {
      const raw = readFileSync(file, "utf8");
      importSettings(memoryDir, raw);
      console.log(`Successfully imported settings from ${file}`);
      return 0;
    } catch (err: any) {
      console.error(`Error importing settings: ${err.message}`);
      return 1;
    }
  }

  console.error(`Error: unknown settings subcommand "${sub}". Supported: get, set, reset, export, import`);
  return 2;
}

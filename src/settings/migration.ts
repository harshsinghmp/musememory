import type { SettingsStore } from "./types.ts";

export interface SettingsMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (store: SettingsStore) => SettingsStore;
}

const SETTINGS_MIGRATIONS: SettingsMigration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    migrate: (store) => ({
      ...store,
      version: 2,
      global: {
        ...store.global,
        ui: {
          ...store.global.ui,
          graphEngine: store.global.ui.graphEngine || "auto",
        },
      },
    }),
  },
];











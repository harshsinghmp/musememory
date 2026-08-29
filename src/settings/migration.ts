import type { SettingsStore } from "./types.ts";

export interface SettingsMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (store: SettingsStore) => SettingsStore;
}

export const SETTINGS_MIGRATIONS: SettingsMigration[] = [
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

export function migrateSettingsStore(store: SettingsStore): SettingsStore {
  let current = store;
  for (const m of SETTINGS_MIGRATIONS) {
    if (current.version === m.fromVersion) {
      current = m.migrate(current);
    }
  }
  return current;
}

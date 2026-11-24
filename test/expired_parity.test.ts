import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, openStore, propose, save } from "../src/store.ts";
import { isExpired } from "../src/retrieval.ts";
import { resolveMemoriesForCode } from "../src/retrieval/code_context.ts";

/**
 * #441: two `isExpired` predicates disagreed.
 *
 * `src/retrieval.ts` (canonical) expires on `status === "expired"` or a past
 * `expires_at`. `src/retrieval/code_context.ts` expired on a past `valid_to` or
 * a past `expires_at` and never looked at `status` — so code-context recall
 * served memories every other read path treats as expired, and withheld
 * `confirmed` memories whose historical `valid_to` had passed. One shared table
 * pins that both paths now agree on all three shapes.
 */
describe("#441: retrieval and code-context agree on expiry", () => {
  const now = Date.now();
  const past = new Date(now - 86_400_000).toISOString();
  const future = new Date(now + 86_400_000).toISOString();

  interface Shape {
    name: string;
    patch: Record<string, unknown>;
    expired: boolean;
  }

  // `expired` is the documented contract (`expires_at` + `status: "expired"`),
  // not a restatement of either old predicate: `valid_to` is valid-time, not
  // expiry, so a confirmed entry whose valid window closed is NOT expired.
  const shapes: Shape[] = [
    { name: 'status: "expired" with no timestamps', patch: { status: "expired" }, expired: true },
    {
      name: "confirmed with a past valid_to",
      patch: { status: "confirmed", valid_to: past, valid_to_exact: true },
      expired: false,
    },
    { name: "confirmed with a past expires_at", patch: { status: "confirmed", expires_at: past }, expired: true },
  ];

  for (const shape of shapes) {
    test(`${shape.name} — both paths agree`, () => {
      const memoryDir = mkdtempSync(join(tmpdir(), "muse-expiry-"));
      try {
        const store = openStore(memoryDir);
        const entry = propose(store, {
          content: `expiry probe: ${shape.name}`,
          project: "p",
          type: "constraint",
          confirmed: true,
        });
        save(store, {
          ...entry,
          status: (shape.patch.status as typeof entry.status) ?? entry.status,
          expires_at: shape.patch.expires_at as string | undefined,
          valid_to: shape.patch.valid_to as string | undefined,
          valid_to_exact: shape.patch.valid_to_exact as boolean | undefined,
          anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts" }],
        });

        const live = get(store, entry.id);
        if (!live) throw new Error(`memory ${entry.id} vanished after save`);
        expect(isExpired(live, now)).toBe(shape.expired);

        // The code-context recall path (enforceFreshness defaults to on) must
        // withhold exactly what the canonical predicate calls expired. This is
        // the assertion that fails while code_context.ts carries its own copy.
        const served = resolveMemoriesForCode(store, {
          files: ["src/auth.ts"],
          project: "p",
          enforceFreshness: true,
        });
        expect(served.some((item) => item.entry.id === entry.id)).toBe(!shape.expired);
      } finally {
        rmSync(memoryDir, { recursive: true, force: true });
      }
    });
  }

  test("a future expires_at is expired on neither path", () => {
    const memoryDir = mkdtempSync(join(tmpdir(), "muse-expiry-"));
    try {
      const store = openStore(memoryDir);
      const entry = propose(store, { content: "still valid", project: "p", type: "constraint", confirmed: true });
      save(store, { ...entry, expires_at: future, anchors: [{ id: "a1", kind: "file", file_path: "src/auth.ts" }] });

      const live = get(store, entry.id);
      if (!live) throw new Error(`memory ${entry.id} vanished after save`);
      expect(isExpired(live, now)).toBe(false);
      const served = resolveMemoriesForCode(store, { files: ["src/auth.ts"], project: "p", enforceFreshness: true });
      expect(served.map((item) => item.entry.id)).toContain(entry.id);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openStore,
  propose,
  get,
  fileForId,
  isTombstoned,
  change,
  end,
  correct,
  revert,
  forget,
  type Store,
} from "../src/store.ts";
import { queryContext, queryAsOf } from "../src/retrieval.ts";

describe("T-084: Five-verb lifecycle (change, end, correct, revert, forget)", () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "muse-lifecycle-"));
    store = openStore(tmpDir);
  });

  afterEach(() => {
    store.db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Verb 1: change", () => {
    test("supersedes old entry with new confirmed entry and stamps bi-temporal closeout", () => {
      const old = propose(store, {
        content: "Database port is 5432",
        project: "infra",
        confirmed: true,
      });

      const result = change(store, old.id, {
        content: "Database port is 6432",
        project: "infra",
      }, {
        reason: "Port conflict migration",
        valid_to_exact: true,
      });

      expect(result).not.toBeNull();
      const updatedOld = get(store, old.id)!;
      const next = get(store, result!.next.id)!;

      expect(updatedOld.status).toBe("superseded");
      expect(updatedOld.valid_to).toBeDefined();
      expect(updatedOld.valid_to_exact).toBe(true);
      expect(updatedOld.superseded_by).toContain(next.id);

      expect(next.status).toBe("confirmed");
      expect(next.content).toBe("Database port is 6432");
      expect(next.supersedes).toContain(old.id);
    });

    test("changes using an existing proposed memory id", () => {
      const old = propose(store, {
        content: "Auth protocol: OAuth 1.0",
        project: "auth",
        confirmed: true,
      });
      const replacement = propose(store, {
        content: "Auth protocol: OAuth 2.1",
        project: "auth",
        confirmed: false,
      });

      const res = change(store, old.id, replacement.id);
      expect(res).not.toBeNull();
      expect(get(store, replacement.id)?.status).toBe("confirmed");
      expect(get(store, old.id)?.status).toBe("superseded");
    });
  });

  describe("Verb 2: end", () => {
    test("marks fact as stale with ended_at and valid_to", () => {
      const entry = propose(store, {
        content: "Temporary promotional discount active",
        project: "billing",
        confirmed: true,
      });

      const ended = end(store, entry.id, {
        reason: "Promotion expired",
        valid_to_exact: true,
      });

      expect(ended).not.toBeNull();
      const reloaded = get(store, entry.id)!;
      expect(reloaded.status).toBe("stale");
      expect(reloaded.ended_at).toBeDefined();
      expect(reloaded.valid_to).toBeDefined();
      expect(reloaded.valid_to_exact).toBe(true);
      expect(reloaded.content).toContain("Ended: Promotion expired");

      // Verify query with confirmed status or as_of post-end excludes ended memory
      const recallConfirmed = queryContext(store, "promotional discount", { status: "confirmed" });
      expect(recallConfirmed.results.map((r) => r.entry.id)).not.toContain(entry.id);

      const asOfPostEnd = queryAsOf(store, "promotional discount", "2027-01-01T00:00:00.000Z");
      expect(asOfPostEnd.results.map((r) => r.entry.id)).not.toContain(entry.id);
    });
  });

  describe("Verb 3: correct", () => {
    test("amends mistaken belief without date closeout or continuity gap", () => {
      const entry = propose(store, {
        content: "AWS region is us-east-2",
        title: "Primary Region",
        project: "infra",
        confirmed: true,
      });

      const corrected = correct(store, entry.id, "AWS region is actually us-east-1 (typo in original spec)", {
        reason: "Corrected transcription error",
      });

      expect(corrected).not.toBeNull();
      const reloaded = get(store, entry.id)!;
      expect(reloaded.content).toBe("AWS region is actually us-east-1 (typo in original spec)");
      expect(reloaded.corrected_at).toBeDefined();
      expect(reloaded.correction_reason).toBe("Corrected transcription error");
      // Must NOT set valid_to: it was never valid as us-east-2 historically
      expect(reloaded.valid_to).toBeUndefined();
      expect(reloaded.status).toBe("confirmed");
    });

    test("corrects structured payload (title, tags, salience)", () => {
      const entry = propose(store, {
        content: "Kafka cluster size: 3",
        project: "data",
      });

      correct(store, entry.id, {
        content: "Kafka cluster size: 5 brokers",
        title: "Kafka Cluster Config",
        tags: ["kafka", "sizing"],
        salience: 0.9,
      });

      const reloaded = get(store, entry.id)!;
      expect(reloaded.content).toBe("Kafka cluster size: 5 brokers");
      expect(reloaded.title).toBe("Kafka Cluster Config");
      expect(reloaded.tags).toEqual(["kafka", "sizing"]);
      expect(reloaded.salience).toBe(0.9);
    });
  });

  describe("Verb 4: revert", () => {
    test("restores superseded memory back to confirmed active state and clears closeout", () => {
      const v1 = propose(store, {
        content: "Rate limiter: Token Bucket",
        project: "api",
        confirmed: true,
      });
      const v2 = propose(store, {
        content: "Rate limiter: Leaky Bucket",
        project: "api",
        confirmed: true,
      });

      change(store, v1.id, v2.id);
      expect(get(store, v1.id)?.status).toBe("superseded");
      expect(get(store, v1.id)?.valid_to).toBeDefined();

      // Revert v1 back to active
      const reverted = revert(store, v1.id, { reason: "Rolling back Leaky Bucket due to latency spikes" });
      expect(reverted).not.toBeNull();

      const reloadedV1 = get(store, v1.id)!;
      expect(reloadedV1.status).toBe("confirmed");
      expect(reloadedV1.valid_to).toBeUndefined();
      expect(reloadedV1.valid_to_exact).toBeUndefined();
      expect(reloadedV1.reverted_at).toBeDefined();

      // Incoming supersession reference on v2 should be unlinked
      const reloadedV2 = get(store, v2.id)!;
      expect(reloadedV2.supersedes).toBeNull();

      // Reverted memory is now returned in recall
      const recall = queryContext(store, "Rate limiter");
      expect(recall.results.map((r) => r.entry.id)).toContain(v1.id);
    });
  });

  describe("Verb 5: forget", () => {
    test("soft forget tombstones memory, evicting from recall while keeping audit trail", () => {
      const entry = propose(store, {
        content: "User requested deletion of private note",
        project: "privacy",
        confirmed: true,
      });

      const ok = forget(store, entry.id, { reason: "GDPR right to be forgotten" });
      expect(ok).toBe(true);

      expect(isTombstoned(store, entry.id)).toBe(true);
      const recall = queryContext(store, "private note");
      expect(recall.results.map((r) => r.entry.id)).not.toContain(entry.id);
    });

    test("hard forget completely excises memory file and database record", () => {
      const entry = propose(store, {
        content: "Ephemeral test scratchpad",
        project: "test",
      });
      const filePath = fileForId(store, entry.id);
      expect(existsSync(filePath)).toBe(true);

      const ok = forget(store, entry.id, { hard: true, reason: "Hard purge requested" });
      expect(ok).toBe(true);

      expect(existsSync(filePath)).toBe(false);
      expect(get(store, entry.id)).toBeNull();
    });
  });
});

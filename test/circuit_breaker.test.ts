import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CircuitBreaker } from "../src/circuit.ts";
import { openStore, propose, get, list } from "../src/store.ts";

describe("T-055: store circuit breaker and graceful degradation", () => {
  test("5 consecutive failures trip the breaker to open state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 120000 });
    expect(cb.getState()).toBe("closed");
    expect(cb.isDegraded()).toBe(false);

    for (let i = 0; i < 4; i++) {
      cb.recordFailure(new Error(`Failure ${i + 1}`));
      expect(cb.getState()).toBe("closed");
    }

    // 5th failure trips the breaker
    cb.recordFailure(new Error("5th failure"));
    expect(cb.getState()).toBe("open");
    expect(cb.isDegraded()).toBe(true);

    // Success resets the breaker
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isDegraded()).toBe(false);
  });

  test("cooldown expiration transitions from open to half-open", async () => {
    // 50ms cooldown for fast testing
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 50 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe("half-open");

    // Success in half-open closes the circuit
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  test("tripped store circuit breaker enters degraded mode returning cache instead of stalling", () => {
    const dir = mkdtempSync(join(tmpdir(), "cb-store-test-"));
    const memoryDir = join(dir, ".memory");
    const store = openStore(memoryDir);

    const memory = propose(store, {
      title: "Essential principle",
      content: "Never expose secrets in logs.",
      project: "vibeguard",
    });

    // Populate L0 cache
    const initial = get(store, memory.id);
    expect(initial?.title).toBe("Essential principle");

    // Trip circuit breaker manually
    store.circuit?.trip();
    expect(store.circuit?.isDegraded()).toBe(true);

    // Read should still return cached entry in degraded mode without throwing
    const degradedGet = get(store, memory.id);
    expect(degradedGet?.id).toBe(memory.id);

    // Reset circuit breaker
    store.circuit?.reset();
    expect(store.circuit?.isDegraded()).toBe(false);

    store.db?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

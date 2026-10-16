export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold?: number; // default 5 consecutive failures
  cooldownMs?: number; // default 120s (120,000ms)
}

/**
 * T-055: Circuit breaker protecting store read/write paths.
 * 5 consecutive failures trip the breaker into 'open' (degraded mode) for 120s cooldown.
 * In degraded mode, read paths degrade gracefully rather than hanging turns or throwing crashes.
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: CircuitState = "closed";
  public readonly failureThreshold: number;
  public readonly cooldownMs: number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.cooldownMs = config.cooldownMs ?? 120000;
  }

  public getState(): CircuitState {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = "half-open";
      }
    }
    return this.state;
  }

  public isDegraded(): boolean {
    return this.getState() === "open";
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
  }

  public recordFailure(err?: unknown): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  public reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = "closed";
  }

  public trip(): void {
    this.failureCount = this.failureThreshold;
    this.lastFailureTime = Date.now();
    this.state = "open";
  }

  public execute<T>(fn: () => T, fallback: () => T): T {
    if (this.getState() === "open") {
      return fallback();
    }
    try {
      const result = fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      if (this.getState() === "open") {
        return fallback();
      }
      throw err;
    }
  }

  public async executeAsync<T>(fn: () => Promise<T>, fallback: () => Promise<T> | T): Promise<T> {
    if (this.getState() === "open") {
      return await fallback();
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      if (this.getState() === "open") {
        return await fallback();
      }
      throw err;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getStoreCircuitBreaker(key = "default", config?: CircuitBreakerConfig): CircuitBreaker {
  let cb = breakers.get(key);
  if (!cb) {
    cb = new CircuitBreaker(config);
    breakers.set(key, cb);
  }
  return cb;
}

export function resetAllCircuitBreakers(): void {
  for (const cb of breakers.values()) {
    cb.reset();
  }
  breakers.clear();
}

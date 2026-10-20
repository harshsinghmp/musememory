import { describe, test, expect } from "bun:test";
import { parseFlags } from "../src/cli/shared.ts";

describe("T-354: CLI Argument Parsing Hardening", () => {
  test("preserves values with equal signs in --key=val=with=equals", () => {
    const res = parseFlags(["--filter=type=fix", "--config=a=b=c"]);
    expect(res.flags["filter"]).toBe("type=fix");
    expect(res.flags["config"]).toBe("a=b=c");
    expect(res.positional).toEqual([]);
  });

  test("handles negative numeric values without treating them as flag names", () => {
    const res = parseFlags(["--limit", "-1", "-n", "-10", "--offset", "-2.5"]);
    expect(res.flags["limit"]).toBe("-1");
    expect(res.flags["n"]).toBe("-10");
    expect(res.flags["offset"]).toBe("-2.5");
  });

  test("parses standalone negative numbers as positional arguments", () => {
    const res = parseFlags(["calculate", "-42", "-100"]);
    expect(res.positional).toEqual(["calculate", "-42", "-100"]);
    expect(Object.keys(res.flags).length).toBe(0);
  });

  test("treats all tokens after -- terminator as positional arguments", () => {
    const res = parseFlags(["command", "--flag", "val", "--", "--not-a-flag", "-x", "plain"]);
    expect(res.flags["flag"]).toBe("val");
    expect(res.flags["not-a-flag"]).toBeUndefined();
    expect(res.positional).toEqual(["command", "--not-a-flag", "-x", "plain"]);
  });

  test("handles empty and standard boolean flags correctly", () => {
    const res = parseFlags(["--verbose", "-v", "target-dir"]);
    expect(res.flags["verbose"]).toBe("true");
    expect(res.flags["v"]).toBe("target-dir");
  });
});

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { Socket } from "node:net";
import { execSync } from "node:child_process";
import { detectAgents } from "../agents/detect.ts";
import { findOrCreateProjectRoot } from "../root.ts";
import type { ParsedArgs } from "../cli/shared.ts";

export interface SystemTerrainHost {
  platform: string;
  arch: string;
  hostname: string;
  release: string;
  cpus: {
    model: string;
    speed: number;
    count: number;
  };
  totalMemoryGb: number;
  freeMemoryGb: number;
  uptimeHours: number;
}

export interface SystemTerrainToolchains {
  bunVersion?: string;
  nodeVersion?: string;
  gitVersion?: string;
  cargoVersion?: string;
  pythonVersion?: string;
  dockerAvailable?: boolean;
}

export interface SystemTerrainPort {
  port: number;
  service: string;
  listening: boolean;
}

export interface SystemTerrainEcosystem {
  activePorts: SystemTerrainPort[];
  detectedAgents: string[];
}

export interface SystemTerrain {
  timestamp: string;
  host: SystemTerrainHost;
  toolchains: SystemTerrainToolchains;
  agentEcosystem: SystemTerrainEcosystem;
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(100);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

function runCommandSafe(cmd: string): string | undefined {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 1500 });
    return out.toString("utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Collect complete machine & system terrain.
 */
export async function collectSystemTerrain(): Promise<SystemTerrain> {
  const cpus = os.cpus() || [];
  const firstCpu = cpus[0] || { model: "Unknown", speed: 0 };

  const host: SystemTerrainHost = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    release: os.release(),
    cpus: {
      model: firstCpu.model,
      speed: firstCpu.speed,
      count: cpus.length,
    },
    totalMemoryGb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100,
    freeMemoryGb: Math.round((os.freemem() / 1024 / 1024 / 1024) * 100) / 100,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
  };

  const toolchains: SystemTerrainToolchains = {
    bunVersion: (process.versions as any).bun || runCommandSafe("bun --version"),
    nodeVersion: process.versions.node || runCommandSafe("node --version"),
    gitVersion: runCommandSafe("git --version")?.replace(/^git version\s*/, ""),
    cargoVersion: runCommandSafe("cargo --version")?.replace(/^cargo\s*/, ""),
    pythonVersion: runCommandSafe("python3 --version")?.replace(/^Python\s*/, ""),
    dockerAvailable: Boolean(runCommandSafe("docker --version")),
  };

  // Common agent daemon ports to probe
  const knownServices: { port: number; name: string }[] = [
    { port: 2222, name: "Muse Memory Studio" },
    { port: 31337, name: "Pulse Dashboard" },
    { port: 3600, name: "Ryoku Rashin Hub" },
    { port: 7878, name: "Muse Daemon SSE" },
    { port: 11434, name: "Ollama Local LLM" },
    { port: 8000, name: "Local AI Endpoint" },
  ];

  const probedPorts = await Promise.all(
    knownServices.map(async (svc) => {
      const listening = await probePort(svc.port);
      return { port: svc.port, service: svc.name, listening };
    }),
  );

  let installedAgents: string[] = [];
  try {
    const detected = detectAgents();
    installedAgents = detected.filter((a) => a.installed).map((a) => a.name);
  } catch {
    installedAgents = ["antigravity", "opencode", "claude-code"];
  }

  return {
    timestamp: new Date().toISOString(),
    host,
    toolchains,
    agentEcosystem: {
      activePorts: probedPorts.filter((p) => p.listening),
      detectedAgents: installedAgents,
    },
  };
}

/**
 * Format system terrain into token-efficient markdown.
 */
export function formatSystemTerrainMarkdown(terrain: SystemTerrain): string {
  const { host, toolchains, agentEcosystem } = terrain;

  const lines: string[] = [
    `# Machine & System Terrain`,
    `> Deterministic hardware, runtime toolchains, and agent ecosystem map.`,
    `> Collected at: \`${terrain.timestamp}\``,
    ``,
    `## 🖥️ Host & Hardware`,
    `| Property | Value |`,
    `| --- | --- |`,
    `| **OS / Platform** | \`${host.platform}\` (${host.release}) |`,
    `| **Architecture** | \`${host.arch}\` |`,
    `| **Hostname** | \`${host.hostname}\` |`,
    `| **CPU Model** | ${host.cpus.model} |`,
    `| **CPU Cores** | ${host.cpus.count} cores @ ${host.cpus.speed} MHz |`,
    `| **Memory (RAM)** | ${host.freeMemoryGb} GB free / ${host.totalMemoryGb} GB total |`,
    `| **Host Uptime** | ${host.uptimeHours} hours |`,
    ``,
    `## 🛠️ Toolchains & Runtimes`,
    `| Runtime / Tool | Version / Status |`,
    `| --- | --- |`,
    `| **Bun Runtime** | \`${toolchains.bunVersion || "Not Found"}\` |`,
    `| **Node.js** | \`${toolchains.nodeVersion || "Not Found"}\` |`,
    `| **Git CLI** | \`${toolchains.gitVersion || "Not Found"}\` |`,
    `| **Cargo (Rust)** | \`${toolchains.cargoVersion || "Not Found"}\` |`,
    `| **Python 3** | \`${toolchains.pythonVersion || "Not Found"}\` |`,
    `| **Docker Engine** | \`${toolchains.dockerAvailable ? "Available" : "Unavailable"}\` |`,
    ``,
    `## 🤖 Agent Ecosystem`,
    `### Installed Coding Agents (${agentEcosystem.detectedAgents.length})`,
    agentEcosystem.detectedAgents.length > 0
      ? agentEcosystem.detectedAgents.map((a) => `- \`${a}\``).join("\n")
      : `_No recognized agent platforms installed._`,
    ``,
    `### Active Local Agent Ports`,
  ];

  if (agentEcosystem.activePorts.length > 0) {
    lines.push(`| Port | Service | Status |`);
    lines.push(`| --- | --- | --- |`);
    for (const p of agentEcosystem.activePorts) {
      lines.push(`| \`:${p.port}\` | ${p.service} | 🟢 Active |`);
    }
  } else {
    lines.push(`_No common agent daemons actively listening._`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by Muse Vault System Collector.*`);

  return lines.join("\n");
}

/**
 * Write system terrain map to `.memory/vault/system.md`.
 */
export async function writeSystemTerrainMap(targetVaultDir: string): Promise<string> {
  if (!existsSync(targetVaultDir)) {
    mkdirSync(targetVaultDir, { recursive: true });
  }

  const terrain = await collectSystemTerrain();
  const md = formatSystemTerrainMarkdown(terrain);
  const targetFile = join(targetVaultDir, "system.md");
  writeFileSync(targetFile, md, "utf8");

  return targetFile;
}

/**
 * CLI Handler for `memory terrain` / `muse terrain`.
 */
export async function handleTerrainCommand(args: ParsedArgs): Promise<number> {
  const silent = Boolean(args.flags.silent);
  const outFile = args.flags.out;
  const projectRootInfo = findOrCreateProjectRoot(process.cwd());
  const defaultVaultDir = join(projectRootInfo.memoryDir, "vault");

  const terrain = await collectSystemTerrain();
  const markdown = formatSystemTerrainMarkdown(terrain);

  if (outFile) {
    writeFileSync(outFile, markdown, "utf8");
    if (!silent) {
      console.log(`\n🗺️ Machine terrain written to: ${outFile}`);
    }
    return 0;
  }

  // Auto-write to vault
  try {
    const savedPath = await writeSystemTerrainMap(defaultVaultDir);
    if (!silent) {
      console.log(`\n🗺️ Machine terrain compiled to: ${savedPath}\n`);
      console.log(markdown);
    }
    return 0;
  } catch (err: any) {
    if (!silent) {
      console.error(`\n❌ Failed to write terrain map: ${err.message}`);
    }
    return 1;
  }
}

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { generateAttestationKeypair, keyIdFromPublicKey, signPacket, verifyAttestation, verifyAttestationChain, type Attestation } from "../sync/attestation.ts";
import { recordAuditEvent } from "../audit.ts";

export async function handleAttestCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];

  switch (sub) {
    case "keygen": {
      const out = flags["out"] ?? join(homedir(), ".config", "musememory", "keys");
      mkdirSync(out, { recursive: true, mode: 0o700 });
      const keyPath = join(out, "attestation.key");
      if (existsSync(keyPath) && flags["force"] === undefined) {
        return usageError(`${keyPath} exists; pass --force to rotate (old attestations will not verify)`);
      }
      const pair = generateAttestationKeypair();
      writeFileSync(keyPath, pair.privateKey, { encoding: "utf8", mode: 0o600, flag: "w" });
      writeFileSync(join(out, "attestation.pub"), pair.publicKey, { encoding: "utf8", mode: 0o644 });
      try { chmodSync(keyPath, 0o600); } catch {}
      recordAuditEvent(ctx.memoryDir, {
        operation: "attest_keygen",
        entry_id: "attestation",
        actor: "cli",
        reason: "attestation_keygen",
        details: { path: keyPath, rotated: flags["force"] !== undefined },
      });
      console.log(`wrote ${keyPath} and attestation.pub (key id ${keyIdFromPublicKey(pair.publicKey)})`);
      return 0;
    }
    case "sign": {
      const packetPath = positional[1];
      const keyPath = flags["key"];
      if (!packetPath || !keyPath) return usageError("attest sign <packet.json> --key <private.pem>");
      const packet = JSON.parse(readFileSync(packetPath, "utf8"));
      const previous = flags["previous"] ? (JSON.parse(readFileSync(flags["previous"], "utf8")) as Attestation) : undefined;
      const attestation = signPacket(packet, readFileSync(keyPath, "utf8"), {
        signer: flags["signer"],
        previous,
        head: flags["head"] !== undefined,
        audience: flags["audience"],
      });
      recordAuditEvent(ctx.memoryDir, {
        operation: "attest_sign",
        entry_id: "attestation",
        actor: "cli",
        reason: "packet_signed",
        details: { packet_hash: attestation.packet_hash, signer: attestation.signer },
      });
      console.log(JSON.stringify(attestation, null, 2));
      return 0;
    }
    case "verify": {
      const packetPath = positional[1];
      const attestationPath = positional[2];
      const pubPath = flags["pub"];
      if (!packetPath || !attestationPath || !pubPath) return usageError("attest verify <packet.json> <attestation.json> --pub <public.pem>");
      const packet = JSON.parse(readFileSync(packetPath, "utf8"));
      const attestation = JSON.parse(readFileSync(attestationPath, "utf8")) as Attestation;
      const publicKey = readFileSync(pubPath, "utf8");
      const ok = verifyAttestation(packet, attestation, publicKey, {
        expectedKeyId: flags["key-id"] ?? keyIdFromPublicKey(publicKey),
        expectedAudience: flags["audience"],
      });
      console.log(ok ? `valid (signer ${attestation.signer}, seq ${attestation.seq})` : "invalid");
      return ok ? 0 : 1;
    }
    case "verify-chain": {
      const chainPath = positional[1];
      const pubPath = flags["pub"];
      if (!chainPath || !pubPath) return usageError("attest verify-chain <chain.json> --pub <public.pem>");
      const chain = JSON.parse(readFileSync(chainPath, "utf8")) as Attestation[];
      const publicKey = readFileSync(pubPath, "utf8");
      const ok = verifyAttestationChain(chain, publicKey, {
        requireHead: flags["no-head"] === undefined,
        expectedKeyId: flags["key-id"] ?? keyIdFromPublicKey(publicKey),
        expectedAudience: flags["audience"],
      });
      console.log(ok ? `valid (${chain.length} record(s))` : "invalid");
      return ok ? 0 : 1;
    }
    default:
      return usageError(`unknown attest subcommand '${sub}' (expected keygen | sign | verify | verify-chain)`);
  }
}

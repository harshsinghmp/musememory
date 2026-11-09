import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireRoot, usageError } from "./shared.ts";
import type { ParsedArgs } from "./shared.ts";
import { generateAttestationKeypair, signPacket, verifyAttestation, type Attestation } from "../sync/attestation.ts";

export async function handleAttestCommand({ positional, flags }: ParsedArgs): Promise<number> {
  const ctx = requireRoot(flags);
  if (!ctx) return 1;
  const sub = positional[0];

  switch (sub) {
    case "keygen": {
      const out = flags["out"] ?? ctx.memoryDir;
      const pair = generateAttestationKeypair();
      writeFileSync(join(out, "attestation.key"), pair.privateKey, { encoding: "utf8", mode: 0o600 });
      writeFileSync(join(out, "attestation.pub"), pair.publicKey, { encoding: "utf8", mode: 0o644 });
      try { chmodSync(join(out, "attestation.key"), 0o600); } catch {}
      console.log(`wrote ${join(out, "attestation.key")} and attestation.pub`);
      return 0;
    }
    case "sign": {
      const packetPath = positional[1];
      const keyPath = flags["key"];
      if (!packetPath || !keyPath) return usageError("attest sign <packet.json> --key <private.pem>");
      const packet = JSON.parse(readFileSync(packetPath, "utf8"));
      const attestation = signPacket(packet, readFileSync(keyPath, "utf8"), { signer: flags["signer"] });
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
      const ok = verifyAttestation(packet, attestation, readFileSync(pubPath, "utf8"));
      console.log(ok ? "valid" : "invalid");
      return ok ? 0 : 1;
    }
    default:
      return usageError(`unknown attest subcommand '${sub}' (expected keygen | sign | verify)`);
  }
}

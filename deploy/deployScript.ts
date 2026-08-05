/**
 * Deploy the AdStamp Intelligent Contract to GenLayer Bradbury testnet.
 *
 * Prerequisites:
 * 1. Fund a wallet from https://testnet-faucet.genlayer.foundation
 * 2. Create ../.env from ../.env.example with ACCOUNT_PRIVATE_KEY
 *
 * Usage:
 *   cd deploy
 *   npm install
 *   npm run deploy
 *
 * The private key is read from environment only and never logged.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import {
  TransactionStatus,
  type GenLayerClient,
  type GenLayerChain,
  type DecodedDeployData,
  type TransactionHash,
} from "genlayer-js/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load credentials from repository-root .env (git-ignored)
loadEnv({ path: path.resolve(__dirname, "..", ".env") });

const CONTRACT_PATH = path.resolve(__dirname, "..", "contracts", "ad_stamp.py");

function requireKey(): `0x${string}` {
  const key = process.env.ACCOUNT_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error(
      "ACCOUNT_PRIVATE_KEY is not set.\n" +
      "Create ../.env from ../.env.example and add a funded Bradbury key."
    );
  }
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  AdStamp Contract Deployment");
  console.log("  AI-Verified Content Bounties on GenLayer");
  console.log("═══════════════════════════════════════════════════════════\n");

  const account = createAccount(requireKey());
  const client = createClient({
    chain: testnetBradbury,
    account,
  }) as GenLayerClient<GenLayerChain>;

  console.log("Network      :", testnetBradbury.name ?? "GenLayer Bradbury");
  console.log("Chain ID     :", testnetBradbury.id);
  console.log("Deployer     :", account.address);
  console.log("Contract file:", CONTRACT_PATH);
  console.log("");

  // Read contract source
  const code = new Uint8Array(readFileSync(CONTRACT_PATH));
  console.log(`Contract size: ${code.length} bytes`);

  // Initialize consensus
  await client.initializeConsensusSmartContract();

  console.log("\n⏳ Deploying... submitting transaction");
  
  const txHash = (await client.deployContract({
    code,
    args: [], // AdStamp constructor takes no arguments
  })) as TransactionHash;

  console.log("Transaction  :", txHash);
  console.log("\n⏳ Waiting for validator consensus...\n");

  // Wait for acceptance (with fallback polling)
  let receipt: Record<string, unknown>;
  try {
    receipt = (await client.waitForTransactionReceipt({
      hash: txHash,
      status: TransactionStatus.ACCEPTED,
      retries: 120,
      interval: 5000,
    })) as Record<string, unknown>;
  } catch {
    receipt = await pollAccepted(client, txHash);
  }

  const statusName = String(receipt.statusName ?? receipt.status ?? "");
  
  if (statusName !== "ACCEPTED" && statusName !== "FINALIZED") {
    throw new Error(`Deployment not accepted. Status: ${statusName || "unknown"}`);
  }

  // Extract deployed address
  const decoded = receipt.txDataDecoded as DecodedDeployData | undefined;
  const address =
    decoded?.contractAddress ??
    (receipt.recipient as string | undefined) ??
    (receipt as { data?: { contract_address?: string } }).data?.contract_address;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✅ AdStamp Deployed Successfully!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("Status          :", statusName);
  console.log("Contract Address:", address);
  console.log("Transaction     :", txHash);
  console.log("");
  console.log("Explorer:");
  console.log(`  https://explorer-bradbury.genlayer.com/address/${address}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy the contract address above");
  console.log("  2. Create .env.local in the project root");
  console.log("  3. Add: NEXT_PUBLIC_CONTRACT_ADDRESS=" + address);
  console.log("  4. Restart the frontend");
  console.log("");
}

/**
 * Poll transaction status until ACCEPTED/FINALIZED.
 * Fallback for when waitForTransactionReceipt has issues.
 */
async function pollAccepted(
  client: GenLayerClient<GenLayerChain>,
  hash: TransactionHash,
  retries = 120,
  intervalMs = 5000,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < retries; i++) {
    try {
      const tx = (await client.getTransaction({ hash })) as Record<string, unknown>;
      const s = String(tx?.statusName ?? tx?.status ?? "");
      
      if (s === "ACCEPTED" || s === "FINALIZED") {
        return tx;
      }
      if (s === "UNDETERMINED" || s === "CANCELED") {
        throw new Error(`Transaction ${s}`);
      }
      
      // Progress indicator
      if (i > 0 && i % 6 === 0) {
        console.log(`   Still waiting... (${Math.floor(i * intervalMs / 1000)}s)`);
      }
    } catch {
      // Transient RPC error - keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for acceptance");
}

// Run
main().catch((err) => {
  console.error("\n❌ Deployment failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

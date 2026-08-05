"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, Hash } from "genlayer-js/types";
import { CONTRACT_ADDRESS, NETWORK } from "./config";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}

function rpcEndpoint(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/rpc`;
  }
  return NETWORK.rpc;
}

export function getReadClient() {
  return createClient({ chain: studionet, endpoint: rpcEndpoint() });
}

export function getWriteClient(address: `0x${string}`) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found. Install MetaMask to continue.");
  return createClient({
    chain: studionet,
    account: address,
    endpoint: NETWORK.rpc,
    provider,
  });
}

let networkReady = false;
let genlayerReady = false;

async function ensureStudioNetwork(): Promise<void> {
  if (networkReady) return;

  const provider = getInjectedProvider();
  if (!provider) return;

  const targetChainId = `0x${NETWORK.chainId.toString(16)}`;
  let currentChainId: string;
  try {
    currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
  } catch {
    return;
  }

  if (currentChainId?.toLowerCase() === targetChainId.toLowerCase()) {
    networkReady = true;
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
    networkReady = true;
    return;
  } catch (err) {
    if ((err as { code?: number })?.code !== 4902) throw err;
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: targetChainId,
      chainName: NETWORK.name,
      rpcUrls: [NETWORK.rpc],
      nativeCurrency: { name: "GEN Token", symbol: NETWORK.currency, decimals: 18 },
      blockExplorerUrls: [NETWORK.explorer],
    }],
  });
  networkReady = true;
}

async function ensureGenLayerReady(address: `0x${string}`): Promise<void> {
  if (genlayerReady) return;
  try {
    const client = getWriteClient(address);
    await client.connect("studionet");
  } catch {
    // Ignore snap/setup issues; direct wallet flow may still work.
  }
  genlayerReady = true;
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No wallet found. Install MetaMask to continue.");

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No account authorized.");

  const address = accounts[0] as `0x${string}`;
  await ensureStudioNetwork();
  await ensureGenLayerReady(address);
  return address;
}

function requireContract(): `0x${string}` {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address not configured.");
  }
  return CONTRACT_ADDRESS;
}

const MIN_READ_GAP_MS = 750;
let lastReadAt = 0;
let readQueue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|exceeds defined limit|-32429|\b429\b|server busy|execution slots/i.test(msg);
}

function scheduleRead<T>(job: () => Promise<T>): Promise<T> {
  const result = readQueue.then(async () => {
    const wait = Math.max(0, lastReadAt + MIN_READ_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastReadAt = Date.now();
    return job();
  });
  readQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function readContract<T = unknown>(
  functionName: string,
  args: CalldataEncodable[] = [],
): Promise<T> {
  return scheduleRead(async () => {
    const client = getReadClient();
    const address = requireContract();
    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return (await client.readContract({ address, functionName, args })) as T;
      } catch (err) {
        if (isRetryable(err) && attempt < maxAttempts - 1) {
          await sleep(1500 * (attempt + 1));
          lastReadAt = Date.now();
          continue;
        }
        throw err;
      }
    }
    throw new Error("Read failed after retries");
  });
}

export async function writeContract(
  address: `0x${string}`,
  functionName: string,
  args: CalldataEncodable[] = [],
  value: bigint = 0n,
): Promise<Hash> {
  await ensureStudioNetwork();
  await ensureGenLayerReady(address);

  const client = getWriteClient(address);
  const hash = (await client.writeContract({
    address: requireContract(),
    functionName,
    args,
    value,
  })) as Hash;
  return hash;
}

export async function waitAccepted(hash: Hash) {
  const client = getReadClient();
  return client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 100,
    interval: 5000,
  });
}

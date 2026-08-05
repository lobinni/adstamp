// AdStamp network + contract configuration (GenLayer Studio).

export const NETWORK = {
  name: "GenLayer Studio",
  chainKey: "studionet" as const,
  rpc: "https://studio.genlayer.com/api",
  chainId: 61999,
  currency: "GEN",
  explorer: "https://explorer-studio.genlayer.com",
};

// Deployed AdStamp contract on GenLayer Studio.
export const CONTRACT_ADDRESS: `0x${string}` = "0xea5D53A5D8111bB4Fb9C9fDD3e01B27C1E1cbc75";

export const PROTOCOL_FEE_BPS = 500; // 5% (matches contract default)

export const WEI = 10n ** 18n;

export function genToWei(gen: string | number): bigint {
  const s = String(gen).trim();
  if (!s) return 0n;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole || "0") * WEI + BigInt(fracPadded || "0");
}

export function weiToGen(wei: bigint | string, dp = 4): string {
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  const whole = v / WEI;
  const frac = v % WEI;
  const fracStr = frac.toString().padStart(18, "0").slice(0, dp).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

export function shortAddr(addr?: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Frame, Label } from "@/components/Frame";
import { Stamp } from "@/components/Stamp";
import { Button } from "@/components/Button";
import { Wordmark, GitHubIcon, GITHUB_URL } from "@/components/icons";
import {
  CONTRACT_ADDRESS,
  NETWORK,
  genToWei,
  weiToGen,
  shortAddr,
} from "@/lib/config";
import {
  connectWallet,
  readContract,
  writeContract,
  waitAccepted,
  getInjectedProvider,
} from "@/lib/genlayer";

type Campaign = {
  id: number;
  brand: string;
  title: string;
  guidelines: string;
  bounty_amount: string;
  escrow_balance: string;
  payouts_made: number;
  active: boolean;
  created_at: string;
};

type Submission = {
  id: number;
  campaign_id: number;
  creator: string;
  media_url: string;
  status: "approved" | "rejected";
  score: number;
  reason: string;
  paid_amount: string;
  created_at: string;
};

function useToast() {
  const [msg, setMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const show = useCallback(
    (kind: "info" | "error", text: string) => setMsg({ kind, text }),
    [],
  );
  const clear = useCallback(() => setMsg(null), []);
  return { msg, show, clear };
}

export default function AppPage() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [tab, setTab] = useState<"creator" | "brand">("creator");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingVerdicts, setLoadingVerdicts] = useState(false);
  const { msg, show, clear } = useToast();

  const configured = Boolean(CONTRACT_ADDRESS);
  const loadingRef = useRef(false);

  const loadCampaigns = useCallback(async () => {
    if (!configured || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadingVerdicts(true);
    try {
      const scount = Number((await readContract<number>("get_submission_count")) ?? 0);
      const start = Math.max(0, scount - 10);
      setSubmissions([]);
      for (let i = scount - 1; i >= start; i--) {
        try {
          const s = await readContract<Submission>("get_submission", [BigInt(i)]);
          setSubmissions((prev) => [...prev, s]);
        } catch { /* skip */ }
      }
      setLoadingVerdicts(false);

      const count = (await readContract<number>("get_campaign_count")) ?? 0;
      const out: Campaign[] = [];
      for (let i = 0; i < Number(count); i++) {
        try {
          out.push(await readContract<Campaign>("get_campaign", [BigInt(i)]));
        } catch { /* skip */ }
      }
      setCampaigns(out.reverse());
    } catch (e) {
      const m = errText(e);
      show("error", /rate limit|exceeds defined limit/i.test(m)
        ? "The network is busy. Please wait a moment and tap Refresh."
        : m);
    } finally {
      loadingRef.current = false;
      setLoadingVerdicts(false);
      setLoading(false);
    }
  }, [configured, show]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const onConnect = async () => {
    clear();
    try { setAddress(await connectWallet()); }
    catch (e) { show("error", errText(e)); }
  };

  const onDisconnect = async () => {
    try {
      await getInjectedProvider()?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch { /* ok */ }
    setAddress(null);
    show("info", "Wallet disconnected.");
  };

  return (
    <main className="min-h-screen bg-paper-2">
      <header className="border-b border-ink/10 bg-ink text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="/" aria-label="AdStamp home"><Wordmark invert /></a>
          <div className="flex items-center gap-3">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-white/50 transition-colors hover:text-white">
              <GitHubIcon className="h-5 w-5" />
            </a>
            <span className="hidden text-xs text-white/40 sm:inline">{NETWORK.name}</span>
            {address ? (
              <button onClick={onDisconnect} title="Disconnect wallet"
                className="group inline-flex items-center gap-2 rounded-sharp border border-volt/50 px-3 py-1.5 text-xs text-volt transition-colors hover:border-coral hover:text-coral">
                <span className="h-2 w-2 rounded-full bg-volt group-hover:bg-coral" />
                <span className="group-hover:hidden">{shortAddr(address)}</span>
                <span className="hidden group-hover:inline">Disconnect</span>
              </button>
            ) : (
              <Button variant="volt" onClick={onConnect} className="!px-4 !py-2 !text-xs">
                Connect wallet
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {!configured && (
          <Banner kind="error">
            No contract address configured. Deploy to {NETWORK.name} and set{" "}
            <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in{" "}
            <code className="font-mono">.env.local</code>, then reload.
          </Banner>
        )}
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        <div className="mb-6 flex gap-2">
          <TabButton active={tab === "creator"} onClick={() => setTab("creator")}>
            I&apos;m a creator
          </TabButton>
          <TabButton active={tab === "brand"} onClick={() => setTab("brand")}>
            I&apos;m a brand
          </TabButton>
          <div className="ml-auto">
            <Button variant="ghost" onClick={loadCampaigns} disabled={!configured}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>

        {tab === "brand" ? (
          <BrandPanel address={address} campaigns={campaigns} onConnect={onConnect} notify={show} reload={loadCampaigns} />
        ) : (
          <CreatorPanel address={address} campaigns={campaigns} onConnect={onConnect} notify={show} reload={loadCampaigns} />
        )}

        <VerdictsFeed submissions={submissions} campaigns={campaigns} loading={loadingVerdicts} />
      </div>
    </main>
  );
}

/* ----------------------------- Verdicts Feed ----------------------------- */

function VerdictsFeed({ submissions, campaigns, loading }: {
  submissions: Submission[]; campaigns: Campaign[]; loading: boolean;
}) {
  if (!loading && submissions.length === 0) return null;
  const titleFor = (id: number) => campaigns.find((c) => c.id === id)?.title ?? `Campaign #${id}`;
  return (
    <section className="mt-10">
      <Label>Latest verdicts</Label>
      <p className="mt-1 mb-4 text-sm text-ink-60">
        Every decision is recorded on-chain by validator consensus.
      </p>
      <div className="space-y-3">
        {submissions.map((s) => (
          <Frame key={s.id} className="flex flex-wrap items-center gap-4 p-4">
            <Stamp verdict={s.status} className="!animate-none" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold tracking-tightest">{titleFor(s.campaign_id)}</div>
              <div className="truncate font-mono text-xs text-ink-60">
                submission #{s.id} · {shortAddr(s.creator)} · confidence {s.score}/100
              </div>
            </div>
            <a href={s.media_url} target="_blank" rel="noreferrer"
              className="font-mono text-xs text-accent underline underline-offset-4 hover:text-accent/70">
              View media
            </a>
            <span className="font-mono text-sm">
              {s.status === "approved"
                ? <span className="text-volt font-bold">+{weiToGen(s.paid_amount)} GEN</span>
                : <span className="text-coral">no payout</span>}
            </span>
          </Frame>
        ))}
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <Frame key={`sk-${i}`} className="flex animate-pulse items-center gap-4 p-4">
            <div className="h-7 w-20 rounded-full bg-paper-2" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-40 rounded bg-paper-2" />
              <div className="h-3 w-24 rounded bg-paper-2" />
            </div>
            <div className="h-4 w-16 rounded bg-paper-2" />
          </Frame>
        ))}
      </div>
      {loading && <p className="mt-3 animate-pulse font-mono text-xs text-ink-60">Loading verdicts from the chain…</p>}
    </section>
  );
}

/* ----------------------------- Brand ----------------------------- */

function BrandPanel({ address, campaigns, onConnect, notify, reload }: {
  address: `0x${string}` | null; campaigns: Campaign[]; onConnect: () => void;
  notify: (k: "info" | "error", t: string) => void; reload: () => void;
}) {
  const [title, setTitle] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [bounty, setBounty] = useState("1");
  const [deposit, setDeposit] = useState("5");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!address) return onConnect();
    if (!title.trim() || !guidelines.trim()) return notify("error", "Title and guidelines are required.");
    setBusy(true);
    notify("info", "Submitting campaign… confirm in your wallet.");
    try {
      const hash = await writeContract(address, "create_campaign",
        [title.trim(), guidelines.trim(), genToWei(bounty)], genToWei(deposit));
      await waitAccepted(hash);
      notify("info", "Campaign created.");
      setTitle(""); setGuidelines("");
      reload();
    } catch (e) { notify("error", errText(e)); }
    finally { setBusy(false); }
  };

  const mine = campaigns.filter((c) => address && c.brand.toLowerCase() === address.toLowerCase());

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <Frame className="p-6">
        <Label>New campaign</Label>
        <div className="mt-4 space-y-4">
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer beach launch" />
          </Field>
          <Field label="Creative guidelines (plain language)">
            <textarea className="input min-h-[110px]" value={guidelines} onChange={(e) => setGuidelines(e.target.value)}
              placeholder="Show our can on a sunny beach. No competing brands visible. Bright, energetic tone." />
          </Field>
          <div className="grid grid-cols-2 items-end gap-4">
            <Field label="Bounty (GEN)">
              <input className="input" inputMode="decimal" value={bounty} onChange={(e) => setBounty(e.target.value)} />
            </Field>
            <Field label="Deposit (GEN)">
              <input className="input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </Field>
          </div>
          <Button onClick={create} disabled={busy} className="w-full">
            {busy ? "Working…" : address ? "Fund campaign" : "Connect to fund"}
          </Button>
          <p className="text-xs text-ink-60">
            Bounty is paid per approved submission. Deposit is escrowed on-chain and
            must cover at least one bounty. Close the campaign any time to reclaim the remainder.
          </p>
        </div>
      </Frame>
      <div>
        <Label>Your campaigns</Label>
        <div className="mt-4 space-y-4">
          {!address && <p className="text-ink-60">Connect your wallet to see campaigns you own.</p>}
          {address && mine.length === 0 && <p className="text-ink-60">No campaigns yet. Create one on the left.</p>}
          {mine.map((c) => (
            <BrandCampaignCard key={c.id} c={c} address={address!} notify={notify} reload={reload} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandCampaignCard({ c, address, notify, reload }: {
  c: Campaign; address: `0x${string}`;
  notify: (k: "info" | "error", t: string) => void; reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("1");

  const fund = async () => {
    setBusy(true); notify("info", "Funding… confirm in your wallet.");
    try {
      const hash = await writeContract(address, "fund_campaign", [BigInt(c.id)], genToWei(amount));
      await waitAccepted(hash);
      notify("info", "Escrow topped up.");
      reload();
    } catch (e) { notify("error", errText(e)); }
    finally { setBusy(false); }
  };

  const close = async () => {
    setBusy(true); notify("info", "Closing campaign… confirm in your wallet.");
    try {
      const hash = await writeContract(address, "close_campaign", [BigInt(c.id)]);
      await waitAccepted(hash);
      notify("info", "Campaign closed and escrow refunded.");
      reload();
    } catch (e) { notify("error", errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <Frame className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold tracking-tightest">{c.title}</div>
          <div className="font-mono text-xs text-ink-60">campaign #{c.id}</div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.active ? "bg-volt/15 text-volt" : "bg-coral/10 text-coral"}`}>
          {c.active ? "active" : "closed"}
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-60">{c.guidelines}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-sm">
        <Stat label="bounty" value={`${weiToGen(c.bounty_amount)} GEN`} />
        <Stat label="escrow" value={`${weiToGen(c.escrow_balance)} GEN`} />
        <Stat label="paid" value={String(c.payouts_made)} />
      </div>
      {c.active && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className="input !py-1.5 w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button variant="ink" onClick={fund} disabled={busy} className="!px-4 !py-2">Add escrow</Button>
          <Button variant="ghost" onClick={close} disabled={busy} className="!px-4 !py-2">Close &amp; refund</Button>
        </div>
      )}
    </Frame>
  );
}

/* ----------------------------- Creator ----------------------------- */

function CreatorPanel({ address, campaigns, onConnect, notify, reload }: {
  address: `0x${string}` | null; campaigns: Campaign[]; onConnect: () => void;
  notify: (k: "info" | "error", t: string) => void; reload: () => void;
}) {
  const active = campaigns.filter((c) => c.active);
  const [selected, setSelected] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);

  const chosen = active.find((c) => c.id === selected) ?? null;

  const submit = async () => {
    if (!address) return onConnect();
    if (selected === null) return notify("error", "Pick a campaign first.");
    if (!url.trim()) return notify("error", "Enter a direct image URL.");

    const imageUrl = url.trim();
    setBusy(true);
    setResult(null);
    setPendingHash(null);

    try {
      notify("info", "Checking image URL…");
      const preflightRes = await fetch("/api/media/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: imageUrl }),
      });
      const preflight = (await preflightRes.json()) as {
        ok: boolean;
        error?: string;
        contentType?: string | null;
        contentLength?: number | null;
      };
      if (!preflight.ok) {
        notify("error", preflight.error || "Image URL validation failed.");
        return;
      }

      notify(
        "info",
        `Submitting for review. Validators are judging the media… ` +
        `(${preflight.contentType || "image"}${preflight.contentLength ? `, ${Math.round(preflight.contentLength / 1024)} KB` : ""}). ` +
        `This can take 30–120 seconds on Studio.`,
      );

      const countBefore = Number((await readContract<number>("get_submission_count")) ?? 0);
      const hash = await writeContract(address, "submit", [BigInt(selected), imageUrl]);
      setPendingHash(hash as `0x${string}`);

      await waitAccepted(hash);

      // Studio can lag briefly before the new submission is visible over RPC.
      let countAfter = countBefore;
      for (let i = 0; i < 8; i++) {
        try {
          countAfter = Number((await readContract<number>("get_submission_count")) ?? 0);
          if (countAfter > countBefore) break;
        } catch {
          /* ignore transient read failures */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (countAfter > countBefore) {
        const latest = await readContract<Submission>("get_submission", [BigInt(countAfter - 1)]);
        setResult(latest);
        notify(
          "info",
          latest.status === "approved"
            ? "Approved. Bounty released to your wallet."
            : "Not approved this time.",
        );
      } else {
        notify(
          "error",
          "The transaction finalized, but the new submission is not visible yet. " +
          "This can be a temporary RPC indexing delay or a rolled-back execution. " +
          "Please refresh in a few seconds. If it still does not appear, try a different direct image URL.",
        );
      }
      reload();
    } catch (e) {
      const msg = errText(e);
      if (/submission not found/i.test(msg)) {
        notify("error",
          "The contract could not evaluate the image. The image host may have blocked the request, the payload may not be a supported image type, or validators may have timed out. Try a different direct image URL.");
      } else if (/already rewarded/i.test(msg)) {
        notify("error", "You already received a payout for this campaign.");
      } else if (/not active/i.test(msg)) {
        notify("error", "This campaign is no longer active.");
      } else if (/exhausted/i.test(msg)) {
        notify("error", "This campaign has run out of funds.");
      } else if (/media fetch returned/i.test(msg)) {
        notify("error", "Could not fetch image. Check the URL is correct and publicly accessible.");
      } else {
        notify("error", msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <Frame className="p-6">
        <Label>Submit content</Label>
        <div className="mt-4 space-y-4">
          <Field label="Campaign">
            <select className="input" value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Select a campaign…</option>
              {active.map((c) => (
                <option key={c.id} value={c.id}>#{c.id}: {c.title} ({weiToGen(c.bounty_amount)} GEN)</option>
              ))}
            </select>
          </Field>
          {chosen && (
            <div className="rounded-sharp border border-accent/20 bg-accent/5 p-3 text-sm text-ink-60">
              <span className="font-mono text-xs uppercase tracking-widest text-accent">Guidelines</span>
              <p className="mt-1">{chosen.guidelines}</p>
            </div>
          )}
          <Field label="Direct image URL">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/your-post.png" />
          </Field>
          <Button onClick={submit} disabled={busy} className="w-full">
            {busy ? "Judging…" : address ? "Submit for payout" : "Connect to submit"}
          </Button>
          {pendingHash && (
            <p className="font-mono text-xs text-ink-60 break-all">
              tx: <a
                href={`${NETWORK.explorer}/tx/${pendingHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-4 hover:text-accent/70"
              >
                {pendingHash}
              </a>
            </p>
          )}
          <p className="text-xs text-ink-60">
            The contract fetches the image, validates MIME type and size, and validators vote.
            Approved content is paid instantly. One payout per creator per campaign.
          </p>
        </div>
      </Frame>
      <div>
        <Label>Verdict</Label>
        <div className="mt-4">
          {!result ? (
            <Frame className="flex flex-col items-center justify-center p-12 text-center text-ink-60">
              <div className="text-3xl">🔍</div>
              <p className="mt-3 text-sm">Your verdict stamp appears here after review.</p>
            </Frame>
          ) : (
            <Frame className="overflow-hidden">
              <div className={`px-6 py-4 ${result.status === "approved" ? "bg-volt/10" : "bg-coral/5"}`}>
                <div className="flex items-center justify-between">
                  <Stamp verdict={result.status} />
                  <span className="font-mono text-sm font-bold">
                    {result.status === "approved"
                      ? <span className="text-volt">+{weiToGen(result.paid_amount)} GEN</span>
                      : <span className="text-coral">no payout</span>}
                  </span>
                </div>
              </div>
              <div className="px-6 py-4">
                <div className="font-mono text-xs text-ink-60">
                  submission #{result.id} · confidence: {result.score}/100
                </div>
                <p className="mt-2 text-sm">{result.reason}</p>
              </div>
            </Frame>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Primitives ----------------------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-60">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sharp bg-paper-2 p-2.5">
      <div className="text-[10px] uppercase tracking-widest text-ink-60">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold">{value}</div>
    </div>
  );
}

function TabButton({ active, children, onClick }: {
  active: boolean; children: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`rounded-sharp px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all ${
        active ? "bg-accent text-white shadow-stamp" : "bg-paper text-ink-60 hover:text-ink"}`}>
      {children}
    </button>
  );
}

function Banner({ kind, children }: { kind: "info" | "error"; children: React.ReactNode }) {
  return (
    <div className={`mb-6 rounded-sharp border p-3 text-sm ${
      kind === "error" ? "border-coral/30 bg-coral/5 text-coral" : "border-accent/30 bg-accent/5 text-ink"}`}>
      {children}
    </div>
  );
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    // MetaMask / viem errors are plain objects with message or shortMessage
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.shortMessage === "string") return obj.shortMessage;
    if (typeof obj.details === "string") return obj.details;
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}

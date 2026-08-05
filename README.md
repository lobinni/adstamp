# AdStamp

On-chain payouts for user-generated marketing content, judged by decentralized AI.

Brands fund a campaign and write the creative guidelines in plain language.
Creators submit a link to their post. A GenLayer Intelligent Contract fetches the
media, validates it, converts it into an explicitly supported image representation,
evaluates it against the guidelines, and releases the bounty when the validators
agree. There is no account manager reviewing submissions by hand.

## Live on GenLayer Studio

| | |
|---|---|
| Contract | [`0xea5D53A5D8111bB4Fb9C9fDD3e01B27C1E1cbc75`](https://explorer-studio.genlayer.com/address/0xea5D53A5D8111bB4Fb9C9fDD3e01B27C1E1cbc75) |
| Network | GenLayer Studio (chain id 61999) |
| RPC | `https://studio.genlayer.com/api` |
| Explorer | `https://explorer-studio.genlayer.com` |

## How it works

1. **A brand funds a campaign.** It deposits GEN into escrow and writes the
   creative guidelines as text. The deposit sets how many bounties the campaign
   can pay.
2. **A creator submits a link.** They post their content and submit the image URL.
   Payouts are limited to one per creator per campaign.
3. **Validators judge and pay.** Each validator independently fetches the media,
   validates HTTP status, MIME type, and size, converts the media into an explicit
   `gl.nondet.Image` representation via `web.render(..., mode='screenshot')`, runs
   a vision model against the same guidelines, and votes. A majority decides.
   Approved content is paid immediately, minus a 5% protocol fee.

## Why the judgment runs on GenLayer

Deciding whether an image matches a brand's guidelines is a subjective call. A
normal smart contract cannot make it, and a single AI API reintroduces a party you
have to trust. GenLayer runs the evaluation inside the contract: the leader fetches
the media and returns a structured verdict, and every validator re-runs the same
check. Consensus is reached only when the validators agree on the boolean
`compliant` decision, and that agreement is what authorizes the payout.

## Technology

- **Intelligent Contract** in Python, executed by the GenVM. It owns the escrow,
  the guidelines, the AI verdict, and the payout.
- **Explicit image representation** in `_fetch_as_supported_image`: `web.get()`
  validates HTTP status, payload size, and `Content-Type`, then
  `web.render(url, mode='screenshot')` converts the validated media into a
  `gl.nondet.Image` object.
- **Contract-level tests** in `tests/test_ad_stamp.py`: 12 tests calling
  `AdStamp.submit()` directly to prove the submit path, state changes, transfers,
  and that `exec_prompt` receives an explicit image object.
- **Frontend** in Next.js (App Router) with TypeScript and Tailwind CSS, connected
  to the chain through [`genlayer-js`](https://www.npmjs.com/package/genlayer-js)
  and a browser wallet.

## Contract interface

| Method | Type | Purpose |
|---|---|---|
| `create_campaign(title, guidelines, bounty_amount)` | write, payable | Open a campaign and escrow GEN |
| `fund_campaign(campaign_id)` | write, payable | Add escrow to a campaign |
| `submit(campaign_id, media_url)` | write | Validate image, AI verdict, payout on approval |
| `close_campaign(campaign_id)` | write | Brand closes a campaign and reclaims escrow |
| `get_campaign(id)` / `get_submission(id)` | view | Read campaign and submission state |
| `get_protocol_config()` | view | Owner, fee recipient, fee, counters |
| `has_claimed(campaign_id, creator)` | view | Check if creator already received payout |

## Contract tests

Requires Python 3.11 or newer.

```bash
pip install pytest
pytest tests/test_ad_stamp.py -v
```

## Frontend

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
npm run build
```

## Wallet behavior

The app uses only the Studio RPC (`https://studio.genlayer.com/api`, chain id
61999). When connecting:

1. Request wallet accounts.
2. Check current chain id.
3. If already on Studio, do nothing.
4. If not, try `wallet_switchEthereumChain`.
5. Only if the chain does not exist (`4902`), call `wallet_addEthereumChain` once.
6. Subsequent writes do not re-prompt to add the chain.

## License

MIT. See [LICENSE](LICENSE).

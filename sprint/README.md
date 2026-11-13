# Sprint work: BlackboxTamperBench

**AI x Epistemics Research Sprint (Apart Research), 13–15 November 2026. Track 2: Trust Infrastructure.**

Everything in this `sprint/` folder was written during the sprint. Everything outside it is **preexisting** Blackbox code, written before the sprint for SERV Hackathon 02 (last preexisting commit: `8b3bb2a`, 13 Nov 2026 04:35 WAT). The sprint code imports the preexisting verifier and pipeline **unchanged**; no file under `src/` was modified on this branch.

## Question

Blackbox's verifier shows one verdict: "Record holds up". What does that verdict actually let a reader believe, and against which kind of adversary? We measure it with an adversary-stratified mutation benchmark.

## What is here

| Path | What it does |
| --- | --- |
| `bench/corpus.mts` | Generates honest receipts by running the preexisting, unmodified `negotiate()` pipeline with scripted, seeded agents (no LLM calls, no network, no money). |
| `bench/lib.mts` | 26 targeted attack operators in 5 adversary classes (A1–A5), 1 pre-anchor forgery operator, 3 benign controls (2 random-fuzz operators live in `run.mts`), a simulated anchor registry that models the Solana memos, and 7 verifier configurations (C1–C6, C3h), including three sprint hardenings: summary binding, a strict (no-downgrade) profile, and a pinned anchor lookup by deal ID. |
| `bench/run.mts` | Applies every operator to every honest receipt and scores every configuration. Writes `results/rows_*.csv` and `results/summary_*.json`. |
| `bench/live-real.mts` | Live check on the real mainnet deal `deal_74b9a05fe8f4`: the shipped verifier with live Solana reads, plus a pinned lookup of the official anchor wallet's memo history. Read-only. One attacker transaction is stubbed locally, so nothing is written on chain. |
| `analysis/analyze.py` | Aggregates the results and draws `results/fig1_heatmap.png` and `results/fig2_classes.png`. |
| `data/` | The honest corpora: 200 receipts with seed 20261113, 100 with seed 424242, and the 4 real receipts. |

## Reproduce (about 2 minutes, no API keys)

```bash
npm ci
npx tsx --conditions=react-server sprint/bench/corpus.mts 200 20261113            # honest corpus
npx tsx --conditions=react-server sprint/bench/run.mts sprint/data/corpus.json 7   # benchmark
npx tsx --conditions=react-server sprint/bench/run.mts sprint/data/real_corpus.json 7
python3 sprint/analysis/analyze.py                                                 # tables and figures
npx tsx --conditions=react-server sprint/bench/live-real.mts                       # live Solana reads
```

Keys and salts are random on every run, so hashes differ between runs. The operator-level rates do not.

## Headline results (200 honest receipts, 6,756 mutants)

| Verifier configuration | Harmful mutants flagged (A1–A5, n=4,756) | Benign flagged (n=600) |
| --- | --- | --- |
| C1 hash chain only | 23.4% | 0 |
| C3 shipped verifier, offline | 42.6% | 0 |
| C4 shipped verifier + on-chain anchor (receipt-directed) | 70.1% | 0 |
| C6 + summary binding + strict profile + pinned anchor lookup (sprint) | 98.1% | 0 |

Gaps found in the preexisting verifier. These are reported, not fixed on `main`:

1. **The receipt directs the anchor check.** If the anchor field is removed, the check becomes "pending" and the verdict is still "holds up". If the anchor field points at a memo the attacker wrote, the check passes, because the writer is read from the receipt. A full forgery passes either way.
2. **Summary fields aren't bound.** The outcome, terms, reveals and budget shown on the receipt card are not checked against the hash-chained log.
3. **Removing evidence downgrades the checks.** Without agent identities or reveals, those checks become "pending" instead of failing.
4. **Some events are only caught by the anchor.** Hiding refusal (injection) events, framing the counterparty with an invented injection attempt, and backdating timestamps are invisible to every in-record check.
5. **Some displayed values can't be verified.** For no-deal receipts the spending limit is shown on the card but never revealed, so no configuration can check it.
6. **Trust boundary.** A forgery by the anchoring operator before anchoring passes every configuration.

The full report is the sprint submission PDF. Sprint results are in `results/`.

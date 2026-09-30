# VeriTrust AI — Product Requirements Document (PRD) v2

> Single source of truth. If code and this file disagree, this file wins. Change this file FIRST, then the code.
> Contracts in sections 8, 9 and 10 are FROZEN once Phase 1 is signed off by all four owners.

## 1. One-line pitch

VeriTrust is an evidence-first verification firewall for customer-service AI. A response reaches the customer only if every factual claim in it is traced to approved company evidence. The Judge is a hybrid: deterministic fact checks first, LLM entailment second. If evidence does not exist, the system abstains instead of guessing.

## 2. Problem

LLM support bots produce fluent but wrong answers (a wrong refund window, an invented perk). Companies need a layer that catches, explains and corrects these before the customer sees them, and that shows how reliable the AI is over time. Asking a second LLM "is this right?" is weak, especially with small local models, because it also misses numeric contradictions and can hallucinate. VeriTrust checks numbers in code and forces every LLM verdict to cite a real evidence chunk.

## 3. Hackathon problem statement (must be satisfied)

"VeriTrust AI — Dual-Agent Maker & Judge Hallucination Guardrail System": a real-time compliance filter where a **Maker Agent** drafts replies from company manuals and a strict **Judge Agent** cross-checks them against a verified corporate database before display, with a unified admin interface showing real-time accuracy metrics and blocked vs approved responses.

Required: agentic workflow (LangGraph), LLM (**Ollama, local only**), database retrieval (ChromaDB + SQLite), web UI.
Expected outcome: a working multi-agent loop that captures, evaluates and auto-corrects inaccurate outputs, plus a demo showing correction speed, latency, and blocked vs approved responses with accuracy metrics.

Mapping:

| PS requirement | Where it is met |
|---|---|
| Maker drafts from manuals | Section 7, `maker` node |
| Judge cross-checks vs verified database | Section 7, `deterministic_check` + `llm_judge` |
| Real-time filter before display | SSE pipeline, customer sees only the final answer |
| Auto-correct | `correct` node, max 2 retries |
| Accuracy metrics, blocked vs approved | Section 12, Ledger |
| Accuracy drift | Section 12, drift line with policy-change markers |
| Correction speed and latency | Per-stage latency stored on every run |

## 4. Goals and non-goals

### Goals
1. Catch and fix wrong claims, with visible and clickable evidence.
2. Refuse to answer when no evidence exists (abstain) instead of guessing.
3. Show what happens to past answers when a policy changes (stale runs) and how accuracy moves.
4. Measure the guardrail honestly on a benchmark (real numbers only, graded by code, not by an LLM).

### Non-goals (do NOT build)
Auth/login, multi-tenant, PDF upload, voice, mobile app, fine-tuning, extra agents beyond Maker and Judge, paid or keyed APIs, real company integrations, KPI-card dashboards, Docker orchestration beyond one start script, human-review queue, source-authority ranking, composite trust scores, confidence percentages.

## 5. Users

- **Customer:** asks questions in a plain chat and sees only the verified final answer with a "Verified against ..." badge, or a refusal message.
- **Reviewer/Admin:** flips to Reviewer view to see tracked changes, browses the Ledger, edits policies, runs the benchmark.

## 6. Fictional company and knowledge base

Company: **VeriCorp** (consumer electronics, prices in ₹). 5–6 markdown files in `data/policies/`: `refund_policy.md`, `warranty_policy.md`, `shipping_policy.md`, `cancellation_policy.md`, `payments_policy.md`, `support_policy.md`.

File format (written by the Data owner by hand; agents never invent policy content):

```
---
name: refund_policy
version: v1
effective_date: 2026-09-01
---
- Refunds are allowed within 15 days of purchase.
- Opened electronics can be returned within 15 days.
```

Rules for policy content:
- 10–15 short, self-contained facts per file, one fact per bullet. Each bullet becomes one chunk.
- Facts carry numbers, durations and prices. Each fact restates its subject ("Opened electronics can be returned within 15 days", not "Within 15 days").
- No two conflicting facts anywhere. Avoid overlapping facts across files at first.
- Policies are the ONLY ground truth. The Judge never uses its own world knowledge.

Runtime versioning: the SQLite `policy_versions` table is authoritative at runtime. The markdown files are seeds loaded on first start. Editing a policy in the UI writes a new row (v1 → v2), never touches the seed files, and re-indexes ChromaDB. `python -m backend.db.reset --policies` restores the seeds so the demo can be repeated.

## 7. Pipeline (LangGraph)

```
retrieve → maker → retrieve_for_draft → split_claims → deterministic_check
        → llm_judge (unresolved claims only, parallel, one claim per call)
        → route:
             all SUPPORTED                        → deliver
             any CONTRADICTED, attempt < 2        → correct → split_claims (loop)
             any CONTRADICTED, attempt = 2        → abstain (RETRY_CAP)
             no CONTRADICTED, any UNSUPPORTED     → abstain (UNSUPPORTED)
        → log → done
```

`attempt` is 0 for the first draft and increases by one per correction. Maximum corrections: `MAX_CORRECTIONS=2`.

### 7.1 retrieve
Top-k (`RETRIEVAL_K=4`) chunks from ChromaDB for the question. Embeddings: `nomic-embed-text`. Returns `Evidence[]`. Emitted to the UI as the `retrieved` event.

### 7.2 maker
Drafts an answer from the question and the retrieved context using `MAKER_MODEL`. Output is plain text (not logic input), constrained by the prompt: at most 3 sentences, no markdown, no bullet lists, no greetings or sign-offs. This keeps sentence spans robust.

`chaos=true`: the Maker is instructed to confidently state plausible wrong numbers or ignore the context. This is a **labeled simulation** of the failure the guardrail exists for. It is visible in the UI and stored with the run (`chaos=true`). It is never presented as natural model behavior.

### 7.3 retrieve_for_draft
Second retrieval using the draft text (`DRAFT_RETRIEVAL=true` by default). Results are merged with the question chunks, de-duplicated by `chunk_id`, question chunks first, capped at 6. This merged set is the Judge's evidence. Reason: the Maker can assert something on a topic the question retrieval never fetched, and that claim should be CONTRADICTED against the right policy, not wrongly UNSUPPORTED. The Judge never sees the merged set replaced by anything from its own memory.

### 7.4 split_claims
Sentence split of the draft. Each sentence is one claim with exact character spans: `Claim.text == draft[start:end]`. If a span check fails, fall back to a plain sentence split and recompute spans.

Splitter requirements (must be covered by tests):
- Do not split on decimals or thousands separators ("₹1,999.", "2.5 years").
- Do not split on common abbreviations ("e.g.", "approx.").
- Newlines and bullet markers are treated as boundaries.

**Non-factual sentences** (greetings, thanks, sign-offs, questions back to the customer; rule-based: no digits and matching a small pleasantries list, or fewer than 4 words) are resolved as `SUPPORTED`, `checked_by="deterministic"`, `reason="Non-factual sentence"`. Without this rule, "Happy to help!" would be UNSUPPORTED and force an abstain.

### 7.5 deterministic_check
Runs in code before any LLM call.

**Extraction** from each claim and each evidence sentence:
- Durations: day(s), business day(s), hour(s), week(s), month(s), year(s). Number words ("two", "fifteen") and hyphen forms ("15-day") are handled.
- Prices: ₹, Rs, INR, $ amounts with commas stripped. "free" or "no charge" is treated as price 0.
- Percentages.

**Normalization:** weeks → days (×7), years → months (×12). "Business days" is its own unit family and is never converted to calendar days. "two weeks" equals "14 days".

**Comparable quantities:** a claim quantity and an evidence quantity are comparable if they share the same kind and unit family AND their sentences share at least one topic keyword (stopword-filtered, lightly stemmed, e.g. "refund", "warranty", "express").

**Decision per claim:**

| Condition | Result |
|---|---|
| Claim has no quantities | unresolved → LLM judge |
| Some claim quantity has a comparable evidence quantity with a different value, and no comparable evidence quantity has the claimed value | CONTRADICTED (`checked_by="deterministic"`) |
| Every claim quantity has an equal-valued comparable evidence quantity AND content-word overlap with that evidence sentence ≥ `DET_SUPPORT_OVERLAP` (default 0.6) | SUPPORTED (`checked_by="deterministic"`) |
| Anything else | unresolved → LLM judge |

Thresholds live in one config module and are tuned in Phase 5 and Phase 12. Tuning is not a contract change. The deterministic result is never overridden by the LLM. Quantities that also appear in the customer's question are ignored for all deterministic decisions (CONTRADICTED and SUPPORTED), so a draft that restates the customer's own number (e.g. 'your purchase is 20 days old') is not blocked. The checker receives the question for this purpose only. For the SUPPORTED overlap check, drop only clauses that contain an echo quantity (a quantity that also appears in the customer's question). All other clauses, including clauses with no numbers, stay in the overlap calculation. A claim with an extra unsupported clause must therefore not pass as SUPPORTED.

### 7.6 llm_judge
One call per unresolved claim, with only that claim and the retrieved evidence. The question and the Maker's full draft are NOT shown to the Judge (this also blocks prompt injection in the question). Runs in parallel up to `JUDGE_CONCURRENCY`. Output is strict JSON validated by Pydantic (`JudgeOutput`, section 8).

Guards:
- `SUPPORTED` requires at least one `evidence_ids` entry that exists in the evidence provided. Otherwise it is downgraded to UNSUPPORTED.
- If the claim contains numbers (ignoring quantities that also appear in the customer's question) and a SUPPORTED verdict cites a chunk that does not contain a comparable equal value, downgrade to UNSUPPORTED. The judge receives the question for this purpose only.
- Invalid JSON: retry once, then the claim becomes UNSUPPORTED.
- Timeout: `OLLAMA_TIMEOUT_S`, treated the same as invalid JSON.
- Identical calls (same claim, same chunk ids, same policy versions, same model) are served from an in-memory cache.

### 7.7 correct
The Maker rewrites the draft using the evidence, the failing claims and the reasons. `correct` receives the customer question, and correction is a minimal edit. The rewrite must be ONE sentence that states the corrected policy fact and, if the customer's question contains a number, relates it to that number in the same sentence (e.g. "Opened electronics can be returned within 15 days, so a 20-day-old purchase is outside the return window."). No new facts, no denials, no separate sentences. 
To improve reliability, `correct_draft` uses only the evidence chunks cited by the failing claims PLUS the top 2 question-retrieval chunks (the first 2 of the evidence list), de-duplicated, max 3. The model temperature is 0. If the evidence does not contain an answer to the customer's question, the correction must output exactly CANNOT_ANSWER, and the run abstains with UNSUPPORTED. The correction is validated in code: exactly one sentence, no "I cannot" / "unable" phrasing, and it must contain the corrected value from the cited chunk. If validation fails, it retries the call once internally. If that fails, it returns the top-ranked question-retrieval chunk verbatim (evidence[0]) and notes the fallback in its telemetry reason. Correction runs only for CONTRADICTED claims (UNSUPPORTED abstains, per 7.9). The corrected draft goes back through `split_claims` and both checkers. After 2 corrections the run abstains with `RETRY_CAP`.

### 7.8 abstain
Fixed safe message (constant in `contracts.py`): "I couldn't verify this from VeriCorp's policies. Please contact support." Abstain reasons: `UNSUPPORTED`, `RETRY_CAP`, `SYSTEM_ERROR`.

### 7.9 Design decisions
- An UNSUPPORTED claim is never "corrected" in the first pass. The run abstains. (Keeps behavior predictable and easy to defend; a future option is to strip unsupported sentences.)
- Maker and Judge use **different model families** (configurable via env) to reduce correlated failures.
- Only one pipeline run executes at a time (a lock). A second request while busy gets an `error` event with code `BUSY`. Local models cannot serve parallel demos.
- Every LLM call has a timeout. If Ollama is down or slow, the stream emits an `error` event, then `final` with `ABSTAINED/SYSTEM_ERROR`, then `run_finished`, and ends cleanly. The UI never hangs.

## 8. Data contracts (FROZEN — Pydantic v2 in `backend/contracts.py`)

```python
from typing import Literal, Optional
from pydantic import BaseModel

ClaimStatus   = Literal["SUPPORTED", "CONTRADICTED", "UNSUPPORTED"]
FinalStatus   = Literal["DELIVERED", "CORRECTED", "ABSTAINED"]
CheckedBy     = Literal["deterministic", "llm"]
AbstainReason = Literal["UNSUPPORTED", "RETRY_CAP", "SYSTEM_ERROR"]

ABSTAIN_MESSAGE = "I couldn't verify this from VeriCorp's policies. Please contact support."

class Evidence(BaseModel):
    source: str            # "refund_policy.md"
    version: str           # "v2"
    text: str              # exact chunk text
    chunk_id: str          # "refund_policy.md#3"

class ClaimSpan(BaseModel):
    id: int
    text: str              # exact substring of the draft it belongs to
    start: int             # char offset in that draft
    end: int

class Claim(ClaimSpan):
    status: ClaimStatus
    checked_by: CheckedBy
    reason: str            # one short sentence
    evidence: list[Evidence]   # chunks cited; empty for UNSUPPORTED with no citation

class JudgeOutput(BaseModel):          # what the LLM judge must return
    status: ClaimStatus
    reason: str                        # max 200 chars
    evidence_ids: list[str]            # chunk_ids from the provided evidence

class RunResult(BaseModel):
    run_id: str                        # short uuid4 hex
    question: str
    chaos: bool
    draft: str                         # first Maker draft
    claims: list[Claim]                # claims of the FIRST draft (drives tracked changes)
    final_draft: str                   # last draft that was checked (== draft if retries == 0)
    final_claims: list[Claim]          # claims of final_draft (drives evidence for inserts and badge)
    final_answer: str                  # final_draft, or ABSTAIN_MESSAGE
    final_status: FinalStatus
    abstain_reason: Optional[AbstainReason]
    retries: int                       # 0..2
    latency_ms: dict[str, int]         # retrieve, maker, check, judge, correct, total
    tokens: dict[str, int]             # maker (incl. correction), judge
    policy_versions: dict[str, str]    # only policies cited by evidence, e.g. {"refund_policy.md": "v2"}
    created_at: str                    # ISO 8601 UTC
```

**Validation rules (enforced by a `model_validator` on `RunResult`, all covered by tests):**
1. Every `claims[i].text == draft[start:end]`; every `final_claims[i].text == final_draft[start:end]`. Otherwise fall back to sentence-split spans.
2. `DELIVERED`: `retries == 0`, `final_answer == draft`, all `final_claims` SUPPORTED, `abstain_reason is None`.
3. `CORRECTED`: `1 <= retries <= 2`, `final_answer == final_draft != draft`, all `final_claims` SUPPORTED, `abstain_reason is None`.
4. `ABSTAINED`: `final_answer == ABSTAIN_MESSAGE`, `abstain_reason` set.
5. `retries <= 2` always.

`JudgeOutput` is internal to the Judge but lives in `contracts.py`. Benchmark file schema is in section 13 (data, not a code contract).

## 9. Streaming events (SSE, `POST /api/ask`)

Each event is `event: <name>\ndata: <json>\n\n`. The browser client must use `fetch` with a `ReadableStream` reader, not `EventSource` (which cannot POST).

`attempt` is 0 for the first draft, 1 or 2 for corrected drafts.

| event | data |
|---|---|
| `run_started` | `{run_id, question, chaos}` |
| `retrieved` | `{evidence: Evidence[]}` (question retrieval) |
| `draft` | `{text}` (first draft) |
| `claims` | `{attempt, claims: ClaimSpan[]}` (spans only, no status yet) |
| `claim_checked` | `{attempt, claim: Claim}` (one per claim, as each resolves) |
| `correcting` | `{attempt, feedback}` (`attempt` is the correction number, 1 or 2) |
| `corrected_draft` | `{attempt, text}` |
| `final` | `{answer, status: FinalStatus, abstain_reason: AbstainReason \| null}` |
| `run_finished` | `{result: RunResult}` |
| `error` | `{code: "BUSY" \| "OLLAMA_DOWN" \| "TIMEOUT" \| "INTERNAL", message}` |

Ordering guarantees: `run_started` first, `run_finished` last, even after an `error`. Every run ends with exactly one `final`.

**Mock file:** `frontend/mocks/events.json` mirrors these for offline frontend work and must contain three scenarios: `corrected` (headphone example, chaos), `delivered` (clean pass) and `abstained` (drone delivery). Shape: `{ "scenarios": { "corrected": [{event, data}, ...], "delivered": [...], "abstained": [...] } }`. Mock offsets are computed by code. The Ledger and Policies screens are built directly against the live API (Phase 11).

## 10. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ask` | body `{question, chaos}` → SSE stream (section 9) |
| GET | `/api/runs?limit&offset&source` | Ledger list. Row: `{run_id, question, final_status, chaos, source, created_at, total_ms, stale}` |
| GET | `/api/runs/{id}` | full `RunResult` for replay |
| GET | `/api/metrics` | aggregate metrics (section 12), computed from DB |
| GET | `/api/policies` | `[{name, version, effective_date, updated_at}]` |
| GET | `/api/policies/{name}` | `{name, version, text}` |
| PUT | `/api/policies/{name}` | body `{text}`. Validates front-matter, bumps version, stores in DB, re-indexes that policy, returns `{name, version, stale_run_ids}` |
| POST | `/api/benchmark/run` | body `{modes: ["normal","chaos"]}` → SSE stream of per-case results, then a summary |
| GET | `/api/benchmark/latest` | the last completed benchmark summary (real stored result) |
| GET | `/api/health` | `{ollama, models_present, db, chroma}` |

Errors: JSON `{code, message}` with a proper HTTP status. CORS origin from `CORS_ORIGINS`.

**Stale run definition:** a run is stale if at least one policy in its `policy_versions` now has a newer version in `policy_versions` table. `stale_run_ids` from PUT lists exactly those runs.

**Benchmark guard:** the benchmark refuses to start (clear error) if any policy is not at its seed version, because ground truth is written against the seeds.

## 11. Storage (SQLite, WAL mode)

| Table | Contents |
|---|---|
| `runs` | `run_id`, `result_json` (full RunResult), `final_status`, `chaos`, `source` (`live` or `benchmark`), `created_at`, `total_ms` |
| `claims` | one row per claim of the first draft: `run_id`, `claim_id`, `status`, `checked_by`, `text` |
| `policy_versions` | `name`, `version`, `text`, `effective_date`, `created_at` (append-only) |
| `benchmark_runs` | `id`, `started_at`, `finished_at`, `modes`, `summary_json` |
| `benchmark_cases` | `benchmark_run_id`, `case_id`, `mode`, `run_id`, `draft_good`, `final_good`, `outcome` |

Every metric is computed from these tables at request time. No cached or hardcoded metrics anywhere. Reset command: `python -m backend.db.reset` (`--policies` restores seed policy versions, `--runs` clears runs).

## 12. Metrics (definitions, computed only from DB)

`GET /api/metrics` returns:

```json
{
  "answers_checked": 0, "wrong_drafts": 0,
  "delivered_clean": 0, "corrected": 0, "abstained": 0,
  "chaos_runs": 0,
  "grounding_rate": null,
  "first_pass_clean_rate": null,
  "drift": [{"window_end": "ISO", "first_pass_clean_rate": 0.0, "runs": 0}],
  "policy_changes": [{"name": "", "from": "", "to": "", "at": "ISO"}],
  "latency_ms": {"retrieve": 0, "maker": 0, "check": 0, "judge": 0, "correct": 0, "total": 0},
  "tokens": {"maker": 0, "judge": 0}
}
```

Definitions:
- **Answers checked:** count of live runs (`source=live`).
- **Wrong drafts:** live runs whose first draft had at least one CONTRADICTED claim.
- **Delivered clean / Corrected / Abstained:** counts by `final_status`.
- **Grounding rate:** SUPPORTED claims / total claims (first drafts). `null` when there are no claims.
- **First-pass clean rate:** live runs where the first draft had no CONTRADICTED and no UNSUPPORTED claims / live runs.
- **Accuracy drift:** rolling first-pass clean rate over a window of the last N live runs (default N=10), plotted with vertical markers at each policy version change (`policy_changes`). This shows what a policy change does to past answers and to the Maker's first-pass quality. The chart never implies drift that the data does not show.
- **Latency:** average per stage and total (ms). **Tokens:** Maker vs Judge, from Ollama's `prompt_eval_count` + `eval_count`.
- Benchmark rates come from `benchmark_runs.summary_json` only, never mixed with live counts. Chaos runs are counted and labeled ("N of these used Chaos mode").

The Ledger's summary sentence uses live runs only. Every number on screen is labeled as measured on our own runs or benchmark.

## 13. Benchmark

`data/benchmark.json`, 40 cases: direct (10), paraphrased (8), multi-part (6), false-premise (8), unanswerable (8). Run in `normal` and `chaos` mode (80 runs; at least the normal mode must complete within a demo-friendly time, see section 16).

Case schema:

```json
{
  "id": "B01",
  "category": "direct | paraphrased | multi_part | false_premise | unanswerable",
  "question": "",
  "ground_truth": "human-readable answer",
  "expected_behavior": "ANSWER | ABSTAIN",
  "expected_facts": ["15 days"],
  "forbidden_facts": ["30 days"]
}
```

`expected_facts` and `forbidden_facts` are short strings. Numbers, durations and prices are compared after the same normalization as section 7.5; everything else is a case-insensitive substring match. False-premise cases put the wrong value from the question in `forbidden_facts`. ABSTAIN cases have empty fact lists.

**Grading is done by code, never by an LLM.** A text is "good" if:
- ANSWER case: every expected fact is present and no forbidden fact is present.
- ABSTAIN case: the text is the abstain message (drafts that assert anything are "bad").

**Rates (per mode):**
- **Baseline accuracy (without VeriTrust):** good first drafts / cases.
- **VeriTrust accuracy:** cases where the customer outcome is good / cases. Good outcome = ANSWER case with a good final answer not abstained, or ABSTAIN case that ended ABSTAINED.
- **Detection rate:** bad first drafts that did not reach the customer unchanged (final status CORRECTED or ABSTAINED) / bad first drafts.
- **False-approval rate:** bad first drafts with final status DELIVERED / bad first drafts.
- **Correct-abstention rate:** ABSTAIN cases that ended ABSTAINED / ABSTAIN cases.
- **Over-abstention rate:** ANSWER cases that ended ABSTAINED / ANSWER cases (the price of safety, reported openly).
- **Correction success:** bad first drafts on ANSWER cases that ended CORRECTED with a good final answer / bad first drafts on ANSWER cases.

Stored per case so any row can be hand-checked against ground truth.

## 14. Frontend (Next.js App Router + TypeScript strict + Tailwind)

Concept: **"Track Changes for AI"** — a document-review experience. NOT a control center. NO KPI card grids, gauges or generic dashboard widgets.

**Look:** light, warm off-white, editorial. Serif for answer text, mono for evidence and IDs. One accent for corrections, one for refusals, everything else neutral. Libraries: Framer Motion, `diff-match-patch`, Recharts (one line chart only).

**Data flow:** all API calls go through one client module. `NEXT_PUBLIC_USE_MOCKS=true` reads `frontend/mocks/events.json`, otherwise the live SSE endpoint, with no component changes.

### Screen 1: Review (main)
- Center: the answer as a document. Rendering rules:
  - Base text is `draft`. Claim spans from `claims` colour the status: CONTRADICTED gets strikethrough (correction accent), UNSUPPORTED gets a yellow underline.
  - A word-level diff (`diff-match-patch`) from `draft` to `final_answer` produces struck text (in draft only) and green inserts (in final only).
  - `ABSTAINED`: the whole draft is struck through in the refusal accent, with the refusal message below it.
  - The strike-through then insert-typing animation is the signature moment.
- Right margin: one comment per marked claim. Contradicted or unsupported claims show the reason and the cited evidence (quote, source, version). Inserts show the evidence from `final_claims`. Clicking a claim highlights its comment and the reverse.
- Left: thin vertical live timeline: Retrieve → Draft → Check claims → Correct → Verified. Driven by SSE events, with per-stage time once known. Plain list with a progress line.
- Toggle: **Customer view** (final answer plus badge "Verified against <source> <version>", clicking opens the exact chunk; or the refusal message) vs **Reviewer view** (all marks, comments, timeline).
- **Chaos mode** toggle, always visibly labeled "Simulated failure". Runs made with it show a persistent "Chaos" tag.

### Screen 2: Ledger
- One large plain sentence from live runs: "142 answers checked. 23 were wrong. 21 fixed, 2 refused." plus a small note if chaos runs are included.
- One small line chart: rolling first-pass clean rate with policy-change markers.
- A log list: ✓ passed, ✎ corrected, ⊘ refused | question | time | tags (chaos, benchmark, stale). Click a row to replay it as tracked changes from `GET /api/runs/{id}`.
- **"Run the gauntlet"** button: streams benchmark rows into the log as they finish, then shows detection, false-approval, correct-abstention and over-abstention rates as plain text lines, plus baseline vs VeriTrust accuracy. Also shows "Last run" from `/api/benchmark/latest` if one exists.

### Screen 3: Policies
List of policy files with versions; textarea editor; save shows the banner "N past answers are now out of date"; re-asking works immediately with the new version.

### States (every screen)
Loading, empty and error states. Errors from the `error` event (Ollama down, busy, timeout) show a clear message and never leave a spinner running.

## 15. Configuration (`.env.example`)

```
MAKER_MODEL=llama3.1:8b        # 3B fallback: llama3.2:3b
JUDGE_MODEL=qwen2.5:7b         # 3B fallback: qwen2.5:3b
EMBED_MODEL=nomic-embed-text
OLLAMA_HOST=http://localhost:11434
OLLAMA_TIMEOUT_S=60
OLLAMA_KEEP_ALIVE=30m
CHROMA_DIR=./.chroma
DB_PATH=./veritrust.db
POLICIES_DIR=./data/policies
RETRIEVAL_K=4
DRAFT_RETRIEVAL=true
MAX_CORRECTIONS=2
JUDGE_CONCURRENCY=2
DET_SUPPORT_OVERLAP=0.6
API_PORT=8000
CORS_ORIGINS=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_USE_MOCKS=true
```

No API keys anywhere. Model names, hosts, ports and paths are never hardcoded in logic. All LLM outputs that feed logic use Ollama's JSON `format` and are validated by Pydantic; one retry, then a safe fallback (UNSUPPORTED → abstain).

## 16. Performance and reliability

- Measure tokens/sec on every machine on day one. Under about 8 tokens/sec, use the 3B models. The demo runs on the fastest machine, and the benchmark numbers used in the pitch come from that machine.
- Two different 8B models need roughly 12 GB or more of free memory to stay loaded together. If they do not fit, Ollama swaps them and every stage pays a reload cost. In that case use the 3B pair. The start script warms both models (`OLLAMA_KEEP_ALIVE`).
- Deterministic checks resolve most numeric claims, so the LLM handles only leftovers. Judge calls run in parallel and are cached.
- Report measured latency per stage for every pipeline change. Targets (to be measured, not promised): a clean run in about 20 s or less and a run with corrections in about 45 s or less on the demo machine. If the benchmark in both modes takes too long, the gauntlet may run `normal` first and `chaos` as an optional second pass.
- Fallback demo video is recorded before the presentation.

## 17. Acceptance criteria (definition of done)

- [ ] Correct question → DELIVERED with evidence badge.
- [ ] Chaos wrong number → claim struck through, corrected, re-verified, final CORRECTED.
- [ ] Unanswerable question → ABSTAINED with the fixed safe message.
- [ ] Greeting or sign-off sentences in a draft never cause an abstain.
- [ ] Retry cap of 2 enforced (proven by a forced always-contradicted case that ends ABSTAINED/RETRY_CAP after exactly 2 retries).
- [ ] Ollama stopped mid-run → clear `error`, safe abstain, stream ends, UI does not hang.
- [ ] Second request while a run is active → `BUSY` error, no corruption.
- [ ] Policy edit changes the next answer and flags stale runs; `db.reset --policies` restores the seeds.
- [ ] Every RunResult passes its validators (section 8).
- [ ] Ledger numbers match direct SQLite queries (both pasted in the report).
- [ ] Benchmark of 40 cases runs from the UI and reports real rates; at least 5 cases hand-checked against ground truth.
- [ ] Full flow works 5 consecutive times from a cold start using one command.
- [ ] No hardcoded metrics, no mock data in live code paths, no paid API calls, no keys in the repo.
- [ ] Judge JSON validity rate reported over at least 20 calls.
- [ ] Fallback demo video recorded.

## 18. Team and phases

| Role | Owner scope |
|---|---|
| Agent (A) | Maker, claim splitting, deterministic checker, LLM judge, correction, tuning |
| Chaining (C) | Contracts, LangGraph, FastAPI, SSE, SQLite |
| Frontend (F) | All UI, mock-first then live |
| Data (D) | Policies, retrieval, benchmark |

| # | Phase | Owner | Verify |
|---|---|---|---|
| 1 | Repo, contracts, env, 3-scenario mock events | C | pytest passes; offsets hand-checked |
| 2 | Policies and retrieval | D | 9–10 of 10 questions return the right rank-1 chunk |
| 3 | Frontend scaffold and customer chat (mock) | F | click-through on mock scenarios |
| 4 | Maker and chaos mode, model choice, latency | A | chaos gives wrong numbers reliably; latency measured |
| 5 | Claim splitting and deterministic checker | A | 10+ hand-written drafts give expected verdicts; splitter edge cases; overlap filter drops echo clauses |
| 6 | LLM judge and correction | A | JSON validity over 20 calls; guards tested including echo-number |
| 7 | LangGraph pipeline and SQLite logging | C | forced failing case stops after 2 retries; DB rows inspected |
| 8 | Review screen with tracked changes (mock) | F | all three scenarios render correctly |
| 9 | FastAPI, SSE, ledger and policy endpoints | C | curl showing the full SSE sequence for a real run |
| 10 | Benchmark (40 cases) and runner | D | 5 cases hand-checked; rates computed per section 13 |
| 11 | Ledger, policies screen, gauntlet, live hookup | F | screen numbers equal direct SQLite queries |
| 12 | Tuning, regression, fallback video | A, everyone | 5 clean runs; video recorded |

Order: (1) → (2, 3, 4) → (5, 8) → (6, 7) → (9, 10) → (11) → (12).

## 19. Demo script (3 minutes)

1. Chaos on: "Can I return opened headphones after 20 days?" → Maker says 30 days → struck through, 15 days inserted, evidence comment, verified badge.
2. "Do you offer drone delivery?" → abstains.
3. Edit refund policy 15 → 10 days, re-ask, answer changes to 10, Ledger shows stale runs.
4. Run the gauntlet, show real benchmark rates (or the stored latest run if time is short).
5. Close: "VeriTrust doesn't make AI smarter. It makes AI accountable."

Before every rehearsal and the final demo: `python -m backend.db.reset --policies` so step 3 starts from 15 days.

## 20. Judge Q&A prep (use these terms out loud)

- *Which agentic framework?* LangGraph. Explicit state, conditional routing, and a bounded correction loop (Maker → Judge → Correct, max 2). Tool steps: retrieval, generation, deterministic verification, LLM entailment, correction, abstention, logging.
- *Why not just ask an LLM to judge?* Small models miss numeric contradictions and can hallucinate a verdict. We check numbers in code first, and an LLM verdict is only accepted if it cites a real evidence chunk.
- *Output validation?* Pydantic v2 schemas on every LLM output, Ollama JSON mode, one retry, then safe fallback to UNSUPPORTED/abstain.
- *What if the Judge is wrong?* We measure false-approval and over-abstention openly on our own benchmark, graded by code, and abstain when unsure.
- *Why two models?* Different families reduce correlated failures between Maker and Judge.
- *Is Chaos mode cheating?* It is a labeled simulated failure to measure the guardrail; the benchmark also counts natural failures.
- *Why local Ollama?* No paid keys, data stays on the machine, and it reflects an on-prem enterprise setting.
- *Retrieval limits?* We retrieve on both the question and the draft. A claim outside the retrieved chunks is UNSUPPORTED, which is a safe failure.
- *Prompt injection in the question?* The Judge never sees the question, only one claim and the evidence.
- *What is out of scope?* PDF upload, human review, source authority ranking, multi-tenant. Listed as future work.

## 21. Risks and cuts

| Risk | Mitigation |
|---|---|
| Local model speed | 3B fallback, deterministic-first checking, parallel judge calls, caching, warm-up |
| Small-model JSON failures | Ollama JSON mode, Pydantic, one retry, safe fallback |
| Maker will not hallucinate on demand | Chaos mode (labeled simulation) |
| Deterministic checker false verdicts | Comparable-quantity rule, topic keyword requirement, overlap threshold, 10+ hand-written tests, tuning in Phase 12 |
| Benchmark takes too long | normal mode first, chaos optional, stored latest result |
| Contract drift between frontend and backend | Frozen contracts, PRD-first changes, shared mock |

Cut order if time runs short: token display → animation polish → policy diff view (keep the textarea) → chaos benchmark pass. Never cut: Review screen with tracked changes, abstain path, benchmark, retry cap.

## 22. Changes from v1

- Fixed the `claims` event conflict (PENDING did not exist): spans-only `ClaimSpan`, statuses via `claim_checked`.
- Added `attempt` to `claims`, `claim_checked` and `corrected_draft`, so the UI can tell first-draft checks from re-verification.
- Added `final_draft`, `final_claims` and `abstain_reason` to `RunResult`, plus status invariants enforced by a validator.
- Added `JudgeOutput` with mandatory evidence citation, and downgrade guards.
- Added non-factual sentence rule, sentence-splitter requirements and Maker output constraints.
- Specified the deterministic checker (extraction, normalization, comparable quantities, decision table).
- Added `retrieve_for_draft` node.
- Defined routing for mixed CONTRADICTED and UNSUPPORTED claims.
- Defined stale runs, runtime policy versioning, seed reset, and a benchmark guard.
- Separated live runs from benchmark runs (`source`), and redefined drift as a rolling first-pass clean rate with policy-change markers.
- Defined benchmark grading by code, added `forbidden_facts`, over-abstention rate and baseline accuracy.
- Added a run lock (`BUSY`), error codes, health details, `/api/benchmark/latest`, full env list, and performance targets.
- Required three mock scenarios (corrected, delivered, abstained) and a `fetch` stream client instead of `EventSource`.
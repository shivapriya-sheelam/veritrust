# VeriTrust AI — Agent Rules

Place this file at `.agent/rules/veritrust.md` (or `AGENTS.md` at the repo root). Read `PRD.md` and this file at the start of EVERY session and EVERY task.

## 1. Source of truth

- `PRD.md` is the spec. Contracts (Pydantic schemas, SSE events, API paths) are FROZEN.
- Never change a contract in code alone. If a change is needed: stop, tell me, update `PRD.md` first, then update both backend and frontend.
- If the PRD is ambiguous or missing something, ASK. Do not invent behavior.

## 2. Scope discipline

- Do ONLY the task in the current prompt. Do not add features, files, endpoints, agents, dependencies or refactors that were not requested.
- Respect the non-goals in PRD section 4. No auth, PDF upload, extra agents, KPI-card dashboards, Docker orchestration.
- Only touch files in the owner's area for the current phase. Do not edit other areas' files without saying so.

Areas: `backend/agents/` (A), `backend/graph/` + `backend/api/` + `backend/contracts.py` + `backend/db/` (C), `frontend/` (F), `data/` + `backend/retrieval/` + `eval/` (D).

## 3. Tech stack (fixed, do not swap)

- Backend: Python 3.11+, FastAPI, uvicorn, python-dotenv, httpx, pytest-asyncio, LangGraph, Pydantic v2, ChromaDB, SQLite, `ollama` Python client.
- Frontend: Next.js (App Router), TypeScript, Tailwind, Framer Motion, `diff-match-patch`, one chart lib (Recharts) for a single line chart.
- LLMs: **Ollama local only.** Never call OpenAI, Anthropic, Google or any paid or keyed API. No API keys anywhere in the repo.
- Model names, hosts and URLs come from env vars (`MAKER_MODEL`, `JUDGE_MODEL`, `EMBED_MODEL`, `OLLAMA_HOST`, `NEXT_PUBLIC_API_URL`). Never hardcode `127.0.0.1`, ports or model names in logic.

## 4. Non-negotiable engineering rules

1. **Validate every LLM output** with Pydantic. Use Ollama's JSON `format`. On validation failure retry once, then fall back safely (a claim becomes UNSUPPORTED; the run abstains). Never use raw LLM text in logic.
2. **No hardcoded or fake metrics.** Every number shown in the UI must be computed from SQLite. No fixed confidence values, no placeholder counts, no mock data on live code paths. Mock data lives only in `frontend/mocks/` and is used only when `NEXT_PUBLIC_USE_MOCKS=true`.
3. **The Judge never uses its own knowledge.** It compares claims only against retrieved policy evidence. No evidence → UNSUPPORTED.
4. **Deterministic checks first.** Numbers, durations, prices are checked in code before any LLM call. The LLM judge only sees unresolved claims, one claim per call.
5. **Bounded loops.** Correction retries max 2, then abstain. Every LLM call has a timeout. No unbounded loops or recursion.
6. **Claim spans must be exact.** `Claim.text == draft[start:end]`. If not, fall back to sentence-split spans.
7. **Graceful failures.** If Ollama is down or slow, return a clear `error` event and a safe abstain. Never crash the stream, never hang the UI.
8. **Chaos mode is a labeled simulation.** It must be visible in the UI and in stored runs (`chaos=true`). Never present it as natural model behavior.
9. **Secrets and paths.** Config via `.env` (provide `.env.example`). Nothing sensitive committed.
10. **Types and structure.** Full type hints in Python, strict TypeScript, no `any`. Small functions with docstrings on public ones. No dead code, no commented-out blocks.

## 5. Frontend rules

- Concept is "Track Changes for AI" (PRD section 14). NOT a control center. **No KPI card grids, no gauges, no generic dashboard widgets.**
- Style: light warm off-white, serif for answer text, mono for evidence and IDs, two accent colors max (corrections, refusals).
- Build against `frontend/mocks/events.json` first, then switch to the live API by env flag, with no code changes needed to the components.
- All API calls go through one client module. Consume SSE events exactly as specified in PRD section 9.
- Handle loading, empty and error states for every screen.
- Keep components small and readable. Do not add UI libraries beyond those in section 3.

## 6. Workflow for every task (mandatory)

1. Restate the task and list the files you will touch. Wait for no approval unless something is unclear.
2. Implement only that.
3. **Verify with real evidence** and paste it in your report. "Should work" is not acceptable. Evidence means: actual terminal output, actual DB query results, actual API responses, actual test results.
4. Write or update a test for the behavior (pytest for backend, simple component or script checks for frontend). Do not weaken or delete a test to make it pass. If a test fails, fix the code and explain the root cause.
5. Report in this format:

```
DONE: <what was built>
FILES: <changed files>
EVIDENCE: <commands run + real output>
KNOWN ISSUES: <honest list, or "none found">
NOT DONE: <anything skipped>
```

6. Never claim a feature is finished unless you ran it. If you could not run it, say so plainly.
7. Do not fabricate examples, outputs, benchmark results or screenshots.

## 7. Testing and verification checklist per phase

- Retrieval: 10 questions → correct source chunk returned (print rank 1 source).
- Deterministic checker: at least 10 hand-written right/wrong drafts with expected verdicts, all pass.
- LLM judge: report JSON validity rate over ≥20 calls.
- Pipeline: a forced always-contradicted case must stop after exactly 2 retries and abstain.
- API: curl or script showing the full SSE event sequence for one real run.
- Ledger: compare a displayed number against a direct `sqlite3` query, paste both.
- Benchmark: hand-check at least 5 cases against ground truth.

## 8. Git

- Commit only after a phase is verified. Message format: `phase-N: short description`.
- One phase per branch or per commit series. Do not rewrite history. Do not commit `.env`, model files or the vector store.

## 9. Performance awareness

- Local models are slow. Report measured latency per stage for every pipeline change.
- Run independent claim checks in parallel where safe. Cache retrieval and identical judge calls in-memory.
- If a change makes the end-to-end run noticeably slower, say so and propose a fix instead of hiding it.

## 10. When to stop and ask

Stop and ask me before: changing any frozen contract, adding a dependency, changing a model family, changing the data folder structure, or if you cannot verify something. Prefer a short question over a wrong assumption.

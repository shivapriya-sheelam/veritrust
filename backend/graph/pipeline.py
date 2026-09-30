"""
backend/graph/pipeline.py
--------------------------
LangGraph pipeline implementing PRD section 7:
retrieve → maker → retrieve_for_draft → split_claims → deterministic_check
→ llm_judge → route → deliver | correct (loop) | abstain → log → done

Event emission follows PRD section 9 exactly.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypedDict

from langgraph.graph import StateGraph, END

from backend import config
from backend.contracts import (
    ABSTAIN_MESSAGE,
    Claim,
    ClaimSpan,
    Evidence,
    RunResult,
    # SSE event models
    RunStartedEvent,
    RetrievedEvent,
    DraftEvent,
    ClaimsEvent,
    ClaimCheckedEvent,
    CorrectingEvent,
    CorrectedDraftEvent,
    FinalEvent,
    RunFinishedEvent,
    ErrorEvent,
)
import backend.agents.splitter as _splitter_mod
import backend.agents.checker as _checker_mod
import backend.agents.judge as _judge_mod
import backend.agents.maker as _maker_mod
import backend.retrieval.retriever as _retriever_mod
from backend.agents.maker import MakerError


# ── Types ─────────────────────────────────────────────────────────────────────

EventCallback = Callable[[str, Any], None]
"""Signature: callback(event_name: str, data: BaseModel)"""


class PipelineState(TypedDict, total=False):
    """Mutable state flowing through the graph."""
    run_id: str
    question: str
    chaos: bool
    attempt: int
    # Evidence
    question_evidence: list[Evidence]
    merged_evidence: list[Evidence]
    # Drafts
    draft: str
    current_draft: str
    # Claims
    current_claims_spans: list[ClaimSpan]
    first_claims: list[Claim]
    current_claims: list[Claim]
    # Tokens and latency
    tokens_maker: int
    tokens_judge: int
    latency_retrieve: int
    latency_maker: int
    latency_check: int
    latency_judge: int
    latency_correct: int
    # Result
    final_status: str
    abstain_reason: str | None
    final_answer: str
    retries: int
    policy_versions: dict[str, str]
    # Control
    route_decision: str
    error_occurred: bool
    error_event: ErrorEvent | None
    callback: EventCallback | None
    t_start: float
    run_result: RunResult | None


def _emit(state: PipelineState, event_name: str, data: Any) -> None:
    """Emit an event through the callback if one is set."""
    cb = state.get("callback")
    if cb:
        cb(event_name, data)


# ── Node functions ────────────────────────────────────────────────────────────

def node_retrieve(state: PipelineState) -> dict:
    """PRD 7.1: retrieve top-k chunks for the question."""
    t0 = time.perf_counter()
    try:
        evidence = _retriever_mod.retrieve(state["question"])
    except Exception:
        evidence = []
    latency = int((time.perf_counter() - t0) * 1000)

    _emit(state, "retrieved", RetrievedEvent(evidence=evidence))

    return {
        "question_evidence": evidence,
        "latency_retrieve": latency,
    }


def node_maker(state: PipelineState) -> dict:
    """PRD 7.2: generate a draft answer."""
    t0 = time.perf_counter()
    draft_text, tokens = _maker_mod.make_draft(
        state["question"],
        state["question_evidence"],
        state["chaos"],
    )
    latency = int((time.perf_counter() - t0) * 1000)

    _emit(state, "draft", DraftEvent(text=draft_text))

    return {
        "draft": draft_text,
        "current_draft": draft_text,
        "tokens_maker": state.get("tokens_maker", 0) + tokens.get("maker", 0),
        "latency_maker": state.get("latency_maker", 0) + latency,
    }


def node_retrieve_for_draft(state: PipelineState) -> dict:
    """PRD 7.3: second retrieval using draft text, merge with question chunks."""
    t0 = time.perf_counter()
    try:
        merged = _retriever_mod.retrieve_for_draft(
            state["current_draft"],
            state["question_evidence"],
        )
    except Exception:
        merged = list(state["question_evidence"])
    latency = int((time.perf_counter() - t0) * 1000)

    # Add to retrieve latency
    return {
        "merged_evidence": merged,
        "latency_retrieve": state.get("latency_retrieve", 0) + latency,
    }


def node_split_claims(state: PipelineState) -> dict:
    """PRD 7.4: split current draft into claim spans."""
    claims_spans = _splitter_mod.split_claims(state["current_draft"])

    _emit(state, "claims", ClaimsEvent(
        attempt=state.get("attempt", 0),
        claims=claims_spans,
    ))

    return {"current_claims_spans": claims_spans}


def node_check(state: PipelineState) -> dict:
    """PRD 7.5 + 7.6: deterministic check then LLM judge for unresolved."""
    spans: list[ClaimSpan] = state["current_claims_spans"]
    evidence = state["merged_evidence"]
    question = state["question"]
    attempt = state.get("attempt", 0)

    t0_check = time.perf_counter()
    resolved: list[Claim] = []
    unresolved: list[ClaimSpan] = []

    for span in spans:
        result = _checker_mod.deterministic_check(span, evidence, question)
        if result is not None:
            resolved.append(result)
            _emit(state, "claim_checked", ClaimCheckedEvent(
                attempt=attempt, claim=result,
            ))
        else:
            unresolved.append(span)

    latency_check = int((time.perf_counter() - t0_check) * 1000)

    # LLM judge for unresolved claims
    t0_judge = time.perf_counter()
    judge_tokens = 0

    for span in unresolved:
        if span.text.strip() == "CANNOT_ANSWER":
            claim = Claim(
                id=span.id, text=span.text, start=span.start, end=span.end,
                status="UNSUPPORTED", checked_by="deterministic",
                reason="Corrector could not find an answer", evidence=[],
            )
            stats = {"tokens": 0}
        else:
            try:
                claim, stats = _judge_mod.judge_claim(span, evidence, question)
            except Exception:
                # Fallback to UNSUPPORTED on any judge error
                claim = Claim(
                    id=span.id, text=span.text, start=span.start, end=span.end,
                    status="UNSUPPORTED", checked_by="llm",
                    reason="Judge error or timeout", evidence=[],
                )
                stats = {"tokens": 0}
        resolved.append(claim)
        judge_tokens += stats.get("tokens", 0)
        _emit(state, "claim_checked", ClaimCheckedEvent(
            attempt=attempt, claim=claim,
        ))

    latency_judge = int((time.perf_counter() - t0_judge) * 1000)

    # Sort by original order
    resolved.sort(key=lambda c: c.id)

    # Store first-draft claims
    updates: dict = {
        "current_claims": resolved,
        "latency_check": state.get("latency_check", 0) + latency_check,
        "latency_judge": state.get("latency_judge", 0) + latency_judge,
        "tokens_judge": state.get("tokens_judge", 0) + judge_tokens,
    }
    if attempt == 0:
        updates["first_claims"] = resolved

    return updates


def node_route(state: PipelineState) -> dict:
    """PRD 7 routing: decide deliver / correct / abstain."""
    claims = state["current_claims"]
    attempt = state.get("attempt", 0)
    max_corr = config.MAX_CORRECTIONS

    has_contradicted = any(c.status == "CONTRADICTED" for c in claims)
    has_unsupported = any(c.status == "UNSUPPORTED" for c in claims)
    all_supported = all(c.status == "SUPPORTED" for c in claims)

    if not claims:
        return {"route_decision": "abstain_unsupported"}
    elif all_supported:
        return {"route_decision": "deliver"}
    elif has_contradicted and attempt < max_corr:
        return {"route_decision": "correct"}
    elif has_contradicted and attempt >= max_corr:
        return {"route_decision": "abstain_retry_cap"}
    elif not has_contradicted and has_unsupported:
        return {"route_decision": "abstain_unsupported"}
    else:
        # Fallback: should not reach here, but abstain safely
        return {"route_decision": "abstain_unsupported"}


def node_correct(state: PipelineState) -> dict:
    """PRD 7.7: correct only CONTRADICTED claims."""
    attempt = state.get("attempt", 0) + 1
    claims = state["current_claims"]
    evidence = state["merged_evidence"]
    question = state["question"]

    failing = [c for c in claims if c.status == "CONTRADICTED"]
    feedback_parts = []
    for c in failing:
        feedback_parts.append(f"- Claim '{c.text}': {c.reason}")
    feedback = "\n".join(feedback_parts)

    _emit(state, "correcting", CorrectingEvent(
        attempt=attempt, feedback=feedback,
    ))

    t0 = time.perf_counter()
    corrected_text, tokens = _maker_mod.correct_draft(
        question, state["current_draft"], failing, evidence,
    )
    latency = int((time.perf_counter() - t0) * 1000)

    _emit(state, "corrected_draft", CorrectedDraftEvent(
        attempt=attempt, text=corrected_text,
    ))

    return {
        "current_draft": corrected_text,
        "attempt": attempt,
        "tokens_maker": state.get("tokens_maker", 0) + tokens.get("maker", 0),
        "latency_correct": state.get("latency_correct", 0) + latency,
        "retries": attempt,
    }


def node_deliver(state: PipelineState) -> dict:
    """PRD 7: all claims SUPPORTED → deliver (or CORRECTED if retries > 0)."""
    answer = state["current_draft"]
    retries = state.get("retries", 0)
    status = "CORRECTED" if retries > 0 else "DELIVERED"

    _emit(state, "final", FinalEvent(
        answer=answer, status=status, abstain_reason=None,
    ))
    return {
        "final_status": status,
        "final_answer": answer,
        "abstain_reason": None,
    }


def node_abstain(state: PipelineState) -> dict:
    """PRD 7.8: abstain with reason."""
    decision = state["route_decision"]
    if decision == "abstain_retry_cap":
        reason = "RETRY_CAP"
    elif decision == "abstain_system_error":
        reason = "SYSTEM_ERROR"
    else:
        reason = "UNSUPPORTED"

    _emit(state, "final", FinalEvent(
        answer=ABSTAIN_MESSAGE, status="ABSTAINED", abstain_reason=reason,
    ))

    return {
        "final_status": "ABSTAINED",
        "final_answer": ABSTAIN_MESSAGE,
        "abstain_reason": reason,
    }


def node_log(state: PipelineState) -> dict:
    """Build the RunResult and emit run_finished. SQLite write is done by caller."""
    # Compute policy_versions from evidence cited by final claims
    pv: dict[str, str] = {}
    for c in state.get("current_claims", []):
        for ev in c.evidence:
            if ev.source not in pv:
                pv[ev.source] = ev.version
    # Also from first claims
    for c in state.get("first_claims", []):
        for ev in c.evidence:
            if ev.source not in pv:
                pv[ev.source] = ev.version

    total_ms = int((time.perf_counter() - state["t_start"]) * 1000)

    # Determine correct final_draft and final_answer for each status
    final_status = state["final_status"]
    retries = state.get("retries", 0)
    draft = state["draft"]
    current_draft = state["current_draft"]
    first_claims = state.get("first_claims", [])
    current_claims = state.get("current_claims", [])

    if final_status == "DELIVERED":
        final_draft = draft
        final_claims = first_claims
        final_answer = draft
    elif final_status == "CORRECTED":
        final_draft = current_draft
        final_claims = current_claims
        final_answer = current_draft
    else:  # ABSTAINED
        final_draft = current_draft
        final_claims = current_claims
        final_answer = ABSTAIN_MESSAGE

    result = RunResult(
        run_id=state["run_id"],
        question=state["question"],
        chaos=state["chaos"],
        draft=draft,
        claims=first_claims,
        final_draft=final_draft,
        final_claims=final_claims,
        final_answer=final_answer,
        final_status=final_status,
        abstain_reason=state.get("abstain_reason"),
        retries=retries,
        latency_ms={
            "retrieve": state.get("latency_retrieve", 0),
            "maker": state.get("latency_maker", 0),
            "check": state.get("latency_check", 0),
            "judge": state.get("latency_judge", 0),
            "correct": state.get("latency_correct", 0),
            "total": total_ms,
        },
        tokens={
            "maker": state.get("tokens_maker", 0),
            "judge": state.get("tokens_judge", 0),
        },
        policy_versions=pv,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    _emit(state, "run_finished", RunFinishedEvent(result=result))

    return {"run_result": result}


# ── Router function ───────────────────────────────────────────────────────────

def _route_decision(state: PipelineState) -> str:
    """Return the next node name based on route_decision."""
    decision = state.get("route_decision", "")
    if decision == "deliver":
        return "deliver"
    elif decision == "correct":
        return "correct"
    else:
        return "abstain"


# ── Graph construction ────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    """Build and compile the VeriTrust pipeline graph."""
    graph = StateGraph(PipelineState)

    graph.add_node("retrieve", node_retrieve)
    graph.add_node("maker", node_maker)
    graph.add_node("retrieve_for_draft", node_retrieve_for_draft)
    graph.add_node("split_claims", node_split_claims)
    graph.add_node("check", node_check)
    graph.add_node("route", node_route)
    graph.add_node("correct", node_correct)
    graph.add_node("deliver", node_deliver)
    graph.add_node("abstain", node_abstain)
    graph.add_node("log", node_log)

    # Edges
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "maker")
    graph.add_edge("maker", "retrieve_for_draft")
    graph.add_edge("retrieve_for_draft", "split_claims")
    graph.add_edge("split_claims", "check")
    graph.add_edge("check", "route")

    # Conditional: route -> deliver / correct / abstain
    graph.add_conditional_edges("route", _route_decision, {
        "deliver": "deliver",
        "correct": "correct",
        "abstain": "abstain",
    })

    # correct loops back to split_claims
    graph.add_edge("correct", "split_claims")

    # deliver and abstain go to log
    graph.add_edge("deliver", "log")
    graph.add_edge("abstain", "log")

    # log -> end
    graph.add_edge("log", END)

    return graph.compile()


# ── Public entry point ────────────────────────────────────────────────────────

_compiled_graph = None


def get_graph():
    """Get or create the compiled graph (singleton)."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


def run_pipeline(
    question: str,
    chaos: bool = False,
    callback: EventCallback | None = None,
) -> RunResult:
    """
    Run the full VeriTrust pipeline for one question.

    Parameters
    ----------
    question : str
        The customer question.
    chaos : bool
        Whether to use chaos mode (labeled simulation of wrong numbers).
    callback : EventCallback | None
        Optional callback(event_name, data_model) for streaming events.

    Returns
    -------
    RunResult
        Validated pipeline result.

    Raises
    ------
    Never raises. On any error, emits error + final ABSTAINED + run_finished.
    """
    run_id = uuid.uuid4().hex[:12]
    t_start = time.perf_counter()

    # Emit run_started
    if callback:
        callback("run_started", RunStartedEvent(
            run_id=run_id, question=question, chaos=chaos,
        ))

    initial_state: PipelineState = {
        "run_id": run_id,
        "question": question,
        "chaos": chaos,
        "attempt": 0,
        "question_evidence": [],
        "merged_evidence": [],
        "draft": "",
        "current_draft": "",
        "first_claims": [],
        "current_claims": [],
        "current_claims_spans": [],
        "tokens_maker": 0,
        "tokens_judge": 0,
        "latency_retrieve": 0,
        "latency_maker": 0,
        "latency_check": 0,
        "latency_judge": 0,
        "latency_correct": 0,
        "final_status": "ABSTAINED",
        "abstain_reason": None,
        "final_answer": ABSTAIN_MESSAGE,
        "retries": 0,
        "policy_versions": {},
        "route_decision": "",
        "error_occurred": False,
        "error_event": None,
        "callback": callback,
        "t_start": t_start,
        "run_result": None,
    }

    try:
        graph = get_graph()
        final_state = graph.invoke(initial_state)

        # Extract the RunResult
        result = final_state.get("run_result")
        if result is None:
            raise RuntimeError("Pipeline did not produce a RunResult")
        return result

    except MakerError as exc:
        return _handle_error(run_id, question, chaos, t_start, callback,
                             "OLLAMA_DOWN", str(exc))
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return _handle_error(run_id, question, chaos, t_start, callback,
                             "INTERNAL", str(exc))


def _handle_error(
    run_id: str,
    question: str,
    chaos: bool,
    t_start: float,
    callback: EventCallback | None,
    code: str,
    message: str,
) -> RunResult:
    """Emit error, final ABSTAINED, and run_finished; return a valid RunResult."""
    if callback:
        callback("error", ErrorEvent(code=code, message=message))

    if callback:
        callback("final", FinalEvent(
            answer=ABSTAIN_MESSAGE,
            status="ABSTAINED",
            abstain_reason="SYSTEM_ERROR",
        ))

    total_ms = int((time.perf_counter() - t_start) * 1000)

    result = RunResult(
        run_id=run_id,
        question=question,
        chaos=chaos,
        draft="",
        claims=[],
        final_draft="",
        final_claims=[],
        final_answer=ABSTAIN_MESSAGE,
        final_status="ABSTAINED",
        abstain_reason="SYSTEM_ERROR",
        retries=0,
        latency_ms={
            "retrieve": 0, "maker": 0, "check": 0,
            "judge": 0, "correct": 0, "total": total_ms,
        },
        tokens={"maker": 0, "judge": 0},
        policy_versions={},
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    if callback:
        callback("run_finished", RunFinishedEvent(result=result))

    return result

"""
backend/agents/maker.py
-----------------------
Maker agent: drafts a customer-service answer from retrieved policy chunks.

Public API
----------
    make_draft(question, context, chaos) -> tuple[str, dict[str, int]]
        Returns (draft_text, tokens).
        tokens keys:
            "maker"            : prompt_eval_count + eval_count  (total tokens)
            "eval_count"       : generated tokens only
            "eval_duration_ms" : Ollama-reported generation time in ms
                                 (use eval_count / eval_duration_ms * 1000 for tok/s)
        Return signature is unchanged; extra keys are additive.
        Raises MakerError on connectivity / timeout failure.

    correct_draft(draft, failing_claims, evidence) -> tuple[str, dict[str, int]]
        Stub — full implementation in Phase 6.

chaos=True
----------
Labeled simulation of the failure the guardrail exists to catch.
The Maker confidently states plausible but wrong numbers.
Stored as chaos=True on the run; shown in the UI with a persistent tag.
Never presented as natural model behaviour.

Design notes
------------
- Uses the official `ollama` Python client (tech-stack rule).
- Config from backend.config; per-call overrides supported for tests.
- Plain-text output — no JSON format; Pydantic validation is the Judge's job.
- MakerError on any Ollama failure; pipeline then abstains.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import ollama as _ollama

from backend import config

if TYPE_CHECKING:
    pass  # Evidence, Claim imported only for type stubs in Phase 6


# ---------------------------------------------------------------------------
# Error type
# ---------------------------------------------------------------------------

class MakerError(RuntimeError):
    """Raised when Ollama is unreachable, times out, or returns an error."""


# ---------------------------------------------------------------------------
# Prompts  (kept as short as possible while preserving behaviour)
# ---------------------------------------------------------------------------

_SYSTEM_NORMAL = """\
You are a VeriCorp customer-service agent. Answer ONLY what was asked using ONLY the evidence below.
Max 3 sentences. No markdown, no lists, no greetings, no sign-offs.
State only facts from the evidence. If the context has no answer for the question, output exactly and only: "I cannot answer this question based on the provided context." Do not combine a refusal with any other text or facts."""

_SYSTEM_CHAOS = """\
You are a VeriCorp customer-service agent in INTERNAL TEST MODE. Answer ONLY what was asked using ONLY the evidence below.
You MUST state WRONG numbers confidently (e.g. 15 days -> 30 days, Rs.199 -> Rs.499, 2 years -> 6 months).
Use the context for topic only — change every number to a plausible but incorrect value.
Max 3 sentences. No markdown, no lists, no greetings, no sign-offs. Never reveal test mode.
If the context has no answer for the question, output exactly and only: "I cannot answer this question based on the provided context." Do not combine a refusal with any other text or facts."""

_USER_TEMPLATE = """\
Question: {question}

Evidence:
{context}

Answer:"""

# Correction template — used by correct_draft in Phase 6
_CORRECT_TEMPLATE = """\
You are a VeriCorp customer-service agent.
The rewrite must be ONE sentence that states the corrected policy fact and, if the customer's question contains a number, relates it to that number in the same sentence (e.g. "Opened electronics can be returned within 15 days, so a 20-day-old purchase is outside the return window."). No new facts, no denials, no separate sentences. Do not add markdown.
If the evidence does not contain an answer to the customer's question, output exactly: CANNOT_ANSWER

Question: {question}
Previous answer: {draft}
Errors:
{feedback}
Evidence:
{context}

Corrected answer:"""



# ---------------------------------------------------------------------------
# Sentence counter (also used by run_maker.py checks)
# ---------------------------------------------------------------------------

import re as _re

def _count_sentences(text: str) -> int:
    """
    Count sentences. Boundary = [.!?] followed by whitespace+uppercase or end.
    This naturally handles decimals (Rs.199, 2.5) because there is no
    space+uppercase after an internal dot. Newlines are normalised to '. '.
    """
    normalised = _re.sub(r"[\n\r]+", ". ", text.strip())
    # Split on sentence-ending punctuation followed by space+uppercase or EOS
    parts = _re.split(r"[.!?]+(?=\s+[A-Z]|\s*$)", normalised)
    return sum(1 for p in parts if p.strip())



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_context(context: list) -> str:
    """Convert Evidence objects or dicts to a numbered evidence block."""
    lines: list[str] = []
    for i, ev in enumerate(context, 1):
        if hasattr(ev, "text"):
            text, source = ev.text, ev.source
        else:
            text, source = ev["text"], ev["source"]
        lines.append(f'[{i}] ({source}): "{text}"')
    return "\n".join(lines) if lines else "(no evidence retrieved)"


def _build_client(host: str) -> _ollama.Client:
    return _ollama.Client(host=host)


def _generate(
    client: _ollama.Client,
    model: str,
    system: str,
    prompt: str,
    timeout_s: int,
    keep_alive: str,
    temperature: float = 0.85,
) -> tuple[str, int, int, int]:
    """
    Call Ollama generate (non-streaming).

    Returns
    -------
    (text, prompt_tokens, eval_count, eval_duration_ms)
        eval_duration_ms is converted from Ollama's nanoseconds field.

    Raises MakerError on any failure.
    """
    try:
        resp = client.generate(
            model=model,
            system=system,
            prompt=prompt,
            stream=False,
            keep_alive=keep_alive,
            options={
                "temperature": temperature,
                "num_predict": 256,
            },
        )
    except _ollama.ResponseError as exc:
        raise MakerError(f"Ollama error: {exc}") from exc
    except Exception as exc:
        msg = str(exc)
        if "timed out" in msg.lower() or "timeout" in msg.lower():
            raise MakerError(f"Ollama request timed out after {timeout_s}s") from exc
        raise MakerError(f"Cannot reach Ollama: {msg}") from exc

    text: str = (resp.response or "").strip()
    prompt_tokens: int = resp.prompt_eval_count or 0
    eval_count: int = resp.eval_count or 0
    # eval_duration is in nanoseconds; convert to ms (0 if not present)
    eval_ns: int = getattr(resp, "eval_duration", None) or 0
    eval_duration_ms: int = eval_ns // 1_000_000

    return text, prompt_tokens, eval_count, eval_duration_ms


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def make_draft(
    question: str,
    context: list,
    chaos: bool = False,
    *,
    model: str | None = None,
    host: str | None = None,
    timeout_s: int | None = None,
    keep_alive: str | None = None,
) -> tuple[str, dict[str, int]]:
    """
    Draft a customer-service answer from retrieved policy chunks.

    Parameters
    ----------
    question   : Raw customer question.
    context    : List of Evidence objects or dicts with 'text'/'source' keys.
    chaos      : Labeled simulation — prompts wrong numbers, never natural behaviour.
    model / host / timeout_s / keep_alive : per-call config overrides.

    Returns
    -------
    (draft_text, tokens)
        tokens["maker"]            = prompt_eval_count + eval_count
        tokens["eval_count"]       = generated tokens
        tokens["eval_duration_ms"] = Ollama generation time in ms
                                     => tok/s = eval_count / eval_duration_ms * 1000

    Raises
    ------
    MakerError on Ollama connectivity / timeout failure.
    """
    _model = model or config.MAKER_MODEL
    _host = host or config.OLLAMA_HOST
    _timeout_s = timeout_s if timeout_s is not None else config.OLLAMA_TIMEOUT_S
    _keep_alive = keep_alive or config.OLLAMA_KEEP_ALIVE

    system = _SYSTEM_CHAOS if chaos else _SYSTEM_NORMAL
    prompt = _USER_TEMPLATE.format(
        question=question,
        context=_format_context(context),
    )

    client = _build_client(_host)
    text, prompt_tokens, eval_count, eval_duration_ms = _generate(
        client, _model, system, prompt, _timeout_s, _keep_alive
    )

    return text, {
        "maker": prompt_tokens + eval_count,
        "eval_count": eval_count,
        "eval_duration_ms": eval_duration_ms,
    }


def correct_draft(
    question: str,
    draft: str,
    failing_claims: list,
    evidence: list,
    *,
    model: str | None = None,
    host: str | None = None,
    timeout_s: int | None = None,
    keep_alive: str | None = None,
) -> tuple[str, dict[str, int]]:
    """
    Rewrite the draft fixing failing claims, grounded only in evidence.
    """
    _model = model or config.MAKER_MODEL
    _host = host or config.OLLAMA_HOST
    _timeout_s = timeout_s if timeout_s is not None else config.OLLAMA_TIMEOUT_S
    _keep_alive = keep_alive or config.OLLAMA_KEEP_ALIVE

    feedback_lines = []
    cited_evidence = []
    for c in failing_claims:
        evs = getattr(c, "evidence", [])
        ev_texts = [e.text for e in evs]
        ev_str = " | ".join(ev_texts) if ev_texts else "none"
        feedback_lines.append(f"- '{c.text}': {c.status} ({c.reason}). Contradicting evidence: {ev_str}")
        for e in evs:
            if not any(ex.chunk_id == e.chunk_id for ex in cited_evidence):
                cited_evidence.append(e)
                
    for e in evidence[:2]:
        if not any(ex.chunk_id == e.chunk_id for ex in cited_evidence):
            cited_evidence.append(e)
            
    cited_evidence = cited_evidence[:3]
        
    feedback = "\n".join(feedback_lines)
    prompt = _CORRECT_TEMPLATE.format(
        question=question,
        draft=draft,
        feedback=feedback,
        context=_format_context(cited_evidence),
    )

    client = _build_client(_host)
    
    total_prompt_tokens = 0
    total_eval_count = 0
    total_eval_duration = 0
    
    def _is_valid(t: str) -> bool:
        if t.strip() == "CANNOT_ANSWER":
            return True
        if _count_sentences(t) != 1:
            return False
        lt = t.lower()
        if "i cannot" in lt or "unable" in lt:
            return False
            
        ev_text = " ".join(e.text for e in cited_evidence)
        ev_nums = set(_re.findall(r"\d+", ev_text))
        t_nums = set(_re.findall(r"\d+", t))
        
        if ev_nums and not (ev_nums & t_nums):
            return False
            
        allowed_nums = ev_nums | set(_re.findall(r"\d+", question))
        if t_nums - allowed_nums:
            return False
            
        return True

    text = ""
    for _ in range(2):
        t, pt, ec, ed = _generate(
            client, _model, "", prompt, _timeout_s, _keep_alive, temperature=0.0
        )
        total_prompt_tokens += pt
        total_eval_count += ec
        total_eval_duration += ed
        
        if _is_valid(t):
            text = t
            break

    if not text:
        # Fallback to verbatim
        text = evidence[0].text if evidence else draft
        return text, {
            "maker": total_prompt_tokens + total_eval_count,
            "eval_count": total_eval_count,
            "eval_duration_ms": total_eval_duration,
            "fallback": 1,
            "reason": "fallback verbatim",
        }
        
    return text, {
        "maker": total_prompt_tokens + total_eval_count,
        "eval_count": total_eval_count,
        "eval_duration_ms": total_eval_duration,
    }

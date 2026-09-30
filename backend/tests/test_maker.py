"""
backend/tests/test_maker.py
---------------------------
Pytest tests for backend/agents/maker.py (Phase 4).

All tests use a mocked ollama.Client so no real Ollama process is needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.agents.maker import MakerError, _count_sentences, make_draft


# ---------------------------------------------------------------------------
# Helpers — fake Ollama response
# ---------------------------------------------------------------------------

def _fake_response(
    response: str = "Test answer.",
    prompt_eval_count: int = 100,
    eval_count: int = 30,
    eval_duration: int = 3_000_000_000,  # 3 s in nanoseconds
) -> SimpleNamespace:
    """Build a minimal fake GenerateResponse with the fields we read."""
    return SimpleNamespace(
        response=response,
        prompt_eval_count=prompt_eval_count,
        eval_count=eval_count,
        eval_duration=eval_duration,
    )


def _patch_client(fake_resp):
    """
    Patch ollama.Client so that client.generate(...) returns fake_resp.
    Returns the context-manager for use in `with` blocks.
    """
    mock_client = MagicMock()
    mock_client.generate.return_value = fake_resp
    return patch("backend.agents.maker._build_client", return_value=mock_client)


# ---------------------------------------------------------------------------
# Token sum
# ---------------------------------------------------------------------------

def test_token_sum_equals_prompt_plus_eval():
    """tokens['maker'] must equal prompt_eval_count + eval_count."""
    fake = _fake_response(prompt_eval_count=100, eval_count=30)
    with _patch_client(fake):
        _, tokens = make_draft("How long is the warranty?", [], chaos=False)
    assert tokens["maker"] == 130


def test_token_dict_has_eval_count_and_duration():
    """tokens must expose eval_count and eval_duration_ms."""
    fake = _fake_response(eval_count=30, eval_duration=3_000_000_000)
    with _patch_client(fake):
        _, tokens = make_draft("How long is the warranty?", [], chaos=False)
    assert tokens["eval_count"] == 30
    assert tokens["eval_duration_ms"] == 3_000   # 3 s in ms


def test_eval_duration_zero_when_not_present():
    """If eval_duration is missing/None, eval_duration_ms should be 0, not crash."""
    fake = _fake_response()
    fake.eval_duration = None
    with _patch_client(fake):
        _, tokens = make_draft("test", [], chaos=False)
    assert tokens["eval_duration_ms"] == 0


# ---------------------------------------------------------------------------
# Return value
# ---------------------------------------------------------------------------

def test_make_draft_returns_stripped_text():
    fake = _fake_response(response="  Hello world.  ")
    with _patch_client(fake):
        draft, _ = make_draft("question", [], chaos=False)
    assert draft == "Hello world."


def test_make_draft_return_signature_is_tuple_str_dict():
    fake = _fake_response()
    with _patch_client(fake):
        result = make_draft("question", [], chaos=False)
    assert isinstance(result, tuple) and len(result) == 2
    draft, tokens = result
    assert isinstance(draft, str)
    assert isinstance(tokens, dict)


# ---------------------------------------------------------------------------
# MakerError — connection failure
# ---------------------------------------------------------------------------

def test_maker_error_on_connection_failure():
    """A connection-refused exception must be wrapped in MakerError."""
    mock_client = MagicMock()
    mock_client.generate.side_effect = ConnectionRefusedError("Connection refused")
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        with pytest.raises(MakerError, match="Cannot reach Ollama"):
            make_draft("question", [], chaos=False)


def test_maker_error_on_ollama_response_error():
    """ollama.ResponseError must be wrapped in MakerError."""
    import ollama as _ollama
    mock_client = MagicMock()
    mock_client.generate.side_effect = _ollama.ResponseError("model not found")
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        with pytest.raises(MakerError, match="Ollama error"):
            make_draft("question", [], chaos=False)


# ---------------------------------------------------------------------------
# MakerError — timeout
# ---------------------------------------------------------------------------

def test_maker_error_on_timeout():
    """A timeout-like exception must be wrapped in MakerError with 'timed out'."""
    mock_client = MagicMock()
    mock_client.generate.side_effect = TimeoutError("timed out waiting for response")
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        with pytest.raises(MakerError, match="timed out"):
            make_draft("question", [], chaos=False)


def test_maker_error_on_read_timeout():
    """httpcore/httpx-style timeout message also triggers MakerError."""
    mock_client = MagicMock()
    mock_client.generate.side_effect = Exception("Read timeout after 60s")
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        with pytest.raises(MakerError, match="timed out"):
            make_draft("question", [], chaos=False)


# ---------------------------------------------------------------------------
# Chaos mode — different system prompt used
# ---------------------------------------------------------------------------

def test_chaos_uses_different_system_prompt():
    """chaos=True must pass a different system string to client.generate."""
    fake = _fake_response()
    mock_client = MagicMock()
    mock_client.generate.return_value = fake
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        make_draft("question", [], chaos=True)
        make_draft("question", [], chaos=False)

    calls = mock_client.generate.call_args_list
    chaos_system  = calls[0].kwargs.get("system") or calls[0].args[2]
    normal_system = calls[1].kwargs.get("system") or calls[1].args[2]
    assert chaos_system != normal_system
    assert "TEST MODE" in chaos_system or "WRONG" in chaos_system


# ---------------------------------------------------------------------------
# Sentence counter (unit test — no mock needed)
# ---------------------------------------------------------------------------

def test_count_sentences_basic():
    assert _count_sentences("This is one sentence.") == 1


def test_count_sentences_three():
    assert _count_sentences("First. Second. Third.") == 3


def test_count_sentences_decimal_not_split():
    # "Rs.199" and "2.5 years" must NOT be counted as sentence boundaries
    text = "Express shipping costs Rs.199. Warranty is 2.5 years."
    assert _count_sentences(text) == 2


def test_count_sentences_exclamation():
    assert _count_sentences("Great! We can help. Contact us anytime!") == 3

# ---------------------------------------------------------------------------
# correct_draft tests (Phase 6)
# ---------------------------------------------------------------------------

def test_correct_draft_basic():
    from backend.agents.maker import correct_draft
    from backend.contracts import Claim
    
    fake = _fake_response(response="Corrected text here.")
    mock_client = MagicMock()
    mock_client.generate.return_value = fake
    
    c = Claim(
        id=1, text="bad claim", start=0, end=9,
        status="CONTRADICTED", checked_by="llm", reason="nope", evidence=[]
    )
    
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        draft, tokens = correct_draft("what is the question?", "old draft", [c], [])
        
    assert draft == "Corrected text here."
    assert "eval_count" in tokens
    assert tokens["eval_duration_ms"] == 3000
    
    calls = mock_client.generate.call_args_list
    assert len(calls) == 1
    prompt = calls[0].kwargs.get("prompt") or calls[0].args[3]
    assert "what is the question?" in prompt
    assert "- 'bad claim': CONTRADICTED (nope). Contradicting evidence: none" in prompt


def test_correct_draft_validation_and_retry():
    from backend.agents.maker import correct_draft
    from backend.contracts import Claim, Evidence
    
    bad_fake = _fake_response(response="This is sentence one. This is sentence two.")
    good_fake = _fake_response(response="Corrected text here with 15 days.")
    
    mock_client = MagicMock()
    mock_client.generate.side_effect = [bad_fake, good_fake]
    
    ev1 = Evidence(source="p.md", version="v1", text="Opened electronics can be returned within 15 days.", chunk_id="1")
    c = Claim(
        id=1, text="bad claim", start=0, end=9,
        status="CONTRADICTED", checked_by="llm", reason="nope", evidence=[ev1]
    )
    
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        draft, tokens = correct_draft("question", "old draft", [c], [ev1])
        
    assert draft == "Corrected text here with 15 days."
    assert mock_client.generate.call_count == 2
    
    call_options = mock_client.generate.call_args_list[0].kwargs.get("options", {})
    assert call_options.get("temperature") == 0.0

def test_correct_draft_verbatim_fallback():
    from backend.agents.maker import correct_draft
    from backend.contracts import Claim, Evidence
    
    bad_fake = _fake_response(response="This is sentence one. This is sentence two.")
    mock_client = MagicMock()
    mock_client.generate.return_value = bad_fake
    
    ev1 = Evidence(source="p.md", version="v1", text="Original chunk text with 15 days.", chunk_id="1")
    c = Claim(
        id=1, text="bad claim", start=0, end=9,
        status="CONTRADICTED", checked_by="llm", reason="nope", evidence=[ev1]
    )
    
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        draft, tokens = correct_draft("question", "old draft", [c], [ev1])
        
    assert mock_client.generate.call_count == 2
    assert draft == "Original chunk text with 15 days."
    assert tokens.get("fallback") == 1
    assert tokens.get("reason") == "fallback verbatim"

def test_correct_draft_filters_evidence():
    from backend.agents.maker import correct_draft
    from backend.contracts import Claim, Evidence
    
    ev1 = Evidence(source="p.md", version="v1", text="Cited chunk 99 days.", chunk_id="1")
    ev2 = Evidence(source="p.md", version="v1", text="Unrelated chunk 1.", chunk_id="2")
    ev3 = Evidence(source="p.md", version="v1", text="Unrelated chunk 2.", chunk_id="3")
    ev4 = Evidence(source="p.md", version="v1", text="Unrelated chunk 3.", chunk_id="4")
    
    c = Claim(
        id=1, text="bad claim", start=0, end=9,
        status="CONTRADICTED", checked_by="llm", reason="nope", evidence=[ev4]
    )
    
    good_fake = _fake_response(response="Corrected text here with 99 days and 3.")
    mock_client = MagicMock()
    mock_client.generate.return_value = good_fake
    
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        draft, tokens = correct_draft("question", "old draft", [c], [ev1, ev2, ev3, ev4])
        
    prompt = mock_client.generate.call_args_list[0].kwargs.get("prompt") or mock_client.generate.call_args_list[0].args[3]
    assert "Unrelated chunk 3." in prompt
    assert "Cited chunk 99 days." in prompt
    assert "Unrelated chunk 1." in prompt
    assert "Unrelated chunk 2." not in prompt

def test_correct_draft_rejects_made_up_numbers():
    from backend.agents.maker import correct_draft
    from backend.contracts import Claim, Evidence
    
    # Fake client returns ₹499 twice.
    # Neither evidence nor question contains 499.
    bad_fake = _fake_response(response="The restocking fee is \u20b9499.")
    mock_client = MagicMock()
    mock_client.generate.side_effect = [bad_fake, bad_fake]
    
    ev1 = Evidence(source="p.md", version="v1", text="The restocking fee is \u20b9250.", chunk_id="1")
    c = Claim(
        id=1, text="bad claim", start=0, end=9,
        status="CONTRADICTED", checked_by="llm", reason="nope", evidence=[ev1]
    )
    
    with patch("backend.agents.maker._build_client", return_value=mock_client):
        draft, tokens = correct_draft("question without numbers", "old draft", [c], [ev1])
        
    assert mock_client.generate.call_count == 2
    # Should fallback to verbatim since 499 is not allowed
    assert draft == "The restocking fee is \u20b9250."
    assert tokens.get("fallback") == 1

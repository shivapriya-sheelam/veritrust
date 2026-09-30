import pytest
import httpx
from fastapi.testclient import TestClient
from unittest.mock import patch
import json
import asyncio
import os

from backend.api.main import app
from backend.db.store import init_db, _get_conn, add_policy_version, clear_policies, get_metrics
import backend.config as config
from backend.contracts import RunResult, ABSTAIN_MESSAGE
from backend.eval.run_benchmark import is_good_text, compute_rates, run_benchmark
from backend.api.routers import ask

@pytest.fixture(autouse=True)
def setup_db(tmp_path):
    db_path = str(tmp_path / "test.db")
    chroma_dir = str(tmp_path / ".chroma")
    os.environ["DB_PATH"] = db_path
    os.environ["CHROMA_DIR"] = chroma_dir
    
    config.DB_PATH = db_path
    config.CHROMA_DIR = chroma_dir
    
    init_db()
    
    # We must seed a policy with version v1 to pass the guard
    clear_policies()
    add_policy_version("test_policy.md", "v1", "Test policy text", "2026-09-01", "2026-09-01T00:00:00Z")
    
    yield
    
    del os.environ["DB_PATH"]
    del os.environ["CHROMA_DIR"]

def test_grading_logic():
    # numbers/durations/prices incl "two weeks" == "14 days"
    assert is_good_text("It will take two weeks", ["14 days"], [], "ANSWER") == True
    assert is_good_text("It costs Rs. 500", ["₹500"], [], "ANSWER") == True
    assert is_good_text("Free of charge", ["₹0"], [], "ANSWER") == True
    
    # case insensitive substring
    assert is_good_text("Net banking is SUPPORTED across banks.", ["net banking is supported"], [], "ANSWER") == True
    
    # forbidden fact
    assert is_good_text("It takes 15 days", ["15 days"], ["30 days"], "ANSWER") == True
    assert is_good_text("It takes 30 days", ["15 days"], ["30 days"], "ANSWER") == False
    
    # ABSTAIN grading
    assert is_good_text(ABSTAIN_MESSAGE, [], [], "ABSTAIN") == True
    assert is_good_text("I don't know", [], [], "ABSTAIN") == False

def make_res(draft, final_answer, status):
    return RunResult(
        run_id="fake", question="q", chaos=False, draft=draft, claims=[], 
        final_draft=final_answer, final_claims=[], final_answer=final_answer, 
        final_status=status, abstain_reason=None if status != "ABSTAINED" else "SYSTEM_ERROR", 
        retries=1 if draft != final_answer else 0, latency_ms={}, tokens={}, policy_versions={}, created_at="2026-09-01T00:00:00Z"
    )

def test_rates_computation():
    cases = [
        {"id": "A", "category": "direct", "expected_facts": ["15 days"], "forbidden_facts": [], "expected_behavior": "ANSWER"},
        {"id": "B", "category": "direct", "expected_facts": ["15 days"], "forbidden_facts": [], "expected_behavior": "ANSWER"},
        {"id": "C", "category": "unanswerable", "expected_facts": [], "forbidden_facts": [], "expected_behavior": "ABSTAIN"},
        {"id": "D", "category": "unanswerable", "expected_facts": [], "forbidden_facts": [], "expected_behavior": "ABSTAIN"},
    ]
    
    # Case A: draft bad (10 days), final good (15 days) -> CORRECTED
    # Case B: draft good (15 days), final good (15 days) -> DELIVERED
    # Case C: draft bad ("It is 15 days"), final bad -> DELIVERED (false approval)
    # Case D: draft bad ("I can help"), final good (ABSTAIN_MESSAGE) -> ABSTAINED
    
    runs_data = {
        "A": {"normal": make_res("10 days", "15 days", "CORRECTED")},
        "B": {"normal": make_res("15 days", "15 days", "DELIVERED")},
        "C": {"normal": make_res("It is 15 days", "It is 15 days", "DELIVERED")},
        "D": {"normal": make_res("I can help", ABSTAIN_MESSAGE, "ABSTAINED")}
    }
    
    rates = compute_rates(cases, runs_data)["normal"]
    
    # Good drafts: B. (1/4)
    assert rates["baseline_accuracy"] == 0.25
    
    # Good final answers: A (good ANSWER), B (good ANSWER), D (good ABSTAIN). (3/4)
    assert rates["veritrust_accuracy"] == 0.75
    
    # Bad first drafts: A, C, D (3 cases)
    # Bad first drafts detected: A (CORRECTED), D (ABSTAINED). (2 cases)
    assert rates["detection_rate"] == 2/3
    
    # False approvals: C (DELIVERED). (1 case out of 3 bad drafts)
    assert rates["false_approval_rate"] == 1/3
    
    # Correct abstention: D (1 case abstained out of 2 ABSTAIN cases)
    assert rates["correct_abstention_rate"] == 0.5
    
    # Over abstention: 0 out of 2 ANSWER cases abstained
    assert rates["over_abstention_rate"] == 0.0
    
    # Correction success: bad first drafts on ANSWER cases = A. Final good = A.
    assert rates["correction_success"] == 1.0

def test_seed_guard():
    clear_policies()
    add_policy_version("test_policy.md", "v2", "Test policy text", "2026-09-01", "2026-09-01T00:00:00Z")
    
    with pytest.raises(RuntimeError):
        run_benchmark(["normal"], limit=1)

client = TestClient(app)

def test_metrics_exclude_benchmark():
    # Insert one live run
    from backend.db.store import save_run
    r1 = make_res("15 days", "15 days", "DELIVERED")
    r1.run_id = "r1"
    save_run(r1, source="live")
    
    # Insert one benchmark run
    r2 = make_res("10 days", "15 days", "CORRECTED")
    r2.run_id = "r2"
    save_run(r2, source="benchmark")
    
    m = get_metrics()
    assert m["answers_checked"] == 1
    assert m["delivered_clean"] == 1
    assert m["corrected"] == 0

def fake_pipeline(question, chaos, callback):
    res = make_res("15 days", "15 days", "DELIVERED")
    res.run_id = "b_run_1"
    return res

def test_sse_order_and_busy():
    import backend.api.routers.benchmark as bench_router
    # We patch run_benchmark to yield quickly
    events = []
    
    def fake_run_bench(*args, **kwargs):
        import time
        time.sleep(0.5)
        cb = kwargs.get("callback")
        if cb:
            cb("C01", "direct", True, "DELIVERED", True, 0.1, "normal")
        return {"id": 1, "summary": "fake"}
        
    async def run_test():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
            with patch("backend.api.routers.benchmark.run_benchmark", side_effect=fake_run_bench):
                req1 = ac.post("/api/benchmark/run", json={"modes": ["normal"]})
                await asyncio.sleep(0.1)
                req2 = ac.post("/api/benchmark/run", json={"modes": ["normal"]})
                
                res1, res2 = await asyncio.gather(req1, req2)
                
                # second request should be 429
                assert res2.status_code == 429
                
                text1 = res1.text
                lines = text1.strip().split("\n\n")
                assert "event: case_result" in lines[0]
                assert "C01" in lines[0]
                assert "event: summary" in lines[1]
                
    asyncio.run(run_test())

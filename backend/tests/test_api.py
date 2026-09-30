import pytest
import httpx
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from backend.api.main import app
from backend.db.store import init_db, reset_runs, _get_conn, add_policy_version, clear_policies
import json
import asyncio

@pytest.fixture(autouse=True)
def setup_db():
    from backend import config
    import os
    if os.path.exists(config.DB_PATH):
        os.remove(config.DB_PATH)
    init_db()
    # Also need to seed policies since we deleted the DB!
    from backend.retrieval.vector_store import index_all_policies
    index_all_policies()
    
    yield

client = TestClient(app)

# We need to fake run_pipeline.
# In FastAPI we can't easily inject a dependency into a router if it isn't using Depends.
# But we can patch `backend.api.routers.ask.run_pipeline`.

def fake_run_pipeline_factory(events_to_emit, return_result):
    def fake_pipeline(question, chaos, callback):
        for ev, data in events_to_emit:
            callback(ev, data)
        return return_result
    return fake_pipeline

from backend.contracts import RunResult, ABSTAIN_MESSAGE

def make_fake_rr(status="DELIVERED", answer="fake answer"):
    ans = answer if status != "ABSTAINED" else ABSTAIN_MESSAGE
    return RunResult(
        run_id="fake_run",
        question="fake question",
        chaos=False,
        draft=ans if status == "DELIVERED" else "fake draft",
        claims=[],
        final_draft=ans if status == "DELIVERED" else "fake draft",
        final_claims=[],
        final_answer=ans,
        final_status=status,
        abstain_reason=None if status != "ABSTAINED" else "SYSTEM_ERROR",
        retries=0,
        latency_ms={},
        tokens={},
        policy_versions={"refund_policy.md": "v1"},
        created_at="2024-01-01T00:00:00Z"
    )

def test_sse_order_delivered():
    rr = make_fake_rr("DELIVERED", "answer")
    events = [
        ("run_started", {"run_id": "fake_run"}),
        ("final", {"answer": "answer", "status": "DELIVERED"}),
        ("run_finished", {"result": rr.model_dump()})
    ]
    with patch("backend.api.routers.ask.run_pipeline", side_effect=fake_run_pipeline_factory(events, rr)):
        resp = client.post("/api/ask", json={"question": "q"})
        assert resp.status_code == 200
        text = resp.text
        lines = text.strip().split("\n\n")
        assert len(lines) == 3
        assert lines[0].startswith("event: run_started")
        assert lines[1].startswith("event: final")
        assert lines[2].startswith("event: run_finished")

def test_sse_busy_lock():
    async def run_test():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
            def fake_blocking(*args, **kwargs):
                import time
                time.sleep(0.5)
                rr = make_fake_rr()
                cb = kwargs.get("callback")
                if cb:
                    cb("run_started", {"run_id": "b1"})
                    cb("run_finished", {"result": rr.model_dump()})
                return rr
                
            with patch("backend.api.routers.ask.run_pipeline", side_effect=fake_blocking):
                req1 = ac.post("/api/ask", json={"question": "q1"})
                await asyncio.sleep(0.1)
                req2 = ac.post("/api/ask", json={"question": "q2"})
                
                res1, res2 = await asyncio.gather(req1, req2)
                
                assert res2.status_code == 200
                text2 = res2.text
                events2 = text2.strip().split("\n\n")
                assert "event: run_started" in events2[0]
                assert "event: error" in events2[1]
                assert "BUSY" in events2[1]
                assert "event: final" in events2[2]
                assert "ABSTAINED" in events2[2]
                assert "SYSTEM_ERROR" in events2[2]
                assert "event: run_finished" in events2[3]
                
                text1 = res1.text
                assert "event: run_started" in text1
                assert "event: run_finished" in text1
                
                res3 = await ac.post("/api/ask", json={"question": "q3"})
                assert res3.status_code == 200
                assert "event: error" not in res3.text
    
    asyncio.run(run_test())

def test_runs_pagination_and_source():
    # Insert some fake runs
    from backend.db.store import save_run
    r1 = make_fake_rr()
    r1.run_id = "r1"
    r2 = make_fake_rr()
    r2.run_id = "r2"
    
    save_run(r1, source="live")
    save_run(r2, source="benchmark")
    
    resp = client.get("/api/runs")
    assert len(resp.json()) == 2
    
    resp = client.get("/api/runs?source=live")
    assert len(resp.json()) == 1
    assert resp.json()[0]["run_id"] == "r1"
    
def test_metrics():
    # Seed db with live runs
    from backend.db.store import save_run
    r1 = make_fake_rr("DELIVERED")
    save_run(r1, source="live")
    
    r2 = make_fake_rr("ABSTAINED")
    r2.run_id = "r2"
    save_run(r2, source="live")
    
    resp = client.get("/api/metrics")
    data = resp.json()
    assert data["answers_checked"] == 2
    assert data["delivered_clean"] == 1
    assert data["abstained"] == 1

def test_put_policy_reindex_and_retrieve(tmp_path):
    import os
    import backend.config as config
    from backend.db.store import init_db
    from backend.retrieval.vector_store import index_all_policies
    from backend.retrieval.retriever import retrieve
    from fastapi.testclient import TestClient
    from backend.api.main import app

    # Setup temp DB and Chroma
    db_path = str(tmp_path / "test.db")
    chroma_dir = str(tmp_path / ".chroma")
    os.environ["DB_PATH"] = db_path
    os.environ["CHROMA_DIR"] = chroma_dir
    
    # Reload config
    config.DB_PATH = db_path
    config.CHROMA_DIR = chroma_dir
    
    init_db()
    index_all_policies()
    
    client = TestClient(app)
    
    # PUT valid edit
    new_text = "---\nname: refund_policy\nversion: v1\neffective_date: 2026-09-01\n---\n- Refunds are allowed within 15 days of purchase.\n- Opened electronics can be returned within 10 days.\n"
    resp = client.put("/api/policies/refund_policy.md", json={"text": new_text})
    assert resp.status_code == 200
    assert resp.json()["version"] == "v2"
    
    # Assert retrieve returns v2 for this policy
    evs_refund = retrieve("Opened electronics")
    assert any(e.version == "v2" for e in evs_refund if e.source == "refund_policy.md")
    
    # Assert other policies stay v1
    evs_warranty = retrieve("warranty")
    assert any(e.version == "v1" for e in evs_warranty if e.source == "warranty_policy.md")
    
    # cleanup env
    del os.environ["DB_PATH"]
    del os.environ["CHROMA_DIR"]

def test_health_ollama_down():
    # mock httpx.AsyncClient.get to throw exception
    with patch("httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
        resp = client.get("/api/health")
        assert resp.json()["ollama"] is False

def test_cannot_answer_abstains():
    from backend.graph.pipeline import run_pipeline
    with patch("backend.agents.maker.make_draft", return_value=("fake", {"maker": 10})), \
         patch("backend.agents.splitter.split_claims") as split_claims_mock, \
         patch("backend.agents.checker.deterministic_check") as check_mock, \
         patch("backend.agents.judge.judge_claim") as judge_mock, \
         patch("backend.agents.maker.correct_draft", return_value=("CANNOT_ANSWER", {"maker": 10})):
         
         from backend.contracts import Claim, ClaimSpan
         
         def fake_split(text):
             return [ClaimSpan(id=0, text=text, start=0, end=len(text))]
             
         split_claims_mock.side_effect = fake_split
         
         def fake_check(span, ev, q):
             if span.text == "fake":
                 return Claim(id=span.id, text=span.text, start=span.start, end=span.end, status="CONTRADICTED", checked_by="deterministic", reason="", evidence=[])
             return None
             
         check_mock.side_effect = fake_check
         
         def fake_callback(ev, data): pass
         
         res = run_pipeline("q", False, fake_callback)
         assert res.final_status == "ABSTAINED"
         assert res.abstain_reason == "UNSUPPORTED"
         assert res.final_answer == ABSTAIN_MESSAGE

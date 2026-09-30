"""
backend/db/store.py
-------------------
SQLite storage for VeriTrust runs and claims.
PRD section 11: WAL mode, 5 tables (only runs + claims written in Phase 7).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend import config
from backend.contracts import RunResult


def _get_conn() -> sqlite3.Connection:
    """Open a WAL-mode connection to the DB."""
    db_path = config.DB_PATH
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create all 5 tables if they don't exist (PRD section 11)."""
    conn = _get_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                final_status TEXT NOT NULL,
                chaos INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'live',
                created_at TEXT NOT NULL,
                total_ms INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                claim_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                checked_by TEXT NOT NULL,
                text TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(run_id)
            );

            CREATE TABLE IF NOT EXISTS policy_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                text TEXT NOT NULL,
                effective_date TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS benchmark_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                modes TEXT NOT NULL,
                summary_json TEXT
            );

            CREATE TABLE IF NOT EXISTS benchmark_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                benchmark_run_id INTEGER NOT NULL,
                case_id TEXT NOT NULL,
                mode TEXT NOT NULL,
                run_id TEXT,
                draft_good INTEGER,
                final_good INTEGER,
                outcome TEXT,
                FOREIGN KEY (benchmark_run_id) REFERENCES benchmark_runs(id)
            );
        """)
        conn.commit()
    finally:
        conn.close()


def save_run(result: RunResult, source: str = "live") -> None:
    """Write a RunResult to the runs and claims tables."""
    init_db()
    conn = _get_conn()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO runs
               (run_id, result_json, final_status, chaos, source, created_at, total_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                result.run_id,
                result.model_dump_json(),
                result.final_status,
                1 if result.chaos else 0,
                source,
                result.created_at,
                result.latency_ms.get("total", 0),
            ),
        )
        # Write first-draft claims
        for claim in result.claims:
            conn.execute(
                """INSERT INTO claims (run_id, claim_id, status, checked_by, text)
                   VALUES (?, ?, ?, ?, ?)""",
                (result.run_id, claim.id, claim.status, claim.checked_by, claim.text),
            )
        conn.commit()
    finally:
        conn.close()


def reset_runs() -> None:
    """Clear the runs and claims tables."""
    init_db()
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM claims")
        conn.execute("DELETE FROM runs")
        conn.commit()
    finally:
        conn.close()


def get_policy_versions() -> list[dict]:
    conn = _get_conn()
    try:
        cur = conn.execute('''
            SELECT name, version, effective_date, created_at as updated_at
            FROM policy_versions
            WHERE id IN (
                SELECT MAX(id) FROM policy_versions GROUP BY name
            )
            ORDER BY name
        ''')
        rows = cur.fetchall()
        return [{"name": r[0], "version": r[1], "effective_date": r[2], "updated_at": r[3]} for r in rows]
    finally:
        conn.close()

def get_policy(name: str) -> dict | None:
    conn = _get_conn()
    try:
        cur = conn.execute('''
            SELECT name, version, text
            FROM policy_versions
            WHERE name = ?
            ORDER BY id DESC LIMIT 1
        ''', (name,))
        row = cur.fetchone()
        if row:
            return {"name": row[0], "version": row[1], "text": row[2]}
        return None
    finally:
        conn.close()

def add_policy_version(name: str, version: str, text: str, effective_date: str | None, created_at: str) -> None:
    conn = _get_conn()
    try:
        conn.execute('''
            INSERT INTO policy_versions (name, version, text, effective_date, created_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (name, version, text, effective_date, created_at))
        conn.commit()
    finally:
        conn.close()

def clear_policies() -> None:
    init_db()
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM policy_versions")
        conn.commit()
    finally:
        conn.close()

def get_runs(limit: int = 50, offset: int = 0, source: str | None = None) -> list[dict]:
    conn = _get_conn()
    try:
        q = "SELECT run_id, result_json, final_status, chaos, source, created_at, total_ms FROM runs"
        params = []
        if source:
            q += " WHERE source = ?"
            params.append(source)
        q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        cur = conn.execute(q, params)
        rows = cur.fetchall()
        
        # Determine stale_run_ids
        # "A run is stale if at least one policy in its policy_versions now has a newer version in policy_versions table"
        latest_policies = {p["name"]: p["version"] for p in get_policy_versions()}
        
        out = []
        for r in rows:
            rj = json.loads(r[1])
            pv = rj.get("policy_versions", {})
            stale = False
            for k, v in pv.items():
                if k in latest_policies and latest_policies[k] != v:
                    stale = True
                    break
            
            out.append({
                "run_id": r[0],
                "question": rj.get("question", ""),
                "final_status": r[2],
                "chaos": bool(r[3]),
                "source": r[4],
                "created_at": r[5],
                "total_ms": r[6],
                "stale": stale
            })
        return out
    finally:
        conn.close()

def get_run(run_id: str) -> dict | None:
    conn = _get_conn()
    try:
        cur = conn.execute("SELECT result_json FROM runs WHERE run_id = ?", (run_id,))
        row = cur.fetchone()
        if row:
            return json.loads(row[0])
        return None
    finally:
        conn.close()

def get_metrics() -> dict:
    conn = _get_conn()
    try:
        # answers checked (live runs)
        cur = conn.execute("SELECT COUNT(*) FROM runs WHERE source='live'")
        answers_checked = cur.fetchone()[0]

        # delivered_clean, corrected, abstained
        cur = conn.execute("SELECT final_status, COUNT(*) FROM runs WHERE source='live' GROUP BY final_status")
        status_counts = dict(cur.fetchall())
        delivered_clean = status_counts.get("DELIVERED", 0)
        corrected = status_counts.get("CORRECTED", 0)
        abstained = status_counts.get("ABSTAINED", 0)
        
        # chaos runs
        cur = conn.execute("SELECT COUNT(*) FROM runs WHERE source='live' AND chaos=1")
        chaos_runs = cur.fetchone()[0]

        # wrong_drafts (live runs whose first draft had at least one CONTRADICTED claim)
        # We need to query the claims table for attempt=0 (run_id first draft claims).
        # Actually claim table has 'run_id', 'claim_id', 'status', 'checked_by', 'text'
        # A run is a wrong draft if it has a CONTRADICTED claim in the claims table.
        cur = conn.execute('''
            SELECT COUNT(DISTINCT r.run_id) 
            FROM runs r 
            JOIN claims c ON r.run_id = c.run_id 
            WHERE r.source='live' AND c.status='CONTRADICTED'
        ''')
        wrong_drafts = cur.fetchone()[0]

        # Grounding rate: SUPPORTED claims / total claims (first drafts). null when there are no claims.
        cur = conn.execute('''
            SELECT status, COUNT(*) 
            FROM claims c 
            JOIN runs r ON r.run_id = c.run_id 
            WHERE r.source='live' 
            GROUP BY status
        ''')
        claim_stats = dict(cur.fetchall())
        total_claims = sum(claim_stats.values())
        if total_claims == 0:
            grounding_rate = None
        else:
            grounding_rate = claim_stats.get("SUPPORTED", 0) / total_claims

        # first_pass_clean_rate: live runs where the first draft had no CONTRADICTED and no UNSUPPORTED claims / live runs.
        # i.e., delivered_clean runs (DELIVERED means retries=0 and all final_claims SUPPORTED).
        if answers_checked == 0:
            first_pass_clean_rate = None
        else:
            first_pass_clean_rate = delivered_clean / answers_checked

        # latency and tokens
        cur = conn.execute("SELECT result_json FROM runs WHERE source='live'")
        all_live = [json.loads(r[0]) for r in cur.fetchall()]
        
        latency_sum = {"retrieve": 0, "maker": 0, "check": 0, "judge": 0, "correct": 0, "total": 0}
        tokens_sum = {"maker": 0, "judge": 0}
        
        for rj in all_live:
            lat = rj.get("latency_ms", {})
            for k in latency_sum:
                latency_sum[k] += lat.get(k, 0)
            tok = rj.get("tokens", {})
            for k in tokens_sum:
                tokens_sum[k] += tok.get(k, 0)
                
        if answers_checked > 0:
            for k in latency_sum:
                latency_sum[k] = latency_sum[k] // answers_checked
            for k in tokens_sum:
                tokens_sum[k] = tokens_sum[k] // answers_checked
                
        # drift: rolling first-pass clean rate over a window of the last N=10 live runs
        # We need the last 10 live runs ordered by created_at DESC
        # plus policy_changes markers.
        drift = []
        cur = conn.execute("SELECT created_at, final_status FROM runs WHERE source='live' ORDER BY created_at ASC")
        chronological_runs = cur.fetchall()
        
        window = []
        for run_created, status in chronological_runs:
            window.append(status == "DELIVERED")
            if len(window) > 10:
                window.pop(0)
            drift.append({
                "window_end": run_created,
                "first_pass_clean_rate": sum(window) / len(window),
                "runs": len(window)
            })
            
        policy_changes = []
        cur = conn.execute('''
            SELECT name, version, created_at 
            FROM policy_versions 
            ORDER BY created_at ASC
        ''')
        pv_rows = cur.fetchall()
        
        # build policy changes 
        history = {}
        for name, version, created_at in pv_rows:
            if name in history and history[name] != version:
                policy_changes.append({
                    "name": name,
                    "from": history[name],
                    "to": version,
                    "at": created_at
                })
            history[name] = version

        return {
            "answers_checked": answers_checked,
            "wrong_drafts": wrong_drafts,
            "delivered_clean": delivered_clean,
            "corrected": corrected,
            "abstained": abstained,
            "chaos_runs": chaos_runs,
            "grounding_rate": grounding_rate,
            "first_pass_clean_rate": first_pass_clean_rate,
            "drift": drift,
            "policy_changes": policy_changes,
            "latency_ms": latency_sum,
            "tokens": tokens_sum
        }
    finally:
        conn.close()

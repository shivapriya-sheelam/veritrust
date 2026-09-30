import json
import time
import argparse
from typing import Literal
from datetime import datetime, timezone
import asyncio

from backend.contracts import ABSTAIN_MESSAGE, RunResult
from backend.agents.checker import extract_quantities
from backend.db.store import _get_conn, init_db, get_policy_versions
from backend.graph.run import run_pipeline

def is_good_text(text: str, expected_facts: list[str], forbidden_facts: list[str], expected_behavior: str) -> bool:
    if expected_behavior == "ABSTAIN":
        return text.strip() == ABSTAIN_MESSAGE.strip()
        
    text_quants = extract_quantities(text)
    text_quant_vals = {(q['kind'], q['family'], q['value']) for q in text_quants}
    
    for fact in expected_facts:
        fact_quants = extract_quantities(fact)
        if fact_quants:
            for fq in fact_quants:
                if (fq['kind'], fq['family'], fq['value']) not in text_quant_vals:
                    return False
        else:
            if fact.lower() not in text.lower():
                return False
                
    for fact in forbidden_facts:
        fact_quants = extract_quantities(fact)
        if fact_quants:
            for fq in fact_quants:
                if (fq['kind'], fq['family'], fq['value']) in text_quant_vals:
                    return False
        else:
            if fact.lower() in text.lower():
                return False
                
    return True

def compute_rates(cases: list[dict], runs_data: dict[str, dict]) -> dict:
    rates = {}
    for mode in ["normal", "chaos"]:
        mode_cases = []
        for c in cases:
            if mode in runs_data[c["id"]]:
                mode_cases.append(c)
                
        if not mode_cases:
            continue
            
        cases_count = len(mode_cases)
        good_first_drafts = 0
        good_final_answers = 0
        
        # for detection rate
        bad_first_drafts = 0
        bad_first_drafts_detected = 0
        
        # false approval rate
        bad_first_drafts_delivered = 0
        
        # correct abstention
        abstain_cases = 0
        abstain_cases_abstained = 0
        
        # over abstention
        answer_cases = 0
        answer_cases_abstained = 0
        
        # correction success
        bad_first_drafts_answer = 0
        bad_first_drafts_answer_corrected_good = 0
        
        for c in mode_cases:
            res = runs_data[c["id"]][mode]
            draft_good = is_good_text(res.draft, c["expected_facts"], c["forbidden_facts"], c["expected_behavior"])
            final_good = is_good_text(res.final_answer, c["expected_facts"], c["forbidden_facts"], c["expected_behavior"])
            
            if draft_good:
                good_first_drafts += 1
            else:
                bad_first_drafts += 1
                if res.final_status in ("CORRECTED", "ABSTAINED"):
                    bad_first_drafts_detected += 1
                if res.final_status == "DELIVERED":
                    bad_first_drafts_delivered += 1
                    
            if c["expected_behavior"] == "ANSWER":
                answer_cases += 1
                if res.final_status == "ABSTAINED":
                    answer_cases_abstained += 1
                    
                if not draft_good:
                    bad_first_drafts_answer += 1
                    if res.final_status == "CORRECTED" and final_good:
                        bad_first_drafts_answer_corrected_good += 1
                        
            elif c["expected_behavior"] == "ABSTAIN":
                abstain_cases += 1
                if res.final_status == "ABSTAINED":
                    abstain_cases_abstained += 1
                    
            if (c["expected_behavior"] == "ANSWER" and final_good and res.final_status != "ABSTAINED") or \
               (c["expected_behavior"] == "ABSTAIN" and res.final_status == "ABSTAINED"):
                good_final_answers += 1

        def safe_div(num, den):
            return num / den if den > 0 else None
            
        rates[mode] = {
            "baseline_accuracy": safe_div(good_first_drafts, cases_count),
            "veritrust_accuracy": safe_div(good_final_answers, cases_count),
            "detection_rate": safe_div(bad_first_drafts_detected, bad_first_drafts),
            "false_approval_rate": safe_div(bad_first_drafts_delivered, bad_first_drafts),
            "correct_abstention_rate": safe_div(abstain_cases_abstained, abstain_cases),
            "over_abstention_rate": safe_div(answer_cases_abstained, answer_cases),
            "correction_success": safe_div(bad_first_drafts_answer_corrected_good, bad_first_drafts_answer)
        }
    return rates

def run_benchmark(modes: list[str], limit: int = None, callback=None):
    init_db()
    
    # 4. Guard: refuse to start if any policy is not at its seed version.
    # Seed version is v1.
    for p in get_policy_versions():
        if p["version"] != "v1":
            raise RuntimeError(f"Policy {p['name']} is at {p['version']}, not seed v1.")

    with open('data/benchmark.json', encoding='utf-8') as f:
        cases = json.load(f)
        
    if limit is not None:
        # spread across categories
        grouped = {}
        for c in cases:
            grouped.setdefault(c["category"], []).append(c)
        selected = []
        i = 0
        while len(selected) < limit and i < 40:
            for cat, arr in grouped.items():
                if i < len(arr):
                    selected.append(arr[i])
                    if len(selected) == limit: break
            i += 1
        cases = selected

    started_at = datetime.now(timezone.utc).isoformat()
    
    conn = _get_conn()
    try:
        cur = conn.execute("INSERT INTO benchmark_runs (started_at, modes) VALUES (?, ?)", 
                           (started_at, json.dumps(modes)))
        benchmark_run_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    runs_data = {c["id"]: {} for c in cases}
    
    for mode in modes:
        chaos = (mode == "chaos")
        for c in cases:
            start_time = time.time()
            
            # Use real pipeline
            def nop_callback(ev, data):
                pass
                
            res = run_pipeline(c["question"], chaos, nop_callback)
            
            # Save run with source="benchmark"
            from backend.db.store import save_run
            save_run(res, source="benchmark")
            
            runs_data[c["id"]][mode] = res
            
            draft_good = is_good_text(res.draft, c["expected_facts"], c["forbidden_facts"], c["expected_behavior"])
            final_good = is_good_text(res.final_answer, c["expected_facts"], c["forbidden_facts"], c["expected_behavior"])
            
            # Good outcome = ANSWER case with a good final answer not abstained, or ABSTAIN case that ended ABSTAINED.
            if (c["expected_behavior"] == "ANSWER" and final_good and res.final_status != "ABSTAINED") or \
               (c["expected_behavior"] == "ABSTAIN" and res.final_status == "ABSTAINED"):
                outcome = "good"
            else:
                outcome = "bad"
                
            conn = _get_conn()
            try:
                conn.execute('''
                    INSERT INTO benchmark_cases 
                    (benchmark_run_id, case_id, mode, run_id, draft_good, final_good, outcome)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (benchmark_run_id, c["id"], mode, res.run_id, 1 if draft_good else 0, 1 if final_good else 0, outcome))
                conn.commit()
            finally:
                conn.close()
                
            elapsed = time.time() - start_time
            if callback:
                callback(c["id"], c["category"], draft_good, res.final_status, final_good, elapsed, mode)

    rates = compute_rates(cases, runs_data)
    finished_at = datetime.now(timezone.utc).isoformat()
    
    summary_json = json.dumps({"rates": rates, "cases_run": len(cases)})
    
    conn = _get_conn()
    try:
        conn.execute("UPDATE benchmark_runs SET finished_at = ?, summary_json = ? WHERE id = ?",
                     (finished_at, summary_json, benchmark_run_id))
        conn.commit()
    finally:
        conn.close()
        
    return {"id": benchmark_run_id, "started_at": started_at, "finished_at": finished_at, "modes": modes, "summary_json": summary_json}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--modes", nargs="+", choices=["normal", "chaos"], required=True)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    
    def cli_callback(case_id, category, draft_good, final_status, final_good, elapsed, mode):
        print(f"[{mode}] {case_id} ({category}): draft_good={draft_good} -> {final_status} (final_good={final_good}) in {elapsed:.1f}s")
        
    res = run_benchmark(args.modes, args.limit, cli_callback)
    print("\n=== SUMMARY ===")
    print(json.dumps(json.loads(res["summary_json"]), indent=2))

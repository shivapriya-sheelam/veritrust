import sqlite3
import json
import sys
sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect('veritrust.db')
cur = conn.cursor()

def print_run(case_id):
    cur.execute('''SELECT r.result_json 
                   FROM benchmark_cases bc 
                   JOIN runs r ON bc.run_id = r.run_id 
                   WHERE bc.case_id = ? AND bc.mode = 'chaos'
                   ORDER BY bc.id DESC LIMIT 1''', (case_id,))
    row = cur.fetchone()
    if not row:
        print(f'{case_id} not found')
        return
        
    res = json.loads(row[0])
    
    print(f'\n================= {case_id} =================')
    print(f'Question: {res["question"]}')
    
    draft = res["draft"]
    claims = res.get("claims", [])
    print(f'\n--- First Draft ---')
    print(draft)
    for i, c in enumerate(claims):
        print(f'  Claim {i}: {c["text"]}')
        print(f'    Status: {c["status"]} | Checked By: {c["checked_by"]}')
        print(f'    Reason: {c["reason"]}')
        print(f'    Evidence: {c.get("evidence", "")}')
        
    final_draft = res["final_draft"]
    final_claims = res.get("final_claims", [])
    if final_draft != draft or final_claims != claims:
        print(f'\n--- Final Draft (Correction) ---')
        print(final_draft)
        for i, c in enumerate(final_claims):
            print(f'  Claim {i}: {c["text"]}')
            print(f'    Status: {c["status"]} | Checked By: {c["checked_by"]}')
            print(f'    Reason: {c["reason"]}')
            print(f'    Evidence: {c.get("evidence", "")}')
            
    print(f'\nFinal Status: {res["final_status"]}')
    if res.get("abstain_reason"):
         print(f'Abstain Reason: {res["abstain_reason"]}')

print_run('U01')
print_run('P02')

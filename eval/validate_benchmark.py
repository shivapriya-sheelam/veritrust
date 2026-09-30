import json
import glob
import re

def run_validation():
    with open('data/benchmark.json', encoding='utf-8') as f:
        cases = json.load(f)

    assert len(cases) == 40, f"Expected 40 cases, got {len(cases)}"
    counts = {'direct': 0, 'paraphrased': 0, 'multi_part': 0, 'false_premise': 0, 'unanswerable': 0}
    ids = set()

    for c in cases:
        counts[c['category']] += 1
        ids.add(c['id'])
        
        assert 'id' in c
        assert 'category' in c
        assert 'question' in c
        assert 'ground_truth' in c
        assert 'expected_behavior' in c
        assert 'expected_facts' in c
        assert 'forbidden_facts' in c

        if c['category'] == 'unanswerable':
            assert c['expected_behavior'] == 'ABSTAIN', f"Case {c['id']} is unanswerable but not ABSTAIN"
            assert not c['expected_facts'], f"Case {c['id']} unanswerable has expected facts"
        else:
            assert c['expected_behavior'] == 'ANSWER', f"Case {c['id']} expects ANSWER"
            
    assert len(ids) == 40, "IDs not unique"
    assert counts == {'direct': 10, 'paraphrased': 8, 'multi_part': 6, 'false_premise': 8, 'unanswerable': 8}, f"Bad counts: {counts}"

    all_text = ""
    for file in glob.glob('data/policies/*.md'):
        with open(file, encoding='utf-8') as f:
            all_text += f.read() + "\n"
    
    all_text_lower = all_text.lower()
            
    for c in cases:
        for f in c['expected_facts']:
            assert f.lower() in all_text_lower, f"Expected fact '{f}' not found in policies"
            
        if c['category'] == 'unanswerable':
            terms = ["drone", "ceo", "invest", "solar", "groceries", "dress code", "pets", "trade-in"]
            for term in terms:
                if term in c['question'].lower():
                    assert term not in all_text_lower, f"Unanswerable term '{term}' found in policies!"

    print("Benchmark validated successfully!")
    
if __name__ == '__main__':
    run_validation()

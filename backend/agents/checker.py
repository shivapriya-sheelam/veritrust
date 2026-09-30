import re
from backend.contracts import Claim, ClaimSpan, Evidence
from backend import config

WORDS_TO_NUM = {
    "zero": 0, "one": 1, "a": 1, "an": 1, "two": 2, "three": 3, "four": 4, "five": 5, 
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, 
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100
}

STOPWORDS = {"is", "the", "a", "an", "and", "or", "to", "for", "in", "of", "on", "with", "at", "by", "from", "are", "be", "this", "that", "it", "can", "will", "you", "your", "we", "our", "if", "not", "no", "yes"}

def is_non_factual(text: str) -> bool:
    if len(text.split()) < 4:
        return True
    if not any(c.isdigit() for c in text):
        t = text.lower()
        pleasantries = ["happy to help", "thank you", "hello", "hi there", "have a great day", "let me know", "feel free to", "please contact support"]
        if any(p in t for p in pleasantries):
            return True
    return False

def parse_number(num_str: str) -> float:
    try:
        return float(num_str.replace(",", ""))
    except ValueError:
        s = num_str.lower()
        if s in WORDS_TO_NUM:
            return float(WORDS_TO_NUM[s])
        return 0.0

def extract_quantities(text: str) -> list[dict]:
    quantities = []
    text_lower = text.lower()
    
    # Percentages
    for m in re.finditer(r'(\d+(?:\.\d+)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fifty|hundred)\b)\s*(percent|%)', text_lower):
        quantities.append({
            "kind": "percentage",
            "value": parse_number(m.group(1)),
            "family": "percentage",
            "raw": m.group(0)
        })
        
    # Prices
    for m in re.finditer(r'(₹|rs\.?|inr|\$)\s*(\d+(?:,\d+)*(?:\.\d+)?)', text_lower):
        quantities.append({
            "kind": "price",
            "value": parse_number(m.group(2).replace(',', '')),
            "family": "currency",
            "raw": m.group(0)
        })
    if re.search(r'\b(free|no charge)\b', text_lower):
        quantities.append({
            "kind": "price",
            "value": 0.0,
            "family": "currency",
            "raw": "free"
        })
        
    # Durations
    duration_units = r'(business day|day|hour|week|month|year)s?'
    number_pattern = r'(\d+(?:\.\d+)?|\b(?:one|a|an|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|ninety|hundred)\b)'
    pattern = number_pattern + r'(?:\s+|-)' + duration_units
    for m in re.finditer(pattern, text_lower):
        val = parse_number(m.group(1))
        unit = m.group(2)
        family = "time"
        if unit == "business day":
            family = "business_time"
            
        if unit == "week":
            val *= 7
        elif unit == "year":
            val *= 12
            
        quantities.append({
            "kind": "duration",
            "value": val,
            "family": family,
            "raw": m.group(0)
        })
        
    return quantities

def get_keywords(text: str) -> set[str]:
    words = re.findall(r'\b[a-z]{3,}\b', text.lower())
    keywords = set()
    for w in words:
        if w not in STOPWORDS:
            if w.endswith("ies"): w = w[:-3] + "y"
            elif w.endswith("es"): w = w[:-2]
            elif w.endswith("s"): w = w[:-1]
            elif w.endswith("ing"): w = w[:-3]
            elif w.endswith("ed"): w = w[:-2]
            keywords.add(w)
    return keywords

def share_topic(claim_text: str, ev_text: str, kind: str = "") -> bool:
    c_kw = get_keywords(claim_text)
    e_kw = get_keywords(ev_text)
    overlap = c_kw & e_kw
    if kind == "price":
        generic_kws = {"return", "polic", "apply", "item", "product", "order", "purchase", "day", "month", "year", "week", "hour", "within", "such", "refund", "allow", "delivery", "charge", "cost", "take"}
        return len(overlap - generic_kws) > 0
    return len(overlap) > 0

def overlap_ratio(claim_text: str, ev_text: str) -> float:
    c_kw = get_keywords(claim_text)
    e_kw = get_keywords(ev_text)
    if not c_kw: return 0.0
    return len(c_kw & e_kw) / len(c_kw)

def get_relevant_text(claim_text: str, echo_quants: list[dict]) -> str:
    if not echo_quants:
        return claim_text
    clauses = re.split(r'[,;:]\s+', claim_text)
    valid_clauses = []
    for clause in clauses:
        clause_lower = clause.lower()
        if not any(q['raw'] in clause_lower for q in echo_quants):
            valid_clauses.append(clause)
    if valid_clauses:
        return " ".join(valid_clauses)
    return claim_text

def deterministic_check(claim: ClaimSpan, evidence: list[Evidence], question: str) -> Claim | None:
    # Exact match check
    for ev in evidence:
        if claim.text.strip() == ev.text.strip():
            return Claim(
                id=claim.id, text=claim.text, start=claim.start, end=claim.end,
                status="SUPPORTED", checked_by="deterministic", 
                reason="Exact match with policy chunk.", 
                evidence=[ev]
            )

    if is_non_factual(claim.text):
        return Claim(
            id=claim.id, text=claim.text, start=claim.start, end=claim.end,
            status="SUPPORTED", checked_by="deterministic", reason="Non-factual sentence", evidence=[]
        )
        
    c_quants = extract_quantities(claim.text)
    
    if not c_quants:
        return None # unresolved
        
    q_quants = extract_quantities(question)
    q_vals = {(q['kind'], q['family'], q['value']) for q in q_quants}
    
    non_echo_c_quants = [cq for cq in c_quants if (cq['kind'], cq['family'], cq['value']) not in q_vals]
    echo_c_quants = [cq for cq in c_quants if (cq['kind'], cq['family'], cq['value']) in q_vals]
    
    if not non_echo_c_quants:
        return None # unresolved

    relevant_claim_text = get_relevant_text(claim.text, echo_c_quants)
    
    has_support_for_all = True
    supporting_evidence = []
    
    for cq in non_echo_c_quants:
        found_exact = None
        contradicting_ev = None
        has_claimed_value = False
        
        for ev in evidence:
            e_quants = extract_quantities(ev.text)
            for eq in e_quants:
                if eq['kind'] == cq['kind'] and eq['family'] == cq['family']:
                    if share_topic(relevant_claim_text, ev.text, cq['kind']):
                        if eq['value'] == cq['value']:
                            has_claimed_value = True
                            if overlap_ratio(relevant_claim_text, ev.text) >= config.DET_SUPPORT_OVERLAP:
                                found_exact = ev
                        else:
                            contradicting_ev = ev
                            
        if found_exact:
            supporting_evidence.append(found_exact)
        else:
            has_support_for_all = False
            if contradicting_ev and not has_claimed_value:
                return Claim(
                    id=claim.id, text=claim.text, start=claim.start, end=claim.end,
                    status="CONTRADICTED", checked_by="deterministic", 
                    reason=f"Conflicts with policy (claimed {cq['raw']}).", 
                    evidence=[contradicting_ev]
                )

    if has_support_for_all:
        unique_ev = {e.chunk_id: e for e in supporting_evidence}
        return Claim(
            id=claim.id, text=claim.text, start=claim.start, end=claim.end,
            status="SUPPORTED", checked_by="deterministic", 
            reason="Supported by policy numbers.", 
            evidence=list(unique_ev.values())
        )
        
    return None # unresolved

import pytest
from backend.contracts import ClaimSpan, Evidence
from backend.agents.checker import deterministic_check

def create_claim(text: str) -> ClaimSpan:
    return ClaimSpan(id=1, text=text, start=0, end=len(text))

ev_refund = Evidence(
    source="refund_policy.md", version="v1", chunk_id="chunk1",
    text="Refunds are allowed within 15 days of purchase. Opened electronics can be returned within 15 days. A restocking fee of Rs 250 applies."
)

ev_shipping = Evidence(
    source="shipping_policy.md", version="v1", chunk_id="chunk2",
    text="Standard shipping takes between 3 to 5 business days for delivery. Express shipping costs Rs. 499 and takes 2 days."
)

def test_check_30_days_vs_15_days():
    c = create_claim("Opened electronics can be returned within 30 days.")
    res = deterministic_check(c, [ev_refund], "")
    assert res is not None
    assert res.status == "CONTRADICTED"
    assert len(res.evidence) == 1
    assert res.evidence[0] == ev_refund

def test_check_15_days_correct():
    c = create_claim("Opened electronics can be returned within 15 days.")
    res = deterministic_check(c, [ev_refund], "")
    assert res is not None
    assert res.status == "SUPPORTED"
    assert len(res.evidence) == 1

def test_check_unresolved_no_numbers():
    c = create_claim("We have a great refund policy for our customers.")
    res = deterministic_check(c, [ev_refund], "")
    assert res is None

def test_check_business_days_vs_calendar_days():
    ev = Evidence(source="test", version="v1", chunk_id="chunk5", text="Standard shipping takes 5 business days.")
    c = create_claim("Standard shipping takes 5 days.")
    res = deterministic_check(c, [ev], "")
    assert res is None

def test_check_two_weeks_equals_14_days():
    ev = Evidence(source="test", version="v1", chunk_id="chunk3", text="You can return items within 14 days.")
    c = create_claim("You can return items within two weeks.")
    res = deterministic_check(c, [ev], "")
    assert res is not None
    assert res.status == "SUPPORTED"

def test_check_echo_number_supported():
    c = create_claim("Opened electronics can be returned within 15 days, so a 20-day-old purchase is outside the return window.")
    q = "Can I return my opened headphones after 20 days?"
    res = deterministic_check(c, [ev_refund], q)
    assert res is not None
    assert res.status == "SUPPORTED"

def test_check_echo_number_contradicted():
    c = create_claim("Opened electronics can be returned within 30 days, so a 20-day-old purchase is inside the window.")
    q = "Can I return my opened headphones after 20 days?"
    res = deterministic_check(c, [ev_refund], q)
    assert res is not None
    assert res.status == "CONTRADICTED"

def test_check_wrong_number_not_in_question_contradicted():
    # express shipping ₹499 vs ₹199
    # claim says Rs. 199, ev says Rs. 499
    c = create_claim("Express shipping costs Rs. 199.")
    q = "How much does express shipping cost?"
    res = deterministic_check(c, [ev_shipping], q)
    assert res is not None
    assert res.status == "CONTRADICTED"

def test_check_non_factual_sentence():
    c = create_claim("Thank you for contacting support.")
    res = deterministic_check(c, [], "")
    assert res is not None
    assert res.status == "SUPPORTED"
    assert res.reason == "Non-factual sentence"

def test_overlap_drops_unsupported_free_clause():
    ev = Evidence(source="refund_policy.md", version="v1", chunk_id="c1", text="Opened electronics can be returned within 15 days of delivery.")
    c = create_claim("Opened electronics can be returned within 15 days, and returns are always free.")
    q = "Can I return opened headphones?"
    res = deterministic_check(c, [ev], q)
    assert res is None or res.status != "SUPPORTED"

def test_overlap_drops_unsupported_restocking_clause():
    ev = Evidence(source="refund_policy.md", version="v1", chunk_id="c1", text="Opened electronics can be returned within 15 days of delivery.")
    c = create_claim("Opened electronics can be returned within 15 days, but a restocking fee applies to everything.")
    q = "Can I return opened headphones?"
    res = deterministic_check(c, [ev], q)
    assert res is None or res.status != "SUPPORTED"

def test_overlap_drops_unsupported_accidental_clause():
    ev = Evidence(source="warranty_policy.md", version="v1", chunk_id="c2", text="All VeriCorp laptops and desktop computers include a standard 2-year manufacturer warranty.")
    c = create_claim("The laptop warranty is 2 years, which also covers accidental damage.")
    q = "How long is the laptop warranty?"
    res = deterministic_check(c, [ev], q)
    assert res is None or res.status != "SUPPORTED"

def test_check_percentages():
    ev = Evidence(source="test", version="v1", chunk_id="chunk4", text="We offer a 10 percent discount on refunds.")
    c = create_claim("You get a 10% discount on refunds.")
    res = deterministic_check(c, [ev], "")
    assert res is not None
    assert res.status == "SUPPORTED"

def test_check_prices():
    c = create_claim("A restocking fee of Rs 250 applies.")
    res = deterministic_check(c, [ev_refund], "")
    assert res is not None
    assert res.status == "SUPPORTED"

def test_check_prices_wrong():
    c = create_claim("A restocking fee of Rs 500 applies.")
    res = deterministic_check(c, [ev_refund], "")
    assert res is not None
    assert res.status == "CONTRADICTED"
    assert len(res.evidence) == 1
    assert res.evidence[0] == ev_refund

def test_deterministic_check_exact_match():
    from backend.agents.checker import deterministic_check, ClaimSpan, Evidence
    
    claim = ClaimSpan(id=1, text="A restocking fee of ₹250 applies to opened electronics returns.", start=0, end=63)
    ev = Evidence(source="refund_policy.md", version="v1", text="A restocking fee of ₹250 applies to opened electronics returns.", chunk_id="refund_policy.md#4")
    
    # Question has no numbers matching the claim
    question = "Can I return my opened headphones after 20 days?"
    
    res = deterministic_check(claim, [ev], question)
    
    assert res is not None
    assert res.status == "SUPPORTED"
    assert res.reason == "Exact match with policy chunk."
    assert res.evidence == [ev]

def test_bug2_restocking_fee_supported_or_unresolved():
    c = create_claim("Opened headphones can be returned within 10 days of delivery, but a restocking fee of ₹250 applies to such returns.")
    ev2 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#2", text="Opened electronics can be returned within 10 days.")
    ev4 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#4", text="A restocking fee of ₹250 applies to opened electronics returns.")
    ev8 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#8", text="Return shipping costs ₹99.")
    res = deterministic_check(c, [ev2, ev4, ev8], "")
    assert res is None or res.status != "CONTRADICTED"

def test_bug2_restocking_fee_contradicted_cites_4():
    c = create_claim("Opened headphones can be returned within 10 days of delivery, but a restocking fee of ₹499 applies to such returns.")
    ev2 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#2", text="Opened electronics can be returned within 10 days.")
    ev4 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#4", text="A restocking fee of ₹250 applies to opened electronics returns.")
    ev8 = Evidence(source="refund_policy.md", version="v1", chunk_id="refund_policy.md#8", text="Return shipping costs ₹99.")
    res = deterministic_check(c, [ev2, ev4, ev8], "")
    assert res is not None
    assert res.status == "CONTRADICTED"
    assert len(res.evidence) == 1
    assert res.evidence[0].chunk_id == "refund_policy.md#4"

import http from "http";

http.get("http://localhost:3001", (res) => {
  let html = "";
  res.on("data", (chunk) => (html += chunk));
  res.on("end", () => {
    console.log("=== Rendered HTML Deep Inspection ===");

    // 1. Verify struck-through '30'
    const hasDeleted30 = html.includes("<del") && html.includes("30</del>");
    console.log(`- Struck-through '30' in <del>: ${hasDeleted30 ? "PASSED" : "FAILED"}`);

    // 2. Verify green inserted text
    const hasInserted15 = html.includes("<ins") && html.includes("15</ins>");
    console.log(`- Inserted '15' in <ins>: ${hasInserted15 ? "PASSED" : "FAILED"}`);

    const hasGreenIns = html.includes("text-emerald-900") && html.includes("bg-emerald-50");
    console.log(`- Inserted text has green styling: ${hasGreenIns ? "PASSED" : "FAILED"}`);

    // 3. Verify absence of ref-01 or [ref_01]
    const hasRef01 = html.includes("ref-01") || html.includes("[ref_01]");
    console.log(`- No 'ref-01' or '[ref_01]' placeholders: ${!hasRef01 ? "PASSED" : "FAILED"}`);

    // 4. Verify Evidence rail has Contradicted Claim and Verified Correction
    const hasContradictedCard = html.includes("Contradicted Claim #01");
    const hasVerifiedCorrectionCard = html.includes("Verified Correction #01");
    console.log(`- Evidence Rail contains Contradicted Claim card: ${hasContradictedCard ? "PASSED" : "FAILED"}`);
    console.log(`- Evidence Rail contains Verified Correction card: ${hasVerifiedCorrectionCard ? "PASSED" : "FAILED"}`);

    // 5. Verify real policy citations in HTML
    const hasRealPolicy = html.includes("refund_policy.md") && html.includes("v2");
    console.log(`- Real policy citation (refund_policy.md · v2): ${hasRealPolicy ? "PASSED" : "FAILED"}`);

    // 6. Verify absence of hardcoded fallback copy
    const hasHardcoded15Days = html.includes("15 days applied");
    console.log(`- No hardcoded '15 days applied' in timeline: ${!hasHardcoded15Days ? "PASSED" : "FAILED"}`);

    const hasFabricatedWarning = html.includes("Deprecated policy state detected");
    console.log(`- No fabricated 'Deprecated policy state detected': ${!hasFabricatedWarning ? "PASSED" : "FAILED"}`);

    // 7. Verify persistent Chaos mode tag
    const hasChaosTag = html.includes("Chaos");
    console.log(`- Persistent Chaos tag present: ${hasChaosTag ? "PASSED" : "FAILED"}`);

    if (
      hasDeleted30 &&
      hasInserted15 &&
      hasGreenIns &&
      !hasRef01 &&
      hasContradictedCard &&
      hasVerifiedCorrectionCard &&
      hasRealPolicy &&
      !hasHardcoded15Days &&
      !hasFabricatedWarning &&
      hasChaosTag
    ) {
      console.log("\n=== ALL HTML INSPECTION CHECKS PASSED SUCCESSFULLY ===");
      process.exit(0);
    } else {
      console.error("\nOne or more checks failed!");
      process.exit(1);
    }
  });
});

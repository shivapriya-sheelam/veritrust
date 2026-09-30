import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=== Testing Phase 8 Polish & Interaction Improvements ===");

// 1. Verify package.json has NO new dependencies (Framer Motion was not added)
const pkgPath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const deps = Object.keys(pkg.dependencies || {});
console.log("- Checking dependencies in package.json:", deps.join(", "));
if (deps.includes("framer-motion")) {
  console.error("FAIL: framer-motion was unexpectedly added to dependencies!");
  process.exit(1);
}
console.log("  ✓ No new dependencies added (Framer Motion not installed, compliant with constraint).");

// 2. Fetch rendered HTML from localhost:3001
http.get("http://localhost:3001", (res) => {
  let html = "";
  res.on("data", (chunk) => (html += chunk));
  res.on("end", () => {
    // 3. Verify signature correction animation classes
    const hasStrikeAnim = html.includes("animate-strike-through");
    const hasInsertAnim = html.includes("animate-insert-reveal");
    console.log(`- Signature strike-through animation class: ${hasStrikeAnim ? "PASSED" : "FAILED"}`);
    console.log(`- Signature progressive insertion reveal animation class: ${hasInsertAnim ? "PASSED" : "FAILED"}`);

    // 4. Verify Customer verification badge uses real final claims policy evidence
    const hasCorrectBadge = html.includes("Verified against") && html.includes("refund_policy.md") && html.includes("v2");
    console.log(`- Customer verification badge displays actual final evidence citation: ${hasCorrectBadge ? "PASSED" : "FAILED"}`);

    // 5. Verify source-aware data attributes or IDs
    const hasDocClaim0 = html.includes('id="doc-claim-0"');
    const hasCommentClaim0 = html.includes('id="comment-claim-0"');
    const hasDocFinalClaim0 = html.includes('id="doc-final-claim-0"');
    const hasCommentFinalClaim0 = html.includes('id="comment-final-claim-0"');
    console.log(`- Document claim 0 ID present: ${hasDocClaim0 ? "PASSED" : "FAILED"}`);
    console.log(`- Comment claim 0 ID present: ${hasCommentClaim0 ? "PASSED" : "FAILED"}`);
    console.log(`- Document final-claim 0 ID present: ${hasDocFinalClaim0 ? "PASSED" : "FAILED"}`);
    console.log(`- Comment final-claim 0 ID present: ${hasCommentFinalClaim0 ? "PASSED" : "FAILED"}`);

    if (
      hasStrikeAnim &&
      hasInsertAnim &&
      hasCorrectBadge &&
      hasDocClaim0 &&
      hasCommentClaim0 &&
      hasDocFinalClaim0 &&
      hasCommentFinalClaim0
    ) {
      console.log("\n=== ALL POLISH VERIFICATIONS PASSED ===");
      process.exit(0);
    } else {
      console.error("\nOne or more polish verifications failed!");
      process.exit(1);
    }
  });
});

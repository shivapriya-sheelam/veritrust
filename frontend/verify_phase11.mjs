// Phase 11 Step 1 + Step 2 Verification Script
import { createServer } from "http";

async function runTests() {
  console.log("==================================================");
  console.log("Phase 11 Step 1 & 2 — Automated Verification Suite");
  console.log("==================================================\n");

  // TEST 1: Mock Mode Verification (NEXT_PUBLIC_USE_MOCKS=true)
  console.log("--- TEST 1: Mock Mode (NEXT_PUBLIC_USE_MOCKS=true) ---");
  process.env.NEXT_PUBLIC_USE_MOCKS = "true";

  const {
    getMetrics,
    getRuns,
    getRun,
    getPolicies,
    getPolicy,
    updatePolicy,
  } = await import("./src/lib/api.ts");

  // 1a. Ledger metrics & runs in mock mode
  const mockMetrics = await getMetrics();
  console.log("✓ getMetrics() returned:", {
    answers_checked: mockMetrics.answers_checked,
    wrong_drafts: mockMetrics.wrong_drafts,
    delivered_clean: mockMetrics.delivered_clean,
    corrected: mockMetrics.corrected,
    abstained: mockMetrics.abstained,
    chaos_runs: mockMetrics.chaos_runs,
    drift_points: mockMetrics.drift.length,
    policy_changes: mockMetrics.policy_changes.length,
  });

  const mockRunsPage1 = await getRuns({ limit: 3, offset: 0, source: "live" });
  console.log(`✓ getRuns({ limit: 3, offset: 0 }) returned ${mockRunsPage1.length} rows`);
  const mockRunResult = await getRun(mockRunsPage1[0].run_id);
  console.log(`✓ getRun("${mockRunsPage1[0].run_id}") returned full RunResult (status=${mockRunResult.final_status})`);

  // 1b. Policies in mock mode
  const mockPoliciesList = await getPolicies();
  console.log(`✓ getPolicies() returned ${mockPoliciesList.length} policies in mock mode:`);
  for (const p of mockPoliciesList) {
    console.log(`  - ${p.name} (${p.version}) · Effective: ${p.effective_date}`);
    if (!p.name || !p.version) {
      throw new Error(`FAIL: Invalid PolicySummary for ${p.name}`);
    }
  }

  const selectedMockName = mockPoliciesList[0].name;
  const mockPolicyDetail = await getPolicy(selectedMockName);
  console.log(`✓ getPolicy("${selectedMockName}") returned detail:`, {
    name: mockPolicyDetail.name,
    version: mockPolicyDetail.version,
    textLength: mockPolicyDetail.text.length,
  });
  if (!mockPolicyDetail.text || typeof mockPolicyDetail.text !== "string") {
    throw new Error("FAIL: PolicyDetail missing text");
  }

  const mockSaveResult = await updatePolicy(selectedMockName, mockPolicyDetail.text + "\n- Updated clause test.");
  console.log(`✓ updatePolicy("${selectedMockName}") returned:`, {
    name: mockSaveResult.name,
    version: mockSaveResult.version,
    stale_run_ids: mockSaveResult.stale_run_ids,
  });
  if (!mockSaveResult.version || !Array.isArray(mockSaveResult.stale_run_ids)) {
    throw new Error("FAIL: PolicyUpdateResult missing required fields");
  }

  // TEST 2: Live Mode Failure Isolation (NEXT_PUBLIC_USE_MOCKS=false)
  console.log("\n--- TEST 2: Live Mode Failure Isolation (NEXT_PUBLIC_USE_MOCKS=false) ---");
  process.env.NEXT_PUBLIC_USE_MOCKS = "false";
  process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:59999"; // Non-existent port

  let caughtPoliciesError = false;
  try {
    await getPolicies();
  } catch (err) {
    caughtPoliciesError = true;
    console.log("✓ Correctly caught live connection failure on getPolicies():", err.message);
  }
  if (!caughtPoliciesError) {
    throw new Error("FAIL: getPolicies() did not throw on unavailable server; may have silently fallen back to mock data!");
  }

  let caughtPolicyError = false;
  try {
    await getPolicy("refund_policy.md");
  } catch (err) {
    caughtPolicyError = true;
    console.log("✓ Correctly caught live connection failure on getPolicy():", err.message);
  }
  if (!caughtPolicyError) {
    throw new Error("FAIL: getPolicy() did not throw on unavailable server!");
  }

  let caughtUpdateError = false;
  try {
    await updatePolicy("refund_policy.md", "new content");
  } catch (err) {
    caughtUpdateError = true;
    console.log("✓ Correctly caught live connection failure on updatePolicy():", err.message);
  }
  if (!caughtUpdateError) {
    throw new Error("FAIL: updatePolicy() did not throw on unavailable server!");
  }

  // TEST 3: Live Policies API Integration with Simulated Live Server
  console.log("\n--- TEST 3: Live Policy API Integration with Live Backend ---");
  const liveMockPort = 59889;
  let backendPolicyVersion = "v1";
  let backendPolicyText = `---
name: refund_policy
version: v1
effective_date: 2026-09-01
---
- Refunds are allowed within 15 days of purchase.
- Opened electronics can be returned within 15 days.`;

  const liveServer = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${liveMockPort}`);

    if (req.method === "GET" && url.pathname === "/api/policies") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          {
            name: "refund_policy.md",
            version: backendPolicyVersion,
            effective_date: "2026-09-01",
            updated_at: "2026-09-30 14:00:00",
          },
          {
            name: "warranty_policy.md",
            version: "v1",
            effective_date: "2026-09-01",
            updated_at: "2026-09-30 14:00:00",
          },
        ])
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/policies/refund_policy.md") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          name: "refund_policy.md",
          version: backendPolicyVersion,
          text: backendPolicyText,
        })
      );
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/policies/refund_policy.md") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        backendPolicyText = parsed.text;
        backendPolicyVersion = "v2"; // Server is authoritative for version bump!
        const staleRunIds = ["run-9042", "run-9035", "run-9022"];

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "refund_policy.md",
            version: backendPolicyVersion,
            stale_run_ids: staleRunIds,
          })
        );
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => liveServer.listen(liveMockPort, resolve));
  process.env.NEXT_PUBLIC_API_URL = `http://localhost:${liveMockPort}`;

  try {
    // 3a. GET /api/policies
    const livePolicies = await getPolicies();
    console.log(`✓ Live getPolicies() returned ${livePolicies.length} policies:`, livePolicies);
    if (livePolicies.length !== 2 || livePolicies[0].name !== "refund_policy.md") {
      throw new Error("FAIL: Live policies list response mismatch");
    }

    // 3b. GET /api/policies/refund_policy.md
    const liveDetail = await getPolicy("refund_policy.md");
    console.log("✓ Live getPolicy('refund_policy.md') returned:", {
      name: liveDetail.name,
      version: liveDetail.version,
      clausesCount: liveDetail.text.split("\n").filter((l) => l.startsWith("-")).length,
    });
    if (liveDetail.version !== "v1") {
      throw new Error(`FAIL: Expected initial version v1, got ${liveDetail.version}`);
    }

    // 3c. PUT /api/policies/refund_policy.md
    const updatedContent = `${liveDetail.text}\n- Returns for headphones extended to 20 days.`;
    const liveUpdateResult = await updatePolicy("refund_policy.md", updatedContent);
    console.log("✓ Live updatePolicy('refund_policy.md') returned:", liveUpdateResult);

    if (liveUpdateResult.version !== "v2") {
      throw new Error(`FAIL: Expected backend-authoritative version 'v2', got '${liveUpdateResult.version}'`);
    }

    if (liveUpdateResult.stale_run_ids.length !== 3) {
      throw new Error(`FAIL: Expected 3 stale_run_ids, got ${liveUpdateResult.stale_run_ids.length}`);
    }
    console.log(`✓ Stale run count verified: ${liveUpdateResult.stale_run_ids.length} past answers are now out of date.`);

    // 3d. Verify updated policy detail returns new version and updated text
    const reloadedDetail = await getPolicy("refund_policy.md");
    console.log("✓ Re-fetching policy confirms new authoritative version:", {
      version: reloadedDetail.version,
      updated_text: reloadedDetail.text.includes("extended to 20 days"),
    });
    if (reloadedDetail.version !== "v2") {
      throw new Error("FAIL: Reloaded policy version did not reflect backend state");
    }
  } finally {
    await new Promise((resolve) => liveServer.close(resolve));
  }

  // TEST 4: Phase 11 Step 3 — Benchmark Gauntlet in Mock Mode (NEXT_PUBLIC_USE_MOCKS=true)
  console.log("\n--- TEST 4: Benchmark Gauntlet in Mock Mode (NEXT_PUBLIC_USE_MOCKS=true) ---");
  process.env.NEXT_PUBLIC_USE_MOCKS = "true";

  const {
    getLatestBenchmark,
    runBenchmarkStream,
  } = await import("./src/lib/api.ts");

  const mockLatest = await getLatestBenchmark();
  console.log("✓ getLatestBenchmark() in mock mode returned authoritative summary:", {
    total_cases: mockLatest.total_cases,
    detection_rate: mockLatest.detection_rate,
    false_approval_rate: mockLatest.false_approval_rate,
    correct_abstention_rate: mockLatest.correct_abstention_rate,
    correction_success_rate: mockLatest.correction_success_rate,
    veritrust_accuracy: mockLatest.veritrust_accuracy,
    baseline_accuracy: mockLatest.baseline_accuracy,
  });

  if (
    mockLatest.detection_rate !== 0.913 ||
    mockLatest.false_approval_rate !== 0.0 ||
    mockLatest.correct_abstention_rate !== 1.0 ||
    mockLatest.correction_success_rate !== 0.875
  ) {
    throw new Error("FAIL: Mock latest benchmark metrics do not match PRD §13 specifications");
  }

  console.log("  Testing mock SSE benchmark stream (Normal mode)...");
  let mockReceivedCount = 0;
  let mockStartedEvent = null;
  let mockSummaryEvent = null;

  for await (const event of runBenchmarkStream(false)) {
    if (event.event === "benchmark_started") {
      mockStartedEvent = event.data;
    } else if (event.event === "benchmark_case") {
      mockReceivedCount++;
    } else if (event.event === "benchmark_summary") {
      mockSummaryEvent = event.data;
    }
  }

  console.log(`✓ Stream yielded ${mockReceivedCount} cases incrementally.`);
  if (mockReceivedCount !== 40) {
    throw new Error(`FAIL: Expected 40 benchmark cases in stream, got ${mockReceivedCount}`);
  }
  if (!mockStartedEvent || !mockSummaryEvent) {
    throw new Error("FAIL: Missing benchmark_started or benchmark_summary in stream");
  }
  console.log("✓ Final summary received with detection_rate:", mockSummaryEvent.detection_rate);

  // TEST 5: Phase 11 Step 3 — Live Mode Failure Isolation (NEXT_PUBLIC_USE_MOCKS=false)
  console.log("\n--- TEST 5: Benchmark Live Mode Failure Isolation (NEXT_PUBLIC_USE_MOCKS=false) ---");
  process.env.NEXT_PUBLIC_USE_MOCKS = "false";
  process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:59999"; // unreachable port

  let caughtBmLatestError = false;
  try {
    await getLatestBenchmark();
  } catch (err) {
    caughtBmLatestError = true;
    console.log("✓ Correctly caught live connection failure on getLatestBenchmark():", err.message);
  }
  if (!caughtBmLatestError) {
    throw new Error("FAIL: getLatestBenchmark() did not throw on unavailable server; must not fallback to mock data!");
  }

  let caughtBmStreamError = false;
  try {
    const stream = runBenchmarkStream(false);
    for await (const _ev of stream) {
      // should throw on connect
    }
  } catch (err) {
    caughtBmStreamError = true;
    console.log("✓ Correctly caught live connection failure on runBenchmarkStream():", err.message);
  }
  if (!caughtBmStreamError) {
    throw new Error("FAIL: runBenchmarkStream() did not throw on unavailable server!");
  }

  // TEST 6: Phase 11 Step 3 — Live Benchmark SSE Server Integration
  console.log("\n--- TEST 6: Live Benchmark SSE Server Integration ---");
  const bmServerPort = 59890;
  let receivedPostPayload = null;

  const bmServer = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${bmServerPort}`);

    if (req.method === "GET" && url.pathname === "/api/benchmark/latest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: 42,
          started_at: "2026-09-30T14:00:00Z",
          finished_at: "2026-09-30T14:00:45Z",
          modes: ["normal"],
          total_cases: 40,
          completed_cases: 40,
          passed_cases: 38,
          failed_cases: 2,
          detection_rate: 0.913,
          false_approval_rate: 0.0,
          correct_abstention_rate: 1.0,
          correction_success_rate: 0.875,
          over_abstention_rate: 0.05,
          baseline_accuracy: 0.45,
          veritrust_accuracy: 0.925,
          cases: [
            {
              case_id: "B01",
              category: "direct",
              question: "What is the return window for opened electronics?",
              expected_behavior: "ANSWER",
              actual_status: "DELIVERED",
              pass: true,
              latency_ms: 180,
            },
          ],
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/benchmark/run") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        receivedPostPayload = JSON.parse(body);

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // 1. Emit started
        res.write(
          `event: benchmark_started\ndata: ${JSON.stringify({
            total_cases: 3,
            mode: receivedPostPayload.modes?.includes("chaos") ? "chaos" : "normal",
            started_at: new Date().toISOString(),
          })}\n\n`
        );

        // 2. Emit cases incrementally
        const sampleCases = [
          {
            case_id: "B01",
            category: "direct",
            question: "What is return window?",
            expected_behavior: "ANSWER",
            actual_status: "DELIVERED",
            pass: true,
            latency_ms: 190,
          },
          {
            case_id: "B25",
            category: "false_premise",
            question: "Confirm 30-day return policy",
            expected_behavior: "ANSWER",
            actual_status: "CORRECTED",
            pass: true,
            latency_ms: 480,
          },
          {
            case_id: "B33",
            category: "unanswerable",
            question: "Do you offer drone delivery?",
            expected_behavior: "ABSTAIN",
            actual_status: "ABSTAINED",
            pass: true,
            latency_ms: 290,
          },
        ];

        for (const c of sampleCases) {
          await new Promise((r) => setTimeout(r, 20));
          res.write(`event: benchmark_case\ndata: ${JSON.stringify(c)}\n\n`);
        }

        // 3. Emit summary
        await new Promise((r) => setTimeout(r, 20));
        res.write(
          `event: benchmark_summary\ndata: ${JSON.stringify({
            id: 43,
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            modes: receivedPostPayload.modes || ["normal"],
            total_cases: 3,
            completed_cases: 3,
            passed_cases: 3,
            failed_cases: 0,
            detection_rate: 0.913,
            false_approval_rate: 0.0,
            correct_abstention_rate: 1.0,
            correction_success_rate: 0.875,
            over_abstention_rate: 0.05,
            baseline_accuracy: 0.45,
            veritrust_accuracy: 0.925,
          })}\n\n`
        );

        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => bmServer.listen(bmServerPort, resolve));
  process.env.NEXT_PUBLIC_API_URL = `http://localhost:${bmServerPort}`;

  try {
    // 6a. Verify live GET /api/benchmark/latest
    const liveLatest = await getLatestBenchmark();
    console.log("✓ Live getLatestBenchmark() successfully retrieved summary:", {
      id: liveLatest.id,
      detection_rate: liveLatest.detection_rate,
      false_approval_rate: liveLatest.false_approval_rate,
      cases_count: liveLatest.cases.length,
    });
    if (liveLatest.id !== 42 || liveLatest.detection_rate !== 0.913) {
      throw new Error("FAIL: Live latest benchmark mismatch");
    }

    // 6b. Verify live POST /api/benchmark/run with chaos=true
    console.log("  Testing live POST /api/benchmark/run SSE streaming with chaos=true...");
    let liveReceivedCases = [];
    let liveReceivedSummary = null;

    for await (const event of runBenchmarkStream(true)) {
      if (event.event === "benchmark_case") {
        liveReceivedCases.push(event.data);
      } else if (event.event === "benchmark_summary") {
        liveReceivedSummary = event.data;
      }
    }

    console.log(`✓ Received ${liveReceivedCases.length} cases incrementally over real SSE.`);
    if (liveReceivedCases.length !== 3) {
      throw new Error(`FAIL: Expected 3 cases in live stream, got ${liveReceivedCases.length}`);
    }
    if (!liveReceivedSummary || liveReceivedSummary.detection_rate !== 0.913) {
      throw new Error("FAIL: Live benchmark summary mismatch");
    }
    if (!receivedPostPayload || !receivedPostPayload.modes || !receivedPostPayload.modes.includes("chaos") || receivedPostPayload.chaos !== undefined) {
      throw new Error(`FAIL: Expected POST payload strictly { modes: ['chaos'] } without extra chaos key, got ${JSON.stringify(receivedPostPayload)}`);
    }
    console.log("✓ Verified payload received by backend strictly matches PRD §10: { modes: ['chaos'] }");

    // 6c. Verify abort cancellation
    console.log("  Testing stream cancellation via AbortSignal...");
    const abortCtrl = new AbortController();
    const abortStream = runBenchmarkStream(false, abortCtrl.signal);
    const iterator = abortStream[Symbol.asyncIterator]();
    await iterator.next(); // first event
    abortCtrl.abort(); // cancel immediately
    const nextResult = await iterator.next();
    console.log("✓ Stream cleanly handled client abort (done:", nextResult.done, ")");
  } finally {
    await new Promise((resolve) => bmServer.close(resolve));
  }

  console.log("\n==================================================");
  console.log("ALL PHASE 11 (STEP 1, 2, AND 3) TESTS PASSED! ✅");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});

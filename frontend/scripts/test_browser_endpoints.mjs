import http from "http";

console.log("=== Testing Next.js Dev Server at http://localhost:3001 ===");

const req = http.get("http://localhost:3001", (res) => {
  console.log(`HTTP Status: ${res.statusCode} ${res.statusMessage}`);
  let data = "";

  res.on("data", (chunk) => {
    data += chunk;
  });

  res.on("end", () => {
    console.log(`Received ${data.length} bytes of HTML.`);

    // Check for critical Phase 8 UI landmarks in HTML
    const checks = [
      { name: "Page title", pattern: /<title>VeriTrust AI/ },
      { name: "Track Changes header", pattern: /Track Changes/ },
      { name: "Editorial response container", pattern: /Response Draft/ },
      { name: "Verified badge / policy citation", pattern: /Verified against/ },
      { name: "Pipeline timeline", pattern: /Pipeline/ },
      { name: "Automated stages list", pattern: /Retrieve/ },
      { name: "Evidence & Comments rail", pattern: /Evidence &amp; Comments|Evidence & Comments/ },
      { name: "Simulated failure indicator", pattern: /Simulated failure/ },
      { name: "AskBar input form", pattern: /Ask a policy question/ },
    ];

    let allPassed = true;
    for (const c of checks) {
      const match = c.pattern.test(data);
      console.log(`  ${match ? "✓" : "✗"} ${c.name}`);
      if (!match) allPassed = false;
    }

    if (allPassed) {
      console.log("\n=== ALL SERVER ENDPOINT CHECKS PASSED ===");
      process.exit(0);
    } else {
      console.error("\nSome server HTML checks failed!");
      process.exit(1);
    }
  });
});

req.on("error", (err) => {
  console.error("Failed to connect to http://localhost:3001:", err.message);
  process.exit(1);
});

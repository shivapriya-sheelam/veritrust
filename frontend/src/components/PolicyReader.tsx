"use client";

import React from "react";
import Link from "next/link";

interface PolicyReaderProps {
  policyName: string;
  version: string;
  effectiveDate?: string;
  updatedAt?: string;
  text: string;
  mode: "view" | "edit";
  onModeChange: (mode: "view" | "edit") => void;
  showStaleBanner: boolean;
  staleRunCount: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export const PolicyReader: React.FC<PolicyReaderProps> = ({
  policyName,
  version,
  effectiveDate,
  updatedAt,
  text,
  mode,
  onModeChange,
  showStaleBanner,
  staleRunCount,
  loading = false,
  error = null,
  onRetry,
}) => {
  // Parse policy markdown into frontmatter metadata and clauses/paragraphs
  const { frontmatter, clauses, isBulletFormat } = React.useMemo(() => {
    if (!text) return { frontmatter: {}, clauses: [], isBulletFormat: false };

    let body = text;
    const meta: Record<string, string> = {};

    // Check for YAML frontmatter
    if (body.startsWith("---")) {
      const closingIdx = body.indexOf("---", 3);
      if (closingIdx !== -1) {
        const yamlStr = body.substring(3, closingIdx).trim();
        body = body.substring(closingIdx + 3).trim();
        for (const line of yamlStr.split("\n")) {
          const colonIdx = line.indexOf(":");
          if (colonIdx !== -1) {
            const k = line.substring(0, colonIdx).trim();
            const v = line.substring(colonIdx + 1).trim();
            meta[k] = v;
          }
        }
      }
    }

    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const bulletLines = lines.filter((l) => l.startsWith("- ") || l.startsWith("* "));
    const hasBullets = bulletLines.length > 0;

    let parsedClauses: { id: string; title?: string; content: string }[] = [];

    if (hasBullets) {
      parsedClauses = bulletLines.map((line, idx) => ({
        id: `Clause #${idx + 1}`,
        content: line.replace(/^[-*]\s+/, ""),
      }));
    } else {
      // Split by double newlines or headings
      const sections = body.split(/\n\n+/).filter((s) => s.trim().length > 0);
      parsedClauses = sections.map((sec, idx) => {
        const secLines = sec.split("\n");
        const firstLine = secLines[0].trim();
        const isHeader = firstLine.startsWith("#");
        return {
          id: `Section #${idx + 1}`,
          title: isHeader ? firstLine.replace(/^#+\s*/, "") : undefined,
          content: isHeader ? secLines.slice(1).join("\n").trim() : sec,
        };
      });
    }

    return { frontmatter: meta, clauses: parsedClauses, isBulletFormat: hasBullets };
  }, [text]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header & Metadata Bar Container */}
      <div className="bg-white p-6 sm:p-7 rounded-lg border border-outline-dim shadow-xs flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider flex-wrap">
              <span className="text-accent-ochre font-semibold">Policy · {policyName}</span>
              <span className="w-1 h-1 rounded-full bg-outline"></span>
              <span className="text-outline">
                VERSION: <strong>{version}</strong> (Authoritative Runtime)
              </span>
              {effectiveDate && (
                <>
                  <span className="w-1 h-1 rounded-full bg-outline"></span>
                  <span className="text-outline">EFFECTIVE: {effectiveDate}</span>
                </>
              )}
            </div>

            <h1 className="font-editorial text-[1.75rem] font-serif text-on-surface mt-0.5">
              {policyName}
            </h1>

            {frontmatter.effective_date && (
              <p className="font-mono text-[11px] text-on-surface-variant">
                Frontmatter: version {frontmatter.version || version} · effective {frontmatter.effective_date}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start">
            {/* View / Edit Mode Toggle Tabs */}
            <div className="flex items-center p-0.5 bg-surface-muted rounded border border-outline-dim">
              <button
                type="button"
                onClick={() => onModeChange("view")}
                className={`px-3 py-1 rounded font-sans text-[12px] font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  mode === "view"
                    ? "bg-white text-on-surface shadow-xs"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">auto_stories</span>
                Document View
              </button>
              <button
                type="button"
                onClick={() => onModeChange("edit")}
                className={`px-3 py-1 rounded font-sans text-[12px] font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  mode === "edit"
                    ? "bg-white text-on-surface shadow-xs"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[14px] leading-none">edit_note</span>
                Edit Policy
              </button>
            </div>
          </div>
        </div>

        {/* Freshness / Stale Runs Alert Banner (PRD Section 14) */}
        {showStaleBanner && staleRunCount > 0 && (
          <div className="rounded-lg p-4 bg-accent-ochre-bg/40 border border-accent-ochre-border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-accent-ochre text-[22px] mt-0.5 leading-none">
                update
              </span>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-editorial text-[15px] font-semibold text-on-surface">
                    Policy updated to {version}
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white text-accent-ochre border border-accent-ochre-border font-semibold">
                    New Version Active
                  </span>
                </div>
                <p className="font-sans text-[13px] text-on-surface-variant">
                  <strong>{staleRunCount}</strong> {staleRunCount === 1 ? "past answer is" : "past answers are"} now out of date because they were verified against an earlier version.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-end sm:self-center font-mono text-[11px]">
              <Link
                href="/ledger"
                className="text-accent-ochre hover:underline flex items-center gap-1 font-semibold"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">history</span>
                View in Ledger →
              </Link>
              <span className="text-outline/40">·</span>
              <Link
                href="/"
                className="text-on-surface hover:text-accent-ochre hover:underline flex items-center gap-1 font-medium"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">question_answer</span>
                Test in Review →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* VIEW MODE: Document View */}
      {mode === "view" && (
        <div className="bg-white p-6 sm:p-9 rounded-lg border border-outline-dim shadow-xs flex flex-col gap-6">
          {loading ? (
            <div className="py-16 text-center font-mono text-[12px] text-on-surface-variant flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent-ochre animate-pulse"></span>
              Loading policy specification from backend...
            </div>
          ) : error ? (
            <div className="p-5 rounded bg-red-50/70 border border-red-200 font-mono text-[12px] text-accent-rose flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <span className="font-bold">Error loading policy:</span> {error}
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-3 py-1 bg-white border border-red-300 rounded hover:bg-red-50 font-semibold cursor-pointer"
                >
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Document Meta Header inside reader */}
              <div className="flex items-center justify-between pb-3 border-b border-surface-dim">
                <span className="font-mono text-[10px] text-outline uppercase tracking-wider font-semibold">
                  Specification Clauses · {clauses.length} Chunks
                </span>
                <span className="font-mono text-[10px] text-on-surface-variant bg-surface-muted px-2 py-0.5 rounded border border-outline-dim/60">
                  Authoritative Runtime Ground Truth
                </span>
              </div>

              {/* Render Clauses */}
              <div className="flex flex-col gap-5 divide-y divide-surface-dim">
                {clauses.map((clause, idx) => (
                  <div
                    key={clause.id || idx}
                    className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start pt-5 first:pt-0"
                  >
                    {/* Left Gutter Label */}
                    <div className="md:col-span-3 flex md:flex-col justify-between md:justify-start gap-1 p-2 rounded bg-surface-muted/60 border border-outline-dim/50">
                      <span className="font-mono text-[11px] font-bold text-accent-ochre">
                        {clause.id}
                      </span>
                      <span className="font-mono text-[10px] text-outline truncate">
                        {policyName}
                      </span>
                    </div>

                    {/* Clause Text */}
                    <div className="md:col-span-9 flex flex-col gap-1">
                      {clause.title && (
                        <h3 className="font-editorial text-[1.125rem] font-serif text-on-surface font-semibold mb-1">
                          {clause.title}
                        </h3>
                      )}
                      <p className="font-editorial text-[1.0625rem] text-on-surface leading-relaxed">
                        {clause.content}
                      </p>
                    </div>
                  </div>
                ))}

                {clauses.length === 0 && (
                  <div className="p-8 text-center font-mono text-[12px] text-outline">
                    Empty policy document.
                  </div>
                )}
              </div>

              {/* Bottom Audit Verification Stamp */}
              <div className="bg-surface-muted/60 p-4 rounded flex flex-col sm:flex-row items-center justify-between gap-3 border border-outline-dim/70 mt-2">
                <div className="flex items-center gap-2 text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-accent-ochre leading-none">
                    fact_check
                  </span>
                  <span className="font-sans text-[12px] text-on-surface-variant">
                    Active baseline: <strong className="text-on-surface">{version}</strong> ·
                    ChromaDB index synced with SQLite runtime table
                  </span>
                </div>
                <Link
                  href="/ledger"
                  className="font-mono text-[11px] text-accent-ochre hover:underline flex items-center gap-1 font-semibold"
                >
                  Inspect Ledger Runs <span className="material-symbols-outlined text-[13px] leading-none">arrow_forward</span>
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

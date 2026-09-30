"use client";

import React from "react";

interface PolicyEditorProps {
  policyName: string;
  version: string;
  content: string;
  onChangeContent: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isDirty: boolean;
  saveError?: string | null;
  saveSuccess?: boolean;
}

export const PolicyEditor: React.FC<PolicyEditorProps> = ({
  policyName,
  version,
  content,
  onChangeContent,
  onSave,
  onCancel,
  isSaving,
  isDirty,
  saveError = null,
  saveSuccess = false,
}) => {
  const lines = content.split("\n");
  const lineCount = lines.length;
  const charCount = content.length;

  return (
    <div className="bg-white p-6 rounded-lg border border-outline-dim shadow-xs flex flex-col gap-4">
      {/* Editor Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-surface-dim">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] uppercase text-accent-ochre font-semibold">
            Markdown Editor
          </span>
          <span className="text-outline">·</span>
          <span className="font-mono text-[11px] text-on-surface font-medium">
            {policyName} ({version})
          </span>
          {isDirty && (
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-mono text-[10px] font-semibold flex items-center gap-1.5 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              Unsaved changes
            </span>
          )}
        </div>

        <div className="font-mono text-[10px] text-outline">
          {charCount.toLocaleString()} characters · {lineCount} lines
        </div>
      </div>

      {/* Save Error Banner */}
      {saveError && (
        <div className="p-3 bg-red-50/80 border border-red-200 rounded font-mono text-[11px] text-accent-rose flex items-center gap-2">
          <span className="font-bold">Error saving policy:</span>
          <span>{saveError}</span>
        </div>
      )}

      {/* Save Success Banner */}
      {saveSuccess && !isDirty && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded font-mono text-[11px] text-emerald-800 flex items-center gap-2">
          <span className="font-bold">✓ Policy updated:</span>
          <span>Active baseline bumped to <strong>{version}</strong> and re-indexed.</span>
        </div>
      )}

      {/* Code Editor Box with Line Numbers */}
      <div className="w-full flex rounded bg-surface-muted/50 border border-outline-dim overflow-hidden font-mono text-[12px]">
        {/* Line Numbers gutter */}
        <div className="select-none py-3 px-2 bg-surface-muted text-right font-mono text-[11px] text-outline/60 flex flex-col gap-0 leading-6 w-11 border-r border-outline-dim">
          {Array.from({ length: Math.max(lineCount, 15) }, (_, i) => (
            <span key={i}>{String(i + 1).padStart(2, "0")}</span>
          ))}
        </div>

        {/* Textarea editor */}
        <textarea
          rows={Math.max(lineCount, 20)}
          value={content}
          onChange={(e) => onChangeContent(e.target.value)}
          spellCheck={false}
          className="w-full p-3 bg-transparent text-on-surface focus:outline-none resize-none leading-6 font-mono text-[12px]"
          placeholder="Policy markdown content..."
        />
      </div>

      {/* Editor Action Triggers */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <span className="font-sans text-[12px] text-on-surface-variant flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[15px] text-accent-ochre leading-none">
            info
          </span>
          Saving validates front-matter, records an append-only version, re-indexes chunks, and marks past runs stale.
        </span>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={!isDirty || isSaving}
            className="px-3.5 py-1.5 rounded font-sans text-[12px] font-medium bg-surface-muted text-on-surface hover:bg-surface-dim border border-outline-dim transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Discard Edits
          </button>
          <button
            type="button"
            disabled={isSaving || !isDirty}
            onClick={onSave}
            className="px-4 py-1.5 rounded font-sans text-[12px] font-medium bg-black text-white hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[15px] leading-none">
              {isSaving ? "sync" : "publish"}
            </span>
            <span>{isSaving ? "Publishing Revision..." : "Save Policy Revision"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

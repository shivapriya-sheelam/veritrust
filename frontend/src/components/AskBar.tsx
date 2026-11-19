import React, { useState } from 'react';

interface AskBarProps {
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  onAsk: (question: string) => void;
}

const EXAMPLE_PROMPTS = [
  "Can I return opened headphones after 20 days?",
  "What is our warranty coverage on laptops and accidental damage?",
  "Can I get a cash refund for a digital gift card?",
];

export const AskBar: React.FC<AskBarProps> = ({ status, error, onAsk }) => {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "running") return;
    onAsk(input);
  };

  const handleChipClick = (prompt: string) => {
    if (status === "running") return;
    setInput(prompt);
    onAsk(prompt);
  };

  return (
    <div className="w-full flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex gap-2 w-full">
        <input 
          type="text" 
          value={input} 
          onChange={e => setInput(e.target.value)}
          disabled={status === "running"}
          className="flex-1 bg-white border border-outline-dim px-3 py-2 rounded text-[13px] font-sans text-on-surface placeholder:text-outline focus:outline-none focus:border-on-surface transition-colors"
          placeholder="Ask a policy question..." 
        />
        <button 
          type="submit" 
          disabled={status === "running" || !input.trim()}
          className="bg-on-surface text-surface px-4 py-2 rounded text-[13px] font-medium disabled:opacity-50 hover:bg-black transition-colors"
        >
          Ask
        </button>
      </form>

      {/* Example Prompt Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-outline select-none mr-1">
          Try:
        </span>
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={status === "running"}
            onClick={() => handleChipClick(prompt)}
            className="font-mono text-[11px] text-on-surface-variant bg-white border border-outline-dim hover:border-on-surface hover:text-on-surface px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 text-left cursor-pointer"
          >
            {prompt}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 bg-rose-50 text-rose-700 border border-rose-200 rounded text-[13px]">
          {error}
        </div>
      )}

      {status === "running" && !error && (
        <div className="p-3 flex items-center justify-center gap-2 text-outline">
          <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span>
          <span className="font-mono text-[11px] uppercase tracking-widest">Checking policies...</span>
        </div>
      )}
    </div>
  );
};

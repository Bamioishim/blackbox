"use client";
import { useState } from "react";

/** A long hash that wraps (or truncates on small screens) with a copy button. */
export function CopyHash({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="hash">
      <span className="hash-full mono" title={value}>{value}</span>
      <span className="hash-short mono" title={value}>{value.slice(0, 10)}…{value.slice(-6)}</span>
      <button type="button" className="copy" aria-label={`Copy ${label ?? "hash"}`}
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); }}>
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

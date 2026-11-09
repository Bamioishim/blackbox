/** Hand-drawn wax seal mark. */
export function Seal({ size = 22, color = "var(--wax)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path
        d="M20 2.5c2.4 0 3.2 2.1 5.3 2.6 2.1.5 4-.9 5.9.4 1.9 1.3 1.4 3.6 2.6 5.4 1.2 1.8 3.6 2.2 4 4.4.4 2.2-1.6 3.4-1.6 5.7s2 3.5 1.6 5.7c-.4 2.2-2.8 2.6-4 4.4-1.2 1.8-.7 4.1-2.6 5.4-1.9 1.3-3.8-.1-5.9.4-2.1.5-2.9 2.6-5.3 2.6s-3.2-2.1-5.3-2.6c-2.1-.5-4 .9-5.9-.4-1.9-1.3-1.4-3.6-2.6-5.4C3.3 29.3.9 28.9.5 26.7.1 24.5 2.1 23.3 2.1 21s-2-3.5-1.6-5.7c.4-2.2 2.8-2.6 4-4.4 1.2-1.8.7-4.1 2.6-5.4 1.9-1.3 3.8.1 5.9-.4C15.1 4.6 15.9 2.5 20 2.5z"
        fill={color}
      />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke="#f2ede3" strokeOpacity=".55" strokeWidth="1.2" />
      <path d="M16 20.5l3 3 5.5-7" fill="none" stroke="#f2ede3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null)
    return (<svg width="18" height="18" viewBox="0 0 18 18" aria-label="pending"><circle cx="9" cy="9" r="7" fill="none" stroke="var(--muted)" strokeDasharray="2 3" /></svg>);
  return ok ? (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-label="pass"><circle cx="9" cy="9" r="8" fill="#2f6b3a" /><path d="M5.2 9.4l2.5 2.4 5-5.6" stroke="#f2ede3" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-label="fail"><circle cx="9" cy="9" r="8" fill="var(--wax)" /><path d="M6 6l6 6M12 6l-6 6" stroke="#f2ede3" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
}

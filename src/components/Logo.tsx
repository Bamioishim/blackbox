/**
 * Blackbox mark: a flight recorder. A dark case with a carry handle, one accent band
 * where the lid seals, and the recorded trace running through it.
 */
export const HANDLE = "M24.5 13.2V9.6c0-1.6 1-2.6 2.6-2.6h9.9c1.6 0 2.5 1 2.5 2.6v3.6";
export const CASE = "M8.4 18.6c0-3.3 2-5.3 5.2-5.3h36.9c3.2 0 5.1 2 5.1 5.3v28.9c0 3.3-2 5.2-5.2 5.2H13.5c-3.2 0-5.1-2-5.1-5.3z";
export const BAND = "M8.4 29.2h47.2v8.1H8.4z";
export const TRACE = "M21.2 33.3h3.9l2.1-2.9 2.6 5.4 2.9-6.8 2.6 6.1 2.2-1.8h11.5";

export function LogoMark({ size = 28, ink = "var(--ink)", accent = "var(--wax)", paper = "var(--paper)" }: { size?: number; ink?: string; accent?: string; paper?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d={HANDLE} fill="none" stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
      <path d={CASE} fill={ink} />
      <path d={BAND} fill={accent} />
      <circle cx="15.2" cy="33.3" r="2.3" fill={paper} />
      <path d={TRACE} fill="none" stroke={paper} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

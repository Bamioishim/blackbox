/** The Blackbox mark: an isometric cube whose Y seam leaks the accent light. Source: public/brand/blackbox-mark.svg */
export function LogoMark({ size = 28 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/blackbox-mark.svg" width={size} height={size} alt="" aria-hidden style={{ display: "block" }} />;
}

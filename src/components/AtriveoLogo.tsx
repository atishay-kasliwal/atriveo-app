/**
 * Official Atriveo brand mark — the "Directional Apex": a serif capital A
 * whose crossbar is a compass needle. Sourced from the Atriveo Brand Foundation.
 * Single solid form, holds shape down to 16px.
 */
export default function AtriveoLogo({
  size = 28,
  fill = "currentColor",
  className,
}: {
  size?: number;
  fill?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="Atriveo"
      className={className}
    >
      {/* Apex — serif A silhouette */}
      <path d="M50 12L88 88H76L50 38L24 88H12L50 12Z" fill={fill} />
      {/* Compass needle crossbar */}
      <path d="M43 65L50 56L57 65L50 61L43 65Z" fill={fill} />
    </svg>
  );
}

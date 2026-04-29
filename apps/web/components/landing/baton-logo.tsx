export function BatonLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby="baton-logo-title"
    >
      <title id="baton-logo-title">Conductor</title>
      {/* Baton stick */}
      <line
        x1="8"
        y1="40"
        x2="38"
        y2="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Baton handle bulb */}
      <circle cx="38" cy="10" r="5" fill="currentColor" opacity="0.9" />
      {/* Small decorative dots (musical notes suggestion) */}
      <circle cx="16" cy="28" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="22" cy="20" r="1.5" fill="currentColor" opacity="0.3" />
      <circle cx="28" cy="14" r="1" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

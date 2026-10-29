/** Layered ridge line for banners, drawn in currentColor so it follows the theme. */
export function MountainArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice" fill="currentColor" aria-hidden>
      <path opacity="0.08" d="M0 230 140 128 236 182 388 44 528 168 646 96 792 196 934 70 1072 176 1200 112V320H0Z" />
      <path opacity="0.14" d="m388 44 46 42-24-4-22 22-24-20-26 8Zm546 26 50 46-26-6-24 24-26-22-28 10Z" />
      <path opacity="0.12" d="M0 272 172 176 304 238 476 126 618 236 768 158 910 246 1060 166 1200 236V320H0Z" />
      <path opacity="0.18" d="M0 304 210 236 392 290 590 214 786 292 980 226 1200 290V320H0Z" />
    </svg>
  );
}

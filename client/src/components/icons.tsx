// Line icons (currentColor) shared across the app chrome and screens.
// Ported from the Claude Design prototype's icon set.

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconHome = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9z" />
  </svg>
);

export const IconPractice = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M4 7l8-4 8 4-8 4-8-4z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 17l8 4 8-4" />
  </svg>
);

export const IconBrowse = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 4v16" />
  </svg>
);

export const IconStats = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M3 21V8" />
    <path d="M9 21V4" />
    <path d="M15 21V12" />
    <path d="M21 21V16" />
  </svg>
);

export const IconSearch = ({ className }: IconProps) => (
  <svg {...base} strokeWidth={1.6} className={className} aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const IconClose = ({ className }: IconProps) => (
  <svg {...base} strokeWidth={2} className={className} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevron = ({ className }: IconProps) => (
  <svg {...base} strokeWidth={2} className={className} aria-hidden>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

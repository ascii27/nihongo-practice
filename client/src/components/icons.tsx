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

// Study tab — a bookmarked/open study book.
export const IconStudy = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M4 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v15l-5-3-5 3V5z" />
    <path d="M17 5h1a2 2 0 0 1 2 2v11" />
  </svg>
);

// Brush — kanji drawing / stroke practice.
export const IconBrush = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M15 4l5 5-8.5 8.5a3 3 0 0 1-1.7.85L6 19l.65-3.8a3 3 0 0 1 .85-1.7L15 4z" />
    <path d="M13 6l5 5" />
  </svg>
);

// Daily tab on the Today hero — a day on the calendar.
export const IconDaily = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17" />
    <path d="M8 3v4M16 3v4" />
    <circle cx="12" cy="15" r="1.4" />
  </svg>
);

// SRS tab on the Today hero — the review cycle.
export const IconCycle = ({ className }: IconProps) => (
  <svg {...base} className={className} aria-hidden>
    <path d="M20 12a8 8 0 0 1-13.7 5.6" />
    <path d="M4 12a8 8 0 0 1 13.7-5.6" />
    <path d="M17.7 2.8v3.8h-3.8" />
    <path d="M6.3 21.2v-3.8h3.8" />
  </svg>
);

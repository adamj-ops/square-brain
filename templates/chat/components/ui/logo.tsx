import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      {/* Outer glow/shadow */}
      <defs>
        <linearGradient id="brainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="50%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      
      {/* Background circle */}
      <circle
        cx="24"
        cy="24"
        r="20"
        className="fill-white dark:fill-zinc-900"
        stroke="url(#brainGradient)"
        strokeWidth="2"
      />
      
      {/* Brain icon - simplified stylized brain */}
      <g transform="translate(12, 12)" filter="url(#glow)">
        {/* Left hemisphere */}
        <path
          d="M12 4C8 4 5 7 5 11C4 11 3 12 3 14C3 16 4 17 5 17C5 18 5 19 6 20C6 21 7 22 8 22C9 22 10 21 10 20C11 21 12 21 12 21"
          stroke="url(#brainGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Right hemisphere */}
        <path
          d="M12 4C16 4 19 7 19 11C20 11 21 12 21 14C21 16 20 17 19 17C19 18 19 19 18 20C18 21 17 22 16 22C15 22 14 21 14 20C13 21 12 21 12 21"
          stroke="url(#brainGradient)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Center line */}
        <path
          d="M12 4V21"
          stroke="url(#brainGradient)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.6"
        />
        {/* Neural connections */}
        <circle cx="8" cy="12" r="1" fill="url(#brainGradient)" opacity="0.8" />
        <circle cx="16" cy="12" r="1" fill="url(#brainGradient)" opacity="0.8" />
        <circle cx="12" cy="15" r="1" fill="url(#brainGradient)" opacity="0.8" />
      </g>
    </svg>
  );
}

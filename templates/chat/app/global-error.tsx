"use client";

import { GlobalErrorUI } from "@/components/error-boundary";

/**
 * Global error boundary for catching errors in the root layout.
 * This is the last line of defense and must provide its own <html> and <body> tags
 * since the root layout may have failed.
 *
 * Note: This component uses inline styles because:
 * 1. The root layout (where Tailwind CSS is imported) may have failed
 * 2. We need a fully self-contained fallback UI
 * 3. Providers (theme, etc.) are not available in this context
 *
 * Features:
 * - Standalone HTML/body tags
 * - Branded LifeRX error UI with gradient accents (inline styles)
 * - Reset functionality to retry rendering
 * - Home navigation option
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <GlobalErrorUI error={error} reset={reset} />;
}

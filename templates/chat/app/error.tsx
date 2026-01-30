"use client";

import { ErrorBoundaryUI } from "@/components/error-boundary";

/**
 * Error boundary for catching runtime errors in page components.
 * This component is automatically used by Next.js App Router to handle
 * errors within the route segment and its children.
 *
 * Features:
 * - Branded LifeRX error UI with gradient accents
 * - Reset functionality to retry rendering
 * - Home navigation option
 * - Development-only error details display
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryUI error={error} reset={reset} />;
}

"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface ErrorBoundaryUIProps {
  error: Error & { digest?: string };
  reset?: () => void;
  className?: string;
}

/**
 * Branded error UI component for LifeRX Brain
 * Uses LifeRX accent colors with Square UI base styling
 */
export function ErrorBoundaryUI({
  error,
  reset,
  className,
}: ErrorBoundaryUIProps) {
  useEffect(() => {
    // Log error to console in development
    console.error("Error Boundary caught error:", error);
  }, [error]);

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center justify-center bg-background p-4",
        className
      )}
    >
      <div className="w-full max-w-md space-y-6 text-center">
        {/* Error Icon with gradient */}
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/10 via-indigo-500/10 to-blue-500/10 ring-1 ring-violet-500/20">
          <AlertTriangle className="h-10 w-10 text-violet-500" />
        </div>

        {/* Error Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            We encountered an unexpected error. Don&apos;t worry, your data is safe.
          </p>
        </div>

        {/* Error Details (development only) */}
        {process.env.NODE_ENV === "development" && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-left">
            <p className="text-xs font-medium text-destructive">
              {error.name}: {error.message}
            </p>
            {error.digest && (
              <p className="mt-1 text-xs text-muted-foreground">
                Digest: {error.digest}
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          {reset && (
            <Button
              onClick={reset}
              className="gap-2 bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 text-white hover:from-violet-600 hover:via-indigo-600 hover:to-blue-600"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => (window.location.href = "/")}
            className="gap-2"
          >
            <Home className="h-4 w-4" />
            Go Home
          </Button>
        </div>

        {/* Branding footer */}
        <p className="pt-4 text-xs text-muted-foreground">
          LifeRX Brain • Your prescription for happiness starts here
        </p>
      </div>
    </div>
  );
}

/**
 * Minimal error UI for global-error.tsx where providers aren't available
 * Uses inline styles for gradient since Tailwind may not be loaded
 */
export function GlobalErrorUI({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Error Boundary caught error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: "400px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          {/* Error Icon */}
          <div
            style={{
              width: "80px",
              height: "80px",
              margin: "0 auto 24px",
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(99, 102, 241, 0.1), rgba(59, 130, 246, 0.1))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(139, 92, 246, 0.2)",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8B5CF6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 600,
              color: "#18181b",
              margin: "0 0 8px",
            }}
          >
            Something went wrong
          </h1>

          {/* Description */}
          <p
            style={{
              fontSize: "14px",
              color: "#71717a",
              margin: "0 0 24px",
              lineHeight: 1.5,
            }}
          >
            A critical error occurred. Please try refreshing the page.
          </p>

          {/* Error details in development */}
          {process.env.NODE_ENV === "development" && (
            <div
              style={{
                padding: "12px",
                marginBottom: "24px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.05)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                textAlign: "left",
              }}
            >
              <p
                style={{
                  fontSize: "12px",
                  color: "#dc2626",
                  margin: 0,
                  fontFamily: "monospace",
                }}
              >
                {error.name}: {error.message}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={reset}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#ffffff",
                background: "linear-gradient(135deg, #8B5CF6, #6366F1, #3B82F6)",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
              Try Again
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: 500,
                color: "#18181b",
                backgroundColor: "#ffffff",
                border: "1px solid #e4e4e7",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Go Home
            </button>
          </div>

          {/* Branding footer */}
          <p
            style={{
              fontSize: "12px",
              color: "#a1a1aa",
              marginTop: "32px",
            }}
          >
            LifeRX Brain • Your prescription for happiness starts here
          </p>
        </div>
      </body>
    </html>
  );
}

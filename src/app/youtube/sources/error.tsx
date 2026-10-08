"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function SourcesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.sources.title" error={error} reset={reset} />;
}

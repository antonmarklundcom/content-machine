"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function IngestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.ingest.title" error={error} reset={reset} />;
}

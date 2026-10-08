"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function TagError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.topics.title" error={error} reset={reset} />;
}

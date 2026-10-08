"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function MarksError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.marks.title" error={error} reset={reset} />;
}

"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function DigestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.digest.title" error={error} reset={reset} />;
}

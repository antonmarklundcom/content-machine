"use client";

import { ErrorPanel } from "@/components/ErrorPanel";

export default function VideoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorPanel titleKey="error.video.title" error={error} reset={reset} />;
}

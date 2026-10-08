"use client";

import { useEffect, useState } from "react";

import type { HiggsfieldJobStatus } from "@/db/schema";
import type { Translator } from "@/lib/i18n";

import { ResultMessage } from "./ResultMessage";

const TERMINAL: HiggsfieldJobStatus[] = ["done", "failed", "cancelled"];

export type QueuedVoiceJob = {
  id: number;
  status: HiggsfieldJobStatus;
  lines: number;
  credits: number;
};

/** A queued voice job's status line, polled until it ends, with a link to /higgsfield. */
export function HiggsfieldVoiceStatus({
  job,
  t,
  onEnd,
}: {
  job: QueuedVoiceJob;
  t: Translator;
  onEnd?: (status: HiggsfieldJobStatus) => void;
}) {
  const [status, setStatus] = useState<HiggsfieldJobStatus>(job.status);

  useEffect(() => {
    setStatus(job.status);
  }, [job.id, job.status]);

  useEffect(() => {
    if (TERMINAL.includes(status)) {
      onEnd?.(status);
      return;
    }
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/higgsfield/jobs/${job.id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { status: HiggsfieldJobStatus };
        setStatus((s) => (s !== body.status ? body.status : s));
      } catch {
        /* next tick */
      }
    }, 4000);
    return () => clearInterval(timer);
    // onEnd is a callback prop; re-subscribing on its identity would restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, status]);

  return (
    <ResultMessage tone={status === "failed" ? "error" : status === "done" ? "success" : "info"}>
      {t("hfVoice.batch.queued", {
        id: job.id,
        lines: job.lines,
        credits: job.credits,
        status: t(`higgsfield.status.${status}`),
      })}{" "}
      <a href="/higgsfield" className="underline">
        {t("hfVoice.batch.openJob")}
      </a>
    </ResultMessage>
  );
}

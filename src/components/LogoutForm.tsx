"use client";
import { useActionState } from "react";
import { logoutWithResult } from "@/lib/auth/actions";

export function LogoutForm({ label }: { label: string }) {
  const [state, action, pending] = useActionState(logoutWithResult, null);
  return (
    <form action={action} className="flex max-w-xs flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {label}
      </button>
      {state && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

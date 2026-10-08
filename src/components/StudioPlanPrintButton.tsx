"use client";

import { STUDIO_BUTTON } from "./StudioStyles";

/** `window.print()` for the filming plan; the page's print CSS hides the chrome. */
export function StudioPlanPrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={`${STUDIO_BUTTON} print:hidden`}
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}

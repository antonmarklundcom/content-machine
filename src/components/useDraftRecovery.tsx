"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readDraft, writeDraft } from "@/lib/draft-recovery";
import { STUDIO_BUTTON } from "./StudioStyles";

/** Keep local edits through client navigation, browser back, refresh and failed saves.
 * A changed saved copy never silently overwrites a recovered draft.
 */
export function useDraftRecovery<T>(input: {
  storageKey: string | null;
  initial: T;
  revision: number | string;
  value: T;
  dirty: boolean;
  restore: (value: T, dirty: boolean) => void;
  validate: (value: unknown) => value is T;
}) {
  const initialBase = JSON.stringify({ revision: input.revision, value: input.initial });
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const state = useRef(input);
  state.current = input;
  const base = useRef(initialBase);
  const loaded = useRef(false);
  const seenServer = useRef(initialBase);

  const persist = useCallback(() => {
    const current = state.current;
    if (!loaded.current || !current.dirty || !current.storageKey) return;
    try {
      localStorage.setItem(current.storageKey, writeDraft(base.current, current.value));
    } catch {
      setMessage("Browser draft storage is unavailable. Save before leaving this page.");
    }
  }, []);

  useEffect(() => {
    const current = state.current;
    if (!loaded.current) {
      loaded.current = true;
      try {
        const recovered = readDraft(
          current.storageKey ? localStorage.getItem(current.storageKey) : null,
          current.validate,
        );
        if (recovered) {
          base.current = recovered.base;
          current.restore(recovered.value, true);
          setConflict(recovered.base !== initialBase);
          setMessage(
            recovered.base === initialBase
              ? "Recovered unsaved edits from this browser. Save to update the saved copy."
              : "Recovered edits are based on an older saved copy. Review them before keeping or discarding them.",
          );
        }
      } catch {
        setMessage("Browser draft storage is unavailable. Save before leaving this page.");
      }
    } else if (seenServer.current !== initialBase) {
      if (current.dirty && base.current !== initialBase) {
        setConflict(true);
        setMessage(
          "The saved copy changed while you were editing. Review your edits before keeping or discarding them.",
        );
      } else if (!current.dirty) {
        base.current = initialBase;
        current.restore(current.initial, false);
      }
    }
    seenServer.current = initialBase;
  }, [initialBase]);

  useEffect(() => {
    persist();
  });

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      persist();
      if (state.current.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const leave = () => persist();
    const click = (event: MouseEvent) => {
      if (!state.current.dirty) return;
      persist();
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      const action = target?.closest("button,input[type=submit],a[href]");
      const relatedEditor = /^\/(posts|studio)\/\d+$/.test(href);
      if (
        (action?.closest("[data-saved-action]") && !relatedEditor) ||
        /^\/api\/(posts|scripts)\/.+\/export/.test(href)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setMessage(
          "Save your editor changes before exporting, generating, scheduling or approving the saved copy.",
        );
      }
    };
    const submit = (event: SubmitEvent) => {
      if (
        state.current.dirty &&
        event.target instanceof Element &&
        event.target.closest("[data-saved-action]")
      ) {
        persist();
        event.preventDefault();
        event.stopPropagation();
        setMessage("Save your editor changes before scheduling or approving the saved copy.");
      }
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      persist();
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, [persist]);

  function saved(value: T): boolean {
    // A slow save must not clear edits typed while the request was pending.
    if (JSON.stringify(state.current.value) !== JSON.stringify(value)) return false;
    state.current = { ...state.current, dirty: false };
    try {
      if (input.storageKey) localStorage.removeItem(input.storageKey);
    } catch {
      /* saved on server */
    }
    base.current = JSON.stringify({ revision: input.revision, value });
    setMessage(null);
    setConflict(false);
    return true;
  }
  function useSavedCopy() {
    state.current = { ...state.current, dirty: false };
    try {
      if (input.storageKey) localStorage.removeItem(input.storageKey);
    } catch {
      /* storage unavailable */
    }
    base.current = initialBase;
    input.restore(input.initial, false);
    setConflict(false);
    setMessage(null);
  }
  function keepEdits() {
    base.current = initialBase;
    setConflict(false);
    setMessage("Recovered edits kept. Save to update the current saved copy.");
    persist();
  }
  return { message, conflict, saved, useSavedCopy, keepEdits };
}

export function DraftRecoveryNotice({
  recovery,
}: {
  recovery: {
    message: string | null;
    conflict: boolean;
    keepEdits: () => void;
    useSavedCopy: () => void;
  };
}) {
  if (!recovery.message) return null;
  return (
    <div
      role="status"
      className="surface-border rounded-[var(--radius-sm)] px-4 py-3 text-sm text-[var(--color-warn)]"
    >
      <p>{recovery.message}</p>
      {recovery.conflict && (
        <div className="mt-2 flex gap-2">
          <button type="button" className={STUDIO_BUTTON} onClick={recovery.keepEdits}>
            Keep my edits
          </button>
          <button type="button" className={STUDIO_BUTTON} onClick={recovery.useSavedCopy}>
            Use saved copy
          </button>
        </div>
      )}
    </div>
  );
}

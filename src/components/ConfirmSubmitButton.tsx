"use client";

/**
 * A submit button that asks first.
 *
 * Deleting a source or a video is not recoverable from the UI — the video's
 * transcript and analyses go with it, and re-ingesting means paying for the
 * analysis again. `confirm()` rather than a modal component: it cannot be
 * dismissed by a stray click, it needs no state, and this is a private
 * single-user tool, not a product surface.
 */
export function ConfirmSubmitButton({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

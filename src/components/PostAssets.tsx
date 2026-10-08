"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { POST_ASSET_ROLES, type AssetKind, type PostAssetRole } from "@/db/schema";
import { ROLE_LABEL } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import {
  attachAssetAction,
  detachAssetAction,
  reorderAssetsAction,
  setAssetRoleAction,
  type PostActionResult,
} from "@/lib/posts.actions";
import { STUDIO_BUTTON, STUDIO_INPUT } from "./StudioStyles";

export type PostAssetItem = {
  id: number;
  kind: AssetKind;
  name: string;
  thumbUrl: string | null;
};

function Thumb({ item }: { item: PostAssetItem }) {
  return item.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- owner-only media route, not a static asset
    <img
      src={item.thumbUrl}
      alt=""
      loading="lazy"
      className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface)] object-cover"
    />
  ) : (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface)] text-[10px] text-[var(--color-ink-muted)] uppercase">
      {item.kind}
    </span>
  );
}

/**
 * A post's files, in order, and the library to attach more from (PLAN.md
 * §6.S15). Up/down buttons reorder — they work on a phone and with a keyboard,
 * which drag-and-drop does not.
 */
export function PostAssets({
  postId,
  revision,
  attached,
  library,
}: {
  postId: number;
  revision?: number;
  attached: (PostAssetItem & { role: PostAssetRole })[];
  library: PostAssetItem[];
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const run = (action: () => Promise<PostActionResult<object>>) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await action();
        if (result.ok) router.refresh();
        else setError(result.error);
      } catch {
        setError(t("posts.error.generic"));
      }
    });

  const move = (index: number, by: -1 | 1) => {
    const ids = attached.map((a) => a.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    run(() => reorderAssetsAction(postId, ids, revision));
  };

  return (
    <div className="flex flex-col gap-3">
      {attached.length === 0 ? (
        <p className="text-xs text-[var(--color-ink-muted)]">{t("posts.assets.none")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {attached.map((a, i) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3">
              <span className="w-6 text-xs text-[var(--color-ink-muted)]">
                {t("posts.assets.position", { n: i + 1 })}
              </span>
              <Thumb item={a} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">
                {a.name}
              </span>
              <select
                aria-label={t("posts.assets.role")}
                className={`${STUDIO_INPUT} w-auto py-1 text-xs`}
                value={a.role}
                disabled={pending}
                onChange={(e) =>
                  run(() =>
                    setAssetRoleAction(postId, a.id, e.target.value as PostAssetRole, revision),
                  )
                }
              >
                {POST_ASSET_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_LABEL[r])}
                  </option>
                ))}
              </select>
              <span className="flex gap-1">
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={pending || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t("posts.assets.up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={pending || i === attached.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("posts.assets.down")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={pending}
                  onClick={() => run(() => detachAssetAction(postId, a.id, revision))}
                >
                  {t("posts.assets.detach")}
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div>
        <button
          type="button"
          className={STUDIO_BUTTON}
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          {t("posts.assets.pick")}
        </button>
      </div>
      {picking &&
        (library.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("posts.assets.libraryEmpty")}{" "}
            <Link href="/media" className="underline">
              {t("posts.assets.openLibrary")}
            </Link>
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {library.map((a) => (
              <li
                key={a.id}
                className="surface-border flex items-center gap-3 rounded-[var(--radius-sm)] p-2"
              >
                <Thumb item={a} />
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink)]">
                  {a.name}
                </span>
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  disabled={pending}
                  onClick={() => run(() => attachAssetAction(postId, a.id, "slide", revision))}
                >
                  {t("posts.assets.attach")}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {error && (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

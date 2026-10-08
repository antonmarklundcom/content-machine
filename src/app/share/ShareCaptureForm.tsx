"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name?: string; label?: string };

export function ShareCaptureForm({
  initialUrl,
  initialNote,
  brands,
  purposes,
  labels,
}: {
  initialUrl: string;
  initialNote: string;
  /** [S16] Capture fields (PLAN.md §6.S16); hashtags in the note work too. */
  brands: Option[];
  purposes: Option[];
  labels: {
    brand: string;
    noBrand: string;
    purpose: string;
    tags: string;
    tagsPlaceholder: string;
  };
}) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl);
  const [note, setNote] = useState(initialNote);
  const [brandId, setBrandId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          note: note || undefined,
          brandId: brandId || undefined,
          purpose: purpose || undefined,
          tags: tags || undefined,
          source: "share",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ ok: false, text: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setResult({ ok: true, text: "Saved to the inbox." });
      setTimeout(() => router.push("/inbox"), 900);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>Save this clip</h1>
      <p className="muted" style={{ marginTop: 4 }}>
        Confirm the link and add a note if you want one.
      </p>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          autoFocus={!url}
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why did you save this? (optional)"
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted">{labels.brand}</span>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">{labels.noBrand}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted">{labels.purpose}</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="" />
            {purposes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="muted">{labels.tags}</span>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={labels.tagsPlaceholder}
          />
        </label>
        <button onClick={save} disabled={saving || !url}>
          {saving ? "Saving…" : "Save"}
        </button>
        {result && (
          <p style={{ color: result.ok ? "var(--ok)" : "var(--danger)" }}>{result.text}</p>
        )}
      </div>
    </div>
  );
}

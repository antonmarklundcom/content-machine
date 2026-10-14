import { updateAutomation, pauseAutomation } from "@/lib/automation/actions";
import { getAutomationPolicy } from "@/lib/automation/store";
import type { AutomationFeature } from "@/lib/automation/policy";
const OPTIONS: { key: AutomationFeature; label: string; note: string }[] = [
  {
    key: "youtubeMonitoring",
    label: "Monitor selected YouTube sources",
    note: "Fetch and analyse uploads from active channels/playlists.",
  },
  {
    key: "captureAnalysis",
    label: "Analyse YouTube links when captured",
    note: "When off, sharing only saves the link. Manual processing still works.",
  },
  {
    key: "learningSummaries",
    label: "Process saved learning items automatically",
    note: "Requires the learning scheduler; manual Summarise remains available.",
  },
  {
    key: "publishing",
    label: "Publish scheduled posts",
    note: "Keep off for the private pilot. Account setup and approved posts are also required.",
  },
];
export async function AutomationSettings() {
  const policy = await getAutomationPolicy();
  return (
    <section className="surface-border surface-card mt-8 p-5">
      <h2 className="text-lg font-semibold">
        Automation · {policy.enabled ? "enabled" : "paused"}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Controls are saved in the database and survive redeployment. Pausing prevents new automatic
        work; it cannot undo a request already sent. Manual research and drafting remain available.
      </p>
      <form action={updateAutomation} className="mt-5 space-y-4">
        <label className="flex items-center gap-3 font-semibold">
          <input type="checkbox" name="enabled" defaultChecked={policy.enabled} />
          Allow automation
        </label>
        {OPTIONS.map((option) => (
          <label key={option.key} className="flex items-start gap-3">
            <input
              type="checkbox"
              name={option.key}
              defaultChecked={policy[option.key]}
              className="mt-1"
            />
            <span>
              {option.label}
              <span className="block text-xs text-[var(--color-ink-muted)]">{option.note}</span>
            </span>
          </label>
        ))}
        <button className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm text-[var(--color-accent-ink)]">
          Save automation
        </button>
      </form>
      <form action={pauseAutomation} className="mt-3">
        <button className="surface-border rounded-md px-4 py-2 text-sm">
          Pause all automation
        </button>
      </form>
      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        Enabling a switch does not create a scheduler. Configure exactly one runner per task.
        Pause/Resume individual channels in YouTube → Sources.
      </p>
    </section>
  );
}

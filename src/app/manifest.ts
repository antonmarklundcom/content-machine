import type { MetadataRoute } from "next";

/**
 * The PWA manifest (PLAN.md §6.S3.3). Its only real job is `share_target`:
 * once this app is added to a phone's home screen, it becomes a destination
 * in the OS share sheet — "share a reel → Content Engine" — which lands on
 * `/share`, a thin page that turns the shared link into a `POST /api/clips`
 * call (docs/CAPTURE.md covers the other capture path, the iOS Shortcut,
 * which doesn't go through a share_target at all).
 *
 * `share_target` isn't in Next's `MetadataRoute.Manifest` type yet (it's a
 * real, broadly-supported manifest field the type just hasn't caught up to),
 * hence the cast.
 */
export default function manifest(): MetadataRoute.Manifest {
  const withShareTarget = {
    name: "Content Engine",
    short_name: "Content Engine",
    description: "Save a link to the clip inbox from any app's share sheet.",
    start_url: "/inbox",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    icons: [],
    // GET, not POST: a POST share_target needs a service worker to receive the
    // multipart body, which this app has no other use for. GET turns the share
    // into a plain navigation with url/title/text as query params, which a
    // server-rendered page can read directly — see src/app/share/page.tsx.
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
  return withShareTarget as MetadataRoute.Manifest;
}

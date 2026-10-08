/**
 * The media library's file side (PLAN.md §1.41, §5.O10.3): registering files
 * under `MEDIA_ROOT` as `assets`, scanning the drive, and the public copies.
 */
export { registerFile, sha256File, type RegisterMeta, type RegisterResult } from "./register";
export { scanMediaRoot, type ScanResult } from "./scan";
export { publishCopy, prunePublic, retentionDays, type PruneResult, type PublishResult } from "./public";
export { parseManifest, type Manifest, type ManifestEntry } from "./manifest";
export { sniffMime, type Sniffed } from "./sniff";
export { ffprobeAvailable, probeDuration } from "./probe";

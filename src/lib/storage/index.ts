/**
 * The storage adapter (PLAN.md §1.41): `local` (MEDIA_ROOT, the external
 * drive) and `hostinger` (the public copy). Neon stores text and links only.
 */
export * from "./driver";
export * from "./root";
export * from "./paths";
export { localDriver } from "./local";
export {
  HOSTINGER_NOT_CONFIGURED,
  hostingerConfig,
  hostingerDriver,
  hostingerKeyFromUrl,
  isHostingerKey,
  type HostingerConfig,
} from "./hostinger";
export {
  DRIVE_NOT_CONFIGURED,
  driveConfig,
  driveDriver,
  driveFileIdFromUrl,
  driveViewUrl,
  isDriveFileId,
  type DriveDriver,
} from "./drive";

# Where the media lives

Photos, videos and thumbnails are **files on a drive, never rows in the
database**. MariaDB holds application data and media metadata/links; file bytes
stay outside SQL. The inherited source documentation referred to Neon, which
is historical and is not used by this runtime. There are three
places a file can be:

| Tier | Where | What for | Set up by |
|---|---|---|---|
| Primary | An external drive in the office, `MEDIA_ROOT` (e.g. `E:\ContentEngine`) | Everything. The app reads and writes here. | You, once (below) |
| Backup + phone | Google Drive for desktop, backing up that folder | A copy if the drive dies; opening files on the phone | You, once (below) — no app code |
| Public | The `media.` subdomain on the **EU** Hostinger account | Only the finished files of posts being published, and thumbnails | You, once (step 4) |

When the drive is unplugged the app says **"media drive not connected"** and
keeps working on everything else (posts, ideas, research). Plug it back in and
it works again — no restart needed.

## 1. Give the drive a fixed letter (once)

Windows can hand a USB drive a different letter each time, which would break
`MEDIA_ROOT`. Pin it:

1. Plug the drive in.
2. Start menu → type **"Disk Management"** → open **Create and format hard disk partitions**.
3. Right-click the drive's box → **Change Drive Letter and Paths…** → **Change** →
   pick **`E:`** → OK. If `E:` is taken, pick another free letter and use it
   everywhere this page says `E:`.

Then create the folder (PowerShell):

```powershell
mkdir E:\ContentEngine
```

## 2. Tell the app where it is (once)

Open `.env` in the app folder:

```powershell
notepad .env
```

Add or change this line, save, and restart the app (`.env` is only read at start):

```
MEDIA_ROOT=E:\ContentEngine
```

Unset, the app uses a `media` folder inside the repo — fine for trying it out,
not for real use.

Check it sees the drive and register what is already there:

```powershell
npm run media:scan
```

It is safe to run as often as you like: a file already registered (same
sha256) is skipped. If the drive is missing it says so and exits cleanly.

**Optional: `ffprobe`.** With ffmpeg installed (`setup.ps1` does it, or
`winget install --id Gyan.FFmpeg -e`), videos get their duration filled in.
Set `FFPROBE_PATH` in `.env` only if it is not on PATH.

## 3. Folder layout (the app writes this; don't rename by hand)

```
E:\ContentEngine\
  <brand>\<account-handle or _brand>\<YYYY-MM>\<post-id>-<slug>\01-<slug>.jpg
  _inbox\higgsfield\<YYYY-MM-DD>\     unsorted Higgsfield imports
  captures\<clip-id>\                 fetched reels (research only, never republished)
  _thumbs\                            480 px previews the app makes
  _originals\<sha-prefix>\<sha>.<ext>   immutable library originals (include in backups)
```

Moving or replacing a source file inside the drive is fine: run
`npm run media:scan` again. Every source is hashed, including same-size
replacements. Registration snapshots the bytes under `_originals/` and asset
rows point there; an existing approved asset keeps its old bytes and a
replacement becomes a separate new asset. Do not rename, overwrite or delete
`_originals/` by hand. Thumbnails are also keyed by content hash.

The first scan upgrades intact legacy asset paths to originals. If a legacy
path already changed or disappeared and the old bytes cannot be found, the
old asset is detached and rejected with a recovery note; affected media must
be restored from backup and reviewed. Preview and publication verify the
stored SHA and refuse changed bytes. A scan cannot recreate bytes that were
overwritten before snapshots existed. Back up both source folders and
`_originals/`; expect the extra snapshot disk usage.

## 4. Backup with Google Drive for desktop (once)

This is setup only; the app does not talk to Google Drive (a read-only Drive
link arrives with O14).

1. Install it:
   ```powershell
   winget install --id Google.GoogleDrive -e
   ```
2. Sign in. In **Settings (gear) → Preferences → My Computer → Add folder**, pick
   `E:\ContentEngine` and choose **Back up to Google Drive**.
3. Limit the upload so it doesn't eat the office connection: **Settings (gear) →
   Preferences → gear icon (top right) → Bandwidth settings → Upload rate**, e.g.
   1000 KB/s. Or pause syncing from the tray icon during calls.
4. On the phone, the Google Drive app shows the backup under **Computers**.

The first backup of a big folder takes days on a slow line; that is normal.

## 5. The public copy on Hostinger EU (once, needed only to publish)

Instagram and Facebook fetch media from a public URL, so a post being
published needs a copy online. That copy lives on a small PHP endpoint on the
**EU** Hostinger account — never the Brazil one. Install steps:
[`hosting/media-upload/README.md`](../hosting/media-upload/README.md). Then in
`.env`:

```
MEDIA_UPLOAD_URL=https://media.<your-domain>/upload.php
MEDIA_UPLOAD_TOKEN=<the token from config.php>
MEDIA_PUBLIC_BASE=https://media.<your-domain>
```

Unset, everything works except publishing, which says the endpoint is not
configured.

## 6. Retention

Public copies are temporary. After `MEDIA_PUBLIC_RETENTION_DAYS` (default 90)
this deletes them from Hostinger, except for posts still scheduled or being
published:

```powershell
npm run media:prune
```

The original on your drive is never touched. Run it by hand now and then, or
weekly from Task Scheduler ([LOCAL-SETUP.md §7](LOCAL-SETUP.md#7-scheduled-jobs-optional-once)).

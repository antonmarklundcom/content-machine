# Media upload endpoint (Hostinger EU, `media.` subdomain)

The public tier of content-engine's storage (PLAN.md §1.41): a small PHP
endpoint that holds only what must be public — the finished files of posts
being published, and thumbnails. The app uploads with a bearer token and
deletes the copies again after `MEDIA_PUBLIC_RETENTION_DAYS` (`npm run
media:prune`). Originals stay on the media drive.

It goes on the **EU** Hostinger account (shared hosting, no Node.js slot),
never the Brazil one.

## Install (once — §7 item 6)

1. hPanel (EU account) → **Domains → Subdomains**: create `media.<your-domain>`.
   Note its document root (e.g. `public_html/media`). Wait for SSL to turn on.
2. **File Manager** → that document root: upload everything in this folder
   (`upload.php`, `delete.php`, `lib.php`, `config.example.php`, `.htaccess`,
   `.user.ini`, `files/.htaccess`). Dot-files are hidden by default in File
   Manager; turn on "show hidden files" to check they arrived.
3. Copy `config.example.php` to `config.php` and set `token` to a new random
   value (64 hex characters):
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. In the app's `.env`:

   ```
   MEDIA_UPLOAD_URL=https://media.<your-domain>/upload.php
   MEDIA_UPLOAD_TOKEN=<the same token>
   MEDIA_PUBLIC_BASE=https://media.<your-domain>
   ```

5. Check it (PowerShell, one command at a time):

   ```
   curl.exe -i https://media.<your-domain>/upload.php
   ```

   `405` means PHP runs and the token is set; `503` means `config.php` is
   missing or the token is still the placeholder.

## What it accepts

- `POST upload.php` — multipart field `file`, header `Authorization: Bearer <token>`.
  Answers `{"path": "files/2026/09/<32 hex>.jpg", "url": "https://…", "bytes": n, "mime": "…"}`.
- `POST delete.php` — JSON `{"path": "files/…"}` with the same header.
  Answers `{"removed": true|false}`.

Errors are JSON `{"error": "…"}` with 400 (bad request), 401 (token), 405 (not
POST), 413 (too large), 415 (type not allowed), 503 (not configured).

## Security rules (§5.O10.2)

- The token is compared with `hash_equals` (constant time) and must be ≥ 32 characters.
- A file must have an allowed **extension** (jpg, jpeg, png, webp, gif, mp4, mov)
  **and** sniffed content (`finfo`) of the matching type.
- Size cap: `max_bytes` in `config.php` (default 250 MB). Raise `.user.ini`'s
  `upload_max_filesize` / `post_max_size` with it.
- File names are random (`random_bytes`), never the uploader's.
- Under `files/`: no listing, no PHP or CGI execution, and nothing but the
  allowed media types is served at all. `config.php`, `lib.php` and `.user.ini`
  are not reachable over HTTP.

Rotating the token: change it in `config.php` and in `.env`; the old one stops
working at once.

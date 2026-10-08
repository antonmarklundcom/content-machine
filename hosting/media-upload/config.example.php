<?php
// Copy to config.php on the server and fill in the token. Never commit config.php.
// The same token goes into the app's .env as MEDIA_UPLOAD_TOKEN.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
return [
    // At least 32 characters. Shorter (or the placeholder) and every request is refused.
    'token' => 'CHANGE-ME-to-64-hex-characters',

    // Largest accepted file, bytes. Also raise upload_max_filesize/post_max_size in .user.ini to match.
    'max_bytes' => 250 * 1024 * 1024,

    // What public URLs start with, no trailing slash — the app's MEDIA_PUBLIC_BASE.
    // Empty: derived from the request (https://<host>/<folder of upload.php>).
    'public_base' => '',
];

<?php
// POST upload.php — one file in the multipart field "file", bearer token required.
// Answers {"path": "files/2026/09/<random>.jpg", "url": "https://…", "bytes": n, "mime": "image/jpeg"}.
// See README.md. content-engine, PLAN.md §1.41, §5.O10.2.
declare(strict_types=1);
define('CE_MEDIA', true);
require __DIR__ . '/lib.php';

ce_require_post();
$config = ce_config();
ce_authenticate($config);

$upload = $_FILES['file'] ?? null;
if (!is_array($upload) || is_array($upload['error'] ?? null)) {
    // An over-size body makes PHP drop $_FILES entirely; say which.
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > 0 && empty($_POST)) {
        ce_json(413, ['error' => 'File too large for the server (upload_max_filesize / post_max_size).']);
    }
    ce_json(400, ['error' => 'Send exactly one file in the multipart field "file".']);
}
$error = (int)$upload['error'];
if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
    ce_json(413, ['error' => 'File too large for the server (upload_max_filesize).']);
}
if ($error !== UPLOAD_ERR_OK || !is_uploaded_file((string)$upload['tmp_name'])) {
    ce_json(400, ['error' => 'Upload failed (code ' . $error . ').']);
}

$bytes = (int)filesize((string)$upload['tmp_name']);
if ($bytes <= 0) {
    ce_json(400, ['error' => 'Empty file.']);
}
if ($bytes > $config['max_bytes']) {
    ce_json(413, ['error' => 'File too large: ' . $bytes . ' bytes, the limit is ' . $config['max_bytes'] . '.']);
}

// Extension AND sniffed content must both be on the allowlist, and agree.
$ext = strtolower(pathinfo((string)$upload['name'], PATHINFO_EXTENSION));
if (!isset(CE_TYPES[$ext])) {
    ce_json(415, ['error' => 'File type not allowed: .' . $ext]);
}
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = (string)$finfo->file((string)$upload['tmp_name']);
if (!in_array($mime, CE_TYPES[$ext], true)) {
    ce_json(415, ['error' => 'File content (' . $mime . ') does not match .' . $ext . '.']);
}
$ext = CE_CANONICAL[$ext] ?? $ext;

// A random name, never the client's: nothing about the path is guessable or chosen.
$dir = 'files/' . gmdate('Y') . '/' . gmdate('m');
$absDir = __DIR__ . '/' . $dir;
if (!is_dir($absDir) && !mkdir($absDir, 0755, true) && !is_dir($absDir)) {
    ce_json(500, ['error' => 'Cannot create the storage folder.']);
}
$key = $dir . '/' . bin2hex(random_bytes(16)) . '.' . $ext;
if (!move_uploaded_file((string)$upload['tmp_name'], __DIR__ . '/' . $key)) {
    ce_json(500, ['error' => 'Cannot store the file.']);
}
@chmod(__DIR__ . '/' . $key, 0644);

ce_json(200, [
    'path' => $key,
    'url' => ce_public_base($config) . '/' . $key,
    'bytes' => $bytes,
    'mime' => $mime,
]);

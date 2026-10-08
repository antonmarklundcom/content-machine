<?php
// POST delete.php — {"path": "files/2026/09/<random>.jpg"} (JSON or form field), bearer token required.
// Answers {"removed": true} or {"removed": false} when the file was already gone.
// See README.md. content-engine, PLAN.md §1.41, §5.O10.2.
declare(strict_types=1);
define('CE_MEDIA', true);
require __DIR__ . '/lib.php';

ce_require_post();
$config = ce_config();
ce_authenticate($config);

$key = $_POST['path'] ?? null;
if ($key === null) {
    $body = json_decode((string)file_get_contents('php://input'), true);
    $key = is_array($body) ? ($body['path'] ?? null) : null;
}
if (!is_string($key) || !preg_match(CE_KEY, $key)) {
    ce_json(400, ['error' => 'Not a path this endpoint wrote.']);
}

$filesDir = realpath(__DIR__ . '/files');
$file = __DIR__ . '/' . $key;
if (!is_file($file)) {
    ce_json(200, ['removed' => false]);
}
$real = realpath($file);
if ($filesDir === false || $real === false || strpos($real, $filesDir . DIRECTORY_SEPARATOR) !== 0) {
    ce_json(400, ['error' => 'Not a path this endpoint wrote.']);
}
if (!unlink($real)) {
    ce_json(500, ['error' => 'Cannot delete the file.']);
}
ce_json(200, ['removed' => true]);

# Content Engine — one-time Windows installer (docs/LOCAL-SETUP.md).
# Re-runnable: every step checks what is already done.
#
#   1. Installs Node.js LTS and Git with winget if they are missing, and the
#      optional yt-dlp (reel downloads) and ffmpeg (video durations)
#   2. Asks for your Neon database URL, login email and password
#   3. Writes .env (secrets generated for you), installs, creates the database
#      tables, brands and your owner login, builds the app
#   4. Puts a "Content Engine" shortcut on your desktop
#   5. Optionally schedules the hourly YouTube poll and Monday competitor report
#
# API keys (Gemini, YouTube) are entered afterwards in the app: Settings.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}

Step "1/6  Node.js, Git, yt-dlp and ffmpeg"
function InstallOrAsk($cmd, $wingetId, $url, $name, [switch]$Optional) {
  if (Have $cmd) { return }
  if (Have winget) {
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements
    RefreshPath
  }
  if (-not (Have $cmd) -and $Optional) {
    Write-Host "$name is not installed (optional; the app runs without it). Get it from $url" -ForegroundColor Yellow
    return
  }
  if (-not (Have $cmd)) {
    Write-Host "$name is not installed and winget is not available." -ForegroundColor Yellow
    Write-Host "A download page opens. Install $name with the default options, then press Enter here."
    Start-Process $url
    Read-Host "Press Enter when $name is installed"
    RefreshPath
  }
}
InstallOrAsk node "OpenJS.NodeJS.LTS" "https://nodejs.org/en/download" "Node.js (LTS)"
InstallOrAsk git "Git.Git" "https://git-scm.com/download/win" "Git"
InstallOrAsk yt-dlp "yt-dlp.yt-dlp" "https://github.com/yt-dlp/yt-dlp/releases/latest" "yt-dlp" -Optional
InstallOrAsk ffmpeg "Gyan.FFmpeg" "https://www.gyan.dev/ffmpeg/builds/" "ffmpeg" -Optional
if (-not (Have node)) { throw "Node.js is still not found. Close this window, open a NEW PowerShell window and run setup.bat again." }
Write-Host "Node $(node --version)  ·  npm $(npm --version)"

Step "2/6  Settings file (.env)"
$envFile = Join-Path $PSScriptRoot ".env"
$existing = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$') { $existing[$Matches[1]] = $Matches[2] }
  }
}
function NewSecret { -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }

$db = $existing["DATABASE_URL"]
if (-not $db -or $db -like "*ep-xxxx*") {
  Write-Host "You need a free Neon database. A browser window opens: sign in, create a project,"
  Write-Host "pick the region AWS Europe Central 1 (Frankfurt), click 'Connect' and copy"
  Write-Host "the connection string (starts with postgresql://)."
  Start-Process "https://console.neon.tech/signup"
  do { $db = Read-Host "Paste the Neon connection string" } until ($db -match '^postgres(ql)?://')
}
$lines = @(
  "# Written by setup.ps1. API keys: set them in the app → Settings.",
  "DATABASE_URL=`"$db`"",
  "DB_DRIVER=pg",
  "SESSION_SECRET=$(if ($existing['SESSION_SECRET']) { $existing['SESSION_SECRET'] } else { NewSecret })",
  "CRON_SECRET=$(if ($existing['CRON_SECRET']) { $existing['CRON_SECRET'] } else { NewSecret })",
  "CLIP_TOKEN=$(if ($existing['CLIP_TOKEN']) { $existing['CLIP_TOKEN'] } else { NewSecret })"
)
$keep = "DATABASE_URL","DB_DRIVER","SESSION_SECRET","CRON_SECRET","CLIP_TOKEN"
foreach ($k in $existing.Keys) { if ($keep -notcontains $k) { $lines += "$k=$($existing[$k])" } }
Set-Content -Path $envFile -Value $lines -Encoding UTF8
Write-Host ".env written."

Step "3/6  Installing packages (a few minutes the first time)"
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

Step "4/6  Database tables, brands and your login"
npm run db:check;   if ($LASTEXITCODE -ne 0) { throw "Cannot reach the database. Check the Neon string in .env and run setup.bat again." }
npm run db:migrate; if ($LASTEXITCODE -ne 0) { throw "db:migrate failed." }
npm run db:seed;    if ($LASTEXITCODE -ne 0) { throw "db:seed failed." }
$email = Read-Host "Your login email"
do {
  $sec = Read-Host "Choose a login password (12+ characters)" -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
} until ($pw.Length -ge 12)
$env:ADMIN_EMAIL = $email; $env:ADMIN_PASSWORD = $pw
npm run yt:seed-owner
$env:ADMIN_PASSWORD = $null
if ($LASTEXITCODE -ne 0) { throw "Creating the login failed." }

Step "5/6  Building the app"
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Step "6/6  Desktop shortcut and schedules"
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $desktop "Content Engine.lnk"))
$lnk.TargetPath = Join-Path $PSScriptRoot "start.bat"
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Save()
Write-Host "Shortcut 'Content Engine' is on your desktop."

$ans = Read-Host "Check your tracked YouTube channels every hour and build the competitor report every Monday 08:00? (y/n)"
if ($ans -match '^[yY]') {
  $npm = (Get-Command npm.cmd).Source
  $poll = New-ScheduledTaskAction -Execute $npm -Argument "run yt:poll" -WorkingDirectory $PSScriptRoot
  $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName "ContentEngine-Poll" -Action $poll -Trigger $hourly -Force | Out-Null
  $weekly = New-ScheduledTaskAction -Execute $npm -Argument "run studio:weekly" -WorkingDirectory $PSScriptRoot
  $monday = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8am
  Register-ScheduledTask -TaskName "ContentEngine-WeeklyReport" -Action $weekly -Trigger $monday -Force | Out-Null
  Write-Host "Scheduled. (They run while you are logged in on this PC.)"
}

Write-Host "`nDone. Double-click 'Content Engine' on your desktop, log in, then open Settings" -ForegroundColor Green
Write-Host "and paste your Gemini and YouTube API keys." -ForegroundColor Green

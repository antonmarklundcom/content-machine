# Chatterbox Multilingual server on http://127.0.0.1:8004 (docs/CHATTERBOX.md).
# First run: creates .venv, installs CPU PyTorch + chatterbox-tts, downloads the model (~3 GB).
# Run:  powershell -ExecutionPolicy Bypass -File tools\chatterbox-server\start.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  Write-Host "Creating the Python environment..."
  if (Get-Command py -ErrorAction SilentlyContinue) { py -3.11 -m venv .venv }
  elseif (Get-Command python -ErrorAction SilentlyContinue) { python -m venv .venv }
  else { throw "Install Python 3.11 from python.org first." }
  & $python -m pip install --upgrade pip
  & $python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
  if ($LASTEXITCODE -ne 0) { throw "pip install failed." }
}
& $python server.py --port 8004 @args

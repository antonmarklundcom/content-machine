@echo off
rem Chatterbox Multilingual server on http://127.0.0.1:8004 (docs/CHATTERBOX.md).
rem First run: creates .venv, installs CPU PyTorch + chatterbox-tts, downloads the model (~3 GB).
cd /d %~dp0
if not exist .venv\Scripts\python.exe (
  echo Creating the Python environment...
  py -3.11 -m venv .venv || python -m venv .venv || (echo Install Python 3.11 from python.org first. & pause & exit /b 1)
  .venv\Scripts\python.exe -m pip install --upgrade pip
  .venv\Scripts\python.exe -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu || (pause & exit /b 1)
)
.venv\Scripts\python.exe server.py --port 8004 %*
pause

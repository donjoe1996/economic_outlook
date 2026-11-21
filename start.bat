@echo off
REM Windows: double-click start.bat
REM Creates .venv the first time, and (re)installs packages whenever
REM requirements.txt changed since the last install.
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv
)
fc /b requirements.txt .venv\requirements.installed >nul 2>&1
if errorlevel 1 (
  .venv\Scripts\pip install -r requirements.txt
  if not errorlevel 1 copy /y requirements.txt .venv\requirements.installed >nul
)
.venv\Scripts\python run.py %*

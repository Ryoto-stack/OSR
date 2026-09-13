@echo off
REM Optional: run OSR Desk from a local web address instead of double-clicking the HTML.
cd /d "%~dp0"
start "" http://localhost:8600
python -m http.server 8600

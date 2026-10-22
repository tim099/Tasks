@echo off
rem Constitution Broadside settings admin (TASK-0542): double-click = start admin.py serve and open the page.
rem Already running => just opens the page. Close this window (or Ctrl+C) to stop the server.
title Constitution Broadside admin
cd /d "%~dp0src"
python -I admin.py serve --open
if errorlevel 1 pause

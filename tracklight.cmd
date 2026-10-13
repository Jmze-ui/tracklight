@echo off
rem Tracklight launcher. Usage: tracklight [song.mod|project.tlp] [--port N] [--no-browser] [--keep]
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Tracklight needs Node.js: https://nodejs.org/
  exit /b 1
)
node "%~dp0serve.js" %*
exit /b %errorlevel%

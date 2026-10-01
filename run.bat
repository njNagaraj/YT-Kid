@echo off
setlocal
cd /d "%~dp0"
title YT Video Processing Pipeline - Joiner ^& Parallel Cleaner

echo ====================================================================
echo   YT Video Processing Pipeline (Joiner ^& Parallel Logo Cleaner)
echo ====================================================================
echo.
echo Select Workflow Option:
echo   [1] Join Video (Output: output_with_logo.mp4) [No logo removal]
echo   [2] Parallel Logo Remover + Join Video (Output: output_without_logo.mp4) [DEFAULT]
echo.

set "MODE_CHOICE=2"
set /p "MODE_CHOICE=Enter choice [1 or 2, default: 2]: "

if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE: =%"
if defined MODE_CHOICE set "MODE_CHOICE=%MODE_CHOICE:"=%"

echo.
set "TARGET_FOLDER=%~1"

if "%TARGET_FOLDER%"=="" (
    set /p "TARGET_FOLDER=Enter video folder name (e.g. video1, video2) [Press Enter for latest]: "
)

if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER: =%"
if defined TARGET_FOLDER set "TARGET_FOLDER=%TARGET_FOLDER:"=%"

set "MODE_FLAG=full"
if "%MODE_CHOICE%"=="1" (
    set "MODE_FLAG=join"
) else (
    set "MODE_FLAG=full"
)

echo.
if "%TARGET_FOLDER%"=="" (
    echo [Processing latest detected video folder with option: %MODE_FLAG%...]
    echo.
    node index.mjs %MODE_FLAG%
) else (
    echo [Processing folder: %TARGET_FOLDER% with option: %MODE_FLAG%...]
    echo.
    node index.mjs %MODE_FLAG% -i "%TARGET_FOLDER%"
)

echo.
pause

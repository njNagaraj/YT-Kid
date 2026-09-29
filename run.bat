@echo off
title YT Kids - Gemini Watermark Remover
cd /d "%~dp0"
echo ======================================================
echo  Starting Gemini Watermark Removal and Video Stitcher
echo ======================================================
node index.mjs %*
echo.
pause

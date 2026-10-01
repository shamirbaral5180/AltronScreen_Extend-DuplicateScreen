@echo off
setlocal EnableDelayedExpansion
title AltronScreen - Virtual Display Driver Setup

:: ------------------------------------------------------------------
:: Self-elevate: relaunch this same script through PowerShell's RunAs
:: verb so Windows shows a UAC prompt and the driver can be installed.
:: ------------------------------------------------------------------
net session >nul 2>&1
if %errorLevel% neq 0 (
	echo Requesting administrator privileges...
	powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
	exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-vdd.ps1"
exit /b %errorLevel%

$ErrorActionPreference='Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path config\workers.json)) { Copy-Item config\workers.example.json config\workers.json }
Write-Host 'Installed. Edit config\workers.json, create profile/worktree directories, authenticate AGY separately, and update Claude Desktop JSON.'

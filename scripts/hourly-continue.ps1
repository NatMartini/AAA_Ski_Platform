param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$configPath = Join-Path $workspacePath 'storage\thread-continuation\01a0fec1-db67-7ec0-9e72-75a41aa21910\config.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ([IO.Path]::GetFullPath($config.workspace) -ne $workspacePath) { throw 'Continuation workspace mismatch' }
$mode = if ($CheckOnly) { '--check' } else { '--run' }
$runnerPath = Join-Path $workspacePath 'scripts\hourly-continue.mjs'
$arguments = '"' + $runnerPath + '" ' + $mode
$runnerProcess = Start-Process -FilePath $config.nodeExe -ArgumentList $arguments -WorkingDirectory $workspacePath -WindowStyle Hidden -Wait -PassThru
exit $runnerProcess.ExitCode

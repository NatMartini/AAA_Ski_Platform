param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$workspacePath = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$threadId = '01a0fec1-db67-7ec0-9e72-75a41aa21910'
if ($env:CODEX_THREAD_ID -and $env:CODEX_THREAD_ID -ne $threadId) { throw 'This automation belongs to a different chat' }
$taskName = 'AAA-Ski-Chat-Hourly-Continue-01a0fec1'
$runnerPath = Join-Path $workspacePath 'scripts\hourly-continue.ps1'
$powershellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$actionArguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + $runnerPath + '"'
$principal = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing) {
  $actualPrincipal = New-Object Security.Principal.NTAccount($existing.Principal.UserId)
  $actualSid = $actualPrincipal.Translate([Security.Principal.SecurityIdentifier]).Value
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($existing.Actions.Count -ne 1 -or $existing.Actions[0].Execute -ne $powershellExe -or $existing.Actions[0].Arguments -ne $actionArguments -or $existing.Actions[0].WorkingDirectory -ne $workspacePath -or $actualSid -ne $currentSid) {
    throw 'An existing task has a different owner or action. It was left unchanged.'
  }
}
if ($CheckOnly) {
  [pscustomobject]@{ TaskName=$taskName; Exists=[bool]$existing; Owned=[bool]$existing; Enabled=if ($existing) { [bool]$existing.Settings.Enabled } else { $false }; ThreadId=$threadId } | ConvertTo-Json
  return
}
$privateRoot = Join-Path $workspacePath ('storage\thread-continuation\' + $threadId)
New-Item -ItemType Directory -Path $privateRoot -Force | Out-Null
& icacls $privateRoot /inheritance:r /grant:r "${principal}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect continuation logs' }
$sessionFile = @(Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.codex\sessions') -Recurse -File -Filter ('*' + $threadId + '*.jsonl'))
if ($sessionFile.Count -ne 1) { throw 'The exact current chat transcript could not be identified' }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$codexExe = (Get-Command codex.exe -ErrorAction Stop).Source
$config = @{ threadId=$threadId; workspace=$workspacePath; sessionFile=$sessionFile[0].FullName; nodeExe=$nodeExe; codexExe=$codexExe }
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateRoot 'config.json') -Encoding UTF8
if ($existing) { Export-ScheduledTask -TaskName $taskName -TaskPath '\' | Set-Content -LiteralPath (Join-Path $privateRoot ('task-before-' + (Get-Date -Format yyyyMMddHHmmss) + '.xml')) -Encoding UTF8 }
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument $actionArguments -WorkingDirectory $workspacePath
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddHours(1) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
if ($existing -and -not $existing.Settings.Enabled) { $settings.Enabled = $false }
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $principal -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description ('Hourly continuation for chat ' + $threadId + '; wait for restored quota, skip busy chat, disable only after evidence-backed completion.') -Force | Out-Null
& $nodeExe (Join-Path $workspacePath 'scripts\hourly-continue.mjs') --activate
if ($LASTEXITCODE -ne 0) { throw 'Task registered but activation verification failed' }
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{ TaskName=$taskName; Enabled=(Get-ScheduledTask -TaskName $taskName).Settings.Enabled; Interval='PT1H'; NextRunTime=$taskInfo.NextRunTime; ThreadId=$threadId } | ConvertTo-Json

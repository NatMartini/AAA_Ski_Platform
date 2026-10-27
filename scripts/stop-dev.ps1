param([switch]$WorkerOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$stateFile = Join-Path $projectRoot '.next\launcher.json'

function Get-ManagedNodeProcess {
    param([int]$ProcessId, [string]$ScriptPath, [string]$NodePath, [string]$OwnerArgument)
    if ($ProcessId -le 0) { throw 'Invalid managed process ID.' }
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    if ($null -eq $candidate) { return $null }
    if ($candidate.Name -ne 'node.exe' -or
        -not $candidate.CommandLine -or
        -not $candidate.CommandLine.Contains($ScriptPath) -or
        ($NodePath -and $candidate.ExecutablePath -ine $NodePath) -or
        ($OwnerArgument -and -not $candidate.CommandLine.Contains($OwnerArgument))) {
        throw 'The recorded PID belongs to another process; it was left running.'
    }
    return $candidate
}

if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host 'No launcher-managed server is recorded. Use Ctrl+C in a manually started server.'
    exit 0
}

try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ([int]$state.pid -le 0 -or $state.root -ne $projectRoot) {
        throw 'The launcher state does not belong to this project.'
    }
    $expectedCli = Join-Path $projectRoot 'node_modules\next\dist\bin\next'
    if ($state.nextCli -ne $expectedCli) { throw 'Invalid Next.js process path.' }
    $serverOwner = ''
    if ($state.serverToken) {
        if ($state.serverToken -notmatch '^[a-f0-9]{32}$') { throw 'Invalid server owner token.' }
        $serverOwner = "--title=aaa-ski-test-server-$($state.serverToken)"
    }
    $serverProcess = $null
    if (-not $WorkerOnly) {
        $serverProcess = Get-ManagedNodeProcess -ProcessId ([int]$state.pid) -ScriptPath $expectedCli -NodePath $state.node -OwnerArgument $serverOwner
        if ($serverProcess -and -not $serverProcess.CommandLine.Contains($projectRoot)) {
            throw 'The recorded server command does not belong to this project.'
        }
    }

    # Validate every recorded identity before writing a marker or terminating anything.
    $workerProcess = $null
    if ($state.worker) {
        $expectedWorker = Join-Path $projectRoot 'scripts\video-analysis-worker.ts'
        $expectedTsx = Join-Path $projectRoot 'node_modules\tsx\dist\cli.mjs'
        if ($state.worker.script -ne $expectedWorker -or $state.worker.tsxCli -ne $expectedTsx -or
            $state.worker.ownerToken -notmatch '^[a-f0-9]{32}$') {
            throw 'Invalid managed analysis worker state.'
        }
        $expectedStop = Join-Path $projectRoot "tmp\video-analysis-worker.$($state.worker.ownerToken).stop"
        if ($state.worker.stopFile -ne $expectedStop -or -not $state.worker.node) {
            throw 'Invalid analysis worker stop path.'
        }
        $workerProcess = Get-ManagedNodeProcess -ProcessId ([int]$state.worker.pid) -ScriptPath $expectedWorker -NodePath $state.worker.node -OwnerArgument "--owner-token=$($state.worker.ownerToken)"
        if ($workerProcess -and -not $workerProcess.CommandLine.Contains($expectedTsx)) {
            throw 'The recorded worker command does not belong to this launcher.'
        }
    }
    if ($workerProcess) {
        [System.IO.Directory]::CreateDirectory((Split-Path -Parent $expectedStop)) | Out-Null
        Set-Content -LiteralPath $expectedStop -Value 'stop' -Encoding UTF8
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        do {
            $workerProcess = Get-ManagedNodeProcess -ProcessId ([int]$state.worker.pid) -ScriptPath $expectedWorker -NodePath $state.worker.node -OwnerArgument "--owner-token=$($state.worker.ownerToken)"
            if ($null -eq $workerProcess) { break }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($workerProcess) {
            & taskkill.exe /PID ([int]$state.worker.pid) /T /F
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the recorded analysis worker.' }
        }
    }
    if ($WorkerOnly) {
        Write-Host 'Managed analysis worker stopped. The website and isolated FreeSki service remain running.'
        exit 0
    }
    if ($serverProcess) {
        $serverProcess = Get-ManagedNodeProcess -ProcessId ([int]$state.pid) -ScriptPath $expectedCli -NodePath $state.node -OwnerArgument $serverOwner
        if ($serverProcess) {
            & taskkill.exe /PID ([int]$state.pid) /T /F
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop the recorded development server.' }
        }
    }
    # The launcher also removes its state when Next exits. Reading/deleting that
    # disappearing file is bookkeeping after successful termination, not a stop failure.
    for ($cleanupAttempt = 0; $cleanupAttempt -lt 3; $cleanupAttempt++) {
        try {
            if (-not (Test-Path -LiteralPath $stateFile)) { break }
            $fileShare = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
            $stateStream = [System.IO.File]::Open($stateFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $fileShare)
            $stateReader = [System.IO.StreamReader]::new($stateStream)
            try { $current = $stateReader.ReadToEnd() | ConvertFrom-Json }
            finally { $stateReader.Dispose() }
            if ($current.pid -eq $state.pid -and $current.serverToken -eq $state.serverToken) {
                Remove-Item -LiteralPath $stateFile -ErrorAction Stop
            }
            break
        } catch {
            if (-not (Test-Path -LiteralPath $stateFile)) { break }
            if ($cleanupAttempt -eq 2) {
                Write-Warning 'Services stopped; concurrent process-state cleanup was unavailable. The recorded state was left for the next launch.'
            } else { Start-Sleep -Milliseconds 50 }
        }
    }
    Write-Host 'Development server and analysis worker stopped. PostgreSQL and FreeSki services remain running.'
} catch {
    Write-Error $_
    exit 1
}

# BestWay Windows Desktop Performance & Memory Measurement Tool
# Measures real Tauri host + child WebView2 processes

$ErrorActionPreference = "Continue"

Write-Host "=========================================================="
Write-Host "BESTWAY WINDOWS DESKTOP REAL RUNTIME BENCHMARK"
Write-Host "=========================================================="

# 1. Environment & Hardware Profile
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
$totalRamMb = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
$freeRamMb = [math]::Round($os.FreePhysicalMemory / 1024, 0)

Write-Host "OS: $($os.Caption) ($($os.Version))"
Write-Host "CPU: $($cpu.Name) ($($cpu.NumberOfCores) Cores, $($cpu.NumberOfLogicalProcessors) Logical Processors)"
Write-Host "RAM: Total $totalRamMb MB, Available $freeRamMb MB"
Write-Host "GPU: $($gpu.Name) (Driver: $($gpu.DriverVersion))"

# Check WebView2 Runtime Version
$webview2Path = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-9D4A-442A-8221-729B56965E5E}"
$wv2Version = (Get-ItemProperty -Path $webview2Path -ErrorAction SilentlyContinue).pv
if (-not $wv2Version) {
    $webview2PathUser = "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-9D4A-442A-8221-729B56965E5E}"
    $wv2Version = (Get-ItemProperty -Path $webview2PathUser -ErrorAction SilentlyContinue).pv
}
Write-Host "WebView2 Runtime: $(if ($wv2Version) { $wv2Version } else { 'Evergreen System Default' })"
Write-Host "----------------------------------------------------------"

$appExe = Resolve-Path "src-tauri/target/debug/bestway-app.exe" -ErrorAction SilentlyContinue
if (-not $appExe) {
    Write-Warning "bestway-app.exe not found. Build it with cargo build first."
    exit 1
}

Write-Host "`n[1/3] Measuring Process Working Set Memory & Startup Time..."

function Measure-AppLaunch {
    param([string]$label)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $appExe -PassThru -WindowStyle Normal
    $pidHost = $proc.Id

    # Wait until process initializes and main window or child processes spawn
    $maxWaitSec = 8
    $windowFound = $false
    $launchElapsed = 0

    for ($i = 0; $i -lt ($maxWaitSec * 10); $i++) {
        Start-Sleep -Milliseconds 100
        $proc.Refresh()
        if ($proc.HasExited) { break }
        if ($proc.MainWindowHandle -ne 0 -and -not $windowFound) {
            $launchElapsed = $sw.ElapsedMilliseconds
            $windowFound = $true
            break
        }
    }
    if (-not $windowFound) {
        $launchElapsed = $sw.ElapsedMilliseconds
    }

    # Settle period for WebView2 child processes (Renderer, GPU, Utility)
    Start-Sleep -Seconds 3

    # Collect host and child processes
    $hostProc = Get-Process -Id $pidHost -ErrorAction SilentlyContinue
    $childProcs = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $pidHost } | ForEach-Object {
        Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    }
    # Also find msedgewebview2 processes spawned in the same tree
    $allWv2 = Get-Process "msedgewebview2" -ErrorAction SilentlyContinue

    $hostWsMb = if ($hostProc) { [math]::Round($hostProc.WorkingSet64 / 1MB, 2) } else { 0 }
    $childrenWsMb = 0
    if ($childProcs) {
        $childrenWsMb = [math]::Round(($childProcs | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB, 2)
    }

    $totalWsMb = $hostWsMb + $childrenWsMb

    Write-Host "$label Launch:"
    Write-Host "  - Launch to Window: $launchElapsed ms"
    Write-Host "  - Rust Host (bestway-app.exe) Working Set: $hostWsMb MB"
    Write-Host "  - Child Processes (WebView2) Working Set: $childrenWsMb MB"
    Write-Host "  - Combined Total Working Set Memory: $totalWsMb MB"

    # Terminate test process and its tree
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $pidHost -Force -ErrorAction SilentlyContinue
        # Clean any remaining direct children
        if ($childProcs) {
            $childProcs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
        }
    }
    Start-Sleep -Seconds 1

    return [PSCustomObject]@{
        LaunchMs = $launchElapsed
        HostWsMb = $hostWsMb
        ChildWsMb = $childrenWsMb
        TotalWsMb = $totalWsMb
    }
}

$sample1 = Measure-AppLaunch "Cold (Sample 1)"
$sample2 = Measure-AppLaunch "Warm (Sample 2)"
$sample3 = Measure-AppLaunch "Warm (Sample 3)"

$launches = @($sample1.LaunchMs, $sample2.LaunchMs, $sample3.LaunchMs) | Sort-Object
$memories = @($sample1.TotalWsMb, $sample2.TotalWsMb, $sample3.TotalWsMb) | Sort-Object

$medianLaunch = $launches[1]
$p95Launch = $launches[2]
$medianMem = $memories[1]
$p95Mem = $memories[2]

Write-Host "`n----------------------------------------------------------"
Write-Host "APPLICATION RUNTIME PERFORMANCE SUMMARY (3 SAMPLES):"
Write-Host "  - Launch Duration: Median = $medianLaunch ms, p95 = $p95Launch ms"
Write-Host "  - Working Set Memory: Median = $medianMem MB, p95 = $p95Mem MB"
Write-Host "----------------------------------------------------------"

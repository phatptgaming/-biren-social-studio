param(
  [ValidateSet('check','install','start','stop','status','model')]
  [string]$Action = 'check',
  [string]$ComfyDir = "$env:LOCALAPPDATA\BirenSocialStudio\ComfyUI",
  [int]$MinimumDiskGB = 20,
  [string]$TorchIndexUrl = 'https://download.pytorch.org/whl/cu130',
  [switch]$AcceptModelLicense,
  [switch]$SkipModel,
  [switch]$SkipTorch,
  [string]$ExtraArgs = ''
)

$ErrorActionPreference = 'Stop'
$ManifestPath = Join-Path $PSScriptRoot 'model-manifest.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$ComfyUrl = 'http://127.0.0.1:8188'
$PidPath = Join-Path $ComfyDir 'biren-comfyui.pid'
$StdoutLogPath = Join-Path $ComfyDir 'biren-comfyui.stdout.log'
$StderrLogPath = Join-Path $ComfyDir 'biren-comfyui.stderr.log'

function Find-Command([string]$Name) { Get-Command $Name -ErrorAction SilentlyContinue }
function Get-GpuVramGb {
  $nvidia = Find-Command 'nvidia-smi'
  if (-not $nvidia) { return 0 }
  $raw = & $nvidia.Source '--query-gpu=memory.total' '--format=csv,noheader,nounits' 2>$null
  $values = @($raw | ForEach-Object { [double]($_.ToString().Trim()) / 1024 } | Where-Object { $_ -gt 0 })
  if (-not $values.Count) { return 0 }
  return ($values | Measure-Object -Maximum).Maximum
}
function Get-FreeDiskGb {
  $fullPath = [IO.Path]::GetFullPath($ComfyDir)
  $root = [IO.Path]::GetPathRoot($fullPath)
  return [math]::Round(([IO.DriveInfo]::new($root).AvailableFreeSpace / 1GB), 1)
}
function Get-Python {
  $python = Find-Command 'python'
  if (-not $python) { throw 'Python was not found. Install Python 3.10-3.12 and add it to PATH.' }
  $version = (& $python.Source '--version' 2>&1).ToString()
  if ($version -notmatch 'Python 3\.(10|11|12)\.') { throw "ComfyUI requires Python 3.10-3.12; detected $version." }
  return $python.Source
}
function Test-Host {
  $python = Get-Python
  if (-not (Find-Command 'git')) { throw 'Git was not found. Install Git for Windows first.' }
  $vram = Get-GpuVramGb; $free = Get-FreeDiskGb
  Write-Host ("Python: {0}`nGit: OK`nNVIDIA VRAM: {1:N1} GB`nFree disk: {2:N1} GB" -f $python, $vram, $free)
  if ($vram -lt $Manifest.minVramGb) { Write-Warning "GPU is below $($Manifest.minVramGb) GB VRAM; model download is blocked." }
  if ($free -lt $MinimumDiskGB) { throw "Only $free GB is free; at least $MinimumDiskGB GB is required." }
  return @{ Python = $python; VramGb = $vram; FreeGb = $free }
}
function Get-VenvPython { Join-Path $ComfyDir 'venv\Scripts\python.exe' }
function Test-ComfyProcess {
  if (-not (Test-Path $PidPath)) { return $null }
  $processId = [int](Get-Content -LiteralPath $PidPath -Raw)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process) { return $process }
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
  return $null
}
function Wait-ComfyReady([int]$TimeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-ComfyProcess)) { throw "ComfyUI exited during startup. Check $StdoutLogPath and $StderrLogPath." }
    try {
      $response = Invoke-WebRequest "$ComfyUrl/system_stats" -TimeoutSec 3 -UseBasicParsing
      if ($response.StatusCode -eq 200) { return $response.Content }
    } catch { Start-Sleep -Seconds 2 }
  }
  throw "ComfyUI did not become ready within $TimeoutSeconds seconds. Check $StdoutLogPath and $StderrLogPath."
}
function Install-Model([hashtable]$HostInfo) {
  if ($SkipModel) { Write-Host 'Model download skipped by request.'; return }
  if (-not $AcceptModelLicense) { Write-Warning "Model not downloaded. Review license at $($Manifest.licenseUrl), then use -AcceptModelLicense."; return }
  if ($HostInfo.VramGb -lt $Manifest.minVramGb) { throw "Model download blocked: VRAM is $($HostInfo.VramGb) GB, required $($Manifest.minVramGb) GB." }
  $target = Join-Path $ComfyDir "models\checkpoints\$($Manifest.fileName)"
  if (Test-Path $target) { Write-Host "Model already exists: $target"; return }
  $requiredGb = [math]::Round(($Manifest.approxSizeGb + 2), 1)
  if ((Get-FreeDiskGb) -lt $requiredGb) { throw "Not enough free disk for the model; $requiredGb GB required." }
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  $partial = "$target.part"
  $headers = @{}
  if ($env:HF_TOKEN) { $headers.Authorization = "Bearer $env:HF_TOKEN" }
  Write-Host "Downloading $($Manifest.displayName) (~$($Manifest.approxSizeGb) GB) from $($Manifest.url)"
  $curl = Find-Command 'curl.exe'
  if ($curl) {
    $arguments = @('--fail', '--location', '--retry', '3', '--retry-delay', '5', '--continue-at', '-', '--output', $partial)
    if ($env:HF_TOKEN) { $arguments += @('--header', "Authorization: Bearer $env:HF_TOKEN") }
    $arguments += $Manifest.url
    & $curl.Source @arguments
    if ($LASTEXITCODE -ne 0) { throw "Model download failed with curl exit code $LASTEXITCODE." }
  } else {
    Invoke-WebRequest -Uri $Manifest.url -Headers $headers -OutFile $partial -UseBasicParsing
  }
  $file = Get-Item -LiteralPath $partial
  if ($Manifest.sizeBytes -and $file.Length -ne [long]$Manifest.sizeBytes) {
    Remove-Item -LiteralPath $partial -Force
    throw "Downloaded model has $($file.Length) bytes; expected $($Manifest.sizeBytes)."
  }
  if ($Manifest.sha256) {
    Write-Host 'Verifying SHA-256 of the downloaded model...'
    $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Manifest.sha256.ToLowerInvariant()) {
      Remove-Item -LiteralPath $partial -Force
      throw "Model SHA-256 mismatch. Expected $($Manifest.sha256), got $actual."
    }
  }
  Move-Item -LiteralPath $partial -Destination $target -Force
  Write-Host "Model verified and installed: $target"
}
function Install-Comfy {
  $hostInfo = Test-Host
  $git = (Find-Command 'git').Source
  if (-not (Test-Path (Join-Path $ComfyDir 'main.py'))) {
    New-Item -ItemType Directory -Force (Split-Path $ComfyDir) | Out-Null
    & $git clone --depth 1 'https://github.com/comfyanonymous/ComfyUI.git' $ComfyDir
    if ($LASTEXITCODE -ne 0) { throw 'Failed to clone ComfyUI.' }
  }
  $python = Get-VenvPython
  if (-not (Test-Path $python)) {
    & $hostInfo.Python -m venv (Join-Path $ComfyDir 'venv')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create the ComfyUI virtual environment.' }
  }
  & $python -m pip install --upgrade pip setuptools wheel
  if (-not $SkipTorch) {
    Write-Host "Installing CUDA-enabled PyTorch from $TorchIndexUrl ..."
    & $python -m pip install --upgrade torch torchvision torchaudio --index-url $TorchIndexUrl
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install PyTorch. Check the CUDA wheel index and network connection.' }
  }
  & $python -m pip install -r (Join-Path $ComfyDir 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install ComfyUI requirements.' }
  & $python -c "import torch; print('PyTorch', torch.__version__, 'CUDA available:', torch.cuda.is_available(), 'CUDA:', torch.version.cuda)"
  if ($LASTEXITCODE -ne 0) { throw 'PyTorch import failed.' }
  foreach ($folder in @('checkpoints', 'clip', 'vae', 'loras', 'input', 'output')) {
    New-Item -ItemType Directory -Force (Join-Path $ComfyDir "models\$folder") | Out-Null
  }
  New-Item -ItemType Directory -Force (Join-Path $ComfyDir 'input') | Out-Null
  New-Item -ItemType Directory -Force (Join-Path $ComfyDir 'output') | Out-Null
  Install-Model $hostInfo
  Write-Host "ComfyUI is ready at $ComfyDir"
}
function Start-Comfy {
  if (-not (Test-Path (Join-Path $ComfyDir 'main.py'))) { throw 'ComfyUI is not installed. Run -Action install first.' }
  $python = Get-VenvPython
  if (-not (Test-Path $python)) { throw 'Python virtual environment is missing. Run -Action install first.' }
  $running = Test-ComfyProcess
  if ($running) {
    Write-Host "ComfyUI is already running (PID $($running.Id))."
    Wait-ComfyReady 30 | Out-Null
    return
  }
  $arguments = @('main.py', '--listen', '127.0.0.1', '--port', '8188', '--preview-method', 'none', '--disable-auto-launch')
  if ($ExtraArgs.Trim()) { $arguments += ($ExtraArgs.Trim() -split '\s+') }
  $process = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $ComfyDir -RedirectStandardOutput $StdoutLogPath -RedirectStandardError $StderrLogPath -PassThru
  Set-Content -LiteralPath $PidPath -Value $process.Id
  Write-Host "ComfyUI started on localhost only (PID $($process.Id)). Waiting for the API..."
  try { Wait-ComfyReady 180 | Out-Null; Write-Host "ComfyUI API is ready at $ComfyUrl" }
  catch {
    if (Test-Path $StderrLogPath) { Get-Content -LiteralPath $StderrLogPath -Tail 40 | Write-Host }
    throw
  }
}
function Stop-Comfy {
  $running = Test-ComfyProcess
  if (-not $running) { Write-Host 'ComfyUI is not running.'; Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue; return }
  Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
  Write-Host 'ComfyUI stopped.'
}
function Test-Connection {
  try {
    $stats = Invoke-RestMethod "$ComfyUrl/system_stats" -TimeoutSec 8
    Write-Host "ComfyUI returned HTTP 200 at $ComfyUrl."
    if ($stats.devices) { foreach ($device in $stats.devices) { Write-Host ("Device: {0} | VRAM total: {1:N1} GB | free: {2:N1} GB" -f $device.name, ($device.vram_total / 1GB), ($device.vram_free / 1GB)) } }
    try {
      $info = Invoke-RestMethod "$ComfyUrl/object_info" -TimeoutSec 20
      $checkpoints = @($info.CheckpointLoaderSimple.input.required.ckpt_name[0])
      Write-Host ("Checkpoints available: {0}" -f $checkpoints.Count)
      $checkpoints | ForEach-Object { Write-Host "  - $_" }
      foreach ($node in @('LoadImage', 'VAEEncode', 'KSampler', 'VAEDecode', 'SaveImage', 'ImageScaleToTotalPixels')) {
        if (-not $info.PSObject.Properties.Name.Contains($node)) { Write-Warning "Core node missing: $node" }
      }
    } catch { Write-Warning "Could not read /object_info: $($_.Exception.Message)" }
  } catch { Write-Warning 'ComfyUI is not reachable at localhost:8188.' }
}
function Install-ModelOnly { $hostInfo = Test-Host; Install-Model $hostInfo }

switch ($Action) {
  'check' { Test-Host | Out-Null; Test-Connection }
  'install' { Install-Comfy }
  'start' { Start-Comfy; Test-Connection }
  'stop' { Stop-Comfy }
  'status' { Test-Connection }
  'model' { Install-ModelOnly }
}

exit 0

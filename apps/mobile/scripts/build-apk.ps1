# Builds the release APK from a clean-path copy of this app (see docs/MOBILE.md for why).
# Usage: .\scripts\build-apk.ps1 [-BuildDir C:\sb] [-Abis arm64-v8a]
param(
  [string]$BuildDir = "C:\sw",
  [string]$Abis = "arm64-v8a",
  [switch]$Clean,
  # -Fresh: copy this app to a new short-path folder, npm ci, prebuild, then build. Use when the tree is stale or
  # an interrupted native build left ninja's glob re-check in a broken state. Refuses an existing BuildDir.
  [switch]$Fresh,
  # -Install: npm ci + prebuild in an existing BuildDir (for example after an interrupted -Fresh run), then build.
  [switch]$Install
)
$ErrorActionPreference = "Continue"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if ($Fresh -and $Install) { Write-Host "Use either -Fresh or -Install."; exit 1 }
if ($Fresh) {
  $app = (Resolve-Path "$PSScriptRoot\..").Path
  if (Test-Path $BuildDir) { Write-Host "Build dir $BuildDir already exists. Pass a new -BuildDir (long paths make deleting old native trees unreliable)."; exit 1 }
  New-Item -ItemType Directory -Force $BuildDir | Out-Null
  # Full paths in /XD so only these directories are skipped, not every folder named "android" inside node_modules.
  robocopy $app $BuildDir /E /XD "$app\node_modules" "$app\android" "$app\ios" "$app\.expo" /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Host "Source copy failed; refusing to build stale files."; exit 1 }
  Write-Host "Copied app to $BuildDir"
}
if ($Install) {
  # Refresh sources (app.json, plugins, src) from this app without touching node_modules or the native tree.
  $app = (Resolve-Path "$PSScriptRoot\..").Path
  robocopy $app $BuildDir /E /XD "$app\node_modules" "$app\android" "$app\ios" "$app\.expo" /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Host "Source copy failed; refusing to build stale files."; exit 1 }
}
if ($Fresh -or $Install) {
  Set-Location $BuildDir
  Write-Host "Installing dependencies in $BuildDir"
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host "npm ci failed"; exit 1 }
  node node_modules/expo/bin/cli prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { Write-Host "prebuild failed"; exit 1 }
}
if (-not (Test-Path "$BuildDir\android\gradle\wrapper\gradle-wrapper.jar")) {
  Write-Host "No Android project at $BuildDir\android. Copy the app there, run npm ci, then: node node_modules/expo/bin/cli prebuild --platform android --no-install"
  exit 1
}
if ($Clean) {
  # Stale native intermediates (for example from an interrupted build) make ninja stop with an empty message.
  foreach ($dir in @("$BuildDir\android\app\.cxx", "$BuildDir\android\app\build", "$BuildDir\android\build")) {
    if (Test-Path $dir) { Write-Host "Removing $dir"; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Get-ChildItem "$BuildDir\node_modules" -Directory -Recurse -Depth 3 -Filter ".cxx" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Removing $($_.FullName)"; Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
}
# Windows 260-character path limit: cap CMake object paths so codegen object dirs get hashed. The config plugin in
# plugins/ does this at prebuild; this covers trees generated before the plugin existed.
$appGradle = "$BuildDir\android\app\build.gradle"
if (Test-Path $appGradle) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)   # Groovy rejects a UTF-8 byte-order mark
  $bytes = [System.IO.File]::ReadAllBytes($appGradle)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $text = $utf8NoBom.GetString($bytes)
  $changed = $false
  if ($hasBom) { $text = $text.TrimStart([char]0xFEFF); $changed = $true }
  if ($text -notmatch 'CMAKE_OBJECT_PATH_MAX') {
    $text = [regex]::Replace($text, '(?m)^(\s*defaultConfig\s*\{)', '$1' + "`r`n        externalNativeBuild { cmake { arguments `"-DCMAKE_OBJECT_PATH_MAX=240`" } }", 1)
    $changed = $true
  }
  if ($changed) { [System.IO.File]::WriteAllText($appGradle, $text, $utf8NoBom); Write-Host "Patched $appGradle (CMAKE_OBJECT_PATH_MAX=240, no BOM)" }
}
Set-Location "$BuildDir\android"
$java = Join-Path $env:JAVA_HOME "bin\java.exe"
# --no-build-cache: a cached native configure output from an interrupted run can be restored without its CMakeFiles folder.
& $java -classpath "gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain assembleRelease "-PreactNativeArchitectures=$Abis" --no-daemon --no-build-cache 2>&1 | Tee-Object -FilePath "$BuildDir\gradle.log"
$code = $LASTEXITCODE
Write-Host "GRADLE EXIT $code"
Get-ChildItem "app\build\outputs\apk\release" -ErrorAction SilentlyContinue | Select-Object Name, Length
exit $code

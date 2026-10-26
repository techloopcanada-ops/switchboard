# Diagnostic: run the same CMake configure that the Android Gradle plugin runs, outside Gradle,
# and report whether CMake produces its CMakeFiles folder. Usage: .\scripts\cmake-probe.ps1 [-BuildDir C:\sb]
param([string]$BuildDir = "C:\sb")
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$cmake = "$sdk\cmake\3.22.1\bin\cmake.exe"
$ninja = "$sdk\cmake\3.22.1\bin\ninja.exe"
$ndk = "$sdk\ndk\27.1.12297006"
$out = "$BuildDir\cmtest"
$prefab = Get-ChildItem "$BuildDir\android\app\.cxx\RelWithDebInfo" -Directory | Select-Object -First 1
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
& $cmake "-H$BuildDir\node_modules\react-native\ReactAndroid\cmake-utils\default-app-setup" `
  -DCMAKE_SYSTEM_NAME=Android -DCMAKE_EXPORT_COMPILE_COMMANDS=ON -DCMAKE_SYSTEM_VERSION=24 -DANDROID_PLATFORM=android-24 `
  -DANDROID_ABI=arm64-v8a -DCMAKE_ANDROID_ARCH_ABI=arm64-v8a "-DANDROID_NDK=$ndk" "-DCMAKE_ANDROID_NDK=$ndk" `
  "-DCMAKE_TOOLCHAIN_FILE=$ndk\build\cmake\android.toolchain.cmake" "-DCMAKE_MAKE_PROGRAM=$ninja" `
  "-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=$out\obj" "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=$out\obj" -DCMAKE_BUILD_TYPE=RelWithDebInfo `
  "-DCMAKE_FIND_ROOT_PATH=$($prefab.FullName)\prefab\arm64-v8a\prefab" "-B$out" -GNinja -DCMAKE_OBJECT_PATH_MAX=1024 `
  "-DPROJECT_BUILD_DIR=$BuildDir\android\app\build" "-DPROJECT_ROOT_DIR=$BuildDir\android" `
  "-DREACT_ANDROID_DIR=$BuildDir\node_modules\react-native\ReactAndroid" -DANDROID_STL=c++_shared -DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON 2>&1 | Select-Object -Last 15
Write-Host "CMAKE EXIT $LASTEXITCODE"
Write-Host "rules.ninja present: $(Test-Path "$out\CMakeFiles\rules.ninja")"
Get-ChildItem $out | Select-Object Name

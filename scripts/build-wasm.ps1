$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot '.work\tools\emsdk'
$environmentScript = Join-Path $sdkRoot 'emsdk_env.ps1'
$buildDirectory = Join-Path $projectRoot '.work\build-wasm'

if (-not (Test-Path -LiteralPath $environmentScript)) {
    throw "Emscripten SDK environment script not found at $environmentScript. Install the SDK under .work/tools/emsdk first."
}

# Dot-sourcing keeps the SDK's PATH and EMSDK variables scoped to this build process.
. $environmentScript

$emcmake = Get-Command 'emcmake' -ErrorAction Stop
$makeProgram = Get-Command 'mingw32-make' -ErrorAction Stop
& $emcmake.Source cmake -G 'MinGW Makefiles' -S $projectRoot -B $buildDirectory "-DCMAKE_MAKE_PROGRAM=$($makeProgram.Source)" -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cmake --build $buildDirectory --config Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$jsOutput = Join-Path $projectRoot 'public\root-decay.js'
$wasmOutput = Join-Path $projectRoot 'public\root-decay.wasm'
if (-not (Test-Path -LiteralPath $jsOutput) -or -not (Test-Path -LiteralPath $wasmOutput)) {
    throw 'The Emscripten build completed without both public/root-decay.js and public/root-decay.wasm.'
}
Write-Host 'WASM build complete: public/root-decay.js and public/root-decay.wasm'

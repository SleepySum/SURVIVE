# Root & Decay

A single-player, endless bunker-survival simulation with a C++17 simulation core, Emscripten/Embind browser bridge, Canvas bunker map, and small DOM overlays.

## Current status

The simulation and browser UI source are in place, and the native C++ smoke test passes. The WebAssembly output has not been built, so the browser game is not yet playable and no Preview is available. The local Emscripten SDK is under `.work/tools/emsdk`, but Windows currently denies execution of its `upstream/bin/clang.exe` (`permission denied`).

## Project layout

- `src/core.hpp`, `src/core.cpp` — pure C++17 simulation: resource dependency tree, routine/emergency work queues, inmates, bunker graph/A* routing, scavenging, zombie pressure, and fixed-size telemetry.
- `src/wasm_entry.cpp` — Emscripten main loop and Embind API.
- `public/index.html`, `public/style.css`, `public/app.js` — Canvas-first interface, counters, inspection drawers, task cards, and thin browser presentation bridge.
- `tests/native_smoke.cpp` — native assertions for key simulation invariants.
- `scripts/build-wasm.ps1` — builds the browser module with the SDK expected at `.work/tools/emsdk`.

## Native smoke test

From the project root in PowerShell:

```powershell
cmake -G 'MinGW Makefiles' -S . -B .work\build-native-mingw -DCMAKE_BUILD_TYPE=Debug
cmake --build .work\build-native-mingw --config Debug
.\.work\build-native-mingw\root-decay-native.exe
```

Expected final line: `Root & Decay native smoke test passed`.

## Emscripten build

Once Windows permits the local SDK's compiler to execute, run:

```powershell
.\scripts\build-wasm.ps1
```

The script writes `public/root-decay.js` and `public/root-decay.wasm`. Serve `public/` over HTTP (not `file://`) for browser use. The WebDev Session runtime port is declared as `3000`; start a Preview only after both generated files exist.

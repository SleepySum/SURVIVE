# Root & Decay

A single-player, endless 2D apocalypse bunker survival web app featuring a pure C++17 simulation core compiled to WebAssembly (WASM) with Emscripten (`emcc`), rendered to an HTML5 Canvas with minimal modern flat-vector DOM overlays.

In Root & Decay, there is no win condition — players must survive as many days as possible using limited internal resources (Food, Water, Power), external scavenging runs, infrastructure maintenance, and human labor (where inmates are treated as assignable worker units and consumable resources).

## Core Data Structures & Complexities (Pure C++17)

1. **Resource Dependency Tree (`SystemNode`)**:
   - N-ary tree with DFS traversal (`update_state_recursive()`, $O(N)$ time, $O(H)$ space).
   - If a parent node (e.g. Main Generator) fails or takes lethal damage, all dependent children (Hydroponics, Air Scrubbers, Workshop) automatically become non-operational.
   - Resource aggregation via `calculate_total_yield(ResourceType)`, $O(N)$ time.

2. **Task & Emergency Queues (`std::priority_queue` + `std::queue`)**:
   - `std::priority_queue<EmergencyTask>`: Max-Heap for critical events ($O(\log N)$ push/pop).
   - `std::queue<StandardTask>`: FIFO queue for routine duties ($O(1)$ push/pop).
   - Dynamic Priority formula:
     $$\text{Priority} = (\text{Severity} \times 10) + \text{ProximityPenalty} - (\text{AssignedInmateFatigue} \times 0.5)$$
   - Free inmates pop from Emergency Max-Heap first. If empty, routine tasks pop from standard FIFO.
   - If an inmate dies or panics mid-task, the task is re-inserted into the Emergency priority queue with an elevated severity modifier.

3. **Bunker Spatial Graph & A* Pathfinding (`bunker_graph`)**:
   - Adjacency list: `std::unordered_map<uint32_t, std::vector<HallwayEdge>> bunker_graph`.
   - Rooms act as graph vertices; hallways/elevators act as edges with weights (distance + environmental hazards).
   - A* shortest path search (`find_shortest_path(start, target)`, $O((V+E)\log V)$ time).
   - Edge weights dynamically become $\infty$ when a corridor collapses, freezes, or suffers a zombie breach.
   - Zombie pressure spreads across graph edges each tick.

4. **Inmate Registry & Rolling Telemetry**:
   - Fast $O(1)$ key-based inmate lookup: `std::unordered_map<uint32_t, Inmate>`.
   - Zero-allocation circular buffer telemetry: `std::array<DailyMetric, 30>` without memory fragmentation.

5. **Web Engine & JavaScript Bindings**:
   - `emscripten_set_main_loop()` drives the 60 FPS simulation frame update.
   - Rich Embind (`EMSCRIPTEN_BINDINGS`) getters and setters for HUD metrics, room selection, task assignment, and medical rations.

## UI & Playable Graphics Style

- **Minimalist Top Bar**: Shows Food, Water, Power % (with battery fill meter), Inmate count pill, and Day Counter.
- **2D Subterranean Cutaway Canvas**: Multi-story underground bunker cross-section (Surface Gate, Dormitories, Hydroponics, Kitchen, Workshop, Main Generator Room) with detailed furnishings, survivor animations, zombie horde breaches, and glowing route lines.
- **Inmate Panel**: Interactive card displaying survivor portrait, health bar, morale bar, fatigue bar, and quick duty/medical actions.
- **Contextual Drawers**: Toggleable flat-vector panels for Power Grid Status flowchart, Priority Queue heap breakdown, and Graph Route inspection.

## Building & Running

### 1. Build WebAssembly Module
```powershell
.\scripts\build-wasm.ps1
```
Generates `public/root-decay.js` and `public/root-decay.wasm`.

### 2. Run Native Smoke Test
```powershell
cmake -G 'MinGW Makefiles' -S . -B .work\build-native-mingw -DCMAKE_BUILD_TYPE=Debug
cmake --build .work\build-native-mingw --config Debug
.\.work\build-native-mingw\root-decay-native.exe
```

### 3. Launch Local Browser Server
```powershell
python -m http.server 3000 --directory public
```
Open `http://localhost:3000/index.html` in your web browser.

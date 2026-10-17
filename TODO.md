# Root & Decay — ToDo

## 1. Endless bunker survival and resource dependency tree
- [ ] Build an endless day-based apocalypse bunker survival game with no win condition. Players should survive as many days as possible using limited internal resources, external scavenging, infrastructure attrition, and inmate labor; inmates are assignable worker units and consumable resources.
  Progress: The pure C++ simulation implementation exists and passed native smoke checks; browser play remains pending because WASM artifacts are not built.
- [x] Implement the resource dependency tree in the pure C++ core. `SystemNode` must contain `uint32_t id`, `std::string name`, `float health, max_health`, `bool is_operational`, `float generation_rate, consumption_rate`, `SystemNode* parent`, and `std::vector<std::unique_ptr<SystemNode>> children`.
- [x] `update_state_recursive()` must traverse down the tree via DFS; when a parent node is disabled (for example, Main Generator), dependent children (for example, Hydroponics and Air Scrubbers) become non-operational.
- [x] `calculate_total_yield(ResourceType type)` must traverse operational nodes and aggregate resource production.
- [x] `apply_damage(float damage)` must reduce structural integrity and trigger operational failure down the subtree when health reaches zero.

## 2. Routine and emergency task queues with inmate labor
- [x] Implement `std::queue<StandardTask>` as a FIFO queue for routine duties such as cleaning, crop harvesting, and repair, and `std::priority_queue<EmergencyTask>` as a max-heap for critical events such as hull breach, electrical fires, and zombie defense.
- [x] Compute task priority using the specified formula: `(Severity * 10) + ProximityPenalty - (AssignedInmateFatigue * 0.5)`.
- [x] Free inmates must take an emergency task first; if the emergency queue is empty, they take a standard task.
- [x] If an inmate dies or panics mid-task, reinsert that task into the emergency priority queue with an elevated severity modifier. Inmates remain assignable labor units, affected by fatigue and panic, vulnerable to death, and consumable within survival decisions.

## 3. Bunker graph, A* routing, zombie spread, and scavenging
- [x] Model `RoomNode` rooms as graph vertices and `HallwayEdge` hallways/elevators as edges weighted by distance plus environmental hazards. Store the adjacency list as `std::unordered_map<uint32_t, std::vector<HallwayEdge>> bunker_graph`.
- [x] Implement `std::vector<uint32_t> find_shortest_path(uint32_t start_room, uint32_t target_room)` using A* pathfinding.
- [x] Dynamically set an edge weight to `std::numeric_limits<float>::infinity()` when a corridor collapses, freezes, or suffers a zombie breach.
- [x] Implement tick-based zombie invasion traversal: breaches spread to neighboring vertices along valid graph edges each tick, create spatial emergencies, and can dynamically alter safe routes.
- [x] Include external scavenging actions that commit inmate labor to routes beyond internal bunker duties and return limited survival resources under environmental and zombie risk.

## 4. Inmate registry and rolling telemetry
- [x] Store inmates in `std::unordered_map<uint32_t, Inmate>` for fast key-based attribute modifications.
- [x] Use a zero-allocation `std::array<DailyMetric, 30>` circular buffer to track daily burn rates for UI graphing without memory fragmentation.

## 5. C++/WebAssembly runtime, Canvas UI, and contextual overlays
- [ ] Keep all core game state and data structures in pure C++17/20, compile them to WebAssembly with Emscripten (`emcc`), render the game to an HTML5 Canvas, and keep DOM overlays minimal. The C++17 core and Canvas/UI source are implemented; generated WASM/JS output remains absent because Windows denied execution of the local SDK's `clang.exe`.
- [ ] Run the C++ frame/update loop at 60 FPS using `emscripten_set_main_loop()`; expose key state getters/setters to JavaScript via `EMSCRIPTEN_BINDINGS` for lightweight DOM updates or audio cues. Source is written; compilation and browser runtime remain unverified.
- [x] Keep the C++ architecture clean and memory-safe, with inline comments documenting time and space complexities for tree traversals and queue operations.
- [x] Keep the UI clean and minimal. The top bar shows only Food, Water, Power %, and the Day Counter.
- [x] Keep contextual inspection drawers hidden by default and toggleable through clean, modern flat-vector UI controls: Power Tree, Task Priority Queue, and Graph Route overlays.
- [x] Provide streamlined task cards showing the assigned inmate, priority badge, and status bar.

#include "core.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace root_decay {
constexpr std::size_t GameState::kTelemetryCapacity;
constexpr float GameState::kSecondsPerDay;

namespace {

float clamp_range(float value, float low, float high) { return std::max(low, std::min(value, high)); }
float clamp01(float value) { return clamp_range(value, 0.0f, 1.0f); }

std::string status_name(InmateStatus status) {
    switch (status) {
        case InmateStatus::Idle: return "IDLE";
        case InmateStatus::Working: return "WORKING";
        case InmateStatus::Panicked: return "PANICKED";
        case InmateStatus::Dead: return "LOST";
    }
    return "UNKNOWN";
}

float distance_between(const RoomNode& left, const RoomNode& right) {
    const float dx = left.x - right.x;
    const float dy = left.y - right.y;
    return std::sqrt(dx * dx + dy * dy) * 10.0f;
}

} // namespace

// DFS visits every node once: O(N) time and O(H) call-stack space, where H is tree height.
void SystemNode::update_state_recursive() {
    const bool parent_operational = parent == nullptr || parent->is_operational;
    is_operational = enabled_by_design && health > 0.0f && parent_operational;
    for (const auto& child : children) {
        child->update_state_recursive();
    }
}

// Aggregating yields is O(N) time and O(H) recursive stack space.
float SystemNode::calculate_total_yield(ResourceType type) const {
    float total = 0.0f;
    if (is_operational && output_type == type) {
        total += generation_rate;
    }
    for (const auto& child : children) {
        total += child->calculate_total_yield(type);
    }
    return total;
}

void SystemNode::apply_damage(float damage) {
    if (damage <= 0.0f || health <= 0.0f) return;
    health = std::max(0.0f, health - damage);
    if (health <= 0.0f) enabled_by_design = false;
    update_state_recursive();
}

void HallwayEdge::recalculate_weight() {
    if (collapsed || frozen || zombie_breach) {
        weight = std::numeric_limits<float>::infinity();
        return;
    }
    weight = std::max(0.1f, distance + environmental_hazard * 3.0f);
}

void EmergencyTask::recalculate_priority() {
    priority = (severity * 10.0f) + proximity_penalty - (assigned_inmate_fatigue * 0.5f);
}

// std::priority_queue::push/pop are O(log N); the standard FIFO queue is O(1).
bool EmergencyTaskCompare::operator()(const EmergencyTask& left, const EmergencyTask& right) const {
    return left.priority < right.priority;
}

GameState::GameState() { initialize(); }

void GameState::initialize() {
    day_ = 1;
    food_ = 62.0f;
    water_ = 67.0f;
    power_percent_ = 82.0f;
    day_clock_ = 0.0f;
    event_clock_ = 0.0f;
    paused_ = false;
    game_over_ = false;
    recent_event_ = "A quiet shift. The bunker holds—for now.";
    next_task_id_ = 1;
    telemetry_head_ = 0;
    telemetry_count_ = 0;
    telemetry_.fill(DailyMetric{});
    random_.seed(0xC0FFEEu);
    inmates_.clear();
    inmate_order_.clear();
    standard_tasks_ = std::queue<StandardTask>{};
    emergency_tasks_ = decltype(emergency_tasks_){};
    active_tasks_.clear();
    rooms_.clear();
    room_order_.clear();
    route_path_.clear();
    bunker_graph.clear();
    selected_room_id_ = 1;
    route_target_id_ = 6;

    build_system_tree();
    build_bunker_graph();
    build_inmates();
    rebuild_system_order();

    add_emergency_task("Seal the hairline breach", TaskKind::Breach, 6, 3.0f, 15.0f);
    add_routine_task("Harvest the lower beds", TaskKind::Harvest, 2, 18.0f);
    add_routine_task("Clean the air filters", TaskKind::Clean, 4, 16.0f);
    add_routine_task("Repair the reclamation pump", TaskKind::Repair, 3, 20.0f);
    set_route_target(route_target_id_);
    push_telemetry(DailyMetric{day_, food_, water_, power_percent_, 0.0f, 0.0f, 0.0f});
    assign_available_workers();
}

void GameState::build_system_tree() {
    system_root_ = std::make_unique<SystemNode>();
    system_root_->id = 0;
    system_root_->name = "Bunker Systems";
    system_root_->health = system_root_->max_health = 100.0f;
    system_root_->output_type = ResourceType::Power;

    auto generator = std::make_unique<SystemNode>();
    generator->id = 1;
    generator->name = "Main Generator";
    generator->health = 91.0f;
    generator->max_health = 100.0f;
    generator->generation_rate = 18.5f;
    generator->output_type = ResourceType::Power;
    generator->parent = system_root_.get();

    auto hydroponics = std::make_unique<SystemNode>();
    hydroponics->id = 2;
    hydroponics->name = "Hydroponics";
    hydroponics->health = 88.0f;
    hydroponics->max_health = 100.0f;
    hydroponics->generation_rate = 6.7f;
    hydroponics->consumption_rate = 5.0f;
    hydroponics->output_type = ResourceType::Food;
    hydroponics->parent = generator.get();
    generator->children.push_back(std::move(hydroponics));

    auto water_reclaimer = std::make_unique<SystemNode>();
    water_reclaimer->id = 3;
    water_reclaimer->name = "Water Reclaimer";
    water_reclaimer->health = 84.0f;
    water_reclaimer->max_health = 100.0f;
    water_reclaimer->generation_rate = 7.3f;
    water_reclaimer->consumption_rate = 3.5f;
    water_reclaimer->output_type = ResourceType::Water;
    water_reclaimer->parent = generator.get();
    generator->children.push_back(std::move(water_reclaimer));

    auto air_scrubbers = std::make_unique<SystemNode>();
    air_scrubbers->id = 4;
    air_scrubbers->name = "Air Scrubbers";
    air_scrubbers->health = 95.0f;
    air_scrubbers->max_health = 100.0f;
    air_scrubbers->generation_rate = 10.0f;
    air_scrubbers->consumption_rate = 4.5f;
    air_scrubbers->output_type = ResourceType::Air;
    air_scrubbers->parent = generator.get();
    generator->children.push_back(std::move(air_scrubbers));

    auto workshop = std::make_unique<SystemNode>();
    workshop->id = 5;
    workshop->name = "Workshop Relay";
    workshop->health = 76.0f;
    workshop->max_health = 100.0f;
    workshop->generation_rate = 0.8f;
    workshop->consumption_rate = 2.0f;
    workshop->output_type = ResourceType::Parts;
    workshop->parent = generator.get();
    generator->children.push_back(std::move(workshop));

    auto lift = std::make_unique<SystemNode>();
    lift->id = 6;
    lift->name = "Bunker Lift";
    lift->health = 93.0f;
    lift->max_health = 100.0f;
    lift->consumption_rate = 1.0f;
    lift->output_type = ResourceType::Power;
    lift->parent = generator.get();
    generator->children.push_back(std::move(lift));

    system_root_->children.push_back(std::move(generator));
    update_system_state();
}

void GameState::build_bunker_graph() {
    const std::vector<RoomNode> initial_rooms = {
        {1, "Bunker Core", 0.19f, 0.50f, 0.08f, 0.00f, false, true},
        {2, "Hydroponics", 0.39f, 0.23f, 0.12f, 0.00f, false, false},
        {3, "Water Plant", 0.39f, 0.77f, 0.24f, 0.00f, false, false},
        {4, "Dormitory", 0.61f, 0.50f, 0.10f, 0.02f, false, false},
        {5, "Workshop", 0.79f, 0.27f, 0.30f, 0.00f, false, false},
        {6, "Surface Gate", 0.80f, 0.73f, 0.48f, 0.18f, false, false},
        {7, "Outer Yard", 0.96f, 0.73f, 0.68f, 0.86f, true, false},
    };
    for (const RoomNode& room : initial_rooms) {
        rooms_.emplace(room.id, room);
        room_order_.push_back(room.id);
    }

    auto add_pair = [this](std::uint32_t a, std::uint32_t b, float hazard) {
        const RoomNode& left = rooms_.at(a);
        const RoomNode& right = rooms_.at(b);
        const float distance = distance_between(left, right);
        HallwayEdge forward{b, distance, hazard, distance + hazard * 3.0f};
        HallwayEdge reverse{a, distance, hazard, distance + hazard * 3.0f};
        forward.recalculate_weight();
        reverse.recalculate_weight();
        bunker_graph[a].push_back(forward);
        bunker_graph[b].push_back(reverse);
    };
    add_pair(1, 2, 0.10f);
    add_pair(1, 3, 0.22f);
    add_pair(1, 4, 0.08f);
    add_pair(2, 4, 0.14f);
    add_pair(3, 4, 0.18f);
    add_pair(4, 5, 0.19f);
    add_pair(4, 6, 0.30f);
    add_pair(5, 6, 0.16f);
    add_pair(6, 7, 0.62f);
}

void GameState::build_inmates() {
    const std::array<const char*, 8> names = {"Mara", "Elias", "June", "Rafi", "Nika", "Sol", "Tomas", "Vera"};
    const std::array<std::uint32_t, 8> rooms = {1, 1, 2, 2, 3, 4, 4, 5};
    for (std::size_t i = 0; i < names.size(); ++i) {
        const std::uint32_t id = static_cast<std::uint32_t>(i + 1);
        Inmate inmate;
        inmate.id = id;
        inmate.name = names[i];
        inmate.fatigue = static_cast<float>((i * 7) % 19);
        inmate.health = 88.0f + static_cast<float>((i * 3) % 12);
        inmate.panic = static_cast<float>((i * 5) % 13);
        inmate.room_id = rooms[i];
        inmates_.emplace(id, inmate);
        inmate_order_.push_back(id);
    }
}

void GameState::rebuild_system_order() {
    system_order_.clear();
    if (system_root_) collect_system_nodes(system_root_.get());
}

void GameState::collect_system_nodes(SystemNode* node) {
    if (!node) return;
    system_order_.push_back(node);
    for (const auto& child : node->children) collect_system_nodes(child.get());
}

void GameState::update_system_state() {
    if (system_root_) system_root_->update_state_recursive();
}

float GameState::total_power_consumption() const {
    float total = 0.0f;
    for (const SystemNode* node : flatten_systems()) {
        if (node && node->is_operational) total += node->consumption_rate;
    }
    return total;
}

void GameState::add_routine_task(const std::string& name, TaskKind kind,
                                 std::uint32_t room_id, float duration, bool external) {
    StandardTask task;
    task.id = next_task_id_++;
    task.name = name;
    task.kind = kind;
    task.target_room_id = room_id;
    task.duration_seconds = duration;
    task.external_route = external;
    // FIFO enqueue is O(1); no priority reordering is applied to routine work.
    standard_tasks_.push(std::move(task));
}

void GameState::add_emergency_task(const std::string& name, TaskKind kind,
                                   std::uint32_t room_id, float severity, float duration) {
    EmergencyTask task;
    task.id = next_task_id_++;
    task.name = name;
    task.kind = kind;
    task.target_room_id = room_id;
    task.severity = severity;
    const auto room = rooms_.find(room_id);
    task.proximity_penalty = room == rooms_.end() ? 0.0f : room->second.environmental_hazard * 2.0f;
    task.assigned_inmate_fatigue = least_free_inmate_fatigue();
    task.duration_seconds = duration;
    task.recalculate_priority();
    // Max-heap insertion is O(log N); the comparator preserves the highest score at top.
    emergency_tasks_.push(std::move(task));
}

float GameState::least_free_inmate_fatigue() const {
    float fatigue = std::numeric_limits<float>::infinity();
    for (const auto& entry : inmates_) {
        const Inmate& inmate = entry.second;
        if (inmate.status == InmateStatus::Idle && inmate.health > 0.0f) {
            fatigue = std::min(fatigue, inmate.fatigue);
        }
    }
    return std::isfinite(fatigue) ? fatigue : 0.0f;
}

Inmate* GameState::select_free_inmate() {
    Inmate* best = nullptr;
    float best_score = std::numeric_limits<float>::infinity();
    for (std::uint32_t id : inmate_order_) {
        auto found = inmates_.find(id);
        if (found == inmates_.end()) continue;
        Inmate& inmate = found->second;
        if (inmate.status != InmateStatus::Idle || inmate.health <= 0.0f) continue;
        const float score = inmate.fatigue + inmate.panic * 0.35f;
        if (score < best_score) {
            best = &inmate;
            best_score = score;
        }
    }
    return best;
}

void GameState::assign_available_workers() {
    while (Inmate* worker = select_free_inmate()) {
        ActiveTask active;
        if (!emergency_tasks_.empty()) {
            // Heap pop is O(log N); emergency work is always considered before FIFO duties.
            EmergencyTask task = emergency_tasks_.top();
            emergency_tasks_.pop();
            task.assigned_inmate_fatigue = worker->fatigue;
            task.recalculate_priority();
            active = ActiveTask{task.id, task.name, task.kind, task.target_room_id,
                                worker->id, 0.0f, task.duration_seconds, task.priority,
                                true, false};
        } else if (!standard_tasks_.empty()) {
            // FIFO pop is O(1) and occurs only after the emergency max-heap is empty.
            StandardTask task = standard_tasks_.front();
            standard_tasks_.pop();
            const auto room = rooms_.find(task.target_room_id);
            const float proximity = room == rooms_.end() ? 0.0f : room->second.environmental_hazard * 2.0f;
            const float priority = 10.0f + proximity - worker->fatigue * 0.5f;
            active = ActiveTask{task.id, task.name, task.kind, task.target_room_id,
                                worker->id, 0.0f, task.duration_seconds, priority,
                                false, task.external_route};
        } else {
            break;
        }
        worker->status = InmateStatus::Working;
        worker->assigned_task = active.name;
        active_tasks_.push_back(std::move(active));
    }
}

void GameState::update(float delta_seconds) {
    if (game_over_) return;
    const float dt = clamp_range(delta_seconds, 0.0f, 0.10f);
    if (!paused_) {
        day_clock_ += dt;
        event_clock_ += dt;
        while (event_clock_ >= 1.0f) {
            event_clock_ -= 1.0f;
            spread_zombie_pressure();
        }
        if (day_clock_ >= kSecondsPerDay) advance_day();
        progress_tasks(dt);
        assign_available_workers();
    }
}

void GameState::advance_day() {
    if (game_over_) return;
    day_clock_ = 0.0f;
    ++day_;
    update_system_state();

    const float previous_food = food_;
    const float previous_water = water_;
    const float previous_power = power_percent_;
    const float population = static_cast<float>(living_inmate_count());
    const float food_yield = system_root_ ? system_root_->calculate_total_yield(ResourceType::Food) : 0.0f;
    const float water_yield = system_root_ ? system_root_->calculate_total_yield(ResourceType::Water) : 0.0f;
    const float power_yield = system_root_ ? system_root_->calculate_total_yield(ResourceType::Power) : 0.0f;

    food_ = clamp_range(food_ + food_yield - population * 0.95f, 0.0f, 100.0f);
    water_ = clamp_range(water_ + water_yield - population * 1.15f, 0.0f, 100.0f);
    const float net_power = power_yield - total_power_consumption();
    power_percent_ = clamp_range(power_percent_ + net_power * 0.34f, 0.0f, 100.0f);

    update_inmate_condition(std::max(0.0f, previous_food - food_),
                            std::max(0.0f, previous_water - water_));
    if (power_percent_ < 10.0f) {
        if (SystemNode* generator = find_system(1)) generator->apply_damage(1.2f);
        add_emergency_task("Restart the main generator", TaskKind::RestorePower, 1, 4.0f, 20.0f);
    }
    if (food_ < 18.0f && standard_tasks_.size() < 6) {
        add_routine_task("Recover stored provisions", TaskKind::Scavenge, 7, 23.0f, true);
    }
    if (day_ % 3 == 0) add_routine_task("Harvest the lower beds", TaskKind::Harvest, 2, 17.0f);

    trigger_daily_event();
    update_system_state();
    const float food_burn = std::max(0.0f, previous_food - food_);
    const float water_burn = std::max(0.0f, previous_water - water_);
    const float power_burn = std::max(0.0f, previous_power - power_percent_);
    push_telemetry(DailyMetric{day_, food_, water_, power_percent_, food_burn, water_burn, power_burn});

    if (living_inmate_count() == 0) {
        game_over_ = true;
        paused_ = true;
        recent_event_ = "BUNKER SILENT — survival ended on day " + std::to_string(day_) + ".";
    } else if (recent_event_.empty()) {
        recent_event_ = "Day " + std::to_string(day_) + " closed. The counters keep moving.";
    }
    assign_available_workers();
}

void GameState::toggle_pause() { paused_ = !paused_; }

void GameState::dispatch_scavenge() {
    if (game_over_) return;
    bool already_dispatched = false;
    for (const ActiveTask& task : active_tasks_) {
        if (task.external_route) already_dispatched = true;
    }
    std::queue<StandardTask> queued = standard_tasks_;
    while (!queued.empty()) {
        if (queued.front().external_route) already_dispatched = true;
        queued.pop();
    }
    if (already_dispatched) {
        recent_event_ = "A surface team is already out beyond the gate.";
        return;
    }
    const auto path = find_shortest_path(1, 7);
    if (path.empty()) {
        recent_event_ = "Surface route blocked. Clear a corridor before sending a team.";
        return;
    }
    add_routine_task("Scavenge the outer yard", TaskKind::Scavenge, 7, 25.0f, true);
    recent_event_ = "Scavenge team dispatched. The surface is never quiet.";
    assign_available_workers();
}

void GameState::select_room(std::uint32_t room_id) {
    if (rooms_.find(room_id) == rooms_.end()) return;
    selected_room_id_ = room_id;
    for (auto& entry : rooms_) entry.second.selected = entry.first == room_id;
    set_route_target(room_id);
}

void GameState::set_route_target(std::uint32_t room_id) {
    if (rooms_.find(room_id) == rooms_.end()) return;
    route_target_id_ = room_id;
    route_path_ = find_shortest_path(1, route_target_id_);
}

std::vector<std::uint32_t> GameState::find_shortest_path(std::uint32_t start_room,
                                                         std::uint32_t target_room) const {
    if (rooms_.find(start_room) == rooms_.end() || rooms_.find(target_room) == rooms_.end()) return {};
    if (start_room == target_room) return {start_room};

    struct OpenNode { float score; std::uint32_t id; };
    struct MinScore {
        bool operator()(const OpenNode& left, const OpenNode& right) const {
            return left.score > right.score;
        }
    };
    std::priority_queue<OpenNode, std::vector<OpenNode>, MinScore> open;
    std::unordered_map<std::uint32_t, float> cost_so_far;
    std::unordered_map<std::uint32_t, std::uint32_t> came_from;
    cost_so_far[start_room] = 0.0f;
    open.push({heuristic(start_room, target_room), start_room});

    // A* is O((V+E) log V) with the binary heap and O(V+E) auxiliary storage.
    while (!open.empty()) {
        const OpenNode current = open.top();
        open.pop();
        if (current.id == target_room) break;
        const auto edges = bunker_graph.find(current.id);
        if (edges == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : edges->second) {
            if (!std::isfinite(edge.weight)) continue;
            const float candidate = cost_so_far[current.id] + edge.weight;
            const auto known = cost_so_far.find(edge.to_room_id);
            if (known == cost_so_far.end() || candidate < known->second) {
                cost_so_far[edge.to_room_id] = candidate;
                came_from[edge.to_room_id] = current.id;
                open.push({candidate + heuristic(edge.to_room_id, target_room), edge.to_room_id});
            }
        }
    }
    if (came_from.find(target_room) == came_from.end()) return {};

    std::vector<std::uint32_t> path;
    for (std::uint32_t cursor = target_room; cursor != start_room; cursor = came_from.at(cursor)) {
        path.push_back(cursor);
    }
    path.push_back(start_room);
    std::reverse(path.begin(), path.end());
    return path;
}

float GameState::heuristic(std::uint32_t from_room, std::uint32_t to_room) const {
    const auto from = rooms_.find(from_room);
    const auto to = rooms_.find(to_room);
    if (from == rooms_.end() || to == rooms_.end()) return 0.0f;
    return distance_between(from->second, to->second);
}

void GameState::set_corridor_state(std::uint32_t from_room, std::uint32_t to_room,
                                   bool collapsed, bool frozen, bool breached) {
    auto update_edge = [&](std::uint32_t from, std::uint32_t to) {
        auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) return;
        for (HallwayEdge& edge : found->second) {
            if (edge.to_room_id == to) {
                edge.collapsed = collapsed;
                edge.frozen = frozen;
                edge.zombie_breach = breached;
                edge.recalculate_weight();
            }
        }
    };
    update_edge(from_room, to_room);
    update_edge(to_room, from_room);
    route_path_ = find_shortest_path(1, route_target_id_);
}

void GameState::spread_zombie_pressure() {
    std::unordered_map<std::uint32_t, float> pressure_delta;
    for (std::uint32_t room_id : room_order_) {
        const auto room = rooms_.find(room_id);
        if (room == rooms_.end() || room->second.zombie_pressure < 0.04f) continue;
        const auto edges = bunker_graph.find(room_id);
        if (edges == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : edges->second) {
            if (!std::isfinite(edge.weight)) continue;
            pressure_delta[edge.to_room_id] += room->second.zombie_pressure * 0.055f;
        }
    }
    for (const auto& change : pressure_delta) {
        auto room = rooms_.find(change.first);
        if (room == rooms_.end()) continue;
        // Cap the incoming pressure to prevent runaway escalation from multiple sources.
        const float incoming = std::min(change.second, 0.12f);
        room->second.zombie_pressure = clamp01(room->second.zombie_pressure + incoming);
        room->second.environmental_hazard = std::min(1.0f,
            room->second.environmental_hazard + incoming * 0.12f);
    }

    const auto gate = rooms_.find(6);
    if (gate != rooms_.end() && gate->second.zombie_pressure >= 0.84f) {
        set_corridor_state(4, 6, false, false, true);
    }

    for (std::uint32_t room_id : room_order_) {
        const auto room = rooms_.find(room_id);
        if (room == rooms_.end() || room->second.zombie_pressure < 0.52f) continue;
        bool scheduled = false;
        for (const ActiveTask& task : active_tasks_) {
            if (task.kind == TaskKind::Defend && task.target_room_id == room_id) scheduled = true;
        }
        auto pending = emergency_tasks_;
        while (!pending.empty()) {
            if (pending.top().kind == TaskKind::Defend && pending.top().target_room_id == room_id) scheduled = true;
            pending.pop();
        }
        if (!scheduled) {
            add_emergency_task("Hold the " + room->second.name, TaskKind::Defend,
                               room_id, 3.2f + room->second.zombie_pressure, 19.0f);
            recent_event_ = "Movement in " + room->second.name + ". A defense team is needed.";
        }
    }
}

void GameState::trigger_daily_event() {
    if (day_ < 3) return;
    std::uniform_real_distribution<float> chance(0.0f, 1.0f);
    if (chance(random_) > 0.31f) return;
    std::uniform_int_distribution<int> choice(0, 2);
    switch (choice(random_)) {
        case 0: {
            if (SystemNode* relay = find_system(5)) relay->apply_damage(18.0f);
            rooms_[5].environmental_hazard = std::min(1.0f, rooms_[5].environmental_hazard + 0.20f);
            add_emergency_task("Contain an electrical fire", TaskKind::Fire, 5, 4.0f, 17.0f);
            recent_event_ = "ELECTRICAL FIRE — smoke is crawling through the workshop.";
            break;
        }
        case 1: {
            set_corridor_state(4, 6, false, false, true);
            add_emergency_task("Brace the breached lower hall", TaskKind::Breach, 6, 4.4f, 21.0f);
            recent_event_ = "HULL BREACH — the lower hall is no longer a safe route.";
            break;
        }
        default: {
            rooms_[6].zombie_pressure = std::min(1.0f, rooms_[6].zombie_pressure + 0.28f);
            add_emergency_task("Defend the surface gate", TaskKind::Defend, 6, 4.2f, 18.0f);
            recent_event_ = "CONTACT AT THE SURFACE GATE — assign a defense team.";
            break;
        }
    }
}

void GameState::progress_tasks(float delta_seconds) {
    std::vector<std::uint32_t> completed_ids;
    std::vector<std::pair<ActiveTask, bool>> failed_tasks;
    for (ActiveTask& task : active_tasks_) {
        auto worker_it = inmates_.find(task.inmate_id);
        if (worker_it == inmates_.end()) {
            failed_tasks.emplace_back(task, true);
            completed_ids.push_back(task.id);
            continue;
        }
        Inmate& worker = worker_it->second;
        const auto room_it = rooms_.find(task.target_room_id);
        const float hazard = room_it == rooms_.end() ? 0.0f : room_it->second.environmental_hazard;
        const float zombies = room_it == rooms_.end() ? 0.0f : room_it->second.zombie_pressure;
        task.progress += delta_seconds;
        worker.fatigue = std::min(100.0f, worker.fatigue + delta_seconds * (0.13f + hazard * 0.07f));
        worker.panic = std::min(100.0f, worker.panic + delta_seconds * (hazard * 0.08f + zombies * 0.11f));
        if (worker.health <= 0.0f || worker.panic >= 96.0f) {
            failed_tasks.emplace_back(task, worker.panic >= 96.0f);
            completed_ids.push_back(task.id);
        } else if (task.progress >= task.duration_seconds) {
            completed_ids.push_back(task.id);
            complete_task(task);
        }
    }
    for (const auto& failed : failed_tasks) fail_task(failed.first, failed.second);
    if (!completed_ids.empty()) {
        active_tasks_.erase(std::remove_if(active_tasks_.begin(), active_tasks_.end(),
            [&completed_ids](const ActiveTask& task) {
                return std::find(completed_ids.begin(), completed_ids.end(), task.id) != completed_ids.end();
            }), active_tasks_.end());
    }
}

void GameState::complete_task(const ActiveTask& task) {
    auto worker_it = inmates_.find(task.inmate_id);
    if (worker_it != inmates_.end()) {
        Inmate& worker = worker_it->second;
        worker.status = InmateStatus::Idle;
        worker.assigned_task.clear();
        worker.fatigue = std::min(100.0f, worker.fatigue + 5.0f);
        worker.room_id = task.external_route ? 1 : task.target_room_id;
        worker.panic = std::max(0.0f, worker.panic - 7.0f);
    }

    switch (task.kind) {
        case TaskKind::Harvest:
            food_ = std::min(100.0f, food_ + 12.0f);
            recent_event_ = "Harvest secured. The stores rise by twelve.";
            break;
        case TaskKind::Scavenge: {
            const auto room = rooms_.find(task.target_room_id);
            const float risk = room == rooms_.end() ? 0.5f : room->second.environmental_hazard + room->second.zombie_pressure;
            const float survival_chance = clamp_range(0.86f - risk * 0.52f, 0.12f, 0.88f);
            std::uniform_real_distribution<float> roll(0.0f, 1.0f);
            if (roll(random_) <= survival_chance) {
                food_ = std::min(100.0f, food_ + 17.0f);
                water_ = std::min(100.0f, water_ + 13.0f);
                recent_event_ = "Scavenge team returned with food and sealed water.";
            } else {
                if (worker_it != inmates_.end()) {
                    worker_it->second.health = std::max(0.0f, worker_it->second.health - 22.0f);
                    worker_it->second.panic = std::min(100.0f, worker_it->second.panic + 28.0f);
                    if (worker_it->second.health <= 0.0f) worker_it->second.status = InmateStatus::Dead;
                }
                add_emergency_task("Recover the lost surface cache", TaskKind::Defend, 7, 4.8f, 22.0f);
                recent_event_ = "The surface run went bad. One worker is hurt; the cache remains out there.";
            }
            break;
        }
        case TaskKind::Repair:
        case TaskKind::RestorePower: {
            // Repair targets a room-based system; RestorePower targets the main generator.
            std::uint32_t system_id = task.kind == TaskKind::RestorePower ? 1u : task.target_room_id;
            SystemNode* system = find_system(system_id);
            if (!system && task.kind == TaskKind::Repair) {
                // If no system found at the room, fall back to the generator.
                system = find_system(1);
            }
            if (system) {
                system->health = std::min(system->max_health, system->health + 28.0f);
                system->enabled_by_design = true;
                system->update_state_recursive();
            }
            power_percent_ = std::min(100.0f, power_percent_ + 8.0f);
            recent_event_ = task.kind == TaskKind::RestorePower
                ? "Main generator restarted. Power is returning."
                : "Repairs complete. The system is holding.";
            break;
        }
        case TaskKind::Clean: {
            auto room = rooms_.find(task.target_room_id);
            if (room != rooms_.end()) room->second.environmental_hazard = std::max(0.02f, room->second.environmental_hazard - 0.18f);
            recent_event_ = "Air filters cleaned. The corridor clears a little.";
            break;
        }
        case TaskKind::Fire: {
            auto room = rooms_.find(task.target_room_id);
            if (room != rooms_.end()) room->second.environmental_hazard = std::max(0.08f, room->second.environmental_hazard - 0.35f);
            if (SystemNode* relay = find_system(5)) {
                relay->health = std::min(relay->max_health, relay->health + 18.0f);
                relay->enabled_by_design = true;
                relay->update_state_recursive();
            }
            recent_event_ = "Fire contained. The workshop is still standing.";
            break;
        }
        case TaskKind::Breach: {
            set_corridor_state(4, 6, false, false, false);
            const auto room = rooms_.find(task.target_room_id);
            if (room != rooms_.end()) {
                room->second.environmental_hazard = std::max(0.10f, room->second.environmental_hazard - 0.20f);
                room->second.zombie_pressure = std::max(0.0f, room->second.zombie_pressure - 0.16f);
            }
            recent_event_ = "The breach is sealed. That route is open again—for now.";
            break;
        }
        case TaskKind::Defend: {
            const auto room = rooms_.find(task.target_room_id);
            if (room != rooms_.end()) {
                room->second.zombie_pressure = std::max(0.0f, room->second.zombie_pressure - 0.38f);
                room->second.environmental_hazard = std::max(0.05f, room->second.environmental_hazard - 0.08f);
            }
            recent_event_ = "Defense team bought the bunker another quiet hour.";
            break;
        }
    }
}

void GameState::fail_task(const ActiveTask& task, bool panic_failure) {
    auto worker_it = inmates_.find(task.inmate_id);
    if (worker_it != inmates_.end()) {
        Inmate& worker = worker_it->second;
        if (worker.health <= 0.0f) {
            worker.status = InmateStatus::Dead;
            worker.assigned_task.clear();
        } else if (panic_failure) {
            worker.status = InmateStatus::Panicked;
            worker.assigned_task.clear();
            worker.panic = std::min(100.0f, worker.panic + 18.0f);
        } else {
            worker.status = InmateStatus::Idle;
            worker.assigned_task.clear();
        }
    }
    add_task_to_emergency(task, 1.5f);
    recent_event_ = panic_failure
        ? "An inmate panicked mid-task. The emergency has escalated."
        : "A task was abandoned after an inmate was lost. The emergency has escalated.";
}

void GameState::add_task_to_emergency(const ActiveTask& task, float severity_increase) {
    EmergencyTask emergency;
    emergency.id = next_task_id_++;
    emergency.name = task.name;
    emergency.kind = task.kind;
    emergency.target_room_id = task.target_room_id;
    emergency.severity = std::max(1.0f, task.priority / 10.0f) + severity_increase;
    emergency.assigned_inmate_fatigue = least_free_inmate_fatigue();
    const auto room = rooms_.find(task.target_room_id);
    emergency.proximity_penalty = room == rooms_.end() ? 0.0f : room->second.environmental_hazard * 2.0f;
    emergency.duration_seconds = std::max(10.0f, task.duration_seconds * 0.75f);
    emergency.recalculate_priority();
    emergency_tasks_.push(std::move(emergency));
}

void GameState::update_inmate_condition(float, float) {
    for (auto& entry : inmates_) {
        Inmate& inmate = entry.second;
        if (inmate.status == InmateStatus::Dead) continue;
        if (food_ < 16.0f) {
            inmate.health = std::max(0.0f, inmate.health - (food_ < 5.0f ? 4.0f : 1.3f));
            inmate.panic = std::min(100.0f, inmate.panic + (food_ < 5.0f ? 11.0f : 4.0f));
        }
        if (water_ < 16.0f) {
            inmate.health = std::max(0.0f, inmate.health - (water_ < 5.0f ? 5.0f : 1.7f));
            inmate.panic = std::min(100.0f, inmate.panic + (water_ < 5.0f ? 12.0f : 4.5f));
        }
        if (inmate.status == InmateStatus::Idle) {
            inmate.fatigue = std::max(0.0f, inmate.fatigue - 7.0f);
            inmate.panic = std::max(0.0f, inmate.panic - 3.0f);
        }
        if (inmate.health <= 0.0f) {
            inmate.status = InmateStatus::Dead;
            inmate.assigned_task.clear();
        } else if (inmate.status == InmateStatus::Panicked && inmate.panic < 48.0f) {
            inmate.status = InmateStatus::Idle;
        }
    }
}

void GameState::push_telemetry(const DailyMetric& metric) {
    telemetry_[telemetry_head_] = metric;
    telemetry_head_ = (telemetry_head_ + 1) % kTelemetryCapacity;
    telemetry_count_ = std::min(kTelemetryCapacity, telemetry_count_ + 1);
}

SystemNode* GameState::find_system(std::uint32_t id) {
    for (SystemNode* node : system_order_) if (node && node->id == id) return node;
    return nullptr;
}

const SystemNode* GameState::find_system(std::uint32_t id) const {
    for (const SystemNode* node : flatten_systems()) if (node && node->id == id) return node;
    return nullptr;
}

std::vector<SystemNode*> GameState::flatten_systems() const { return system_order_; }

std::uint32_t GameState::day() const { return day_; }
float GameState::food() const { return food_; }
float GameState::water() const { return water_; }
float GameState::power_percent() const { return power_percent_; }

int GameState::living_inmate_count() const {
    int count = 0;
    for (const auto& entry : inmates_) if (entry.second.status != InmateStatus::Dead && entry.second.health > 0.0f) ++count;
    return count;
}

int GameState::total_inmate_count() const { return static_cast<int>(inmates_.size()); }
bool GameState::paused() const { return paused_; }
bool GameState::game_over() const { return game_over_; }
float GameState::day_progress() const { return clamp01(day_clock_ / kSecondsPerDay); }
std::string GameState::recent_event() const { return recent_event_; }

int GameState::room_count() const { return static_cast<int>(room_order_.size()); }
std::uint32_t GameState::room_id_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < room_order_.size() ? room_order_[static_cast<std::size_t>(index)] : 0u;
}
std::string GameState::room_name_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room == rooms_.end() ? std::string{} : room->second.name;
}
float GameState::room_x_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room == rooms_.end() ? 0.0f : room->second.x;
}
float GameState::room_y_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room == rooms_.end() ? 0.0f : room->second.y;
}
float GameState::room_hazard_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room == rooms_.end() ? 0.0f : room->second.environmental_hazard;
}
float GameState::room_zombie_pressure_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room == rooms_.end() ? 0.0f : room->second.zombie_pressure;
}
bool GameState::room_is_external_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room != rooms_.end() && room->second.external;
}
bool GameState::room_is_selected_at(int index) const {
    const auto room = rooms_.find(room_id_at(index));
    return room != rooms_.end() && room->second.selected;
}
int GameState::edge_count() const {
    int count = 0;
    for (std::uint32_t from : room_order_) {
        const auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : found->second) if (from < edge.to_room_id) ++count;
    }
    return count;
}
std::uint32_t GameState::edge_from_at(int index) const {
    if (index < 0) return 0u;
    int position = 0;
    for (std::uint32_t from : room_order_) {
        const auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : found->second) {
            if (from >= edge.to_room_id) continue;
            if (position++ == index) return from;
        }
    }
    return 0u;
}
std::uint32_t GameState::edge_to_at(int index) const {
    if (index < 0) return 0u;
    int position = 0;
    for (std::uint32_t from : room_order_) {
        const auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : found->second) {
            if (from >= edge.to_room_id) continue;
            if (position++ == index) return edge.to_room_id;
        }
    }
    return 0u;
}
float GameState::edge_hazard_at(int index) const {
    if (index < 0) return 0.0f;
    int position = 0;
    for (std::uint32_t from : room_order_) {
        const auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : found->second) {
            if (from >= edge.to_room_id) continue;
            if (position++ == index) return edge.environmental_hazard;
        }
    }
    return 0.0f;
}
bool GameState::edge_is_blocked_at(int index) const {
    if (index < 0) return false;
    int position = 0;
    for (std::uint32_t from : room_order_) {
        const auto found = bunker_graph.find(from);
        if (found == bunker_graph.end()) continue;
        for (const HallwayEdge& edge : found->second) {
            if (from >= edge.to_room_id) continue;
            if (position++ == index) return !std::isfinite(edge.weight);
        }
    }
    return false;
}
int GameState::route_count() const { return static_cast<int>(route_path_.size()); }
std::uint32_t GameState::route_room_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < route_path_.size() ? route_path_[static_cast<std::size_t>(index)] : 0u;
}

int GameState::system_count() const { return static_cast<int>(system_order_.size()); }
std::uint32_t GameState::system_id_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        ? system_order_[static_cast<std::size_t>(index)]->id : 0u;
}
std::string GameState::system_name_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        ? system_order_[static_cast<std::size_t>(index)]->name : std::string{};
}
int GameState::system_parent_index_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= system_order_.size()) return -1;
    SystemNode* parent = system_order_[static_cast<std::size_t>(index)]->parent;
    if (!parent) return -1;
    for (std::size_t i = 0; i < system_order_.size(); ++i) if (system_order_[i] == parent) return static_cast<int>(i);
    return -1;
}
float GameState::system_health_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        ? system_order_[static_cast<std::size_t>(index)]->health : 0.0f;
}
float GameState::system_max_health_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        ? system_order_[static_cast<std::size_t>(index)]->max_health : 0.0f;
}
float GameState::system_output_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        ? system_order_[static_cast<std::size_t>(index)]->generation_rate : 0.0f;
}
bool GameState::system_operational_at(int index) const {
    return index >= 0 && static_cast<std::size_t>(index) < system_order_.size()
        && system_order_[static_cast<std::size_t>(index)]->is_operational;
}

int GameState::inmate_count() const { return static_cast<int>(inmate_order_.size()); }
std::string GameState::inmate_name_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return {};
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? std::string{} : inmate->second.name;
}
std::string GameState::inmate_status_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return {};
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? std::string{} : status_name(inmate->second.status);
}
std::string GameState::inmate_task_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return {};
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? std::string{} : inmate->second.assigned_task;
}
float GameState::inmate_fatigue_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return 0.0f;
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? 0.0f : inmate->second.fatigue;
}
float GameState::inmate_health_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return 0.0f;
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? 0.0f : inmate->second.health;
}
float GameState::inmate_panic_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return 0.0f;
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? 0.0f : inmate->second.panic;
}
std::uint32_t GameState::inmate_room_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= inmate_order_.size()) return 0u;
    const auto inmate = inmates_.find(inmate_order_[static_cast<std::size_t>(index)]);
    return inmate == inmates_.end() ? 0u : inmate->second.room_id;
}

int GameState::task_count() const {
    return static_cast<int>(active_tasks_.size() + emergency_tasks_.size() + standard_tasks_.size());
}

TaskSnapshot GameState::queued_task_at(int index) const {
    if (index < 0) return {};
    std::size_t position = static_cast<std::size_t>(index);
    auto emergency = emergency_tasks_;
    if (position < emergency.size()) {
        while (position-- > 0) emergency.pop();
        const EmergencyTask& task = emergency.top();
        return TaskSnapshot{task.name, "Unassigned", "QUEUED", task.target_room_id,
                            0.0f, task.priority, true};
    }
    position -= emergency.size();
    auto standard = standard_tasks_;
    if (position >= standard.size()) return {};
    while (position-- > 0) standard.pop();
    const StandardTask& task = standard.front();
    const float priority = 10.0f - least_free_inmate_fatigue() * 0.5f;
    return TaskSnapshot{task.name, "Unassigned", "FIFO", task.target_room_id,
                        0.0f, priority, false};
}

TaskSnapshot GameState::task_at(int index) const {
    if (index < 0) return {};
    const std::size_t position = static_cast<std::size_t>(index);
    if (position < active_tasks_.size()) {
        const ActiveTask& task = active_tasks_[position];
        const auto worker = inmates_.find(task.inmate_id);
        const std::string worker_name = worker == inmates_.end() ? "Unassigned" : worker->second.name;
        const float progress = task.duration_seconds > 0.0f ? clamp01(task.progress / task.duration_seconds) : 0.0f;
        return TaskSnapshot{task.name, worker_name, task.emergency ? "ACTIVE · PRIORITY" : "ACTIVE",
                            task.target_room_id, progress, task.priority, task.emergency};
    }
    return queued_task_at(index - static_cast<int>(active_tasks_.size()));
}

int GameState::emergency_queue_size() const { return static_cast<int>(emergency_tasks_.size()); }
int GameState::standard_queue_size() const { return static_cast<int>(standard_tasks_.size()); }

int GameState::telemetry_count() const { return static_cast<int>(telemetry_count_); }
DailyMetric GameState::telemetry_at(int index) const {
    if (index < 0 || static_cast<std::size_t>(index) >= telemetry_count_) return {};
    const std::size_t oldest = (telemetry_head_ + kTelemetryCapacity - telemetry_count_) % kTelemetryCapacity;
    return telemetry_[(oldest + static_cast<std::size_t>(index)) % kTelemetryCapacity];
}

GameState& game() {
    static GameState instance;
    return instance;
}

} // namespace root_decay

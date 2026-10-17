#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <queue>
#include <random>
#include <string>
#include <unordered_map>
#include <vector>

namespace root_decay {

enum class ResourceType : std::uint8_t { Food, Water, Power, Air, Parts, Medicine };
enum class TaskKind : std::uint8_t { Harvest, Repair, Clean, Scavenge, Fire, Breach, Defend, RestorePower };
enum class InmateStatus : std::uint8_t { Idle, Working, Panicked, Dead };

struct SystemNode {
    std::uint32_t id{};
    std::string name;
    float health{100.0f};
    float max_health{100.0f};
    bool is_operational{true};
    float generation_rate{0.0f};
    float consumption_rate{0.0f};
    SystemNode* parent{nullptr};
    std::vector<std::unique_ptr<SystemNode>> children;

    // Additional metadata identifies a node's output and remembers its local state
    // independently from a parent's cascading operational state.
    ResourceType output_type{ResourceType::Power};
    bool enabled_by_design{true};

    void update_state_recursive();
    float calculate_total_yield(ResourceType type) const;
    void apply_damage(float damage);
};

struct RoomNode {
    std::uint32_t id{};
    std::string name;
    float x{};
    float y{};
    float environmental_hazard{};
    float zombie_pressure{};
    bool external{false};
    bool selected{false};
};

struct HallwayEdge {
    std::uint32_t to_room_id{};
    float distance{1.0f};
    float environmental_hazard{0.0f};
    float weight{1.0f};
    bool collapsed{false};
    bool frozen{false};
    bool zombie_breach{false};

    void recalculate_weight();
};

struct Inmate {
    std::uint32_t id{};
    std::string name;
    float fatigue{0.0f};
    float health{100.0f};
    float panic{0.0f};
    std::uint32_t room_id{1};
    InmateStatus status{InmateStatus::Idle};
    std::string assigned_task;
};

struct StandardTask {
    std::uint32_t id{};
    std::string name;
    TaskKind kind{TaskKind::Clean};
    std::uint32_t target_room_id{1};
    float duration_seconds{16.0f};
    bool external_route{false};
};

struct EmergencyTask {
    std::uint32_t id{};
    std::string name;
    TaskKind kind{TaskKind::Breach};
    std::uint32_t target_room_id{1};
    float severity{1.0f};
    float proximity_penalty{0.0f};
    float assigned_inmate_fatigue{0.0f};
    float priority{0.0f};
    float duration_seconds{18.0f};

    void recalculate_priority();
};

struct EmergencyTaskCompare {
    bool operator()(const EmergencyTask& left, const EmergencyTask& right) const;
};

struct ActiveTask {
    std::uint32_t id{};
    std::string name;
    TaskKind kind{TaskKind::Clean};
    std::uint32_t target_room_id{1};
    std::uint32_t inmate_id{};
    float progress{0.0f};
    float duration_seconds{16.0f};
    float priority{0.0f};
    bool emergency{false};
    bool external_route{false};
};

struct DailyMetric {
    std::uint32_t day{};
    float food{0.0f};
    float water{0.0f};
    float power{0.0f};
    float food_burn{0.0f};
    float water_burn{0.0f};
    float power_burn{0.0f};
};

struct TaskSnapshot {
    std::string name;
    std::string worker;
    std::string status;
    std::uint32_t target_room_id{};
    float progress{0.0f};
    float priority{0.0f};
    bool emergency{false};
};

class GameState {
public:
    static constexpr std::size_t kTelemetryCapacity = 30;
    static constexpr float kSecondsPerDay = 34.0f;

    GameState();
    void initialize();
    void update(float delta_seconds);
    void advance_day();
    void toggle_pause();
    void dispatch_scavenge();
    void select_room(std::uint32_t room_id);
    void set_route_target(std::uint32_t room_id);

    std::vector<std::uint32_t> find_shortest_path(std::uint32_t start_room,
                                                 std::uint32_t target_room) const;
    SystemNode* find_system(std::uint32_t id);
    const SystemNode* find_system(std::uint32_t id) const;

    std::uint32_t day() const;
    float food() const;
    float water() const;
    float power_percent() const;
    int living_inmate_count() const;
    int total_inmate_count() const;
    bool paused() const;
    bool game_over() const;
    float day_progress() const;
    std::string recent_event() const;

    int room_count() const;
    std::uint32_t room_id_at(int index) const;
    std::string room_name_at(int index) const;
    float room_x_at(int index) const;
    float room_y_at(int index) const;
    float room_hazard_at(int index) const;
    float room_zombie_pressure_at(int index) const;
    bool room_is_external_at(int index) const;
    bool room_is_selected_at(int index) const;
    int edge_count() const;
    std::uint32_t edge_from_at(int index) const;
    std::uint32_t edge_to_at(int index) const;
    float edge_hazard_at(int index) const;
    bool edge_is_blocked_at(int index) const;
    int route_count() const;
    std::uint32_t route_room_at(int index) const;

    int system_count() const;
    std::uint32_t system_id_at(int index) const;
    std::string system_name_at(int index) const;
    int system_parent_index_at(int index) const;
    float system_health_at(int index) const;
    float system_max_health_at(int index) const;
    float system_output_at(int index) const;
    bool system_operational_at(int index) const;

    int inmate_count() const;
    std::string inmate_name_at(int index) const;
    std::string inmate_status_at(int index) const;
    std::string inmate_task_at(int index) const;
    float inmate_fatigue_at(int index) const;
    float inmate_health_at(int index) const;
    float inmate_panic_at(int index) const;
    std::uint32_t inmate_room_at(int index) const;

    int task_count() const;
    TaskSnapshot task_at(int index) const;
    int emergency_queue_size() const;
    int standard_queue_size() const;

    int telemetry_count() const;
    DailyMetric telemetry_at(int index) const;

    // Required adjacency-list representation. Weights become infinity for unsafe edges.
    std::unordered_map<std::uint32_t, std::vector<HallwayEdge>> bunker_graph;

private:
    std::uint32_t day_{1};
    float food_{62.0f};
    float water_{67.0f};
    float power_percent_{82.0f};
    float day_clock_{0.0f};
    float event_clock_{0.0f};
    bool paused_{false};
    bool game_over_{false};
    std::string recent_event_;

    std::unique_ptr<SystemNode> system_root_;
    std::vector<SystemNode*> system_order_;
    std::unordered_map<std::uint32_t, Inmate> inmates_;
    std::vector<std::uint32_t> inmate_order_;
    std::queue<StandardTask> standard_tasks_;
    std::priority_queue<EmergencyTask, std::vector<EmergencyTask>, EmergencyTaskCompare> emergency_tasks_;
    std::vector<ActiveTask> active_tasks_;
    std::unordered_map<std::uint32_t, RoomNode> rooms_;
    std::vector<std::uint32_t> room_order_;
    std::vector<std::uint32_t> route_path_;
    std::uint32_t selected_room_id_{1};
    std::uint32_t route_target_id_{6};
    std::uint32_t next_task_id_{1};

    // Fixed-capacity circular storage: push/overwrite is O(1) and allocates nothing.
    std::array<DailyMetric, kTelemetryCapacity> telemetry_{};
    std::size_t telemetry_head_{0};
    std::size_t telemetry_count_{0};
    std::mt19937 random_{0xC0FFEEu};

    void build_system_tree();
    void build_bunker_graph();
    void build_inmates();
    void rebuild_system_order();
    void collect_system_nodes(SystemNode* node);
    void update_system_state();
    float total_power_consumption() const;
    void add_routine_task(const std::string& name, TaskKind kind,
                          std::uint32_t room_id, float duration, bool external = false);
    void add_emergency_task(const std::string& name, TaskKind kind,
                            std::uint32_t room_id, float severity, float duration);
    float least_free_inmate_fatigue() const;
    Inmate* select_free_inmate();
    void assign_available_workers();
    void progress_tasks(float delta_seconds);
    void complete_task(const ActiveTask& task);
    void fail_task(const ActiveTask& task, bool panic_failure);
    void add_task_to_emergency(const ActiveTask& task, float severity_increase);
    void spread_zombie_pressure();
    void trigger_daily_event();
    void update_inmate_condition(float food_burn, float water_burn);
    void push_telemetry(const DailyMetric& metric);
    void set_corridor_state(std::uint32_t from_room, std::uint32_t to_room,
                            bool collapsed, bool frozen, bool breached);
    float heuristic(std::uint32_t from_room, std::uint32_t to_room) const;
    std::vector<SystemNode*> flatten_systems() const;
    TaskSnapshot queued_task_at(int index) const;
};

GameState& game();

} // namespace root_decay

#include "core.hpp"

#include <algorithm>
#include <string>

#include <emscripten.h>
#include <emscripten/bind.h>

namespace {
using root_decay::game;

double last_frame_ms = 0.0;

int get_day() { return static_cast<int>(game().day()); }
float get_food() { return game().food(); }
float get_water() { return game().water(); }
float get_power_percent() { return game().power_percent(); }
int get_living_inmates() { return game().living_inmate_count(); }
int get_total_inmates() { return game().total_inmate_count(); }
bool get_paused() { return game().paused(); }
bool get_game_over() { return game().game_over(); }
float get_day_progress() { return game().day_progress(); }
std::string get_recent_event() { return game().recent_event(); }

int get_room_count() { return game().room_count(); }
int get_room_id(int index) { return static_cast<int>(game().room_id_at(index)); }
std::string get_room_name(int index) { return game().room_name_at(index); }
float get_room_x(int index) { return game().room_x_at(index); }
float get_room_y(int index) { return game().room_y_at(index); }
float get_room_hazard(int index) { return game().room_hazard_at(index); }
float get_room_zombie_pressure(int index) { return game().room_zombie_pressure_at(index); }
bool get_room_external(int index) { return game().room_is_external_at(index); }
bool get_room_selected(int index) { return game().room_is_selected_at(index); }
int get_edge_count() { return game().edge_count(); }
int get_edge_from(int index) { return static_cast<int>(game().edge_from_at(index)); }
int get_edge_to(int index) { return static_cast<int>(game().edge_to_at(index)); }
float get_edge_hazard(int index) { return game().edge_hazard_at(index); }
bool get_edge_blocked(int index) { return game().edge_is_blocked_at(index); }

int get_route_count() { return game().route_count(); }
int get_route_room(int index) { return static_cast<int>(game().route_room_at(index)); }

int get_system_count() { return game().system_count(); }
int get_system_id(int index) { return static_cast<int>(game().system_id_at(index)); }
std::string get_system_name(int index) { return game().system_name_at(index); }
int get_system_parent_index(int index) { return game().system_parent_index_at(index); }
float get_system_health(int index) { return game().system_health_at(index); }
float get_system_max_health(int index) { return game().system_max_health_at(index); }
float get_system_output(int index) { return game().system_output_at(index); }
bool get_system_operational(int index) { return game().system_operational_at(index); }

int get_inmate_count() { return game().inmate_count(); }
std::string get_inmate_name(int index) { return game().inmate_name_at(index); }
std::string get_inmate_status(int index) { return game().inmate_status_at(index); }
std::string get_inmate_task(int index) { return game().inmate_task_at(index); }
float get_inmate_fatigue(int index) { return game().inmate_fatigue_at(index); }
float get_inmate_health(int index) { return game().inmate_health_at(index); }
float get_inmate_panic(int index) { return game().inmate_panic_at(index); }
int get_inmate_room(int index) { return static_cast<int>(game().inmate_room_at(index)); }

int get_task_count() { return game().task_count(); }
std::string get_task_name(int index) { return game().task_at(index).name; }
std::string get_task_worker(int index) { return game().task_at(index).worker; }
std::string get_task_status(int index) { return game().task_at(index).status; }
int get_task_room(int index) { return static_cast<int>(game().task_at(index).target_room_id); }
float get_task_progress(int index) { return game().task_at(index).progress; }
float get_task_priority(int index) { return game().task_at(index).priority; }
bool get_task_emergency(int index) { return game().task_at(index).emergency; }
int get_emergency_queue_size() { return game().emergency_queue_size(); }
int get_standard_queue_size() { return game().standard_queue_size(); }

int get_telemetry_count() { return game().telemetry_count(); }
int get_metric_day(int index) { return static_cast<int>(game().telemetry_at(index).day); }
float get_metric_food(int index) { return game().telemetry_at(index).food; }
float get_metric_water(int index) { return game().telemetry_at(index).water; }
float get_metric_power(int index) { return game().telemetry_at(index).power; }
float get_metric_food_burn(int index) { return game().telemetry_at(index).food_burn; }
float get_metric_water_burn(int index) { return game().telemetry_at(index).water_burn; }
float get_metric_power_burn(int index) { return game().telemetry_at(index).power_burn; }

void advance_day() { game().advance_day(); }
void toggle_pause() { game().toggle_pause(); }
void dispatch_scavenge() { game().dispatch_scavenge(); }
void select_room(int room_id) { game().select_room(static_cast<std::uint32_t>(std::max(0, room_id))); }

void update_frame() {
    const double now = emscripten_get_now();
    const float delta_seconds = last_frame_ms <= 0.0
        ? (1.0f / 60.0f)
        : static_cast<float>(std::min((now - last_frame_ms) / 1000.0, 0.05));
    last_frame_ms = now;
    game().update(delta_seconds);
    EM_ASM({ if (typeof window.rootDecayOnFrame === 'function') window.rootDecayOnFrame(); });
}

} // namespace

EMSCRIPTEN_BINDINGS(root_decay_api) {
    emscripten::function("getDay", &get_day);
    emscripten::function("getFood", &get_food);
    emscripten::function("getWater", &get_water);
    emscripten::function("getPowerPercent", &get_power_percent);
    emscripten::function("getLivingInmates", &get_living_inmates);
    emscripten::function("getTotalInmates", &get_total_inmates);
    emscripten::function("getPaused", &get_paused);
    emscripten::function("getGameOver", &get_game_over);
    emscripten::function("getDayProgress", &get_day_progress);
    emscripten::function("getRecentEvent", &get_recent_event);

    emscripten::function("getRoomCount", &get_room_count);
    emscripten::function("getRoomId", &get_room_id);
    emscripten::function("getRoomName", &get_room_name);
    emscripten::function("getRoomX", &get_room_x);
    emscripten::function("getRoomY", &get_room_y);
    emscripten::function("getRoomHazard", &get_room_hazard);
    emscripten::function("getRoomZombiePressure", &get_room_zombie_pressure);
    emscripten::function("getRoomExternal", &get_room_external);
    emscripten::function("getRoomSelected", &get_room_selected);
    emscripten::function("getEdgeCount", &get_edge_count);
    emscripten::function("getEdgeFrom", &get_edge_from);
    emscripten::function("getEdgeTo", &get_edge_to);
    emscripten::function("getEdgeHazard", &get_edge_hazard);
    emscripten::function("getEdgeBlocked", &get_edge_blocked);
    emscripten::function("getRouteCount", &get_route_count);
    emscripten::function("getRouteRoom", &get_route_room);

    emscripten::function("getSystemCount", &get_system_count);
    emscripten::function("getSystemId", &get_system_id);
    emscripten::function("getSystemName", &get_system_name);
    emscripten::function("getSystemParentIndex", &get_system_parent_index);
    emscripten::function("getSystemHealth", &get_system_health);
    emscripten::function("getSystemMaxHealth", &get_system_max_health);
    emscripten::function("getSystemOutput", &get_system_output);
    emscripten::function("getSystemOperational", &get_system_operational);

    emscripten::function("getInmateCount", &get_inmate_count);
    emscripten::function("getInmateName", &get_inmate_name);
    emscripten::function("getInmateStatus", &get_inmate_status);
    emscripten::function("getInmateTask", &get_inmate_task);
    emscripten::function("getInmateFatigue", &get_inmate_fatigue);
    emscripten::function("getInmateHealth", &get_inmate_health);
    emscripten::function("getInmatePanic", &get_inmate_panic);
    emscripten::function("getInmateRoom", &get_inmate_room);

    emscripten::function("getTaskCount", &get_task_count);
    emscripten::function("getTaskName", &get_task_name);
    emscripten::function("getTaskWorker", &get_task_worker);
    emscripten::function("getTaskStatus", &get_task_status);
    emscripten::function("getTaskRoom", &get_task_room);
    emscripten::function("getTaskProgress", &get_task_progress);
    emscripten::function("getTaskPriority", &get_task_priority);
    emscripten::function("getTaskEmergency", &get_task_emergency);
    emscripten::function("getEmergencyQueueSize", &get_emergency_queue_size);
    emscripten::function("getStandardQueueSize", &get_standard_queue_size);

    emscripten::function("getTelemetryCount", &get_telemetry_count);
    emscripten::function("getMetricDay", &get_metric_day);
    emscripten::function("getMetricFood", &get_metric_food);
    emscripten::function("getMetricWater", &get_metric_water);
    emscripten::function("getMetricPower", &get_metric_power);
    emscripten::function("getMetricFoodBurn", &get_metric_food_burn);
    emscripten::function("getMetricWaterBurn", &get_metric_water_burn);
    emscripten::function("getMetricPowerBurn", &get_metric_power_burn);

    emscripten::function("advanceDay", &advance_day);
    emscripten::function("togglePause", &toggle_pause);
    emscripten::function("dispatchScavenge", &dispatch_scavenge);
    emscripten::function("selectRoom", &select_room);
}

int main() {
    game().initialize();
    last_frame_ms = emscripten_get_now();
    emscripten_set_main_loop(update_frame, 60, 1);
    return 0;
}

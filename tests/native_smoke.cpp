#include "core.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

int main() {
    using namespace root_decay;

    GameState state;
    state.initialize();
    assert(state.day() == 1);
    assert(state.living_inmate_count() == 8);
    assert(state.room_count() == 7);
    assert(state.system_count() == 7);

    const std::vector<std::uint32_t> route = state.find_shortest_path(1, 7);
    assert(route.size() >= 3);
    assert(route.front() == 1);
    assert(route.back() == 7);

    EmergencyTask priority_check;
    priority_check.severity = 3.0f;
    priority_check.proximity_penalty = 7.0f;
    priority_check.assigned_inmate_fatigue = 10.0f;
    priority_check.recalculate_priority();
    assert(std::fabs(priority_check.priority - 32.0f) < 0.001f);

    SystemNode* generator = state.find_system(1);
    SystemNode* hydroponics = state.find_system(2);
    SystemNode* scrubbers = state.find_system(4);
    assert(generator && hydroponics && scrubbers);
    generator->apply_damage(1000.0f);
    assert(!generator->is_operational);
    assert(!hydroponics->is_operational);
    assert(!scrubbers->is_operational);
    assert(state.find_system(0)->calculate_total_yield(ResourceType::Food) == 0.0f);

    generator->health = generator->max_health;
    generator->enabled_by_design = true;
    generator->update_state_recursive();
    assert(generator->is_operational);
    assert(hydroponics->is_operational);
    assert(scrubbers->is_operational);

    for (int i = 0; i < 35; ++i) state.advance_day();
    assert(state.day() == 36);
    assert(state.telemetry_count() == static_cast<int>(GameState::kTelemetryCapacity));
    assert(state.telemetry_at(0).day == 7);
    assert(state.telemetry_at(29).day == 36);
    assert(state.food() >= 0.0f && state.food() <= 100.0f);
    assert(state.water() >= 0.0f && state.water() <= 100.0f);
    assert(state.power_percent() >= 0.0f && state.power_percent() <= 100.0f);

    std::cout << "Root & Decay native smoke test passed: day " << state.day()
              << ", living inmates " << state.living_inmate_count()
              << ", telemetry samples " << state.telemetry_count() << '\n';
    return 0;
}

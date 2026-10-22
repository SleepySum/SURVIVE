cmake_minimum_required(VERSION 3.18)
project(root_decay LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(EMSCRIPTEN)
    add_executable(root-decay-wasm
        src/core.cpp
        src/wasm_entry.cpp
    )
    target_include_directories(root-decay-wasm PRIVATE src)
    target_compile_options(root-decay-wasm PRIVATE -O2 -Wall -Wextra -Wpedantic)
    target_link_options(root-decay-wasm PRIVATE
        --bind
        "-sMODULARIZE=1"
        "-sEXPORT_NAME=RootDecayModule"
        "-sENVIRONMENT=web,node"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sEXIT_RUNTIME=0"
    )
    set_target_properties(root-decay-wasm PROPERTIES
        OUTPUT_NAME "root-decay"
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/public"
    )
else()
    add_executable(root-decay-native
        src/core.cpp
        tests/native_smoke.cpp
    )
    target_include_directories(root-decay-native PRIVATE src)
    target_compile_options(root-decay-native PRIVATE -Wall -Wextra -Wpedantic)
endif()

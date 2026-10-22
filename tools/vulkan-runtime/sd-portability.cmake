# SPDX-License-Identifier: GPL-3.0-or-later
# libstdc++ eagerly instantiates pair<PickleValue,PickleValue> while PickleValue
# is incomplete. Define its special members after the complete class, preserving
# the upstream parser and ownership behavior. Keep the immutable checkout intact.
set(pickle_source "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src/model_io/pickle_io.cpp")
file(READ "${pickle_source}" pickle_content)
set(pickle_start "struct PickleValue {")
set(pickle_end "    PickleTensorInfo tensor;\n};")
string(FIND "${pickle_content}" "${pickle_start}" pickle_start_at)
string(FIND "${pickle_content}" "${pickle_end}" pickle_end_at)
if(pickle_start_at LESS 0 OR pickle_end_at LESS 0)
    message(FATAL_ERROR "Pinned SD PickleValue layout changed; review the portability patch")
endif()
string(REPLACE "${pickle_start}" "${pickle_start}
    PickleValue();
    ~PickleValue();
    PickleValue(const PickleValue&);
    PickleValue(PickleValue&&) noexcept;
    PickleValue& operator=(const PickleValue&);
    PickleValue& operator=(PickleValue&&) noexcept;" pickle_content "${pickle_content}")
string(REPLACE "${pickle_end}" "${pickle_end}
PickleValue::PickleValue() = default;
PickleValue::~PickleValue() = default;
PickleValue::PickleValue(const PickleValue&) = default;
PickleValue::PickleValue(PickleValue&&) noexcept = default;
PickleValue& PickleValue::operator=(const PickleValue&) = default;
PickleValue& PickleValue::operator=(PickleValue&&) noexcept = default;" pickle_content "${pickle_content}")
set(patched_pickle "${CMAKE_CURRENT_BINARY_DIR}/sd-patches/pickle_io.cpp")
if(EXISTS "${patched_pickle}")
    file(READ "${patched_pickle}" previous_pickle)
else()
    set(previous_pickle "")
endif()
if(NOT previous_pickle STREQUAL pickle_content)
    file(WRITE "${patched_pickle}" "${pickle_content}")
endif()
get_target_property(sd_sources stable-diffusion SOURCES)
list(REMOVE_ITEM sd_sources "${pickle_source}")
list(APPEND sd_sources "${patched_pickle}")
set_property(TARGET stable-diffusion PROPERTY SOURCES "${sd_sources}")
set_source_files_properties("${patched_pickle}"
    DIRECTORY "${PROS_ROOT}/.deps/stable-diffusion-vulkan"
    PROPERTIES INCLUDE_DIRECTORIES
    "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src/model_io")

# On PS5 the Vulkan memory-budget query can report a free-byte sentinel larger than
# the heap total. Use the known heap total, then subtract the model manager's tracked
# resident allocations below, instead of treating all capacity as exhausted.
set(model_manager_source "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src/model_manager.cpp")
file(READ "${model_manager_source}" model_manager_content)
set(invalid_budget_check [==[        if (total_bytes > 0 && free_bytes > total_bytes && sd_backend_is(backend, "Vulkan")) {
            if (ggml_backend_dev_type(device) != GGML_BACKEND_DEVICE_TYPE_IGPU) {
                return size_t{0};
            }]==])
set(valid_budget_check [==[        if (total_bytes > 0 && free_bytes > total_bytes && sd_backend_is(backend, "Vulkan")) {
            // PS5: the radv user driver may report a wrapped budget on any device type;]==])
string(FIND "${model_manager_content}" "${valid_budget_check}" model_manager_patch_at)
if(model_manager_patch_at LESS 0)
    string(FIND "${model_manager_content}" "${invalid_budget_check}" model_manager_patch_at)
    if(model_manager_patch_at LESS 0)
        message(FATAL_ERROR "Pinned SD Vulkan memory-budget logic changed; review the PS5 fallback patch")
    endif()
    string(REPLACE "${invalid_budget_check}" "${valid_budget_check}"
        model_manager_content "${model_manager_content}")
endif()
set(patched_model_manager "${CMAKE_CURRENT_BINARY_DIR}/sd-patches/model_manager.cpp")
if(EXISTS "${patched_model_manager}")
    file(READ "${patched_model_manager}" previous_model_manager)
else()
    set(previous_model_manager "")
endif()
if(NOT previous_model_manager STREQUAL model_manager_content)
    file(WRITE "${patched_model_manager}" "${model_manager_content}")
endif()
get_target_property(sd_sources stable-diffusion SOURCES)
list(REMOVE_ITEM sd_sources "${model_manager_source}")
list(APPEND sd_sources "${patched_model_manager}")
set_property(TARGET stable-diffusion PROPERTY SOURCES "${sd_sources}")
set_source_files_properties("${patched_model_manager}"
    DIRECTORY "${PROS_ROOT}/.deps/stable-diffusion-vulkan"
    PROPERTIES INCLUDE_DIRECTORIES
    "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src")

# Upstream returns std::u8string (basic_string<char8_t>) from std::string functions in
# resolve_index_shard_path; the pinned toolchain rejects the implicit conversion.
# Rebuild the bytes explicitly through the iterator-range constructor.
set(safetensors_io_source "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src/model_io/safetensors_io.cpp")
file(READ "${safetensors_io_source}" safetensors_io_content)
set(invalid_u8_return [==[        return shard_fs_path.lexically_normal().u8string();
    }
    return (fs::u8path(index_path).parent_path() / shard_fs_path).lexically_normal().u8string();]==])
set(valid_u8_return [==[        return std::string(shard_fs_path.lexically_normal().u8string().begin(),
                                   shard_fs_path.lexically_normal().u8string().end());
    }
    return std::string((fs::u8path(index_path).parent_path() / shard_fs_path).lexically_normal().u8string().begin(),
                       (fs::u8path(index_path).parent_path() / shard_fs_path).lexically_normal().u8string().end());]==])
string(FIND "${safetensors_io_content}" "${valid_u8_return}" safetensors_io_patch_at)
if(safetensors_io_patch_at LESS 0)
    string(FIND "${safetensors_io_content}" "${invalid_u8_return}" safetensors_io_patch_at)
    if(safetensors_io_patch_at LESS 0)
        message(FATAL_ERROR "Pinned SD safetensors shard-path helper changed; review the char8_t patch")
    endif()
    string(REPLACE "${invalid_u8_return}" "${valid_u8_return}" safetensors_io_content "${safetensors_io_content}")
endif()
set(patched_safetensors_io "${CMAKE_CURRENT_BINARY_DIR}/sd-patches/safetensors_io.cpp")
if(EXISTS "${patched_safetensors_io}")
    file(READ "${patched_safetensors_io}" previous_safetensors_io)
else()
    set(previous_safetensors_io "")
endif()
if(NOT previous_safetensors_io STREQUAL safetensors_io_content)
    file(WRITE "${patched_safetensors_io}" "${safetensors_io_content}")
endif()
get_target_property(sd_sources_io stable-diffusion SOURCES)
list(REMOVE_ITEM sd_sources_io "${safetensors_io_source}")
list(APPEND sd_sources_io "${patched_safetensors_io}")
set_property(TARGET stable-diffusion PROPERTY SOURCES "${sd_sources_io}")
set_source_files_properties("${patched_safetensors_io}"
    DIRECTORY "${PROS_ROOT}/.deps/stable-diffusion-vulkan"
    PROPERTIES INCLUDE_DIRECTORIES
    "${PROS_ROOT}/.deps/stable-diffusion-vulkan/src;${PROS_ROOT}/.deps/stable-diffusion-vulkan/src/model_io")

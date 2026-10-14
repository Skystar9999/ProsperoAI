// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "generated_voice_catalog.hpp"
#include "runtime_voice_catalog.hpp"
#include "generation_limits.hpp"
#include "chatterbox_languages.hpp"
#include <cstdio>
#include <cstring>
#include <mutex>
#include <string>
#ifndef PROSPERO_SETTINGS_PATH
#define PROSPERO_SETTINGS_PATH "/download0/prosperoai.cfg"
#endif
namespace prospero_settings {
struct Runtime { unsigned context = 0, output_limit = 0, kv = 0; bool thinking = false, web_search = false; unsigned idle_unload_minutes = 5, web_search_timeout_seconds = 15; unsigned kokoro_voice = 0, chatterbox_voice = 0, chatterbox_language = 0; std::string librey_url; };
inline std::mutex mutex;
inline bool valid_context(unsigned n) {
    return n == 0 || n == 4096 || n == 8192 || n == 16384 || n == 32768 || n == 65536 ||
           n == 131072 || n == 262144;
}
inline bool valid_idle_unload_minutes(unsigned n) {
    return n == 1 || n == 2 || n == 5 || n == 10 || n == 30 || n == 60;
}
inline bool valid_web_search_timeout(unsigned n) { return n >= 3 && n <= 30; }
inline bool valid_librey_url(const std::string &url) {
    if (url.empty() || url.size() > 192 || url.find("https://") != 0) return false;
    if (url.size() <= 8 || url.find_first_of("?#@\\\r\n\t ") != std::string::npos) return false;
    for (unsigned char c : url) if (c < 0x21 || c > 0x7e) return false;
    const auto path = url.find('/', 8);
    const auto authority_end = path == std::string::npos ? url.size() : path;
    if (authority_end == 8) return false;
    return path == std::string::npos || path + 1 == url.size();
}
inline Runtime read_unlocked() {
    Runtime p;
    if (auto *f = std::fopen(PROSPERO_SETTINGS_PATH, "rb")) {
        char line[512]; unsigned v;
        while (std::fgets(line, sizeof(line), f)) {
            if (std::sscanf(line, "context=%u", &v) == 1 && valid_context(v)) p.context = v;
            else if (std::sscanf(line, "tokens=%u", &v) == 1 && prospero_generation::valid_output_limit(v)) p.output_limit = v;
            // Legacy kv= values are ignored: cache precision is automatic.
            else if (std::sscanf(line, "thinking=%u", &v) == 1) p.thinking = v != 0;
            else if (std::sscanf(line, "idle_unload_minutes=%u", &v) == 1 && valid_idle_unload_minutes(v)) p.idle_unload_minutes = v;
            else if (std::sscanf(line, "kokoro_voice=%u", &v) == 1 && v < 128) p.kokoro_voice = v;
            else if (std::sscanf(line, "chatterbox_voice=%u", &v) == 1 && v < 128) p.chatterbox_voice = v;
            else if (std::sscanf(line, "chatterbox_language=%u", &v) == 1 && prospero_language::valid_chatterbox_language(v)) p.chatterbox_language = v;
            else if (std::sscanf(line, "web_search=%u", &v) == 1) p.web_search = v != 0;
            else if (std::sscanf(line, "web_search_timeout=%u", &v) == 1 && valid_web_search_timeout(v)) p.web_search_timeout_seconds = v;
            else if (std::strncmp(line, "librey_url=", 11) == 0) { p.librey_url = line + 11; while (!p.librey_url.empty() && (p.librey_url.back() == '\n' || p.librey_url.back() == '\r')) p.librey_url.pop_back(); if (!valid_librey_url(p.librey_url)) p.librey_url.clear(); }
        }
        std::fclose(f);
    }
    return p;
}
inline Runtime get() { std::lock_guard<std::mutex> lock(mutex); return read_unlocked(); }
inline bool set_unlocked(Runtime p) {
    if (!valid_context(p.context) || !prospero_generation::valid_output_limit(p.output_limit) || p.kv != 0 || !valid_idle_unload_minutes(p.idle_unload_minutes) || p.kokoro_voice >= 128 || p.chatterbox_voice >= 128 || !prospero_language::valid_chatterbox_language(p.chatterbox_language) || !valid_web_search_timeout(p.web_search_timeout_seconds) || (!p.librey_url.empty() && !valid_librey_url(p.librey_url)) || (p.web_search && !valid_librey_url(p.librey_url))) return false;
    std::string contents;
    if (auto *f = std::fopen(PROSPERO_SETTINGS_PATH, "rb")) {
        char line[512];
        while (std::fgets(line, sizeof(line), f))
            if (std::strncmp(line, "context=", 8) && std::strncmp(line, "tokens=", 7) && std::strncmp(line, "kv=", 3) && std::strncmp(line, "thinking=", 9) && std::strncmp(line, "idle_unload_minutes=", 20) && std::strncmp(line, "kokoro_voice=", 13) && std::strncmp(line, "chatterbox_voice=", 17) && std::strncmp(line, "chatterbox_language=", 20) && std::strncmp(line, "web_search=", 11) && std::strncmp(line, "web_search_timeout=", 19) && std::strncmp(line, "librey_url=", 11)) contents += line;
        std::fclose(f);
    }
    if (!contents.empty() && contents.back() != '\n') contents += '\n';
    char fields[256]; std::snprintf(fields, sizeof(fields), "context=%u\ntokens=%u\nkv=%u\nthinking=%u\nidle_unload_minutes=%u\nkokoro_voice=%u\nchatterbox_voice=%u\nchatterbox_language=%u\nweb_search=%u\nweb_search_timeout=%u\n", p.context, p.output_limit, p.kv, p.thinking ? 1U : 0U, p.idle_unload_minutes, p.kokoro_voice, p.chatterbox_voice, p.chatterbox_language, p.web_search ? 1U : 0U, p.web_search_timeout_seconds);
    contents += fields;
    contents += "librey_url=" + p.librey_url + "\n";
    auto *f = std::fopen(PROSPERO_SETTINGS_PATH ".tmp", "wb");
    if (!f) return false;
    const bool written = std::fwrite(contents.data(), 1, contents.size(), f) == contents.size();
    const int closed = std::fclose(f);
    if (!written || closed || std::rename(PROSPERO_SETTINGS_PATH ".tmp", PROSPERO_SETTINGS_PATH)) { std::remove(PROSPERO_SETTINGS_PATH ".tmp"); return false; }
    return true;
}
inline bool set(Runtime p) { std::lock_guard<std::mutex> lock(mutex); return set_unlocked(p); }
inline const char *kv_name(unsigned n) { constexpr const char *names[] = {"auto", "f16", "q8_0", "q4_0"}; return names[n <= 3 ? n : 0]; }
}

// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <string>
#include <vector>

namespace prospero_librey {
struct Result {
    std::string title;
    std::string url;
    std::string snippet;
};

bool valid_query(const std::string &query);
bool parse_response(const std::string &json, unsigned maximum,
                    std::vector<Result> *results, std::string *error);
bool search(const std::string &base_url, const std::string &query,
            unsigned timeout_seconds, unsigned maximum,
            std::vector<Result> *results, std::string *error);
std::string prompt_context(const std::string &query, const std::vector<Result> &results);
}

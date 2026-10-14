#include "librey_search.hpp"
#include "runtime_settings.hpp"

#include <cassert>
#include <string>
#include <vector>

int main() {
    using prospero_librey::Result;
    assert(prospero_settings::valid_librey_url("https://search.example.org"));
    assert(!prospero_settings::valid_librey_url("http://search.example.org"));
    assert(!prospero_settings::valid_librey_url("https://user@search.example.org"));
    assert(prospero_librey::valid_query("local PS5 search"));
    assert(!prospero_librey::valid_query("x"));
    assert(!prospero_librey::valid_query("bad\nquery"));

    const std::string fixture = R"JSON([{"title":"One","url":"https://example.org/1","description":"First result"},
      {"title":"Bad scheme","url":"javascript:alert(1)","description":"ignore"},
      {"title":"Two","url":"https://example.org/2","description":"Second result"},
      {"title":"Three","url":"https://example.org/3","description":"Third result"},
      {"title":"Four","url":"https://example.org/4","description":"Fourth result"},
      {"title":"Five","url":"https://example.org/5","description":"Fifth result"},
      {"title":"Six","url":"https://example.org/6","description":"Sixth result"}])JSON";
    std::vector<Result> results;
    std::string error;
    assert(prospero_librey::parse_response(fixture, 5, &results, &error));
    assert(results.size() == 5);
    assert(results[0].title == "One");
    assert(results[4].title == "Five");
    const auto prompt = prospero_librey::prompt_context("test query", results);
    assert(prompt.find("untrusted data") != std::string::npos);
    assert(prompt.find("https://example.org/1") != std::string::npos);
    assert(!prospero_librey::parse_response("{}", 5, &results, &error));
    assert(error.find("unexpected") != std::string::npos);
}

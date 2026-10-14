#include "librey_search.hpp"
#include "runtime_settings.hpp"

#include <cassert>
#include <string>
#include <vector>

int main() {
    using prospero_librey::Result;
    assert(prospero_librey::valid_query("local PS5 search"));
    assert(!prospero_librey::valid_query("x"));
    assert(!prospero_librey::valid_query("bad\nquery"));

    const std::string fixture = R"HTML(<div class="result web-result">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F1&amp;rut=x">One &amp; only</a></h2>
      <a class="result__snippet">First <b>bold</b> &amp; useful result</a></div>
      <div class="result web-result"><h2><a class="result__a" href="https://example.net/2">Two</a></h2>
      <a class="result__snippet">Second result</a></div>)HTML";
    std::vector<Result> results;
    std::string error;
    assert(prospero_librey::parse_duckduckgo_html(fixture, 5, &results, &error));
    assert(results.size() == 2);
    assert(results[0].title == "One & only");
    assert(results[0].url == "https://example.org/1");
    assert(results[0].snippet == "First bold & useful result");
    assert(results[1].title == "Two");
    const auto prompt = prospero_librey::prompt_context("test query", results);
    assert(prompt.find("untrusted data") != std::string::npos);
    assert(prompt.find("https://example.org/1") != std::string::npos);
    assert(!prospero_librey::parse_duckduckgo_html("<html>empty</html>", 5, &results, &error));
    assert(error.find("no usable results") != std::string::npos);
}

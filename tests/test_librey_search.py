import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LibreYSearchTests(unittest.TestCase):
    def test_result_validation_and_prompt_format(self):
        compiler = shutil.which("clang++") or shutil.which("g++")
        if not compiler:
            self.skipTest("a C++ compiler is required")
        with tempfile.TemporaryDirectory(prefix="librey-search-") as scratch:
            binary = Path(scratch) / "librey-search-test"
            subprocess.run([
                compiler, "-std=c++20", "-O1", "-Wall", "-Wextra", "-Werror",
                "-I" + str(ROOT / "include"), "-I" + str(ROOT / ".deps/llama.cpp/vendor"),
                "-I" + str(ROOT / "vulkan"), str(ROOT / "tests/librey_search_test.cpp"),
                str(ROOT / "src/librey_search.cpp"), "-o", str(binary),
            ], check=True)
            subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    unittest.main()

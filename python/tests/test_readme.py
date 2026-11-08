# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Runs the Python example of README.md."""

import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


class Readme(unittest.TestCase):
    def test_python_example_runs(self):
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as f:
            text = f.read()
        m = re.search(r"<!-- example:python -->\n```python\n(.*?)```", text, re.S)
        self.assertIsNotNone(m)
        with tempfile.TemporaryDirectory() as d:
            script = os.path.join(d, "example.py")
            with open(script, "w", encoding="utf-8") as f:
                f.write(m.group(1))
            out = subprocess.run([sys.executable, "-I", script], cwd=ROOT, capture_output=True, text=True, check=True)
        self.assertIn("49 official rules run", out.stdout)


if __name__ == "__main__":
    unittest.main()

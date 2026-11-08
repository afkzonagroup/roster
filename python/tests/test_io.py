# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Reading registers and report packages, including hostile inputs."""

import io
import os
import tempfile
import unittest
import zipfile

from roster import read_csv_folder, read_report_package_tables, validate_register
from roster.io import RegisterReadError

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SAMPLE = os.path.join(ROOT, "test", "fixtures", "eba", "DUMMYLEI123456789012.CON_FR_DORA010100_DORA_2024-12-31_20241213174803429.zip")


class DataCopy(unittest.TestCase):
    def test_same_taxonomy_data_as_typescript(self):
        with open(os.path.join(ROOT, "src", "data", "dora-4.0.json"), "rb") as a, open(os.path.join(ROOT, "python", "src", "roster", "data", "dora-4.0.json"), "rb") as b:
            self.assertEqual(a.read(), b.read())


class Reading(unittest.TestCase):
    def test_example_register_is_clean(self):
        reg = read_csv_folder(os.path.join(ROOT, "examples", "register"))
        findings, run, not_run = validate_register(reg, reporting=True, reference_date="2025-12-31")
        self.assertEqual(findings, [])
        self.assertEqual(len(run), 49)
        self.assertTrue(any(code == "VR_71" for code, _ in not_run))

    def test_eba_sample_package(self):
        reg = read_report_package_tables(SAMPLE)
        self.assertEqual(len(reg["B_02.02"]), 2)
        findings, _r, _n = validate_register(reg)
        self.assertIn("esa.807", {f.rule for f in findings})

    def _zip(self, entries):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "p.zip")
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in entries:
                z.writestr(name, data)
        return path

    def test_hostile_packages(self):
        with self.assertRaises(RegisterReadError):
            read_report_package_tables(self._zip([("../evil.csv", "x")]))
        with self.assertRaises(RegisterReadError):
            read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "c0010\n" + "A" * 3_000_000)]))
        with self.assertRaises(RegisterReadError):
            read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "c0010\n#nil\n")]))
        reg = read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "c0010,c0020\n506700GE1G29325QX363,##1\n")]))
        self.assertEqual(reg["B_01.01"][0]["c0020"], "#1")
        # EBA filing rules, xBRL-CSV reports extra rules 2 and 3.
        with self.assertRaises(RegisterReadError):
            read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "c0010,c0020,\nA,B,\n")]))
        with self.assertRaises(RegisterReadError):
            read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "c0010,c0020\nA\n")]))
        self.assertEqual(read_report_package_tables(self._zip([("top/reports/b_01.01.csv", "\r\n")]))["B_01.01"], [])

    def test_csv_folder_errors_and_apostrophe(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "b_05.01.csv"), "w", encoding="utf-8") as f:
            f.write("c0010,c0050\nX,'=1+1\n")
        self.assertEqual(read_csv_folder(d)["B_05.01"][0]["c0050"], "=1+1")
        with open(os.path.join(d, "b_01.01.csv"), "w", encoding="utf-8") as f:
            f.write("c0010,Name\n")
        with self.assertRaises(RegisterReadError):
            read_csv_folder(d)
        os.remove(os.path.join(d, "b_01.01.csv"))
        with open(os.path.join(d, "b_01.01.csv"), "wb") as f:
            f.write(b"c0010\n\xff\n")
        with self.assertRaises(RegisterReadError):
            read_csv_folder(d)

    def test_csv_folder_does_not_follow_links(self):
        d = tempfile.mkdtemp()
        secret = os.path.join(d, "secret.txt")
        with open(secret, "w", encoding="utf-8") as f:
            f.write("c0010\nSECRET\n")
        os.symlink(secret, os.path.join(d, "b_01.01.csv"))
        self.assertNotIn("B_01.01", read_csv_folder(d))


if __name__ == "__main__":
    unittest.main()

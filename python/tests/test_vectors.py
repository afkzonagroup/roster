# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""The shared test vectors of the TypeScript package, run against the Python port."""

import json
import os
import unittest

from roster import check_euid, check_lei, read_csv_folder, validate_register

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
VECTORS = os.path.join(ROOT, "test-vectors")
EXAMPLE = os.path.join(ROOT, "examples", "register")


def apply_patch(base, patch):
    reg = {k: [dict(r) for r in v] for k, v in base.items()}
    for p in patch:
        rows = reg.setdefault(p["template"], [])
        while len(rows) <= p["row"]:
            rows.append({})
        row = rows[p["row"]]
        if p["column"] == "*copy":
            row.update(rows[int(p["value"])])
        elif p["value"] is None:
            row.pop(p["column"], None)
        else:
            row[p["column"]] = p["value"]
    return reg


class SharedVectors(unittest.TestCase):
    def test_registers(self):
        with open(os.path.join(VECTORS, "registers.json"), encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        base = read_csv_folder(EXAMPLE)
        self.assertGreater(len(cases), 300)
        for case in cases:
            o = case["options"]
            findings, _run, _not = validate_register(
                apply_patch(base, case["patch"]),
                reporting=o.get("reporting", False),
                reference_date=o.get("referenceDate"),
                include_inactive_rules=o.get("includeInactiveRules", False),
            )
            with self.subTest(case=case["name"]):
                self.assertEqual(sorted(x.key() for x in findings), case["expected"])

    def test_identifiers(self):
        with open(os.path.join(VECTORS, "identifiers.json"), encoding="utf-8") as f:
            ids = json.load(f)
        for v in ids["lei"]:
            self.assertEqual(check_lei(v["value"]), v["problem"], v["value"])
        for v in ids["euid"]:
            self.assertEqual(check_euid(v["value"]), v["valid"], v["value"])


if __name__ == "__main__":
    unittest.main()

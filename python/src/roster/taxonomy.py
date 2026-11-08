# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""The generated DORA taxonomy 4.0 data (same file as the TypeScript package)."""

import json
from importlib import resources

TAXONOMY = json.loads(resources.files("roster").joinpath("data/dora-4.0.json").read_text(encoding="utf-8"))
TEMPLATES = {t["code"]: t for t in TAXONOMY["templates"]}


def allowed_values(column):
    """Members of a column's closed list, or an empty list."""
    e = column.get("enumeration")
    return TAXONOMY["enumerations"].get(e, []) if e else []

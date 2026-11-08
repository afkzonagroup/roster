# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Roster for Python: validate a DORA register of information.

The same checks as the TypeScript package (types, closed lists, keys,
references, ITS checks and the EBA validation rules that can run offline),
validated against the same shared test vectors. Pure Python, no
dependencies, no network.

Roster by AFKzona Group - https://afkzonagroup.lt
"""

from .identifiers import check_euid, check_lei, lei_check_digits
from .io import read_csv_folder, read_report_package_tables
from .taxonomy import TAXONOMY
from .validate import Finding, validate_register

__all__ = [
    "TAXONOMY",
    "Finding",
    "check_euid",
    "check_lei",
    "lei_check_digits",
    "read_csv_folder",
    "read_report_package_tables",
    "validate_register",
]

__version__ = "0.1.0"
ATTRIBUTION = "Roster by AFKzona Group"
ATTRIBUTION_URL = "https://afkzonagroup.lt"

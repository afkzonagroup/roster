# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""LEI (ISO 17442, ISO 7064 MOD 97-10) and EUID structure checks."""

import re

LEI_PATTERN = re.compile(r"\A[A-Z0-9]{18}[0-9]{2}\Z")
EUID_PATTERN = re.compile(r"\A[A-Z]{2}[^.\s]+\.[^\s]+\Z")


def mod97(value):
    """ISO 7064 MOD 97-10 remainder; letters count as A=10 ... Z=35."""
    rem = 0
    for ch in value:
        digits = str(ord(ch) - 55) if "A" <= ch <= "Z" else ch
        for d in digits:
            rem = (rem * 10 + (ord(d) - 48)) % 97
    return rem


def check_lei(value):
    """Return None for a valid LEI, 'format' or 'checksum' otherwise."""
    if not LEI_PATTERN.match(value):
        return "format"
    return None if mod97(value) == 1 else "checksum"


def lei_check_digits(prefix):
    """The two check digits for an 18-character LEI prefix."""
    if not re.fullmatch(r"[A-Z0-9]{18}", prefix):
        raise ValueError("LEI prefix must be 18 upper-case letters or digits")
    return "%02d" % (98 - mod97(prefix + "00"))


def check_euid(value):
    """True when the value has the EUID structure: country, register, dot, number."""
    return bool(EUID_PATTERN.match(value)) and not value.endswith(".")

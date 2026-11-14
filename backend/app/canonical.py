"""Canonical JSON compatible with src/domain/canonicalJson.ts.

Keys are sorted by UTF-16 code units, matching JavaScript Array.sort.
Integral numbers are encoded without a decimal point. null, zero, and Unicode are preserved.
Server receipt_id, accepted_at, and sync_status are not part of this object.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

_MAX_SAFE_INTEGER = 2**53 - 1


class CanonicalError(ValueError):
    pass


def canonical_json(value: object) -> str:
    return json.dumps(
        _normalize(value),
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_operation(schema_version: int, operation_type: str, payload: object) -> str:
    return sha256_hex(
        canonical_json(
            {
                "payload": payload,
                "schema_version": schema_version,
                "type": operation_type,
            }
        )
    )


def hash_payload_part(payload: object, schema_version: int = 1) -> str:
    return sha256_hex(
        canonical_json(
            {
                "payload": payload,
                "schema_version": schema_version,
            }
        )
    )


def _normalize(value: object) -> Any:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        if abs(value) > _MAX_SAFE_INTEGER:
            raise CanonicalError("unsupported_value")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalError("non_finite_number")
        if value == 0.0 or (abs(value) <= _MAX_SAFE_INTEGER and value.is_integer()):
            return int(value)
        return value
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        keys: list[str] = []
        for key in value:
            if not isinstance(key, str):
                raise CanonicalError("unsupported_value")
            keys.append(key)
        return {key: _normalize(value[key]) for key in sorted(keys, key=_utf16_key)}
    raise CanonicalError("unsupported_value")


def _utf16_key(text: str) -> bytes:
    return text.encode("utf-16-be")

from dataclasses import dataclass
from typing import Any


class ContractError(Exception):
    def __init__(self, status: str, code: str) -> None:
        self.status = status
        self.code = code
        super().__init__(code)


class AuthenticationError(Exception):
    pass


@dataclass
class OperationResult:
    status: str
    error_code: str | None = None
    receipt_id: str | None = None
    payload_hash: str | None = None
    entity_refs: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "error_code": self.error_code,
            "receipt_id": self.receipt_id,
            "payload_hash": self.payload_hash,
            "entity_refs": self.entity_refs,
        }


def http_status_for(status: str) -> int:
    if status in ("accepted", "duplicate"):
        return 200
    if status == "conflict":
        return 409
    return 422

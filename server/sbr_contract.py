"""Provider-neutral contract for re-encoding-resilient provenance recovery.

This module deliberately does not guess the request/response format of the
user's watermark/SBR API. A provider-specific adapter must translate that API
into these types after its documentation and test vectors are supplied.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Literal, Mapping, Protocol, runtime_checkable

SBR_ADAPTER_CONTRACT = "relayproof.sbr-provider.v1"
ResolutionState = Literal["recovered", "no_match", "indeterminate"]


class SBRContractError(ValueError):
    """The configured provider returned a response outside the safe contract."""


@dataclass(frozen=True)
class SBRAdapterStatus:
    available: bool
    provider: str | None
    state: Literal["ready", "not_configured", "provider_unavailable"]
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "provider": self.provider,
            "state": self.state,
            "message": self.message,
            "contract": SBR_ADAPTER_CONTRACT,
        }


@dataclass(frozen=True)
class SBRIssueArtifact:
    """Publisher-side output required from an adapter that embeds a binding.

    `protected_media` is the returned media artifact. It is not treated as
    original media, and must be accompanied by a machine-readable receipt.
    Provider-specific fields belong in `receipt`; never put API secrets there.
    """

    protected_media: bytes
    filename: str
    receipt: Mapping[str, Any]


@dataclass(frozen=True)
class SBRResolution:
    """Normalized result for a user-initiated derivative-provenance lookup.

    `recovered` means only that the provider returned a credential candidate.
    The caller must independently verify the credential signature and any
    issuer identity/key trust. This object intentionally has no `authentic`,
    `trusted`, or `same_source` boolean.
    """

    status: ResolutionState
    provider: str
    method: str
    binding_id: str | None
    credential: Mapping[str, Any] | None
    evidence: Mapping[str, Any]
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "contract": SBR_ADAPTER_CONTRACT,
            "status": self.status,
            "provider": self.provider,
            "method": self.method,
            "bindingId": self.binding_id,
            "credential": dict(self.credential) if self.credential is not None else None,
            "evidence": dict(self.evidence),
            "message": self.message,
            "limitations": [
                "A recovered credential candidate still needs its own signature verification.",
                "A valid signature does not establish real-world issuer identity or claim truth.",
                "No match is not evidence that the media is fake.",
            ],
        }


@runtime_checkable
class SoftBindingProvider(Protocol):
    """Interface implemented by a provider-specific, server-side adapter.

    The API key, if any, must stay in the backend's environment/secrets store.
    Methods receive bytes only after a user explicitly starts issue or resolve.
    """

    name: str

    def health(self) -> SBRAdapterStatus: ...

    async def issue(
        self,
        *,
        media: bytes,
        filename: str,
        credential: Mapping[str, Any],
    ) -> SBRIssueArtifact: ...

    async def resolve(
        self,
        *,
        media: bytes,
        filename: str,
    ) -> SBRResolution: ...


def sbr_adapter_status() -> dict[str, Any]:
    """Fail-closed readiness response until the provider contract is mapped."""
    return SBRAdapterStatus(
        available=False,
        provider=None,
        state="not_configured",
        message=(
            "Derivative-provenance recovery is not configured. Supply the "
            "watermark/SBR API's sanitized schema and test vectors before "
            "enabling media upload or recovery. Exact-file verification remains available."
        ),
    ).as_dict()


def _required_text(value: Any, field: str, *, maximum: int = 160) -> str:
    if not isinstance(value, str):
        raise SBRContractError(f"{field} must be a string.")
    value = value.strip()
    if not value or len(value) > maximum:
        raise SBRContractError(f"{field} must contain 1 to {maximum} characters.")
    return value


def validate_issue_artifact(value: Any) -> SBRIssueArtifact:
    """Validate a provider's issuance result before the app exposes it."""
    if isinstance(value, SBRIssueArtifact):
        artifact = value
    elif isinstance(value, Mapping):
        artifact = SBRIssueArtifact(
            protected_media=value.get("protected_media"),
            filename=value.get("filename"),
            receipt=value.get("receipt"),
        )
    else:
        raise SBRContractError("SBR issue result must be a mapping or SBRIssueArtifact.")

    if not isinstance(artifact.protected_media, bytes) or not artifact.protected_media:
        raise SBRContractError("SBR issue result must contain non-empty protected media bytes.")
    if len(artifact.protected_media) > 512 * 1024 * 1024:
        raise SBRContractError("Protected media exceeds the 512 MB adapter limit.")
    if not isinstance(artifact.filename, str) or not artifact.filename.strip():
        raise SBRContractError("SBR issue result must include a filename.")
    # Do not allow an adapter to return a path traversal filename.
    if PurePath(artifact.filename).name != artifact.filename or "/" in artifact.filename or "\\" in artifact.filename:
        raise SBRContractError("SBR issue filename must be a plain basename.")
    if not isinstance(artifact.receipt, Mapping):
        raise SBRContractError("SBR issue result must include a machine-readable receipt.")
    receipt = dict(artifact.receipt)
    _required_text(receipt.get("provider"), "receipt.provider")
    _required_text(receipt.get("method"), "receipt.method")
    return SBRIssueArtifact(artifact.protected_media, artifact.filename, receipt)


def normalize_resolution(value: Any) -> SBRResolution:
    """Normalize a provider response without converting it into an auth verdict."""
    if isinstance(value, SBRResolution):
        raw = {
            "status": value.status,
            "provider": value.provider,
            "method": value.method,
            "binding_id": value.binding_id,
            "credential": value.credential,
            "evidence": value.evidence,
            "message": value.message,
        }
    elif isinstance(value, Mapping):
        raw = value
    else:
        raise SBRContractError("SBR resolve result must be a mapping or SBRResolution.")

    status = raw.get("status")
    if status not in {"recovered", "no_match", "indeterminate"}:
        raise SBRContractError("SBR status must be recovered, no_match, or indeterminate.")
    provider = _required_text(raw.get("provider"), "provider")
    method = _required_text(raw.get("method"), "method")
    binding_id = raw.get("binding_id", raw.get("bindingId"))
    if binding_id is not None:
        binding_id = _required_text(binding_id, "binding_id", maximum=256)

    credential = raw.get("credential", raw.get("recovered_credential"))
    evidence = raw.get("evidence", {})
    message = raw.get("message")
    if not isinstance(evidence, Mapping):
        raise SBRContractError("evidence must be a mapping.")
    if message is None:
        message = {
            "recovered": "A provider returned a credential candidate; independently verify its signature and issuer trust.",
            "no_match": "No recoverable binding was returned. This does not mean the media is fake.",
            "indeterminate": "The provider could not determine whether a binding is present.",
        }[status]
    message = _required_text(message, "message", maximum=600)

    if status == "recovered":
        if not isinstance(credential, Mapping) or not credential:
            raise SBRContractError("A recovered result must include a credential candidate.")
        if not evidence:
            raise SBRContractError("A recovered result must include provider evidence metadata.")
        credential = dict(credential)
    else:
        # Discard stray credentials on non-recovered results rather than letting
        # a caller accidentally display one as a recovered provenance record.
        credential = None

    return SBRResolution(
        status=status,
        provider=provider,
        method=method,
        binding_id=binding_id,
        credential=credential,
        evidence=dict(evidence),
        message=message,
    )

# ADR-0011: Authentication

## Status

Proposed

## Context

LibreChat and Khoj both implement multi-user login and session systems because they serve many users, potentially remotely. AMETHYST v1 is a single-user application running on the user's own machine.

## Decision

AMETHYST v1 has no login or session-authentication system. Access control is the operating system's own user-account boundary — whoever can run the AMETHYST process on this machine is the user. Revisit this decision entirely if and when AMETHYST gains a networked or multi-device remote-access mode.

## Alternatives Considered

- **Build a login/session system now, unused in v1 but ready for future multi-device access.** Rejected: this is infrastructure AMETHYST does not need yet, built speculatively against a future requirement that may end up shaped differently once it's actually specified.

## Trade-offs

If remote or multi-device access is added later, this decision will need to be revisited from scratch rather than extended incrementally — accepted, because building a proper multi-user auth system without a concrete remote-access design to build it against would likely produce the wrong system anyway.

## Consequences

No auth-related code, dependencies, or attack surface in v1. The absence of this system is itself a scope boundary: AMETHYST v1 is explicitly not designed to be exposed on a network.

# ADR-0019: Default app registrations — the registration is shared, the account never is

## Status

Accepted

## Context

Every OAuth connector demanded that a friend register their own app before
signing in — a developer-console detour that is the single largest barrier to
a contributor ever seeing a connector work. The requirement and the fear sit
together: a friend should not have to register apps, **and must never reach
the owner's accounts**. They are compatible because they are different
things. The *app registration* is a client id identifying the software; the
*account tokens* are minted per install, by each person signing in with their
own account, and stay in that install's keychain.

The previous `${VAR}` expansion in `backend/mcp/config.py` could not carry
this: an unset variable expanded to the literal `${AMETHYST_DEFAULT_…}` string,
which was handed to the provider as a client id while `missing_credentials`
reported the connector fully configured — two silent lies in opposite
directions.

## Decision

A real mechanism, shipped with **no Google, Spotify or GitHub value**:

- `CatalogueEntry.default_client_id_env` / `default_client_secret_env` hold
  the **name** of an environment variable, never a value. The repository is
  public; a committed client secret is a published one. A literal pasted into
  the catalogue passes every review because it looks exactly like a
  placeholder — so the shape is asserted by pattern
  (`^AMETHYST_DEFAULT_[A-Z0-9_]+$`) in `tests/test_docker_context.py`, which is
  the mechanical enforcement of "no secrets committed".
- `default_client(entry)` returns `(None, None)` unless the id is present —
  a half-configured default cannot exist, because a secret beside an absent
  id fails at the provider with a message about an unknown client.
- `ServerConfig.resolved_env()` fills the user's absent pair from the
  default, **only when the key is absent** — precedence falls out of the
  loop that has already written every user value, so a keychain credential
  can never be overwritten. It lives there rather than at the call sites
  because there are two spawn paths (connect and sign-in), and filling one
  produces a connector that connects but cannot authenticate.
- `ensure_default_credentials` materialises the credentials-file case (a
  server that reads no environment) with `store_secret=False` — if a
  default landed in the keychain, `credential_is_set` would report it as
  user-supplied and `_guard_stored_credential` would then refuse to let the
  user replace it, locking them out of their own connector.
- `status()` carries `client_source: "user" | "default" | None`, because the
  friend's actual question — *does this app know the owner?* — deserves an
  answer the interface can print.

### Why no defaults are shipped

- **Google cannot honestly be zero-config.** A Testing app needs every user
  added by email in the console (100 cap), and the *grant* — refresh token
  included — dies after seven days. Publishing is blocked twice: Gmail scopes
  are restricted (paid CASA assessment) and Branding needs a
  Search-Console-verified domain, which `*.vercel.app` cannot be. A shared
  client id would make setup zero for the owner and change nothing for the
  friend; `GOOGLE_TESTING_GRANT_DAYS` and the grant-age warning stay.
- **Spotify**, same shape milder: 25 users in Development Mode.
- **GitHub is excluded even though the mechanism would work.** A GitHub
  *OAuth App* needs its `client_secret` at token exchange, so a default means
  distributing that secret. It cannot read anyone's repos, but it
  authorises the *app*, and a leaked one runs a convincing phishing consent
  screen under its name. The right fix is a GitHub *App* with device flow —
  separate work.

### What is genuinely zero-config, with no code at all

`fetch`, `memory`, `playwright`, `chrome-devtools` (no auth); `vercel`
(dynamic registration via its authorization server); `microsoft-todo`
(Microsoft's own public client, device-code flow — the model case: the
friend signs into *their* Microsoft account, and there is no secret to
share).

## Consequences

A friend who runs AMETHYST signs into their own accounts through app
registrations that identify the software, never a person; `client_source`
says which is in play on every connector row. Defaults, where an operator
chooses to supply them, arrive only at `docker run` via `env_file` — never
`ARG` or `ENV`, both of which are visible in `docker history` forever — and
a user-supplied credential always wins over one.

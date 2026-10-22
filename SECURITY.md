# Security policy

## Reporting a vulnerability

Please report security issues **privately**.

1. **Preferred:** use GitHub private vulnerability reporting. On [github.com/Kumar2421/okara-alternative](https://github.com/Kumar2421/okara-alternative), go to **Security → Report a vulnerability**.
2. **If that option is not available:** email `<security contact: to be added by the maintainer>`. If you cannot reach that address, open a GitHub issue that asks for a private channel, **without any details** of the issue.

Include the affected URL or route, steps to reproduce, the impact you observed, and the commit or deployment you tested. Please don't access other users' data, degrade the hosted service, or run automated scanners against `app.marlo.mlforge.in`. Test against your own self-hosted instance when you can.
## Supported versions

Only the latest `main` and the hosted app at `app.marlo.mlforge.in` receive security fixes. There are no versioned releases yet.

## Scope

Both the hosted platform build (Supabase mode) and the self-host build are in scope. Self-host SQLite mode has **no authentication by design** (see [docs/self-hosting.md](docs/self-hosting.md#keep-it-private)), so "an unauthenticated user can use a self-hosted SQLite instance" is expected behavior, not a vulnerability.

For the protections in place, see [docs/security.md](docs/security.md).

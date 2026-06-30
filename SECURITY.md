# Security Policy

## Reporting a vulnerability

Email **support@alttext.ai** with the details. Please don't open a public issue for security reports. We'll acknowledge receipt and work with you on a fix and disclosure timeline.

## Supply-chain guarantees

This package runs locally with your AltText.ai API key in its environment, so its provenance matters:

- Releases are published only from this repository's CI (`.github/workflows/publish.yml`), triggered by a signed version tag.
- Each release carries an [npm provenance](https://docs.npmjs.com/generating-provenance-statements) attestation linking the published tarball to the exact commit and GitHub Actions build that produced it.
- You can verify any installed version with `npm audit signatures`, which validates both the registry signature and the provenance attestation. See "Verify this package" in the [README](README.md).

## What this server does and doesn't do with your key

- `ALTTEXT_API_KEY` is read from the environment and sent only to the AltText.ai API (`https://alttext.ai/api/v1` by default, or `ALTTEXT_API_BASE_URL` if you override it).
- The key is never logged or written to disk by this server.
- The server makes no network calls other than to the AltText.ai API.

## Supported versions

The latest published release receives security fixes. Pin a specific version (see "Pinning a version" in the README) if you need a reproducible install.

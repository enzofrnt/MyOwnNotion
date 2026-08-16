# Desktop Update Manifest Contract

The release channel exposes one manifest per version and platform/architecture.
The manifest is metadata only; the signed installer remains the authoritative
artifact.

```json
{
  "format": "myownnotion.desktop-update.v1",
  "version": "1.2.3",
  "channel": "stable",
  "platform": "win32",
  "architecture": "x64",
  "artifactUrl": "https://example.invalid/releases/...",
  "artifactSha512": "base64-or-hex-digest",
  "releaseNotesUrl": "https://example.invalid/releases/...",
  "minimumServerProtocol": "1.0",
  "maximumServerProtocol": "1.x"
}
```

Required validation:

- strict version and platform/architecture matching;
- HTTPS for manifest and artifact origins;
- digest verification before installation;
- signature verification by the platform/update mechanism;
- compatible server protocol window before enabling writes;
- no downgrade unless an explicit recovery path authorizes it;
- no secret, token, user content or local path in the manifest.

The release workflow publishes the manifest only after the exact artifact has
passed packaging, signing, smoke and security checks.

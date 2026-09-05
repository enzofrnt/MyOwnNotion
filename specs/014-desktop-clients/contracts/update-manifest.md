# Desktop Update Manifest Contract

The release channel exposes one manifest per version and platform/architecture
(`platform`/`architecture` is exactly one of `win32`/`x64`, `win32`/`arm64`,
`darwin`/`arm64`, `linux`/`x64`, `linux`/`arm64`). A client MUST ignore a
manifest whose target does not match the running installation or is outside
that matrix.

The Linux in-app update artifact is the AppImage of the matching architecture.
The `.deb` and `.rpm` of that architecture are additional GitHub Release
downloads, not a second update channel.

```json
{
  "format": "myownnotion.desktop-update.v1",
  "version": "1.2.3",
  "channel": "stable",
  "platform": "win32",
  "architecture": "x64",
  "artifactUrl": "https://github.com/enzofrnt/MyOwnNotion/releases/download/v1.2.3/MyOwnNotion-1.2.3-win32-x64.exe",
  "artifactSha512": "base64-or-hex-digest",
  "releaseNotesUrl": "https://github.com/enzofrnt/MyOwnNotion/releases/tag/v1.2.3",
  "minimumServerProtocol": "3",
  "maximumServerProtocol": "3"
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

The release publishes `desktop-<platform>-<architecture>.json` and its raw
64-byte Ed25519 signature in the adjacent `.json.sig` file. The verifier's SPKI
PEM key is embedded in the app at build time. The latest stable feed is the
repository's `/releases/latest/download/` endpoint; artifacts and release notes
must match the exact canonical versioned paths above. Redirects are HTTPS-only
and limited to GitHub's release asset hosts. A manifest cannot select its own
verification key. Protocol bounds are positive-integer strings, not app versions.
Metadata and downloads are bounded in size and time. A file is verified again
immediately before opening the native installer; opening it does not attest that
the upgrade completed.

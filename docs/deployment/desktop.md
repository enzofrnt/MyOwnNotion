# Desktop clients (Windows, macOS and Linux)

The packaged host reuses the Web client. It does not embed a server. Download
the installer that matches the machine’s operating system **and** CPU
architecture from the GitHub Release. There is no app store.

## Supported installers

Five OS/architecture targets. Linux publishes three package formats per
architecture:

| File | OS | Architecture |
| --- | --- | --- |
| `MyOwnNotion-<version>-win32-x64.exe` | Windows 10/11 | x64 |
| `MyOwnNotion-<version>-win32-arm64.exe` | Windows 10/11 | ARM64 |
| `MyOwnNotion-<version>-darwin-arm64.dmg` | macOS 13+ | Apple Silicon |
| `MyOwnNotion-<version>-linux-x64.AppImage` | Linux glibc desktop | x64 |
| `MyOwnNotion-<version>-linux-x64.deb` | Linux glibc desktop | x64 |
| `MyOwnNotion-<version>-linux-x64.rpm` | Linux glibc desktop | x64 |
| `MyOwnNotion-<version>-linux-arm64.AppImage` | Linux glibc desktop | ARM64 |
| `MyOwnNotion-<version>-linux-arm64.deb` | Linux glibc desktop | ARM64 |
| `MyOwnNotion-<version>-linux-arm64.rpm` | Linux glibc desktop | ARM64 |

macOS Intel, iOS, Android, and every application store are out of scope. Deb
and rpm are GitHub downloads, not packages pushed to a distro repository.

A GitHub Release for a desktop version is complete only when all files above
are attached and no other desktop artefact is published.

## Channels

Releases publish on the `stable` channel from an exact `vX.Y.Z` tag after the
quality gate, artefact verification, and smoke tests succeed. In-app updates
accept only an artefact for the same OS and architecture. On Linux, in-app
updates use the AppImage.

## Signing prerequisites (release runners only)

Secrets never enter the repository. Native release jobs read:

- Windows: `CSC_LINK` (base64 PFX certificate) and `CSC_KEY_PASSWORD`
- macOS: `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_IDENTITY` (Developer ID Application identity including Team ID),
  `APPLE_API_KEY` (P8 text), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`

Every release build also embeds `DESKTOP_UPDATE_PUBLIC_KEY` (Ed25519 SPKI PEM)
from a repository variable. The corresponding `DESKTOP_UPDATE_SIGNING_KEY`
(PKCS8 PEM secret) signs the manifests after native verification.

Linux packages always publish a SHA-512 digest. Local `bun run desktop:dev`
does not need these secrets. Unsigned local packages are for development only
and must not be distributed.

## Recovery

If a start fails after an update, keep the local vault: it lives in the OS
application data directory, not inside the installer. Reinstall the previous
package for the same OS and architecture if the new one cannot boot.
Unsynchronized edits remain until the owner exports or reconnects.

The update screen downloads and verifies the canonical installer, then opens it
(or its containing folder for Linux AppImage). Finish installation and restart
explicitly. A pending local queue blocks this handoff. Keep the application data
directory intact when changing versions; do not clear it as an update workaround.

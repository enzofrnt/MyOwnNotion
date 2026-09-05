/** Runs only after every native release proof has been collected and verified. */
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { artifactName, RELEASE_ROOT } from "../../apps/desktop/src/update-download.ts";
import {
  type DesktopUpdateManifest,
  PUBLISHED_DESKTOP_TARGETS,
} from "../../apps/desktop/src/update-manifest.ts";
import { PROTOCOL_VERSION } from "../../packages/domain/src/sync/protocol-version.ts";
import {
  collectDesktopArtifactFailures,
  expectedArtifactsFor,
  sha512File,
} from "./check-desktop-artifacts.ts";

const directory = path.resolve(process.env["DESKTOP_ARTIFACT_DIR"] ?? "collected-desktop");
const version = (process.env["DESKTOP_VERSION"] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Missing release version");
const failures = collectDesktopArtifactFailures(directory, version);
if (failures.length) throw new Error("Release artifact verification failed");
for (const target of PUBLISHED_DESKTOP_TARGETS) {
  const proof = JSON.parse(
    readFileSync(
      path.join(directory, `verification-${target.platform}-${target.architecture}.json`),
      "utf8",
    ),
  );
  if (
    !process.env["GITHUB_SHA"] ||
    proof.commit !== process.env["GITHUB_SHA"] ||
    proof.version !== version ||
    proof.platform !== target.platform ||
    proof.architecture !== target.architecture ||
    proof.checks !== "native-signatures-and-architecture"
  )
    throw new Error("Missing native release evidence");
  for (const artifact of expectedArtifactsFor(version, target)) {
    if (
      !proof.artifacts.some(
        (entry: { name: string; sha512: string }) =>
          entry.name === artifact.fileName &&
          entry.sha512 === sha512File(path.join(directory, artifact.fileName)),
      )
    )
      throw new Error("Artifact does not match native verification evidence");
  }
}
const privateKey = createPrivateKey(process.env["DESKTOP_UPDATE_SIGNING_KEY"] ?? "");
if (privateKey.asymmetricKeyType !== "ed25519")
  throw new Error("An Ed25519 release key is required");
const actual = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const pinned = createPublicKey(process.env["DESKTOP_UPDATE_PUBLIC_KEY"] ?? "").export({
  type: "spki",
  format: "der",
});
if (!actual.equals(pinned))
  throw new Error("Release signing key differs from the key embedded in the application");
for (const target of PUBLISHED_DESKTOP_TARGETS) {
  const candidate: DesktopUpdateManifest = {
    format: "myownnotion.desktop-update.v1",
    version,
    channel: "stable",
    ...target,
    artifactUrl: "",
    artifactSha512: "",
    releaseNotesUrl: `${RELEASE_ROOT}/tag/v${version}`,
    minimumServerProtocol: String(PROTOCOL_VERSION),
    maximumServerProtocol: String(PROTOCOL_VERSION),
  };
  const name = artifactName(candidate);
  const payload = Buffer.from(
    JSON.stringify(
      {
        ...candidate,
        artifactUrl: `${RELEASE_ROOT}/download/v${version}/${name}`,
        artifactSha512: sha512File(path.join(directory, name)),
      },
      null,
      2,
    ),
  );
  const targetFile = path.join(directory, `desktop-${target.platform}-${target.architecture}.json`);
  writeFileSync(targetFile, payload);
  writeFileSync(`${targetFile}.sig`, sign(null, payload, privateKey));
}
console.info("Five authenticated update manifests generated from verified native artifacts.");

import type { UpdateState } from "./ipc-contract.ts";
import {
  type DesktopUpdateManifest,
  manifestMatchesHost,
  parseUpdateManifest,
  type UpdateArchitecture,
  type UpdatePlatform,
} from "./update-manifest.ts";
import type { UpdateContext, UpdateMachinePhase } from "./update-state.ts";

export interface UpdateDriver {
  readonly host: {
    version: string;
    platform: UpdatePlatform;
    architecture: UpdateArchitecture;
    protocol: number;
  };
  /** Returns authenticated manifest bytes parsed as JSON, never an unverified feed. */
  manifest(): Promise<unknown>;
  download(manifest: DesktopUpdateManifest): Promise<string>;
  /** Reverify the file immediately before handing it to the native installer. */
  launch(file: string, manifest: DesktopUpdateManifest): Promise<void>;
}

export class UpdateOrchestrator {
  #phase: UpdateMachinePhase = "idle";
  #manifest: DesktopUpdateManifest | null = null;
  #file: string | null = null;
  #message: string | null = null;
  #busy = false;
  #context: UpdateContext = {
    pendingLocalChanges: true,
    migrationActive: false,
    ownerConfirmedInstall: false,
  };
  constructor(private readonly driver?: UpdateDriver) {}

  snapshot(): UpdateState {
    return {
      phase: this.#phase,
      version: this.#manifest?.version ?? null,
      message: this.#message,
      pendingLocalChanges: this.#context.pendingLocalChanges,
      migrationActive: this.#context.migrationActive,
    };
  }
  setContext(context: Partial<UpdateContext>): void {
    this.#context = { ...this.#context, ...context };
  }

  async check(): Promise<UpdateState> {
    if (this.#busy) return this.snapshot();
    if (!this.driver) {
      this.#phase = "unavailable";
      this.#message = "Les mises à jour signées ne sont pas configurées pour cette installation.";
      return this.snapshot();
    }
    this.#busy = true;
    this.#phase = "checking";
    try {
      const parsed = parseUpdateManifest(await this.driver.manifest());
      if (!parsed.ok) throw new Error("Invalid manifest");
      const compatible = manifestMatchesHost(parsed.manifest, this.driver.host);
      if (
        !compatible.ok ||
        parsed.manifest.channel !== "stable" ||
        Number(parsed.manifest.minimumServerProtocol) > this.driver.host.protocol ||
        Number(parsed.manifest.maximumServerProtocol) < this.driver.host.protocol
      ) {
        this.#phase = "incompatible";
        this.#manifest = null;
        this.#message = "Cette version ne convient pas à cette installation ou à son protocole.";
      } else {
        this.#manifest = parsed.manifest;
        this.#file = null;
        this.#phase = parsed.manifest.version === this.driver.host.version ? "idle" : "available";
        this.#message =
          this.#phase === "idle"
            ? "Votre application est à jour."
            : `Version ${parsed.manifest.version} disponible depuis GitHub Releases. Signature vérifiée.`;
      }
    } catch {
      this.#manifest = null;
      this.#file = null;
      this.#phase = "invalid-manifest";
      this.#message =
        "Impossible de vérifier la mise à jour. Réessayez lorsque la connexion est disponible.";
    } finally {
      this.#busy = false;
    }
    return this.snapshot();
  }
  defer(): UpdateState {
    if (!this.#busy && ["available", "downloaded"].includes(this.#phase)) this.#phase = "deferred";
    return this.snapshot();
  }
  async install(): Promise<UpdateState> {
    if (
      this.#busy ||
      !this.driver ||
      !this.#manifest ||
      !["available", "deferred", "downloaded", "download-failed", "install-failed"].includes(
        this.#phase,
      )
    )
      return this.snapshot();
    if (this.#context.pendingLocalChanges || this.#context.migrationActive) {
      this.#message =
        "Terminez la synchronisation et les opérations locales avant de lancer l’installation.";
      return this.snapshot();
    }
    this.#busy = true;
    try {
      if (this.#file === null) {
        this.#phase = "downloading";
        this.#message = "Téléchargement et vérification de l’installateur…";
        this.#file = await this.driver.download(this.#manifest);
      }
      this.#phase = "downloaded";
      // The renderer may have reported new edits while downloading.
      if (this.#context.pendingLocalChanges || this.#context.migrationActive)
        return this.snapshot();
      this.#phase = "installing";
      await this.driver.launch(this.#file, this.#manifest);
      this.#message =
        "Installateur vérifié ouvert. Terminez l’installation puis redémarrez l’application. Votre espace local est conservé.";
    } catch {
      const downloading = this.#phase === "downloading";
      this.#phase = downloading ? "download-failed" : "install-failed";
      this.#file = null;
      this.#message =
        "La mise à jour a échoué. Cette version et votre espace local sont conservés. Vous pouvez réessayer.";
    } finally {
      this.#busy = false;
    }
    return this.snapshot();
  }
}

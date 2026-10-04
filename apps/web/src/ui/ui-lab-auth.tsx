import { BootstrapPage } from "../features/auth/bootstrap-page.tsx";
import { LoginPage } from "../features/auth/login-page.tsx";
import { DesktopConnectionPage } from "../features/connection/desktop-connection-page.tsx";
import { SecurityApi } from "../services/security-api.ts";

export type UiLabAuthSurface = "login" | "setup" | "connection";

// All actions reachable in these previews stop before a request or a native
// credential ceremony. No owner credentials, installation or profile is used.
const refusal = {
  ok: false,
  problem: {
    type: "https://myownnotion.dev/problems/ui-lab",
    title: "Local UI preview",
    status: 503,
    code: "service_unavailable",
    correlationId: null,
  },
} as const;

class PreviewSecurityApi extends SecurityApi {
  override async status(): ReturnType<SecurityApi["status"]> {
    return {
      ok: true,
      value: {
        state: "uninitialized",
        ownerCount: 0,
        workspaceCount: 0,
        recoveryReady: false,
        securityReady: false,
      },
    };
  }

  override async start(): ReturnType<SecurityApi["start"]> {
    return refusal;
  }

  override async loginWithPassword(): ReturnType<SecurityApi["loginWithPassword"]> {
    return refusal;
  }

  override async passkeyLoginOptions(): ReturnType<SecurityApi["passkeyLoginOptions"]> {
    return refusal;
  }
}

const previewApi = new PreviewSecurityApi("");
const stayInPreview = () => undefined;

export function UiLabAuthPreview({ surface }: { readonly surface: UiLabAuthSurface }) {
  return (
    <>
      <nav className="ui-lab__preview-navigation" aria-label="Exemples de connexion">
        <a href="/__ui-lab">Laboratoire</a>
        <span>Exemple local — aucune connexion ni configuration enregistrée</span>
      </nav>
      {surface === "login" ? <LoginPage api={previewApi} onSignedIn={stayInPreview} /> : null}
      {surface === "setup" ? <BootstrapPage api={previewApi} onReady={stayInPreview} /> : null}
      {surface === "connection" ? (
        window.myownnotionDesktop === undefined ? (
          <DesktopConnectionPage onConnected={stayInPreview} />
        ) : (
          <p className="ui-lab__hint">
            Ouvrez cet exemple dans un navigateur pour préserver le profil desktop.
          </p>
        )
      ) : null}
    </>
  );
}

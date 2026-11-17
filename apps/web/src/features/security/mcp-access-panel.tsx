import type { ItemDto, McpAction, McpConnectionView, McpGrantResult } from "@myownnotion/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientProblem, McpAuditEvent, SecurityApi } from "../../services/security-api.ts";
import { formatDateTime } from "../../ui/copy/index.ts";
import {
  AsyncState,
  Button,
  ConfirmDialog,
  DialogContent,
  DialogDescription,
  DialogDismiss,
  DialogHeading,
  DialogRoot,
  Field,
} from "../../ui/primitives/index.ts";
import { SettingsPill, type SettingsPillTone } from "../settings/settings-card.tsx";
import { ReauthDialog } from "./reauth-dialog.tsx";
import "./mcp-access-panel.css";

const ACTIONS: ReadonlyArray<{ value: McpAction; label: string }> = [
  { value: "search", label: "Rechercher" },
  { value: "read", label: "Lire le contenu" },
  { value: "create", label: "Créer des pages et dossiers" },
  { value: "edit", label: "Modifier et renommer" },
  { value: "delete", label: "Mettre à la corbeille" },
];
const STATUS = {
  pending: "En attente d’échange",
  active: "Actif",
  expired: "Expiré",
  revoked: "Révoqué",
};
const AUDIT_ACTIONS: Record<string, string> = {
  "mcp.granted": "Accès autorisé",
  "mcp.exchanged": "Code échangé",
  "mcp.revoked": "Accès révoqué",
  "mcp.exchange-failed": "Code refusé",
  "mcp.authentication-failed": "Authentification refusée",
  list_items: "Liste du contenu",
  search: "Recherche",
  search_items: "Recherche",
  read_item: "Lecture",
  create_item: "Création",
  rename_item: "Renommage",
  edit_page: "Modification",
  trash_item: "Mise à la corbeille",
  read_file: "Lecture de fichier",
};
const STATUS_TONE: Record<McpConnectionView["status"], SettingsPillTone> = {
  pending: "warning",
  active: "success",
  expired: "neutral",
  revoked: "neutral",
};
const date = (value: string) => formatDateTime(new Date(value));
/** Shows enough of the code to recognise it, never the whole secret. */
const maskCode = (code: string) => `${code.slice(0, 4)}${"•".repeat(10)}`;

interface Notice {
  kind: "error" | "success" | "info";
  message: string;
}
export interface McpAccessPanelProps {
  api: SecurityApi;
  onReauthenticated?: (() => void) | undefined;
}

export function McpAccessPanel({ api, onReauthenticated }: McpAccessPanelProps) {
  const [connections, setConnections] = useState<McpConnectionView[]>([]);
  const [items, setItems] = useState<ItemDto[]>([]);
  const [events, setEvents] = useState<McpAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [label, setLabel] = useState("");
  const [actions, setActions] = useState<McpAction[]>(["search", "read"]);
  const [allContent, setAllContent] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [files, setFiles] = useState(false);
  const [days, setDays] = useState("90");
  const [unlimited, setUnlimited] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [filter, setFilter] = useState("");
  const [grant, setGrant] = useState<McpGrantResult | null>(null);
  const [copyState, setCopyState] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<McpConnectionView | null>(null);
  const [reauth, setReauth] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);
  const interrupted = useRef<"grant" | "revoke" | null>(null);
  const interruptedTarget = useRef<McpConnectionView | null>(null);
  const secretGeneration = useRef(0);
  const copyLock = useRef(false);

  const hideCode = useCallback(() => {
    secretGeneration.current += 1;
    setGrant(null);
    setCopyState("");
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const [inventory, branches, audit] = await Promise.all([
      api.listMcpConnections(),
      api.listMcpBranches(),
      api.listMcpAudit(),
    ]);
    if (!mounted.current) return;
    setLoadError(!inventory.ok || !branches.ok);
    if (inventory.ok) {
      setConnections(inventory.value.connections);
      setGrant((current) =>
        current !== null &&
        inventory.value.connections.some(
          (connection) =>
            connection.id === current.connection.id && connection.status !== "pending",
        )
          ? null
          : current,
      );
    }
    if (branches.ok) setItems(branches.value.items);
    setAuditError(!audit.ok);
    if (audit.ok) setEvents(audit.value.events);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      secretGeneration.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (grant === null) return;
    const timer = window.setTimeout(
      () => {
        hideCode();
        setNotice({
          kind: "info",
          message:
            "Le token a expiré. Révoquez le token en attente puis générez-en un nouveau si nécessaire.",
        });
      },
      Math.max(0, Date.parse(grant.exchangeExpiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [grant, hideCode]);

  const explain = (
    problem: ClientProblem,
    fallback: string,
    action: "grant" | "revoke" = "grant",
    target: McpConnectionView | null = null,
  ) => {
    if (problem.code === "recent_authentication_required") {
      interrupted.current = action;
      interruptedTarget.current = target;
      // A modal, so the confirmation appears where the person is looking (the
      // button at the bottom of the form) rather than at the top of the panel.
      setGrantOpen(false);
      setReauth(true);
    } else {
      setNotice({
        kind: "error",
        message:
          problem.code === "service_unavailable"
            ? "Le serveur est inaccessible. Rien n’a été mis en attente ; vérifiez la connexion puis réessayez."
            : fallback,
      });
    }
  };

  const authorize = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (lock.current) return;
    if (
      !label.trim() ||
      actions.length === 0 ||
      (!allContent && roots.length === 0) ||
      (unlimited && !acknowledged)
    ) {
      setNotice({
        kind: "error",
        message:
          "Donnez un nom, choisissez au moins une action et une branche. Une durée illimitée doit être confirmée.",
      });
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    const result = await api.grantMcpConnection({
      label: label.trim(),
      scope: { actions, allContent, branchRootIds: allContent ? [] : roots, files },
      lifetimeDays: unlimited ? null : Number(days),
      ...(unlimited ? { acknowledgeUnlimited: acknowledged } : {}),
    });
    if (mounted.current) {
      if (result.ok) {
        secretGeneration.current += 1;
        setReauth(false);
        setGrantOpen(false);
        setGrant(result.value);
        setCopyState("");
        setConnections((current) => [result.value.connection, ...current]);
        setNotice(null);
      } else
        explain(
          result.problem,
          "L’accès n’a pas pu être autorisé. Vérifiez les choix puis réessayez.",
        );
      setBusy(false);
    }
    lock.current = false;
  };

  const revoke = async (target: McpConnectionView | null = pendingRevoke) => {
    if (target === null || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    const result = await api.revokeMcpConnection(target.id);
    if (mounted.current) {
      if (result.ok) {
        if (grant?.connection.id === target.id) hideCode();
        setConnections((current) =>
          current.map((entry) =>
            entry.id === target.id ? { ...entry, status: "revoked" } : entry,
          ),
        );
        await refresh();
        setNotice({
          kind: "success",
          message: `« ${target.label} » a été révoqué. Toute nouvelle demande sera refusée.`,
        });
      } else
        explain(
          result.problem,
          "La révocation n’a pas été confirmée. Réessayez lorsque le serveur est disponible.",
          "revoke",
          target,
        );
      setBusy(false);
      setPendingRevoke(null);
    }
    lock.current = false;
  };

  const identityConfirmed = async () => {
    setReauth(false);
    setNotice(null);
    onReauthenticated?.();
    // Resume the action the confirmation interrupted, with the person's input.
    const action = interrupted.current;
    const target = interruptedTarget.current;
    interrupted.current = null;
    interruptedTarget.current = null;
    if (action === "grant") await authorize();
    else if (action === "revoke" && target !== null) await revoke(target);
  };

  const copyCode = async () => {
    if (grant === null || copyLock.current) return;
    copyLock.current = true;
    const generation = secretGeneration.current;
    try {
      await navigator.clipboard.writeText(grant.exchangeCode);
      if (mounted.current && generation === secretGeneration.current) setCopyState("Token copié.");
    } catch {
      if (mounted.current && generation === secretGeneration.current)
        setCopyState(
          "La copie a été refusée. Réessayez ou autorisez l’accès au presse-papiers du navigateur.",
        );
    } finally {
      copyLock.current = false;
    }
  };

  const renew = (connection: McpConnectionView) => {
    setLabel(connection.label);
    setActions([...connection.scope.actions]);
    setAllContent(connection.scope.allContent);
    setRoots([...connection.scope.branchRootIds]);
    setFiles(connection.scope.files);
    setDays("90");
    setUnlimited(false);
    setAcknowledged(false);
    hideCode();
    setNotice({
      kind: "info",
      message:
        "Vérifiez ce nouveau token puis créez-le. L’ancien token reste inchangé jusqu’à sa révocation.",
    });
    setGrantOpen(true);
  };
  const branchName = (id: string) =>
    items.find((item) => item.id === id)?.name ?? "Branche indisponible";
  const branchChoices = items.filter(
    (item) =>
      item.lifecycle === "active" &&
      item.name.toLocaleLowerCase("fr").includes(filter.toLocaleLowerCase("fr")),
  );

  // Read only while a code is shown: the dialog is built even when hidden.
  const endpoint = grant === null ? "" : api.mcpEndpoint();

  const summary = (connection: McpConnectionView) =>
    [
      ACTIONS.filter((action) => connection.scope.actions.includes(action.value))
        .map((action) => action.label)
        .join(", "),
      connection.scope.allContent
        ? "Tout l’espace"
        : connection.scope.branchRootIds.map(branchName).join(", "),
      connection.scope.files ? "Fichiers inclus" : "Sans fichiers",
    ].join(" · ");

  const feedback =
    notice === null ? null : (
      <AsyncState compact kind={notice.kind} title={notice.message} testId="mcp-message" />
    );

  return (
    <section
      className="ui-settings-panel mcp-panel"
      aria-labelledby="mcp-heading"
      data-testid="mcp-panel"
    >
      <div className="mcp-heading security-settings__panel-head">
        <div>
          <h2 id="mcp-heading">Serveur MCP</h2>
          <p className="security-settings__lead">
            Model Context Protocol : reliez un client MCP, par exemple un assistant IA, à un
            périmètre que vous choisissez.
          </p>
        </div>
        <div className="security-settings__panel-actions">
          <Button
            size="compact"
            variant="ghost"
            busy={loading}
            disabled={busy}
            onClick={() => void refresh()}
          >
            Actualiser
          </Button>
          <Button
            size="compact"
            variant="primary"
            disabled={loading || loadError}
            onClick={() => setGrantOpen(true)}
            data-testid="mcp-open-grant"
          >
            Créer un token
          </Button>
        </div>
      </div>
      {grantOpen || reauth ? null : feedback}
      {loadError && (
        <AsyncState
          compact
          kind="error"
          title="Les accès ou les branches n’ont pas pu être chargés. Actualisez pour réessayer ; votre saisie est conservée."
        />
      )}

      <div className="mcp-inventory">
        {loading ? (
          <AsyncState compact kind="loading" title="Chargement des accès…" />
        ) : connections.length === 0 && !loadError ? (
          <AsyncState
            compact
            kind="empty"
            title="Aucun token MCP pour l’instant."
            description="Créez un token pour relier un assistant à votre espace."
          />
        ) : (
          <ul className="mcp-list">
            {connections.map((connection) => (
              <li key={connection.id} className="mcp-connection" data-testid="mcp-connection">
                <div className="mcp-connection__main">
                  <div className="mcp-connection__title">
                    <strong>{connection.label}</strong>
                    <SettingsPill tone={STATUS_TONE[connection.status]}>
                      {STATUS[connection.status]}
                    </SettingsPill>
                  </div>
                  <p>{summary(connection)}</p>
                  <p>
                    {connection.expiresAt === null
                      ? "Sans expiration"
                      : `Expire le ${date(connection.expiresAt)}`}
                    {" · "}
                    {connection.lastUsedAt === null
                      ? "Jamais utilisé"
                      : `Utilisé le ${date(connection.lastUsedAt)}`}
                  </p>
                </div>
                <div className="mcp-connection__actions">
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => renew(connection)}
                  >
                    Renouveler par un nouveau token
                  </Button>
                  {connection.status !== "revoked" && (
                    <Button
                      size="compact"
                      variant="danger"
                      disabled={busy}
                      onClick={() => setPendingRevoke(connection)}
                    >
                      Révoquer
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mcp-audit">
        <summary>Journal des accès</summary>
        {auditError ? (
          <p>Le journal est indisponible. Actualisez les accès pour réessayer.</p>
        ) : events.length === 0 ? (
          <p>Aucun événement enregistré.</p>
        ) : (
          <ol>
            {events.map((event) => (
              <li key={event.id}>
                <strong>
                  {connections.find((connection) => connection.id === event.connectionId)?.label ??
                    "Connexion retirée"}
                </strong>{" "}
                · {AUDIT_ACTIONS[event.action] ?? "Opération MCP"} ·{" "}
                {event.outcome === "success" ? "Autorisé" : "Refusé"}
                <br />
                <time dateTime={event.occurredAt}>{date(event.occurredAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </details>

      {/* Authorize: the form lives in a modal, so the card stays a short list. */}
      <DialogRoot
        open={grantOpen}
        setOpen={(next) => {
          if (!next && !busy) setGrantOpen(false);
        }}
      >
        <DialogContent
          className="mcp-grant-dialog"
          data-testid="mcp-grant-dialog"
          hideOnEscape={!busy}
          portal={false}
          size="large"
          unmountOnHide
        >
          <DialogHeading>Créer un token MCP</DialogHeading>
          <DialogDescription>
            Choisissez ce que le client MCP pourra faire. Vous obtiendrez ensuite un token à usage
            unique à lui transmettre.
          </DialogDescription>
          {grantOpen ? feedback : null}
          <form className="mcp-grant" onSubmit={(event) => void authorize(event)}>
            <Field
              label="Nom de la connexion"
              placeholder="Assistant de rédaction"
              maxLength={120}
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={busy}
            />
            <fieldset disabled={busy}>
              <legend>Actions autorisées</legend>
              <div className="mcp-choices">
                {ACTIONS.map((action) => (
                  <label key={action.value}>
                    <input
                      type="checkbox"
                      checked={actions.includes(action.value)}
                      onChange={(event) =>
                        setActions((current) =>
                          event.target.checked
                            ? [...current, action.value]
                            : current.filter((value) => value !== action.value),
                        )
                      }
                    />
                    {action.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Contenu accessible</legend>
              <p>
                Les branches choisies incluent leur contenu et leurs descendants, y compris ceux
                ajoutés plus tard.
              </p>
              <label className="mcp-choice">
                <input
                  type="checkbox"
                  checked={allContent}
                  onChange={(event) => setAllContent(event.target.checked)}
                />
                Tout l’espace, y compris le futur contenu
              </label>
              {!allContent && (
                <>
                  <Field
                    label="Filtrer les branches"
                    type="search"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  <section className="mcp-branches" aria-label="Branches autorisées">
                    {loading ? (
                      <p>Chargement des branches…</p>
                    ) : branchChoices.length === 0 ? (
                      <p>Aucune branche disponible pour ce filtre.</p>
                    ) : (
                      branchChoices.map((item) => (
                        <label className="mcp-choice" key={item.id}>
                          <input
                            type="checkbox"
                            checked={roots.includes(item.id)}
                            onChange={(event) =>
                              setRoots((current) =>
                                event.target.checked
                                  ? [...current, item.id]
                                  : current.filter((id) => id !== item.id),
                              )
                            }
                          />
                          <span>
                            {item.name}
                            <small>
                              {item.placements
                                .map((placement) =>
                                  placement.parentItemId === null
                                    ? "Racine"
                                    : branchName(placement.parentItemId),
                                )
                                .join(" · ")}
                            </small>
                          </span>
                        </label>
                      ))
                    )}
                  </section>
                  <p>{roots.length} branche(s) sélectionnée(s).</p>
                </>
              )}
              <label className="mcp-choice">
                <input
                  type="checkbox"
                  checked={files}
                  onChange={(event) => setFiles(event.target.checked)}
                />
                Autoriser les fichiers dans ce périmètre
              </label>
              <p>
                Les fichiers restent soumis aux actions choisies. Leur contenu nécessite la
                permission de lecture.
              </p>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Durée de l’accès</legend>
              {!unlimited && (
                <Field
                  label="Durée en jours"
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  required
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              )}
              <label className="mcp-choice">
                <input
                  type="checkbox"
                  checked={unlimited}
                  onChange={(event) => {
                    setUnlimited(event.target.checked);
                    setAcknowledged(false);
                  }}
                />
                Sans expiration
              </label>
              {unlimited && (
                <label className="mcp-choice mcp-warning">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    required
                  />
                  Je comprends que cet accès restera utilisable jusqu’à sa révocation.
                </label>
              )}
            </fieldset>
            <p>
              Une confirmation récente de votre identité est requise pour autoriser ou révoquer un
              accès.
            </p>
            <div className="mcp-dialog-actions">
              <Button variant="ghost" disabled={busy} onClick={() => setGrantOpen(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={loading || loadError}
                data-testid="mcp-authorize"
              >
                Générer le token
              </Button>
            </div>
          </form>
          <DialogDismiss disabled={busy} />
        </DialogContent>
      </DialogRoot>

      {/* The one-use code: copy it right away; it is never shown in full. */}
      <DialogRoot
        open={grant !== null}
        setOpen={(next) => {
          if (!next) hideCode();
        }}
      >
        <DialogContent
          className="mcp-code-dialog"
          data-testid="mcp-code"
          portal={false}
          size="small"
          unmountOnHide
        >
          <DialogHeading>Connecter « {grant?.connection.label} »</DialogHeading>
          <DialogDescription>
            Token créé. Copiez-le et transmettez-le au client MCP : il est utilisable une seule
            fois, avant le {grant === null ? "" : date(grant.exchangeExpiresAt)}.
          </DialogDescription>
          <div className="mcp-code__secret">
            <output aria-label="Token temporaire" data-testid="mcp-code-masked">
              {grant === null ? "" : maskCode(grant.exchangeCode)}
            </output>
            <Button variant="primary" onClick={() => void copyCode()} data-testid="mcp-code-copy">
              Copier le token
            </Button>
          </div>
          <p role="status" className="mcp-code__status">
            {copyState}
          </p>
          <details className="mcp-code__how">
            <summary>Comment l’utiliser</summary>
            <ol>
              <li>Transmettez ce token uniquement au client que vous venez d’autoriser.</li>
              <li>
                Le client envoie une requête POST à <code>{endpoint}/exchange</code> avec le corps
                JSON <code>{'{"code":"CODE_TEMPORAIRE"}'}</code>. La réponse fournit son jeton dédié{" "}
                <code>accessToken</code>.
              </li>
              <li>
                Configurez son transport HTTP MCP à <code>{endpoint}</code> avec l’accès reçu comme
                jeton Bearer.
              </li>
            </ol>
            <p>
              Utilisez un client qui accepte un jeton Bearer dédié. Ce parcours n’effectue pas de
              connexion OAuth automatique. Ne transmettez jamais votre mot de passe ni votre session
              propriétaire.
            </p>
          </details>
          <div className="mcp-dialog-actions">
            <Button variant="secondary" onClick={hideCode}>
              Terminé
            </Button>
          </div>
          <DialogDismiss />
        </DialogContent>
      </DialogRoot>

      <ReauthDialog
        api={api}
        open={reauth}
        testId="mcp-reauth"
        description="Cette action sur le MCP demande une confirmation récente. Votre saisie est conservée et l’action reprend dès que vous êtes confirmé."
        onCancel={() => {
          interrupted.current = null;
          setReauth(false);
        }}
        onConfirmed={() => void identityConfirmed()}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        busy={busy}
        title={`Révoquer « ${pendingRevoke?.label ?? ""} » ?`}
        description="Le client MCP perdra son accès dès sa prochaine demande. Les informations qu’il a déjà reçues ne seront pas effacées."
        confirmLabel="Révoquer ce token"
        testId="mcp-revoke-dialog"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}

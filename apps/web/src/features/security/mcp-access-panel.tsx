import type { ItemDto, McpAction, McpConnectionView, McpGrantResult } from "@myownnotion/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientProblem, McpAuditEvent, SecurityApi } from "../../services/security-api.ts";
import { FR_COPY, formatDateTime } from "../../ui/copy/index.ts";
import { AsyncState, Button, ConfirmDialog, Field } from "../../ui/primitives/index.ts";
import { passkeysAvailable, requestOwnerPasskey } from "../auth/passkey-client.ts";
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
const date = (value: string) => formatDateTime(new Date(value));

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
  const [password, setPassword] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
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
            "Le code a expiré. Révoquez l’accès en attente puis générez un nouveau code si nécessaire.",
        });
      },
      Math.max(0, Date.parse(grant.exchangeExpiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [grant, hideCode]);

  const explain = (problem: ClientProblem, fallback: string) => {
    if (problem.code === "recent_authentication_required") {
      setReauth(true);
      setNotice({
        kind: "info",
        message:
          "Confirmez votre identité ci-dessous, puis réessayez l’action. Votre saisie est conservée.",
      });
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

  const authorize = async (event: React.FormEvent) => {
    event.preventDefault();
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
        setGrant(result.value);
        setCopyState("");
        setConnections((current) => [result.value.connection, ...current]);
        setNotice({
          kind: "success",
          message: "Accès autorisé. Transmettez le code à l’assistant avant son expiration.",
        });
      } else
        explain(
          result.problem,
          "L’accès n’a pas pu être autorisé. Vérifiez les choix puis réessayez.",
        );
      setBusy(false);
    }
    lock.current = false;
  };

  const revoke = async () => {
    if (pendingRevoke === null || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    const target = pendingRevoke;
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
        );
      setBusy(false);
      setPendingRevoke(null);
    }
    lock.current = false;
  };

  const confirmIdentity = async (method: "password" | "passkey") => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    let success = false;
    if (method === "password") {
      const result = await api.loginWithPassword(password);
      success = result.ok;
    } else {
      const options = await api.passkeyLoginOptions();
      if (options.ok) {
        const assertion = await requestOwnerPasskey(options.value);
        if (assertion.ok) success = (await api.loginWithPasskey(assertion.credential)).ok;
      }
    }
    if (mounted.current) {
      setPassword("");
      setBusy(false);
      setNotice({
        kind: success ? "success" : "error",
        message: success
          ? "Identité confirmée. Vous pouvez réessayer l’autorisation ou la révocation."
          : FR_COPY.auth.login.refused,
      });
      if (success) {
        setReauth(false);
        onReauthenticated?.();
      }
    }
    lock.current = false;
  };

  const copyCode = async () => {
    if (grant === null || copyLock.current) return;
    copyLock.current = true;
    const generation = secretGeneration.current;
    try {
      await navigator.clipboard.writeText(grant.exchangeCode);
      if (mounted.current && generation === secretGeneration.current) setCopyState("Code copié.");
    } catch {
      if (mounted.current && generation === secretGeneration.current)
        setCopyState("La copie a été refusée. Sélectionnez le code et copiez-le manuellement.");
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
        "Vérifiez ce nouvel accès puis autorisez-le. L’ancien accès reste inchangé jusqu’à sa révocation.",
    });
    nameRef.current?.focus();
  };
  const branchName = (id: string) =>
    items.find((item) => item.id === id)?.name ?? "Branche indisponible";
  const branchChoices = items.filter(
    (item) =>
      item.lifecycle === "active" &&
      item.name.toLocaleLowerCase("fr").includes(filter.toLocaleLowerCase("fr")),
  );

  return (
    <section
      className="ui-settings-panel mcp-panel"
      aria-labelledby="mcp-heading"
      data-testid="mcp-panel"
    >
      <div className="mcp-heading">
        <div>
          <h2 id="mcp-heading">Accès des assistants</h2>
          <p>Reliez un assistant compatible MCP à un périmètre que vous choisissez.</p>
        </div>
        <Button size="compact" busy={loading} disabled={busy} onClick={() => void refresh()}>
          Actualiser les accès
        </Button>
      </div>
      {notice && (
        <AsyncState compact kind={notice.kind} title={notice.message} testId="mcp-message" />
      )}
      {reauth && (
        <div className="mcp-reauth" data-testid="mcp-reauth">
          <h3>Confirmer votre identité</h3>
          {passkeysAvailable() && (
            <Button disabled={busy} onClick={() => void confirmIdentity("passkey")}>
              Confirmer avec une passkey
            </Button>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmIdentity("password");
            }}
          >
            <Field
              label="Mot de passe actuel"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={busy}
            />
            <Button type="submit" busy={busy}>
              Confirmer avec le mot de passe
            </Button>
          </form>
        </div>
      )}
      {loadError && (
        <AsyncState
          compact
          kind="error"
          title="Les accès ou les branches n’ont pas pu être chargés. Actualisez pour réessayer ; votre saisie est conservée."
        />
      )}
      <form className="mcp-grant" onSubmit={(event) => void authorize(event)}>
        <h3>Autoriser un assistant</h3>
        <Field
          ref={nameRef}
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
            Les branches choisies incluent leur contenu et leurs descendants, y compris ceux ajoutés
            plus tard.
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
            Les fichiers restent soumis aux actions choisies. Leur contenu nécessite la permission
            de lecture.
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
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={loading || loadError}
          data-testid="mcp-authorize"
        >
          Générer le code d’accès
        </Button>
      </form>
      {grant && (
        <div className="mcp-code" data-testid="mcp-code">
          <h3>Connecter « {grant.connection.label} »</h3>
          <p>
            Ce code est utilisable une seule fois, avant le {date(grant.exchangeExpiresAt)}. Il
            disparaît en quittant ces réglages.
          </p>
          <Field
            label="Code temporaire"
            value={grant.exchangeCode}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.target.select()}
          />
          <div className="mcp-actions">
            <Button onClick={() => void copyCode()}>Copier le code</Button>
            <Button variant="ghost" onClick={hideCode}>
              Masquer le code
            </Button>
          </div>
          <p role="status">{copyState}</p>
          <ol>
            <li>Transmettez ce code uniquement à l’assistant que vous venez d’autoriser.</li>
            <li>
              L’assistant envoie une requête POST à <code>{api.mcpEndpoint()}/exchange</code> avec
              le corps JSON <code>{'{"code":"CODE_TEMPORAIRE"}'}</code>. La réponse fournit son
              jeton dédié <code>accessToken</code>.
            </li>
            <li>
              Configurez son transport HTTP MCP à <code>{api.mcpEndpoint()}</code> avec l’accès reçu
              comme jeton Bearer.
            </li>
          </ol>
          <p>
            Utilisez un client qui accepte un jeton Bearer dédié. Ce parcours n’effectue pas de
            connexion OAuth automatique. Ne transmettez jamais votre mot de passe ni votre session
            propriétaire.
          </p>
        </div>
      )}
      <div className="mcp-inventory">
        <h3>Connexions autorisées</h3>
        {loading ? (
          <AsyncState compact kind="loading" title="Chargement des accès…" />
        ) : connections.length === 0 && !loadError ? (
          <AsyncState compact kind="empty" title="Aucun assistant autorisé." />
        ) : (
          <ul className="mcp-list">
            {connections.map((connection) => (
              <li key={connection.id} data-testid="mcp-connection">
                <div className="mcp-heading">
                  <strong>{connection.label}</strong>
                  <span>{STATUS[connection.status]}</span>
                </div>
                <p>
                  {ACTIONS.filter((action) => connection.scope.actions.includes(action.value))
                    .map((action) => action.label)
                    .join(" · ")}
                </p>
                <p>
                  {connection.scope.allContent
                    ? "Tout l’espace et son futur contenu"
                    : connection.scope.branchRootIds.map(branchName).join(" · ")}{" "}
                  — descendants inclus.
                </p>
                <p>Fichiers : {connection.scope.files ? "autorisés" : "non autorisés"}.</p>
                <p>
                  {connection.expiresAt === null
                    ? "Sans expiration"
                    : `Expire le ${date(connection.expiresAt)}`}{" "}
                  · Dernière utilisation :{" "}
                  {connection.lastUsedAt === null ? "jamais" : date(connection.lastUsedAt)}
                </p>
                <div className="mcp-actions">
                  <Button size="compact" disabled={busy} onClick={() => renew(connection)}>
                    Renouveler par un nouvel accès
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
      <ConfirmDialog
        open={pendingRevoke !== null}
        busy={busy}
        title={`Révoquer « ${pendingRevoke?.label ?? ""} » ?`}
        description="L’assistant perdra son accès dès sa prochaine demande. Les informations qu’il a déjà reçues ne seront pas effacées."
        confirmLabel="Révoquer cet accès"
        testId="mcp-revoke-dialog"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => void revoke()}
      />
    </section>
  );
}

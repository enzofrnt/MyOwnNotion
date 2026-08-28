/**
 * Resolving a genuine divergence, three versions side by side (T027, FR-014, FR-015).
 *
 * Modelled on a Git conflict, and the borrowing is deliberate: the common
 * ancestor is what turns "these two differ" into "here is what each of us did",
 * and without it an owner is comparing two finished texts with no way to tell an
 * addition from a deletion.
 *
 * Four things the owner can do, in the order they need them:
 *
 *   1. **See all three.** Local, common, remote — per block, so the columns line
 *      up on the thing that actually diverged rather than on line numbers.
 *   2. **Choose per block**, including keeping both. Keeping both is not a
 *      compromise offered to avoid deciding; it is frequently the right answer
 *      when two devices each added a thought.
 *   3. **Reorder the result**, because "keep both" leaves an order that no rule
 *      can know. The merge places local first and appends remote-only blocks,
 *      which is defensible and often not what was meant.
 *   4. **Review exactly what will be saved**, before it is saved. Every other
 *      screen in this product commits as you type; this one must not, because the
 *      commit is the moment two versions become one.
 *
 * Nothing is destroyed at any point. The commit writes a *new* revision with both
 * originals as parents, so both remain reachable afterwards — see
 * `resolveConflictLocally`.
 */

import type { ConflictRecordRow } from "@myownnotion/client-core";
import {
  applyResolution,
  type Block,
  type BlockDocument,
  exportMarkdown,
  type MergeOutcome,
  mergeDocuments,
  readDocumentBody,
  type Uuid,
} from "@myownnotion/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";
import { AsyncState, Button } from "../../ui/primitives/index.ts";

/** Shared side vocabulary for document and structured conflict resolvers. */
export type ConflictSide = "local" | "remote";
type Choice = ConflictSide | "both";

/** What the screen needs, once the three versions have been fetched. */
interface Prepared {
  readonly row: ConflictRecordRow;
  readonly outcome: Extract<MergeOutcome, { kind: "needs-owner" }>;
  readonly localRevisionId: Uuid;
  readonly remoteRevisionId: Uuid;
}

function blocksOf(body: unknown): BlockDocument | null {
  const read = readDocumentBody(body);
  return read.kind === "blocks" && read.result.ok ? read.result.document : null;
}

/**
 * One block as text the owner can read.
 *
 * Through the export path rather than a reader written here, so a block type this
 * component has never heard of still shows up. A version rendered as empty is
 * worse than one rendered awkwardly: the owner would choose against content they
 * were never shown.
 */
function blockAsText(block: Block | undefined): string {
  return block === undefined ? "" : exportMarkdown({ blocks: [block] }).trim();
}

function findBlock(document: BlockDocument, id: string): Block | undefined {
  return document.blocks.find((block) => block.id === id);
}

export function ConflictResolution({
  service,
  itemId,
  onResolved,
  onCancel,
}: {
  readonly service: LocalContentService;
  readonly itemId: Uuid;
  readonly onResolved: () => void;
  readonly onCancel: () => void;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  /** The owner's manual order, once they have touched it. */
  const [order, setOrder] = useState<Uuid[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = (await service.outbox.activeConflicts()).filter((row) => {
        const payload = row.payload as { itemId?: unknown };
        return payload.itemId === itemId && row.commandType === "page.document.replace";
      });
      const row = rows[0];
      if (row === undefined) {
        if (!cancelled) {
          setPrepared(null);
        }
        return;
      }
      const ancestorId = row.baseRevisionIds[0];
      const remoteId = row.competingRevisionIds[0];
      if (ancestorId === undefined || remoteId === undefined) {
        if (!cancelled) {
          setUnavailable(
            "Ce conflit ne désigne pas ses deux versions : leur comparaison est impossible ici. Votre version reste conservée et rien n’a été perdu.",
          );
        }
        return;
      }
      const [ancestorRead, remoteRead] = await Promise.all([
        service.api.getRevision(ancestorId),
        service.api.getRevision(remoteId),
      ]);
      if (cancelled) {
        return;
      }
      if (!ancestorRead.ok || !remoteRead.ok) {
        // Most often the ancestor's snapshot passed its retention window. Said
        // plainly, with what is still true: the work is not gone.
        setUnavailable(
          "La version commune de départ n’est plus conservée : la comparaison à trois versions est impossible. Les deux versions restent lisibles et aucune n’a été supprimée.",
        );
        return;
      }
      const snapshotBody = (snapshot: unknown): unknown =>
        (snapshot as { pageDocument?: { body?: unknown } } | null)?.pageDocument?.body;
      const ancestor = blocksOf(snapshotBody(ancestorRead.value["snapshot"]));
      const remote = blocksOf(snapshotBody(remoteRead.value["snapshot"]));
      const local = blocksOf((row.payload["document"] as { body?: unknown } | undefined)?.body);
      if (ancestor === null || remote === null || local === null) {
        setUnavailable(
          "Une de ces versions précède l’éditeur de blocs et ne peut pas être comparée bloc par bloc. Les deux versions restent lisibles.",
        );
        return;
      }
      const outcome = mergeDocuments(ancestor, local, remote);
      if (outcome.kind === "merged") {
        // Nothing to decide. Reachable when the head moved again between the
        // refusal and this screen opening, and the right answer is to say so
        // rather than to present an empty comparison.
        setUnavailable(
          "Ces versions ne sont plus en conflit : elles peuvent être combinées sans décision. Fermez cette fenêtre et relancez l’enregistrement.",
        );
        return;
      }
      setPrepared({
        row,
        outcome,
        localRevisionId: ancestorId as Uuid,
        remoteRevisionId: remoteId as Uuid,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [service, itemId]);

  /** What would be saved, given the choices and any manual reordering. */
  const result = useMemo((): BlockDocument | null => {
    if (prepared === null) {
      return null;
    }
    const assembled = applyResolution({ outcome: prepared.outcome, choices });
    if (order === null) {
      return assembled;
    }
    const byId = new Map(assembled.blocks.map((block) => [block.id, block]));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((block): block is Block => block !== undefined);
    // Anything the owner's order does not mention is appended rather than
    // dropped. A stale order — from a choice changed after reordering — must not
    // be able to delete a block.
    const missing = assembled.blocks.filter((block) => !order.includes(block.id));
    return { blocks: [...ordered, ...missing] };
  }, [prepared, choices, order]);

  const move = useCallback(
    (id: Uuid, direction: -1 | 1) => {
      if (result === null) {
        return;
      }
      const ids = result.blocks.map((block) => block.id);
      const index = ids.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= ids.length) {
        return;
      }
      const next = [...ids];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved as Uuid);
      setOrder(next);
    },
    [result],
  );

  const commit = useCallback(async () => {
    if (prepared === null || result === null) {
      return;
    }
    setSaving(true);
    setFailure(null);
    const outcome = await service.resolveConflict({
      conflictMutationId: prepared.row.mutationId,
      itemId,
      localRevisionId: prepared.localRevisionId,
      remoteRevisionId: prepared.remoteRevisionId,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 1,
        body: result as unknown as Record<string, unknown>,
      },
      pageLinkTargetIds: [],
    });
    setSaving(false);
    if (!outcome.ok) {
      // The conflict record is untouched on failure, so the owner can try again
      // or fall back to the notice. Saying which failure it was matters: "could
      // not save" with no reason invites them to retry something that cannot work.
      setFailure(`${outcome.error.code}: ${outcome.error.title}`);
      return;
    }
    onResolved();
  }, [prepared, result, service, itemId, onResolved]);

  if (unavailable !== null) {
    return (
      <section className="panel" aria-label="Résoudre ce conflit" data-testid="conflict-resolution">
        <h2>Résoudre ce conflit</h2>
        <AsyncState
          compact
          kind="conflict"
          description={unavailable}
          testId="resolution-unavailable"
        />
        <Button type="button" onClick={onCancel} data-testid="resolution-close">
          Fermer
        </Button>
      </section>
    );
  }

  if (prepared === null) {
    return null;
  }

  return (
    <section className="panel" aria-label="Résoudre ce conflit" data-testid="conflict-resolution">
      <h2>Résoudre ce conflit</h2>
      <p className="muted">
        Ces parties ont changé à deux endroits en même temps. Choisissez quoi conserver pour chacune
        ; conserver les deux est souvent pertinent. Rien n’est enregistré avant votre confirmation
        et les deux versions restent ensuite dans l’historique.
      </p>

      <table className="conflict-columns" data-testid="conflict-columns">
        <caption className="muted">
          Chaque ligne représente une partie modifiée aux deux endroits.
        </caption>
        <thead>
          <tr>
            <th scope="col">Cet appareil</th>
            <th scope="col">Version commune de départ</th>
            <th scope="col">L’autre appareil</th>
            <th scope="col">Conserver</th>
          </tr>
        </thead>
        <tbody>
          {prepared.outcome.conflictedBlockIds.map((id) => {
            const choice = choices.get(id) ?? "local";
            return (
              <tr key={id} data-testid={`conflict-block-${id}`}>
                {/* `data-column` is what labels each cell once the columns
                    stack on a narrow screen — see the media query in styles.css.
                    Without it a stacked row is three unlabelled texts, and
                    choosing between unlabelled versions is worse than not
                    choosing. */}
                <td data-column="Cet appareil">
                  <pre data-testid={`conflict-local-${id}`}>
                    {blockAsText(findBlock(prepared.outcome.local, id)) || "(supprimé ici)"}
                  </pre>
                </td>
                <td data-column="Version commune de départ">
                  <pre data-testid={`conflict-ancestor-${id}`}>
                    {blockAsText(findBlock(prepared.outcome.ancestor, id)) ||
                      "(n’existait pas encore)"}
                  </pre>
                </td>
                <td data-column="L’autre appareil">
                  <pre data-testid={`conflict-remote-${id}`}>
                    {blockAsText(findBlock(prepared.outcome.remote, id)) || "(supprimé là-bas)"}
                  </pre>
                </td>
                <td data-column="Conserver">
                  {/* A radio group per row, labelled by the row, so the choice
                      reads as one question with three answers rather than three
                      independent switches. */}
                  <fieldset>
                    <legend className="muted">Conserver pour cette partie</legend>
                    {(["local", "remote", "both"] as const).map((option) => (
                      <label key={option} htmlFor={`choice-${id}-${option}`}>
                        <input
                          id={`choice-${id}-${option}`}
                          type="radio"
                          name={`choice-${id}`}
                          value={option}
                          checked={choice === option}
                          data-testid={`conflict-choose-${option}-${id}`}
                          onChange={() => {
                            setChoices((current) => new Map(current).set(id, option));
                          }}
                        />
                        {option === "local"
                          ? "Cet appareil"
                          : option === "remote"
                            ? "L’autre appareil"
                            : "Les deux"}
                      </label>
                    ))}
                  </fieldset>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Ordre du contenu enregistré</h3>
      <ol data-testid="conflict-order">
        {(result?.blocks ?? []).map((block, index) => (
          <li key={block.id} data-testid={`conflict-order-${block.id}`}>
            <span>{blockAsText(block) || "(vide)"}</span>
            <Button
              size="compact"
              variant="ghost"
              type="button"
              data-testid={`conflict-move-up-${block.id}`}
              disabled={index === 0}
              onClick={() => move(block.id, -1)}
            >
              Monter
            </Button>
            <Button
              size="compact"
              variant="ghost"
              type="button"
              data-testid={`conflict-move-down-${block.id}`}
              disabled={index === (result?.blocks.length ?? 0) - 1}
              onClick={() => move(block.id, 1)}
            >
              Descendre
            </Button>
          </li>
        ))}
      </ol>

      <h3>Vérification avant enregistrement</h3>
      {/* The whole result, not a summary of the choices. A summary is a claim
          about what the choices produce; this is the thing itself. */}
      <pre data-testid="conflict-review">
        {result === null
          ? ""
          : exportMarkdown(result).trim() || "(la page enregistrée serait vide)"}
      </pre>

      {failure !== null ? (
        <AsyncState compact kind="error" description={failure} testId="resolution-failure" />
      ) : null}

      <div className="tree-actions">
        <Button
          type="button"
          data-testid="conflict-commit"
          disabled={saving}
          onClick={() => void commit()}
        >
          {saving ? "Enregistrement…" : "Enregistrer cette résolution"}
        </Button>
        <Button type="button" variant="ghost" data-testid="conflict-cancel" onClick={onCancel}>
          Plus tard
        </Button>
      </div>
    </section>
  );
}

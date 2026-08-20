import type { CreateDatabaseRequestDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type FormEvent, useState } from "react";

export function CreateDatabaseForm({
  parentItemId,
  positionKey = "a",
  onCreate,
}: {
  readonly parentItemId: Uuid | null;
  readonly positionKey?: string;
  readonly onCreate: (request: CreateDatabaseRequestDto) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      setError("Give the database a name.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        id: generateUuidV7(),
        name: normalizedName,
        placement: { id: generateUuidV7(), parentItemId, positionKey },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Table",
      });
      setName("");
    } catch {
      // Keep the owner's draft in place. The caller can safely retry the form;
      // a fresh mutation identity is generated only when it is submitted.
      setError("The database could not be created. Your name is still here.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="database-create" aria-label="Create a database" onSubmit={submit}>
      <label htmlFor="database-name">Create a database</label>
      <div className="field-row">
        <input
          id="database-name"
          name="database-name"
          value={name}
          placeholder="Projects, tasks, reading…"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create database"}
        </button>
      </div>
      {error !== null ? <p role="alert">{error}</p> : null}
    </form>
  );
}

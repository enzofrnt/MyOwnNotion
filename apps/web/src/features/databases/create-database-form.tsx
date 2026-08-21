import type { CreateDatabaseRequestDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { type FormEvent, useState } from "react";
import { DATABASE_COPY } from "./database-copy.ts";

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
      setError(DATABASE_COPY.create.nameRequired);
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
        titlePropertyName: DATABASE_COPY.create.initialTitlePropertyName,
        initialViewId: generateUuidV7(),
        initialViewName: DATABASE_COPY.create.initialViewName,
      });
      setName("");
    } catch {
      // Keep the owner's draft in place. The caller can safely retry the form;
      // a fresh mutation identity is generated only when it is submitted.
      setError(DATABASE_COPY.create.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="database-create" aria-label={DATABASE_COPY.create.label} onSubmit={submit}>
      <label htmlFor="database-name">{DATABASE_COPY.create.label}</label>
      <div className="field-row">
        <input
          id="database-name"
          name="database-name"
          value={name}
          placeholder={DATABASE_COPY.create.placeholder}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? DATABASE_COPY.create.creating : DATABASE_COPY.create.submit}
        </button>
      </div>
      {error !== null ? <p role="alert">{error}</p> : null}
    </form>
  );
}

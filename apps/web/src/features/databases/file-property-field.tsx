import { type DatabaseProperty, normalizeUrl } from "@myownnotion/domain";
import { useId, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/button.tsx";
import type { UploadedDatabaseFile } from "./file-upload.ts";

const IMAGE_EXTENSIONS = /\.(avif|gif|heic|jpe?g|png|svg|tiff?|webp)$/iu;

function isImageFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

/** Notion's documented limits: images 5 MB, PDFs 20 MB, other files 5 MB. */
export function databaseFileLimitBytes(file: Pick<File, "name" | "type">): number {
  if (isImageFile(file)) return 5 * 1024 * 1024;
  if (file.type === "application/pdf" || /\.pdf$/iu.test(file.name)) return 20 * 1024 * 1024;
  return 5 * 1024 * 1024;
}

export function databaseFileLimitLabel(file: Pick<File, "name" | "type">): string {
  return `${databaseFileLimitBytes(file) / (1024 * 1024)} Mo`;
}

export function FilePropertyField({
  property,
  fileIds,
  externalUrls = [],
  fileNames,
  disabled = false,
  onUpload,
  onChange,
}: {
  readonly property: DatabaseProperty;
  readonly fileIds: readonly string[];
  readonly externalUrls?: readonly string[];
  readonly fileNames: ReadonlyMap<string, string>;
  readonly disabled?: boolean;
  readonly onUpload: (file: File) => Promise<UploadedDatabaseFile | null>;
  readonly onChange: (fileIds: readonly string[], externalUrls: readonly string[]) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");

  const add = async (file: File): Promise<void> => {
    if (fileIds.length + externalUrls.length >= 20) {
      setError("20 fichiers ou liens maximum.");
      return;
    }
    const limit = databaseFileLimitBytes(file);
    if (file.size > limit) {
      setError(
        `Le fichier dépasse la limite de ${databaseFileLimitLabel(file)} pour ce type (comme dans Notion).`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await onUpload(file);
      if (uploaded === null) {
        setError("Le fichier n’a pas pu être ajouté.");
        return;
      }
      onChange([...fileIds, uploaded.id], externalUrls);
    } catch {
      setError("Le fichier n’a pas pu être ajouté.");
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = "";
    }
  };

  return (
    <div className="file-property-field">
      {fileIds.length === 0 && externalUrls.length === 0 ? (
        <span className="muted">Aucun fichier</span>
      ) : (
        <ul className="file-property-field__list" aria-label={property.name}>
          {fileIds.map((id) => {
            const name = fileNames.get(id) ?? "Fichier";
            const image = isImageFile({ name, type: "" });
            return (
              <li key={id} className="file-property-field__row">
                {image ? (
                  <img
                    className="file-property-field__preview"
                    src={`/v1/files/${id}/content`}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <AppIcon name="paperclip" size="small" />
                )}
                <a
                  className="file-property-field__name"
                  href={`/v1/files/${id}/content`}
                  download={name}
                >
                  {name}
                </a>
                <Button
                  type="button"
                  size="square"
                  variant="ghost"
                  aria-label={`Retirer ${name}`}
                  disabled={disabled || busy}
                  onClick={() =>
                    onChange(
                      fileIds.filter((candidate) => candidate !== id),
                      externalUrls,
                    )
                  }
                >
                  <AppIcon name="close" size="small" />
                </Button>
              </li>
            );
          })}
          {externalUrls.map((url) => (
            <li key={url} className="file-property-field__row">
              <AppIcon name="link" size="small" />
              <a className="file-property-field__name" href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
              <Button
                type="button"
                size="square"
                variant="ghost"
                aria-label={`Retirer le lien ${url}`}
                disabled={disabled || busy}
                onClick={() =>
                  onChange(
                    fileIds,
                    externalUrls.filter((candidate) => candidate !== url),
                  )
                }
              >
                <AppIcon name="close" size="small" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        id={inputId}
        className="sr-only"
        type="file"
        aria-label="Ajouter un fichier"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file !== undefined) void add(file);
        }}
      />
      <Button
        type="button"
        size="compact"
        variant="ghost"
        disabled={disabled || busy}
        busy={busy}
        onClick={() => input.current?.click()}
      >
        <AppIcon name="paperclip" size="small" />
        {busy ? "Ajout…" : "Ajouter un fichier"}
      </Button>
      <div className="file-property-field__link">
        <input
          type="url"
          value={link}
          disabled={disabled || busy || fileIds.length + externalUrls.length >= 20}
          placeholder="Coller un lien externe…"
          aria-label="Lien externe"
          onChange={(event) => {
            setLink(event.currentTarget.value);
            setError(null);
          }}
        />
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={disabled || busy || link.trim() === ""}
          onClick={() => {
            const normalized = normalizeUrl(link);
            if (!normalized.ok) {
              setError("Ce lien n’est pas une URL http(s) valide.");
              return;
            }
            if (externalUrls.includes(normalized.value)) {
              setError("Ce lien est déjà ajouté.");
              return;
            }
            if (fileIds.length + externalUrls.length >= 20) {
              setError("20 fichiers ou liens maximum.");
              return;
            }
            onChange(fileIds, [...externalUrls, normalized.value]);
            setLink("");
          }}
        >
          Ajouter le lien
        </Button>
      </div>
      {error === null ? null : (
        <span className="database-field__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

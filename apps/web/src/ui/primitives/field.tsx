import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  /** Red field without text: the message lives elsewhere (see `FormMessage`). */
  readonly invalid?: boolean;
  readonly inputClassName?: string;
  readonly label: ReactNode;
  readonly optional?: boolean;
  readonly size?: "compact" | "default";
  /**
   * Control rendered inside the field's own row, after the input — the reveal
   * button of a password field, a "duplicate" action, and so on. It is positioned
   * over the input's trailing padding so the two never overlap.
   */
  readonly trailing?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    className,
    description,
    disabled = false,
    error,
    invalid = false,
    id,
    inputClassName,
    label,
    optional = false,
    required = false,
    size = "default",
    trailing,
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${inputId}-description`;
  const errorId = error === undefined ? undefined : `${inputId}-error`;
  const isInvalid = invalid || error !== undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={classNames("ui-field", className)}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid ? true : undefined}
      data-size={size}
    >
      <label className="ui-field__label" htmlFor={inputId}>
        <span>{label}</span>
        {optional && !required ? (
          <span className="ui-field__requirement">({FR_COPY.field.optional})</span>
        ) : null}
      </label>
      {description === undefined ? null : (
        <span className="ui-field__description" id={descriptionId}>
          {description}
        </span>
      )}
      {trailing === undefined ? (
        <input
          {...inputProps}
          ref={ref}
          id={inputId}
          className={classNames("ui-field__control", inputClassName)}
          disabled={disabled}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={isInvalid ? true : undefined}
        />
      ) : (
        <div className="ui-field__control-row">
          <input
            {...inputProps}
            ref={ref}
            id={inputId}
            className={classNames("ui-field__control", inputClassName)}
            disabled={disabled}
            required={required}
            aria-describedby={describedBy}
            aria-invalid={isInvalid ? true : undefined}
          />
          <span className="ui-field__trailing">{trailing}</span>
        </div>
      )}
      {error === undefined ? null : (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

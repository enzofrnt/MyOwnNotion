import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from "react";
import { classNames } from "../class-names.ts";
import { FR_COPY } from "../copy/index.ts";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly inputClassName?: string;
  readonly label: ReactNode;
  readonly optional?: boolean;
  readonly size?: "compact" | "default";
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    className,
    description,
    disabled = false,
    error,
    id,
    inputClassName,
    label,
    optional = false,
    required = false,
    size = "default",
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description === undefined ? undefined : `${inputId}-description`;
  const errorId = error === undefined ? undefined : `${inputId}-error`;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={classNames("ui-field", className)}
      data-disabled={disabled || undefined}
      data-invalid={error === undefined ? undefined : true}
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
      <input
        {...inputProps}
        ref={ref}
        id={inputId}
        className={classNames("ui-field__control", inputClassName)}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
      {error === undefined ? null : (
        <span className="ui-field__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
});

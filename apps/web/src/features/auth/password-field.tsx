/**
 * Password field for the account surfaces (feature 059).
 *
 * A password is typed blind by default, so every account surface needs the same
 * two affordances: the reveal control, and — only while a password is being
 * chosen — a strength read-out. Both live here so setup, sign-up and sign-in
 * cannot drift apart.
 *
 * The reveal control is a real button with `aria-pressed`; the strength value is
 * a meter with a textual level so the state is never carried by colour alone.
 */

import { type ReactNode, type Ref, useState } from "react";
import { FR_COPY } from "../../ui/copy/index.ts";
import { AppIcon } from "../../ui/icons.tsx";
import { Field } from "../../ui/primitives/field.tsx";
import { assessPassword, PASSWORD_MINIMUM_LENGTH } from "./password-strength.ts";

const COPY = FR_COPY.auth.password;

export interface PasswordFieldProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `current-password` for sign-in, `new-password` while creating one. */
  readonly autoComplete: "current-password" | "new-password";
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  readonly required?: boolean;
  /** Strength is only meaningful while a password is being chosen. */
  readonly showStrength?: boolean;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly testId?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function PasswordField(props: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const strength = assessPassword(props.value);
  const levelLabel = strength.isEmpty ? "—" : COPY.levelLabels[strength.level];

  return (
    <div className="ui-password-field">
      <Field
        id={props.id}
        ref={props.inputRef}
        label={props.label}
        description={props.description}
        error={props.error}
        invalid={props.invalid === true}
        type={revealed ? "text" : "password"}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        disabled={props.disabled}
        required={props.required}
        maxLength={props.maxLength}
        minLength={props.minLength}
        data-testid={props.testId}
        trailing={
          <button
            type="button"
            className="ui-password-toggle"
            aria-label={revealed ? COPY.hide : COPY.show}
            aria-pressed={revealed}
            title={revealed ? COPY.hide : COPY.show}
            disabled={props.disabled}
            onClick={() => {
              setRevealed((current) => !current);
            }}
          >
            <AppIcon name={revealed ? "eyeOff" : "eye"} size="small" />
          </button>
        }
      />

      {props.showStrength === true ? (
        <div className="ui-password-strength" data-level={strength.level}>
          <meter
            className="ui-password-strength__meter"
            min={0}
            max={strength.total}
            low={2}
            high={4}
            optimum={strength.total}
            value={strength.passed}
            aria-label={`${COPY.strengthLabel} : ${levelLabel}, ${COPY.counter
              .replace("{passed}", String(strength.passed))
              .replace("{total}", String(strength.total))}`}
          />
          <p className="ui-password-strength__label" aria-live="polite">
            <span className="ui-password-strength__level">
              {COPY.strengthLabel}&nbsp;: {levelLabel}
            </span>
            <span className="ui-password-strength__count">
              {COPY.counter
                .replace("{passed}", String(strength.passed))
                .replace("{total}", String(strength.total))}
            </span>
          </p>
          <ul className="ui-password-strength__rules">
            {strength.criteria.map((criterion) => (
              <li key={criterion.id} data-met={criterion.met}>
                {COPY.criteria[criterion.id].replace("{count}", String(PASSWORD_MINIMUM_LENGTH))}
                {criterion.required ? (
                  <span className="ui-password-strength__tag">({COPY.requiredTag})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

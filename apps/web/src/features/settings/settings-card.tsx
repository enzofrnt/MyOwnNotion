import type { HTMLAttributes, ReactNode } from "react";
import { AppIcon, type AppIconName } from "../../ui/icons.tsx";

/**
 * Feature 061 settings primitives: a card groups one topic of a settings tab,
 * with the same anatomy everywhere (icon chip + title + help, then body).
 * CSS owner: `settings-card.css`.
 */
export interface SettingsCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly icon: AppIconName;
  readonly title: ReactNode;
  readonly titleId: string;
  readonly help?: ReactNode;
  /** Right-aligned content of the header (a status pill, an action). */
  readonly aside?: ReactNode;
  readonly tone?: "default" | "danger";
  readonly children?: ReactNode;
}

export function SettingsCard({
  icon,
  title,
  titleId,
  help,
  aside,
  tone = "default",
  children,
  className,
  ...props
}: SettingsCardProps) {
  return (
    <section
      {...props}
      className={className === undefined ? "settings-card" : `settings-card ${className}`}
      data-tone={tone}
      aria-labelledby={titleId}
    >
      <header className="settings-card__header">
        <span className="settings-card__chip" aria-hidden="true">
          <AppIcon name={icon} />
        </span>
        <div className="settings-card__heading">
          <h2 id={titleId} className="settings-card__title">
            {title}
          </h2>
          {help === undefined ? null : <p className="settings-card__help">{help}</p>}
        </div>
        {aside === undefined ? null : <div className="settings-card__aside">{aside}</div>}
      </header>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

/** Label + help on one side, the control or value on the other. */
export function SettingsRow({
  label,
  help,
  children,
}: {
  readonly label: ReactNode;
  readonly help?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__copy">
        <p className="settings-row__label">{label}</p>
        {help === undefined ? null : <p className="settings-row__help">{help}</p>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

export type SettingsPillTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Status always carries text; the tint only reinforces it. */
export function SettingsPill({
  tone = "neutral",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { readonly tone?: SettingsPillTone }) {
  return (
    <span {...props} className="settings-pill" data-tone={tone}>
      {children}
    </span>
  );
}

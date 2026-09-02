import {
  DEFAULT_GRAPH_FORCES,
  formatGraphForceValue,
  GRAPH_FORCE_RANGES,
  type GraphForceSettings,
} from "@myownnotion/graph";
import type { CSSProperties } from "react";

const FORCE_FIELDS: readonly {
  readonly key: keyof GraphForceSettings;
  readonly label: string;
}[] = [
  { key: "centerForce", label: "Force centrale" },
  { key: "repelForce", label: "Force de répulsion" },
  { key: "linkForce", label: "Force de liaison" },
  { key: "linkDistance", label: "Distance des liens" },
];

export function GraphForceControls({
  forces,
  onChange,
}: {
  readonly forces: GraphForceSettings;
  readonly onChange: (forces: GraphForceSettings) => void;
}) {
  return (
    <details className="knowledge-graph-forces" open>
      <summary>Forces</summary>
      {FORCE_FIELDS.map(({ key, label }) => {
        const range = GRAPH_FORCE_RANGES[key];
        const value = forces[key];
        const fill = ((value - range.min) / Math.max(range.max - range.min, Number.EPSILON)) * 100;
        return (
          <label key={key} className="knowledge-graph-forces__row">
            <span className="knowledge-graph-forces__label">{label}</span>
            <span className="knowledge-graph-forces__value">
              {formatGraphForceValue(key, value)}
            </span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={value}
              aria-valuetext={formatGraphForceValue(key, value)}
              style={{ "--graph-force-fill": `${fill}%` } as CSSProperties}
              onChange={(event) =>
                onChange({ ...forces, [key]: Number(event.currentTarget.value) })
              }
            />
          </label>
        );
      })}
      <button
        type="button"
        className="knowledge-graph-forces__reset"
        onClick={() => onChange(DEFAULT_GRAPH_FORCES)}
      >
        Réinitialiser les forces
      </button>
    </details>
  );
}

# Contract: Canvas Projection

## Inputs

- One validated version-1 canvas attributes object.
- Current locally available page candidates keyed by stable item UUID.
- Optional selected card/stroke identities and a finite surface rectangle.

## Outputs

- Cards in canonical order with exact world geometry and resolved readable label/status.
- Connections in canonical order with stable identity, source/target identities, labels, and current center endpoints.
- Strokes in canonical order with exact point sequence and supported width.
- Saved viewport plus pure screen/world coordinate conversion.
- Semantic connection and stroke list entries that expose the same stable identities as the visual layer.

## Determinism and safety rules

1. Projection never mutates, sorts, rounds, or rewrites canonical arrays.
2. Moving/resizing a card changes only derived endpoint coordinates, never connection identity.
3. Viewport changes affect screen coordinates only, never world geometry.
4. Missing page targets resolve to `Unavailable page` and preserve stored target identity.
5. Incomplete pointer gestures are excluded because only complete strokes enter canonical attributes.
6. Private text, labels, coordinates, viewport values, and stroke points never appear in validation errors or application logs.
7. Visual connections/strokes have equivalent semantic list entries and do not rely on color alone.

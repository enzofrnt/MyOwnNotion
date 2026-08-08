# Contract: Database Projection

## Pure inputs and outputs

The planning functions accept validated database-block attributes plus an explicit view override when a test or transient UI state requires it. They return:

- the exact filtered and type-aware sorted record list;
- readable cell values resolved through current property/option/record definitions;
- board groups in option order plus Unassigned;
- gallery records in the same identity order;
- diagnostics for relation identities whose record no longer exists.

## Invariants

1. Filtering and sorting never mutate canonical schema or records.
2. Table, board, and gallery contain the same filtered record identity set exactly once.
3. Equal comparable values use record UUID as the final deterministic tie-break.
4. Empty values sort after present values in both directions.
5. A removed relation target remains readable as `Unavailable record` and is never retargeted.
6. Private names, values, and queries are not included in errors or diagnostics.

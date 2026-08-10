/**
 * Security schema (feature 002).
 *
 * Installation, owner credentials, bootstrap attempts, sessions, devices, key
 * epochs/generations, policies, record envelopes, migration checkpoints, rate
 * limits, and append-only audit rows. Every table carries `installation_id`
 * and, where applicable, `workspace_id` so singleton scoping is provable.
 *
 * Tables are added by T019; feature-001 content tables are untouched.
 */

export {};

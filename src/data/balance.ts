// Formula parameters from docs/BALANCE.md. Gameplay numbers live here, never in systems or UI.

/** BALANCE.md §1: the first 8 real hours away count fully. */
export const OFFLINE_FULL_MS = 8 * 3600_000;
/** BALANCE.md §1: the next 16 hours count at OFFLINE_REDUCED_RATE. */
export const OFFLINE_REDUCED_MS = 16 * 3600_000;
export const OFFLINE_REDUCED_RATE = 0.25;
/** Absences shorter than this are simulated without a summary modal. */
export const OFFLINE_MIN_MS = 60_000;

/** The starting plot grid (DATA_SCHEMAS.md §4.8); expansions grow it from phase 03. */
export const START_GRID = { cols: 4, rows: 2 } as const;

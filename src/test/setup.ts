/**
 * Vitest global setup.
 *
 * `fake-indexeddb/auto` installs a real in-memory IndexedDB implementation onto
 * globalThis, so the data layer can be round-trip tested in Node without a browser.
 */
import 'fake-indexeddb/auto';

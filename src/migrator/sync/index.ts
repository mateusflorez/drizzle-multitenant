/**
 * Sync module for migration synchronization
 *
 * Provides functionality to detect and resolve divergences between
 * migrations on disk and tracking in the database.
 *
 * @module migrator/sync
 */

export { SyncManager, createSyncManager } from './sync-manager.js';
export type { SyncManagerConfig, SyncManagerDependencies, InternalSyncOptions } from './types.js';

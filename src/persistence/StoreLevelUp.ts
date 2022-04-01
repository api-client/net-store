/* eslint-disable import/no-named-as-default */
import fs from 'fs/promises';
import levelUp, { LevelUp } from 'levelup';
import leveldown, { LevelDownIterator, LevelDown, Bytes } from 'leveldown';
import sub from 'subleveldown';
import { AbstractLevelDOWN } from 'abstract-leveldown';
import { Logger } from '@api-client/core';
import { StorePersistence } from './StorePersistence.js';
import { LevelHistoryStore } from './LevelHistoryStore.js';
import { LevelSessionStore } from './LevelSessionStore.js';
import { LevelUserStore } from './LevelUserStore.js';
import { LevelBinStore } from './LevelBinStore.js';
import { LevelRevisionsStore } from './LevelRevisionsStore.js';
import { LevelProjectStore } from './LevelProjectStore.js';
import { LevelSpaceStore } from './LevelSpaceStore.js';
import { LevelPermissionStore } from './LevelPermissionStore.js';
import { LevelSharedStore } from './LevelSharedStore.js';

const sessionSymbol = Symbol('session');
const historySymbol = Symbol('history');
const userSymbol = Symbol('user');
const binSymbol = Symbol('bin');
const revisionsSymbol = Symbol('revisions');
const projectSymbol = Symbol('project');
const spaceSymbol = Symbol('space');
const permissionSymbol = Symbol('permission');
const sharedSymbol = Symbol('shared');

export type DataStoreType = LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;

/**
 * The persistence layer that uses LevelUp to store data in the local file system.
 * 
 * TODO:
 * - https://github.com/fergiemcdowall/search-index
 */
export class StoreLevelUp extends StorePersistence {
  dbPath: string;
  db?: LevelUp<LevelDown, LevelDownIterator>;

  [historySymbol]: LevelHistoryStore;
  /**
   * History store.
   */
  get history(): LevelHistoryStore {
    const ref = this[historySymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [sessionSymbol]: LevelSessionStore;
  /**
   * Session store.
   */
  get session(): LevelSessionStore {
    const ref = this[sessionSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [userSymbol]: LevelUserStore;
  /**
   * User store.
   */
  get user(): LevelUserStore {
    const ref = this[userSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [binSymbol]: LevelBinStore;
  /**
   * A store that keeps track of deleted items. It has a reference to the deleted item
   * with additional metadata like when the object was deleted and by whom.
   * 
   * This store can be used to quickly identify an object that was deleted without
   * a need to read the original object from the store and deserializing it. When the
   * corresponding object is in the store it means the object was deleted.
   * 
   * This store can also be used to list deleted items from a particular place (space, project, etc.)
   */
  get bin(): LevelBinStore {
    const ref = this[binSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [revisionsSymbol]: LevelRevisionsStore;
  /**
   * A store that keeps revisions of patched objects.
   */
  get revisions(): LevelRevisionsStore {
    const ref = this[revisionsSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [projectSymbol]: LevelProjectStore;
  /**
   * A store that keeps user project objects.
   */
  get project(): LevelProjectStore {
    const ref = this[projectSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [spaceSymbol]: LevelSpaceStore;
  /**
   * A store that keeps user space objects.
   */
  get space(): LevelSpaceStore {
    const ref = this[spaceSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [permissionSymbol]: LevelPermissionStore;
  /**
   * A store for store permissions.
   */
  get permission(): LevelPermissionStore {
    const ref = this[permissionSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [sharedSymbol]: LevelSharedStore;
  /**
   * A store that references shared objects with the current user.
   */
  get shared(): LevelSharedStore {
    const ref = this[sharedSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  /**
   * @param path The path where to store the data bases.
   */
  constructor(logger: Logger, path: string) {
    super(logger);
    this.dbPath = path;
  }

  async initialize(): Promise<void> {
    const { dbPath } = this;
    await fs.mkdir(dbPath, { recursive: true });
    // @ts-ignore
    const db = levelUp(leveldown(dbPath)) as LevelUp<LevelDown, LevelDownIterator>;
    this.db = db;
    
    const history = sub<string, any>(db, "history") as DataStoreType;
    this[historySymbol] = new LevelHistoryStore(this, history);
    
    const sessions = sub<string, any>(db, 'sessions') as DataStoreType;
    this[sessionSymbol] = new LevelSessionStore(this, sessions);
    
    const users = sub<string, any>(db, 'users') as DataStoreType;
    this[userSymbol] = new LevelUserStore(this, users);

    const bin = sub<string, any>(db, 'bin') as DataStoreType;
    this[binSymbol] = new LevelBinStore(this, bin);

    const revisions = sub<string, any>(db, 'revisions') as DataStoreType;
    this[revisionsSymbol] = new LevelRevisionsStore(this, revisions);

    const projects = sub<Bytes, Bytes>(db, 'projects') as DataStoreType;
    this[projectSymbol] = new LevelProjectStore(this, projects);

    const spaces = sub<Bytes, Bytes>(db, 'spaces') as DataStoreType;
    this[spaceSymbol] = new LevelSpaceStore(this, spaces);

    const permissions = sub<Bytes, Bytes>(db, 'permissions') as DataStoreType;
    this[permissionSymbol] = new LevelPermissionStore(this, permissions);

    const shared = sub<Bytes, Bytes>(db, 'shared') as DataStoreType;
    this[sharedSymbol] = new LevelSharedStore(this, shared);
  }

  /**
   * Cleans up before closing the server.
   */
  async cleanup(): Promise<void> {
    await this.session.cleanup();
    await this.history.cleanup();
    await this.user.cleanup();
    await this.bin.cleanup();
    await this.revisions.cleanup();
    await this.project.cleanup();
    await this.space.cleanup();
    await this.permission.cleanup();
    await this.shared.cleanup();
    await this.db?.close();
  }
}

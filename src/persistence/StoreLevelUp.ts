/* eslint-disable import/no-named-as-default */
import fs from 'fs/promises';
import levelUp, { LevelUp } from 'levelup';
import leveldown, { LevelDownIterator, LevelDown, Bytes } from 'leveldown';
import sub from 'subleveldown';
import { AbstractLevelDOWN } from 'abstract-leveldown';
import { Logger } from '@api-client/core';
import { StorePersistence } from './StorePersistence.js';
import { Sessions } from './level/Session.js';
import { User } from './level/User.js';
import { Revisions } from './level/Revisions.js';
import { PermissionStore } from './level/PermissionStore.js';
import { History } from './level/History.js';
import { Bin } from './level/Bin.js';
import { Shared } from './level/Shared.js';
import { Files } from './level/Files.js';
import { Media } from './level/Media.js';

const sessionSymbol = Symbol('session');
const historySymbol = Symbol('history');
const userSymbol = Symbol('user');
const binSymbol = Symbol('bin');
const revisionsSymbol = Symbol('revisions');
const fileSymbol = Symbol('file');
const permissionSymbol = Symbol('permission');
const sharedSymbol = Symbol('shared');
const mediaSymbol = Symbol('media');

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

  [historySymbol]: History;
  /**
   * History store.
   */
  get history(): History {
    const ref = this[historySymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [sessionSymbol]: Sessions;
  /**
   * Session store.
   */
  get session(): Sessions {
    const ref = this[sessionSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [userSymbol]: User;
  /**
   * User store.
   */
  get user(): User {
    const ref = this[userSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [binSymbol]: Bin;
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
  get bin(): Bin {
    const ref = this[binSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [revisionsSymbol]: Revisions;
  /**
   * A store that keeps revisions of patched objects.
   */
  get revisions(): Revisions {
    const ref = this[revisionsSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [fileSymbol]: Files;

  /**
   * File metadata store.
   */
  get file(): Files {
    const ref = this[fileSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [mediaSymbol]: Media;

  /**
   * The contents of a File.
   */
  get media(): Media {
    const ref = this[mediaSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [permissionSymbol]: PermissionStore;
  /**
   * A store for store permissions.
   */
  get permission(): PermissionStore {
    const ref = this[permissionSymbol];
    if (!ref) {
      throw new Error(`Store not initialized.`);
    }
    return ref;
  }

  [sharedSymbol]: Shared;
  /**
   * A store that references shared objects with the current user.
   */
  get shared(): Shared {
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
    this[historySymbol] = new History(this, history);
    
    const sessions = sub<string, any>(db, 'sessions') as DataStoreType;
    this[sessionSymbol] = new Sessions(this, sessions);
    
    const users = sub<string, any>(db, 'users') as DataStoreType;
    this[userSymbol] = new User(this, users);

    const bin = sub<string, any>(db, 'bin') as DataStoreType;
    this[binSymbol] = new Bin(this, bin);

    const revisions = sub<string, any>(db, 'revisions') as DataStoreType;
    this[revisionsSymbol] = new Revisions(this, revisions);

    const files = sub<Bytes, Bytes>(db, 'files') as DataStoreType;
    this[fileSymbol] = new Files(this, files);

    const media = sub<Bytes, Bytes>(db, 'media') as DataStoreType;
    this[mediaSymbol] = new Media(this, media);

    const permissions = sub<Bytes, Bytes>(db, 'permissions') as DataStoreType;
    this[permissionSymbol] = new PermissionStore(this, permissions);

    const shared = sub<Bytes, Bytes>(db, 'shared') as DataStoreType;
    this[sharedSymbol] = new Shared(this, shared);
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
    await this.file.cleanup();
    await this.media.cleanup();
    await this.permission.cleanup();
    await this.shared.cleanup();
    await this.db?.close();
  }
}

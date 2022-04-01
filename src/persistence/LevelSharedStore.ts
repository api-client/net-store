import { IListResponse, IUser, IListOptions, IWorkspace } from '@api-client/core';
import { AbstractIteratorOptions, DelBatch } from 'abstract-leveldown';
import { SubStore } from './SubStore.js';
import { IListState, ISharedStore } from './LevelStores.js';
import { KeyGenerator } from './KeyGenerator.js';

export type SharedTypes = 'space';

export interface ISharedLink {
  /**
   * The data target of the link
   */
  id: string;
  /**
   * The user id that is the target user.
   */
  uid: string;
  /**
   * The closest parent of the data.
   */
  parent?: string;
}

type SupportedType = 'space';

/**
 * The store that keeps a reference between a user and items shared with the user.
 * 
 * When a user shares an object with another user this information ends up
 * in this registry to allow iterating over shared items. No actual data is stored here
 * but a reference to the corresponding store.
 * 
 * When a user shares an object with another user, the logic adds
 * the permission object to the target object (the shared object) but to associate
 * the shared entity with a user that has the permission while listing for shared items
 * it also adds an entry in this store. The store lists the shared items and returns 
 * the associated targets.
 * 
 * Keys are built as `~` + shared type + `~` + target user key + `~` + target id + `~`.
 * 
 * The shared type is a constant that describes the object like `space` for spaces.
 * This way it is possible to list objects per user per type.
 */
export class LevelSharedStore extends SubStore implements ISharedStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Adds a space to the shared spaced for a user
   * @param space The shared space
   * @param userId The target user
   */
  async addSpace(space: IWorkspace, userId: string): Promise<void> {
    const key = KeyGenerator.sharedSpace(space.key, userId);
    const data: ISharedLink = {
      id: space.key,
      uid: userId,
    };
    if (space.parents.length) {
      const parent = space.parents[space.parents.length - 1];
      data.parent = parent;
    }
    await this.db.put(key, this.parent.encodeDocument(data));
  }

  /**
   * Removes a reference to a shared space from the user.
   * 
   * @param spaceId The id of the previously shared space
   * @param userId The target user id.
   */
  async removeSpace(spaceId: string, userId: string): Promise<void> {
    const key = KeyGenerator.sharedSpace(spaceId, userId);
    try {
      await this.db.del(key);
    } catch (e) {
      // 
    }
  }

  /**
   * Lists spaces shared with the user.
   * 
   * @param user The user to list for shared spaces.
   * @param options Query options.
   * @returns The list of spaces that are shared with the user.
   */
  async listSpaces(user: IUser, options?: IListOptions): Promise<IListResponse<IWorkspace>> {
    const state = await this.parent.readListState(options);
    
    const lk = state.lastKey ? KeyGenerator.sharedSpace(state.lastKey, user.key) : undefined;
    
    const ids = await this.getIds(state, user.key, 'space', lk);
    const lastKey = ids.length ? ids[ids.length - 1] : undefined;

    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse<IWorkspace> = {
      data: [],
      cursor,
    };
    const spaces = await this.parent.space.db.getMany(ids);
    spaces.forEach((item) => {
      if (!item) {
        return;
      }
      const space = this.parent.decodeDocument(item) as IWorkspace;
      result.data.push(space);
    });
    return result;
  }

  private async getIds(state: IListState, userKey: string, type: SupportedType, lastKey?: string): Promise<string[]> {
    const { limit = this.parent.defaultLimit, parent } = state;

    const ids: string[] = [];
    let remaining = limit;

    const itOpts: AbstractIteratorOptions = {
      gte: `~${type}~${userKey}~`,
      lte: `~${type}~${userKey}~~`,
      reverse: true,
      keys: false,
    };

    const iterator = this.db.iterator(itOpts);
    if (lastKey) {
      iterator.seek(lastKey);
      // @ts-ignore
      await iterator.next();
    }

    try {
      // @ts-ignore
      for await (const [, value] of iterator) {
        const obj = JSON.parse(value) as ISharedLink;
        if (obj.parent && parent && obj.parent !== parent) {
          continue;
        } else if ((!obj.parent && parent) || (!parent && obj.parent)) {
          continue;
        }
        ids.push(obj.id);
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    return ids;
  }

  /**
   * Removes all entries that are linking to a `target`
   * @param target The key if the target.
   */
  async deleteByTarget(target: string): Promise<void> {
    const ops: DelBatch[] = [];
    const suffix = `~${target}~`;
    const itOpts: AbstractIteratorOptions = {
      values: false,
    };
    const iterator = this.db.iterator(itOpts);
    try {
      // @ts-ignore
      for await (const [key] of iterator) {
        const k = key.toString() as string;
        if (k.endsWith(suffix)) {
          ops.push({
            key: k,
            type: 'del',
          });
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    if (ops.length) {
      await this.db.batch(ops);
    }
  }
}

import { Bytes } from 'leveldown';
import { IUser, IListResponse, IListOptions, ICursorOptions } from '@api-client/core';
import { SubStore } from './SubStore.js';
import { IUserStore } from './StorePersistence.js';

/**
 * The part of the store that takes care of the user data.
 */
export class LevelUserStore extends SubStore implements IUserStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Adds a new user to the system.
   * This is only called after a successful authentication.
   * 
   * @param userKey The user key.
   * @param user The user to store.
   */
  async add(userKey: string, user: IUser): Promise<void> {
    await this.db.put(userKey, this.parent.encodeDocument(user));
  }

  /**
   * Reads the user data from the store.
   * 
   * @param userKey The user key.
   */
  async read(userKey: string): Promise<IUser | undefined>;
  /**
   * Reads multiple system users with one query. Typically used when the UI asks for
   * user data to render "user pills" in the access control list.
   * 
   * @param userKeys The list of user keys.
   * @returns Ordered list of users defined by the `userKeys` order.
   * Note, when the user is not found an `undefined` is set at the position.
   */
  async read(userKeys: string[]): Promise<IListResponse>;

  /**
   * Reads a user or a full list of users from the store.
   */
  async read(init: string | string[]): Promise<IListResponse | IUser | undefined> {
    if (typeof init === 'string') {
      let raw: Bytes;
      try {
        raw = await this.db.get(init);
      } catch (e) {
        return;
      }
      return this.parent.decodeDocument(raw) as IUser;
    }
    const items = await this.db.getMany(init);
    const data: (IUser|undefined)[] = items.map((raw) => {
      if (!raw) {
        return undefined;
      }
      return this.parent.decodeDocument(raw) as IUser;
    });
    const result: IListResponse = {
      data,
    };
    return result;
  }

  /**
   * Lists the registered users.
   * The final list won't contain the current user.
   * The user can query for a specific data utilizing the `query` filed.
   */
  async list(options?: IListOptions | ICursorOptions): Promise<IListResponse> {
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit } = state;
    const iterator = this.db.iterator();
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IUser[] = [];
    let remaining = limit;
    const lowerQuery = state.query ? state.query.toLowerCase() : undefined;
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.parent.decodeDocument(value) as IUser;
        if ((item as any)._deleted) {
          continue;
        }
        if (lowerQuery && !this.filter(item, lowerQuery)) {
          continue;
        }
        data.push(item);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Checks whether user data contains the `query`.
   * 
   * @param user The user object
   * @param lowerQuery The lowercase query
   * @returns True when the `query` is in the user name or email.
   */
  filter(user: IUser, lowerQuery: string): boolean {
    const { name='', email } = user;
    if (name.toLocaleLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (Array.isArray(email)) {
      const hasEmail = email.some(i => (i.email || '').toLowerCase().includes(lowerQuery));
      if (hasEmail) {
        return hasEmail;
      }
    }
    return false;
  }

  /**
   * Lists users that do not exist in the system
   * @param keys The list of user keys to test.
   * @returns If empty list then all users are set in the store. Returned is the list of keys of missing records.
   */
  async listMissing(keys: string[]): Promise<string[]> {
    const data = await this.db.getMany(keys);
    const result: string[] = [];
    data.forEach((item, index) => {
      if (!item) {
        result.push(keys[index]);
      }
    });
    return result;
  }
}

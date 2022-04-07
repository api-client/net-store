import { Bytes } from 'leveldown';
import { SubStore } from '../SubStore.js';
import { ISessionStore } from './AbstractSessions.js';

/**
 * The part of the store that takes care of the session data.
 */
export class Sessions extends SubStore implements ISessionStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Permanently stores session data in the data store.
   * 
   * @param key The session identifier
   * @param value The value to store.
   */
  async set(key: string, value: unknown): Promise<void> {
    await this.db.put(key, this.parent.encodeDocument(value));
  }

  /**
   * Permanently destroys session data in the data store.
   * 
   * @param key The session identifier
   */
  async delete(key: string): Promise<void> {
    try {
      await this.db.del(key);
    } catch (e) {
      // ....
    }
  }

  /**
   * Reads the session data from the store.
   * 
   * @param key The session identifier
   */
  async read(key: string): Promise<unknown | undefined> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      return;
    }
    return this.parent.decodeDocument(raw);
  }
}

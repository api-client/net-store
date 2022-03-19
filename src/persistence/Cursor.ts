import { Config } from '../lib/Config.js';
import { Encryption } from '../lib/Encryption.js';
import { IListState, HistoryState } from './StorePersistence.js';
import { ApiError } from '../ApiError.js';

/**
 * A class that serializes and deserializes the pagination cursor.
 */
export class Cursor {
  config = new Config();

  /**
   * Reads the cursor received from the client by decrypting its contents.
   * It throws an error when the cursor is invalid
   */
  async decodeCursor(cursor: string): Promise<IListState> {
    const config = await this.config.read();
    const encryption = new Encryption();
    let result: IListState;
    try {
      const data = encryption.decrypt(cursor, config.secret);
      result = JSON.parse(data);
    } catch (e) {
      throw new ApiError(`Invalid page cursor.`, 400);
    }
    return result;
  }

  async encodeCursor(state: IListState, lastKey?: string): Promise<string> {
    const copy: IListState = { ...state };
    // @ts-ignore
    delete copy.cursor;
    if (lastKey) {
      copy.lastKey = lastKey;
    }
    const str = JSON.stringify(copy);
    const config = await this.config.read();
    const encryption = new Encryption();
    return encryption.encrypt(str, config.secret);
  }

  /**
   * Reads the cursor received from the client by decrypting its contents.
   * It throws an error when the cursor is invalid
   */
  async decodeHistoryCursor(cursor: string): Promise<HistoryState> {
    const config = await this.config.read();
    const encryption = new Encryption();
    let result: HistoryState;
    try {
      const data = encryption.decrypt(cursor, config.secret);
      result = JSON.parse(data);
    } catch (e) {
      throw new ApiError(`Invalid page cursor.`, 400);
    }
    return result;
  }

  async encodeHistoryCursor(state: HistoryState, lastKey?: string): Promise<string> {
    const copy: HistoryState = { ...state };
    if (lastKey) {
      copy.lastKey = lastKey;
    }
    const str = JSON.stringify(copy);
    const config = await this.config.read();
    const encryption = new Encryption();
    return encryption.encrypt(str, config.secret);
  }
}

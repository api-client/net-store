import { IUser } from '@api-client/core';
import { SubStore } from '../SubStore.js';
import { KeyGenerator } from '../KeyGenerator.js';
import DefaultUser from '../../authentication/DefaultUser.js';
import { IBinStore } from './AbstractBin.js';

export interface IBinItem {
  /**
   * The user deleting the object.
   */
  deletedBy?: string;
  /**
   * The DB key of the object that has been deleted.
   */
  key: string;
  /**
   * The timestamp when the record was deleted.
   */
  deletedTime: number;
}

/**
 * The part of the store that takes care of the user data.
 */
export class Bin extends SubStore implements IBinStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async add(key: string, user: IUser): Promise<void> {
    const time = Date.now();
    const binItem: IBinItem = {
      key,
      deletedTime: time,
    };
    if (user.key !== DefaultUser.key) {
      binItem.deletedBy = user.key;
    }
    await this.db.put(key, this.parent.encodeDocument(binItem));
  }

  async isDeleted(key: string): Promise<boolean> {
    let deleted = false;
    try {
      await this.db.get(key);
      deleted = true;
    } catch (e) {
      // ...
    }
    return deleted;
  }

  async isSpaceDeleted(space: string): Promise<boolean> {
    const key = KeyGenerator.deletedSpaceKey(space);
    return this.isDeleted(key);
  }

  async isUserDeleted(user: string): Promise<boolean> {
    const key = KeyGenerator.deletedUserKey(user);
    return this.isDeleted(key);
  }

  async isProjectDeleted(space: string, project: string): Promise<boolean> {
    const spaceDeleted = await this.isSpaceDeleted(space);
    if (spaceDeleted) {
      return true;
    }
    const key = KeyGenerator.deletedProjectKey(project);
    return this.isDeleted(key);
  }

  async isFileDeleted(kind: string, ...ids: string[]): Promise<boolean> {
    const key = KeyGenerator.deletedKey(kind, ...ids);
    return this.isDeleted(key);
  }
}

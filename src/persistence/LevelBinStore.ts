import { IUser } from '@api-client/core';
import { SubStore } from './SubStore.js';
import { KeyGenerator } from './KeyGenerator.js';
import DefaultUser from '../authentication/DefaultUser.js';
import { IBinStore } from './StorePersistence.js';

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
export class LevelBinStore extends SubStore implements IBinStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Marks an item as deleted.
   * 
   * @param key The key of the item that has been deleted.
   * @param user The current user.
   */
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

  /**
   * Tests the `trashBin` store against passed key.
   * @param key The `trashBin` key.
   * @returns True when the object has been deleted and added to the trash registry.
   */
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

  /**
   * Checks the bin store whether a space has been deleted.
   * @param space The space key to test.
   * @returns True when the space has been deleted.
   */
  async isSpaceDeleted(space: string): Promise<boolean> {
    const key = KeyGenerator.deletedSpaceKey(space);
    return this.isDeleted(key);
  }

  /**
   * Checks the bin store for whether a user has been deleted.
   * @param user The user key to test.
   * @returns True when the user has been deleted.
   */
  async isUserDeleted(user: string): Promise<boolean> {
    const key = KeyGenerator.deletedUserKey(user);
    return this.isDeleted(key);
  }

  /**
   * Checks the bin store for whether an HTTP project has been deleted.
   * @param space The key of the owning space
   * @param project The key of the project
   * @returns True when the project has been deleted.
   */
  async isProjectDeleted(space: string, project: string): Promise<boolean> {
    const spaceDeleted = await this.isSpaceDeleted(space);
    if (spaceDeleted) {
      return true;
    }
    const key = KeyGenerator.deletedProjectKey(space, project);
    return this.isDeleted(key);
  } 
}

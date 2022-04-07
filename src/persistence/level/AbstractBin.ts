import { IUser } from '@api-client/core';

export interface IBinStore {
  /**
   * Adds an entity to the deleted list.
   * 
   * @param key The key of the deleted entity. Use the KeyGenerator to generate a key.
   * @param user The deleting user.
   */
  add(key: string, user: IUser): Promise<void>;
  /**
   * Checks whether an entity is deleted.
   * @param key The key of the entity.
   * @returns True when the object has been deleted and added to the trash registry.
   */
  isDeleted(key: string): Promise<boolean>;
  /**
   * Checks whether user is deleted 
   * 
   * @param user The user key to test
   * @returns True when the user has been deleted.
   */
  isUserDeleted(user: string): Promise<boolean>;
  /**
   * Shorthand for `isFileDeleted()` for a space
   * @param space The space key.
   */
  isSpaceDeleted(space: string): Promise<boolean>;
  /**
   * Shorthand for `isFileDeleted()` for a project
   * @param space The project's space key.
   * @param project The project.
   * @returns True when the project has been deleted.
   */
  isProjectDeleted(space: string, project: string): Promise<boolean>;

  /**
   * Checks whether a file is deleted.
   * 
   * @param kind The kind of a file to test
   * @param ids The ids that compose of the key.
   */
  isFileDeleted(kind: string, ...ids: string[]): Promise<boolean>;
}

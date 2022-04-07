import { IUser, IHttpProject } from '@api-client/core';
import { JsonPatch } from 'json8-patch';

/**
 * The part of the store that takes care of the project data.
 * 
 * Note, this class does not check for permissions as this should happen 
 * on the `files` store.
 * 
 * ## Relationship to Files
 * 
 * The files store stores project's metadata and each application 
 * listing spaces or projects must use the `files` endpoint.
 * This is a separate store for the project contents and is accessible 
 * through the files route with the `alt=media` parameter.
 * 
 * The HTTP route decides which object to update depending on the `alt` parameter.
 */
export interface IProjectsStore {
  /**
   * Saves a project contents in the store.
   * 
   * Note, this method does not check for permissions. This must be performed on the `file`.
   * 
   * @param key The project key
   * @param project The project to insert.
   */
  add(key: string, project: IHttpProject): Promise<void>;
  /**
   * Reads the project data.
   * 
   * Note, this method does not check for permissions. This must be performed on the `file`.
   * 
   * @param key The project key
   */
  read(key: string): Promise<IHttpProject>;
  /**
   * Deletes a project.
   * 
   * @param key The project key
   * @param user The deleting user
   */
  delete(key: string, user: IUser): Promise<void>;
  /**
   * Applies a patch information to the project.
   * 
   * This method does not check for file access. This must be performed on the `file`.
   * 
   * @param key The project key
   * @param patch The patch to apply
   * @param user The patching user
   * @returns The revert information of the patch.
   */
  applyPatch(key: string, patch: JsonPatch, user: IUser): Promise<JsonPatch>;
}

import { WorkspaceKind, HttpProjectKind, UserKind } from '@api-client/core';
import { AltType } from './level/AbstractRevisions.js';

/**
 * The key generator for the Level DB implementation of the API CLient's data store.
 */
export class KeyGenerator {
  static deletedKey(kind: string, ...keys: string[]): string {
    const k = this.normalizeKind(kind);
    return `~${k}~${keys.join('~')}~`;
  }

  static deletedSpaceKey(key: string): string {
    return this.deletedKey(WorkspaceKind, key);
  }
  
  static deletedUserKey(key: string): string {
    return this.deletedKey(UserKind, key);
  }
  
  static deletedProjectKey(project: string): string {
    return this.deletedKey(HttpProjectKind, project);
  }

  static projectKey(space: string, project: string): string {
    return `~${space}~${project}~`;
  }

  static historyDataKey(time: string, user: string): string {
    return `~${user}~${time}~`;
  }

  static historySpaceKey(time: string, space: string, user: string): string {
    return `~${space}~${user}~${time}~`;
  }

  static historyProjectKey(time: string, project: string, user: string): string {
    return `~${project}~${user}~${time}~`;
  }

  static historyRequestKey(time: string, request: string, user: string): string {
    return `~${request}~${user}~${time}~`;
  }

  static historyAppKey(time: string, app: string, user: string): string {
    return `~${app}~${user}~${time}~`;
  }

  static revisionKey(key: string, time: string, alt: AltType = "media"): string {
    return `~${alt}~${key}~${time}~`;
  }

  static sharedFile(kind: string, file: string, user: string): string {
    const k = this.normalizeKind(kind);
    return `~${k}~${user}~${file}~`;
  }

  static normalizeKind(kind: string): string {
    return kind.toLowerCase().replace('#', '');
  }
}

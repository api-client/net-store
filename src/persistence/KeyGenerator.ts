/**
 * The key generator for the Level DB implementation of the ARC's data store.
 */
export class KeyGenerator {
  static deletedSpaceKey(key: string): string {
    return `~space~${key}~`;
  }
  
  static deletedUserKey(key: string): string {
    return `~user~${key}~`;
  }
  
  static deletedProjectKey(space: string, project: string): string {
    return `~project~${space}~${project}~`;
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

  static projectRevisionKey(key: string, time: string): string {
    return `~project~${key}~${time}~`;
  }
}

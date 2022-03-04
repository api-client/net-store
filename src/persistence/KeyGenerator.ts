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
}

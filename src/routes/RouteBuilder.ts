/**
 * A helper class to make sure routes user and reported by this service are consistent.
 */
export class RouteBuilder {
  /**
   * @returns The path to the /spaces route.
   */
  static buildSpacesRoute(): string {
    return '/spaces';
  }

  /**
   * @returns The path to the /spaces/[id] route.
   */
  static buildSpaceRoute(key: string): string {
    return `/spaces/${key}`;
  }

  /**
   * @returns The path to the /spaces/[id]/users route.
   */
  static buildSpaceUsersRoute(key: string): string {
    return `/spaces/${key}/users`;
  }

  /**
   * @returns The path to the /spaces/[id]/projects route.
   */
  static buildSpaceProjectsRoute(key: string): string {
    return `/spaces/${key}/projects`;
  }

  /**
   * @returns The path to the /spaces/[id]/projects/[id] route.
   */
  static buildSpaceProjectRoute(space: string, project: string): string {
    return `/spaces/${space}/projects/${project}`;
  }

  /**
   * @returns The path to the /spaces/[id]/projects/[id]/revisions route.
   */
  static buildProjectRevisionsRoute(space: string, project: string): string {
    return `/spaces/${space}/projects/${project}/revisions`;
  }

  /**
   * @returns The path to the /backend route.
   */
  static buildBackendRoute(): string {
    return '/store';
  }

  static buildSessionsRoute(): string {
    return '/sessions'
  }

  static buildSessionRenewRoute(): string {
    return '/sessions/renew'
  }

  static buildUsersMeRoute(): string {
    return '/users/me'
  }

  static buildUsersRoute(): string {
    return '/users'
  }

  static buildUserRoute(key: string): string {
    return `/users/${key}`
  }

  static history(): string {
    return `/history`;
  }

  static historyItem(key: string): string {
    return `/history/${key}`;
  }
}

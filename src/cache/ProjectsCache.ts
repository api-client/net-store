import { IHttpProject } from '@advanced-rest-client/core';

interface ProjectState {
  /**
   * The project object
   */
  data: IHttpProject;
  /**
   * The key of the space
   */
  space: string;
  /**
   * The key of the project
   */
  project: string;
  /**
   * The timestamp when the project data was last accessed.
   */
  lastAccess: number;
}

/**
 * A cache for projects data.
 * To enable GC call the `initialize()` first. You should also call the `cleanup()` when exiting.
 */
class ProjectsCache {
  /**
   * Cache life time. Default it is one hour.
   */
  ttl = 60 * 60 * 1000;
  /**
   * The key is the id of the project.
   * Even though a project is related to a space, it always has a unique id.
   */
  projects: Map<string, ProjectState> = new Map();

  protected gcTimer?: NodeJS.Timer;

  /**
   * Initializes the GC process.
   */
  initialize(): void {
    this.gcTimer = setInterval(this._gc.bind(this), 10 * 60 * 1000);
  }

  /**
   * Clears the list of projects ans the GC.
   */
  cleanup(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = undefined;
    }
    this.projects.clear();
  }

  /**
   * Reads the cache data and updates the `lastAccess` for GC.
   * 
   * @param key The project key
   * @returns The project cache state object. Note, these are passed by reference. Changing the returned project will update the cache.
   */
  get(key: string): ProjectState | undefined {
    const cached = this.projects.get(key);
    if (cached) {
      cached.lastAccess = Date.now();
    }
    return cached;
  }

  /**
   * Adds a project to the cache. It revalidates the `lastAccess` for GC.
   * 
   * @param space The space key
   * @param project The project key
   * @param data The project data.
   */
  set(space: string, project: string, data: IHttpProject): void {
    this.projects.set(project, {
      data,
      project,
      space,
      lastAccess: Date.now(),
    });
  }

  /**
   * Removes from cache projects that were accessed longer than its last access time + the set TTL.
   */
  protected _gc(): void {
    const { ttl, projects } = this;
    if (!projects.size) {
      return;
    }
    const now = Date.now();
    const stale: string[] = [];
    projects.forEach((state, key) => {
      if (state.lastAccess + ttl <= now) {
        stale.push(key);
      }
    });
    stale.forEach((key) => {
      projects.delete(key);
    });
  }
}

const instance = new ProjectsCache();
export default instance;

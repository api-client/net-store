import { LevelUp } from 'levelup';
import { LevelDownIterator, Bytes } from 'leveldown';
import { AbstractLevelDOWN } from 'abstract-leveldown';
import sub from 'subleveldown';
import { DataStoreType, StoreLevelUp } from '../StoreLevelUp.js';
import { SubStore } from '../SubStore.js';
import { IAppStore } from './AbstractApp.js';
import { AppRequests } from './AppRequests.js';
import { AppProjects } from './AppProjects.js';

/**
 * The App store keeps well defined data that are stored by applications in the 
 * API Cloud ecosystem.
 * 
 * Currently the store supports the following data:
 * 
 * - AppProject
 * - AppRequest
 */
export class App extends SubStore implements IAppStore {
  projects: AppProjects;
  requests: AppRequests;

  /**
   * @param parent The parent data store object
   * @param db The parent database to use to store the data into.
   */
  constructor(parent: StoreLevelUp, db: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>) {
    super(parent, db);

    const projects = sub<string, any>(db, "projects") as DataStoreType;
    this.projects = new AppProjects(parent, projects);

    const requests = sub<string, any>(db, "requests") as DataStoreType;
    this.requests = new AppRequests(parent, requests);
  }

  async cleanup(): Promise<void> {
    await this.projects.cleanup();
    await this.requests.cleanup();
  }
}

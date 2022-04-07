import { IWorkspace } from '@api-client/core';
import { StoreLevelUp } from '../../index.js';
import { DataHelper } from './DataHelper.js';

export class TestStore extends StoreLevelUp {
  async clearUsers(): Promise<void> {
    await this.user.db.clear();
  }

  async clearSessions(): Promise<void> {
    await this.session.db.clear();
  }

  async clearFiles(): Promise<void> {
    await this.file.db.clear();
  }

  async clearProjects(): Promise<void> {
    await this.project.db.clear();
  }

  async clearRevisions(): Promise<void> {
    await this.revisions.db.clear();
  }

  async clearBin(): Promise<void> {
    await this.bin.db.clear();
  }

  async generateSpaces(owner: string, size=25): Promise<IWorkspace[]> {
    return DataHelper.generateFiles(this, owner, size);
  }

  // async generateProjects(spaceKey: string, size=25): Promise<IHttpProject[]> {
  //   return DataHelper.generateProjects(this, spaceKey, size);
  // }

  async generateRevisions(projectKey: string, size=25): Promise<void> {
    return DataHelper.generateRevisions(this, projectKey, size);
  }
}

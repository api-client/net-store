import { IWorkspace, IHttpProject } from '@api-client/core';
import { StoreLevelUp } from '../../index.js';
import { DataHelper } from './DataHelper.js';

export class TestStore extends StoreLevelUp {
  async clearUsers(): Promise<void> {
    await this.user.db.clear();
  }

  async clearSessions(): Promise<void> {
    await this.session.db.clear();
  }

  async clearSpaces(): Promise<void> {
    await this.space.db.clear();
  }

  async clearProjects(): Promise<void> {
    await this.project.index.clear();
    await this.project.data.clear();
  }

  async clearRevisions(): Promise<void> {
    await this.revisions.db.clear();
  }

  async clearBin(): Promise<void> {
    await this.bin.db.clear();
  }

  async generateSpaces(size=25, owner?: string): Promise<IWorkspace[]> {
    return DataHelper.generateSpaces(this, size, owner);
  }

  async generateProjects(spaceKey: string, size=25): Promise<IHttpProject[]> {
    return DataHelper.generateProjects(this, spaceKey, size);
  }

  async generateRevisions(projectKey: string, size=25): Promise<void> {
    return DataHelper.generateRevisions(this, projectKey, size);
  }
}

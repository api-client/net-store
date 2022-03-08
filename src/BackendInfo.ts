import { IBackendInfo } from '@api-client/core';
import { ServerMode } from './definitions.js';

export class BackendInfo {
  mode: ServerMode = 'single-user';
  prefix?: string;
  /**
   * The path to the authentication endpoint.
   */
  authPath = '/auth/login';
  /**
   * This is not intended for production.
   * It tells the API that it is running in a testing mode
   * (it has unprotected API to destroy data!)
   */
  testing = false;

  toJSON(): IBackendInfo {
    const info: IBackendInfo = {
      mode: this.mode,
      authPath: this.authPath,
    };
    if (this.prefix) {
      info.prefix = this.prefix;
    }
    return info as IBackendInfo;
  }
}

import { IBackendInfo } from '@advanced-rest-client/core';

export class BackendInfo {
  hasAuthentication = false;
  /**
   * This is not intended for production.
   * It tells the API that it is running in a testing mode
   * (it has unprotected API to destroy data!)
   */
  testing = false;

  toJSON(): IBackendInfo {
    const info: IBackendInfo = {
      hasAuthentication: this.hasAuthentication,
    };
    return info;
  }
}

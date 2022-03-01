import { IBackendInfo } from '@advanced-rest-client/core';

class BackendInfo {
  hasAuthentication = false;

  toJSON(): IBackendInfo {
    const info: IBackendInfo = {
      hasAuthentication: this.hasAuthentication,
    };
    return info;
  }
}
const instance = new BackendInfo();
export default instance;

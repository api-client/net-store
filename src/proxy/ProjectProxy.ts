/* eslint-disable no-unused-vars */
import { ApiError, IProjectRunnerOptions, StoreSdk, IHttpProject, HttpProject, ProjectSerialRunner, ProjectParallelRunner } from "@api-client/core";
import Proxy, { IProxyResult } from "./Proxy.js";

export interface IProjectProxyInit {
  kind: 'Core#Project';
  pid: string; 
  opts: IProjectRunnerOptions;
  token: string;
  baseUri: string;
}

/**
 * Runs requests from a project read from the store.
 */
export default class ProjectProxy extends Proxy {
  project?: HttpProject;
  opts?: IProjectRunnerOptions;

  async configure(pid: string, opts: IProjectRunnerOptions, token: string, baseUri: string): Promise<void> {
    if (!pid) {
      throw new ApiError(`The "pid" parameter is required.`, 400);
    }
    if (!token) {
      throw new ApiError(`The "token" parameter is required.`, 400);
    }
    if (!baseUri) {
      throw new ApiError(`The "baseUri" parameter is required.`, 400);
    }
    if (!opts) {
      throw new ApiError(`The "opts" parameter is required.`, 400);
    }
    const sdk = new StoreSdk(baseUri);
    sdk.token = token;
    let project: IHttpProject;
    try {
      project = await sdk.file.read(pid, true) as IHttpProject;
    } catch (cause) {
      const e = cause as Error;
      throw new ApiError(e.message, 400);
    }
    if (project.key !== pid) {
      throw new ApiError(`Unable to read the project.`, 500);
    }
    this.opts = opts;
    this.project = new HttpProject(project);
  }
  
  async execute(): Promise<IProxyResult> {
    const project = this.project as HttpProject;
    const opts = this.opts as IProjectRunnerOptions;
    let factory: ProjectParallelRunner | ProjectSerialRunner;
    if (opts.parallel) {
      factory = new ProjectParallelRunner(project, opts);
    } else {
      factory = new ProjectSerialRunner();
      factory.configure(project, opts);
    }

    // eslint-disable-next-line no-inner-declarations
    function unhandledRejection(): void { }
    // the executing library handles all related errors it need.
    // However, when executing a request to an unknown host Node process may 
    // throw unhandled error event when the error is properly reported by the 
    // application. This suppresses these errors.
    // Note, uncomment this line for debug.
    process.on('unhandledRejection', unhandledRejection);
    const report = await factory.execute();
    process.off('unhandledRejection', unhandledRejection);
    return {
      body: Buffer.from(JSON.stringify(report)),
    };
  }
}

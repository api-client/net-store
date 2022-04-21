/* eslint-disable no-unused-vars */
import { IHttpRequest, IRequestAuthorization, IRequestBaseConfig, ApiError, CoreEngine, HttpEngineOptions } from "@api-client/core";
import { URL } from 'url';
import Proxy, { IProxyResult } from "./Proxy.js";

export interface IRequestProxyInit {
  kind: 'Core#Request';
  request: IHttpRequest; 
  authorization?: IRequestAuthorization[]; 
  config?: IRequestBaseConfig;
}

/**
 * Proxies a single HTTP request
 */
export default class RequestProxy extends Proxy {
  request?: IHttpRequest; 
  authorization?: IRequestAuthorization[]; 
  config?: IRequestBaseConfig;

  async configure(request: IHttpRequest, authorization?: IRequestAuthorization[], config?: IRequestBaseConfig): Promise<void> {
    if (!request) {
      throw new ApiError(`The "request" parameter is required.`, 400);
    }
    if (!request.url) {
      throw new ApiError(`The "request.url" parameter is required.`, 400);
    }
    if (!this.isUrlValid(request.url)) {
      throw new ApiError(`The url ${request.url} is invalid.`, 400);
    }
    this.request = request;
    this.authorization = authorization;
    this.config = config;
  }

  async execute(body?: Buffer): Promise<IProxyResult> {
    const request = this.request as IHttpRequest;
    if (body) {
      request.payload = {
        type: 'buffer',
        data: [...body],
      };
    }
    const { config = {} } = this;
    const init: HttpEngineOptions = {
      ...config,
      authorization: this.authorization,
    };

    const engine = new CoreEngine(request, init);
    const result = await engine.send();
    return {
      body: Buffer.from(JSON.stringify(result)),
    };
  }

  protected isUrlValid(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch (err) {
      return false;
    }
  }
}

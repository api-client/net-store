import { Request, ParameterizedContext } from 'koa';
import { ApiError, IApiError } from '@api-client/core';

export default class ApiRoute {
  get jsonType(): string {
    return 'application/json';
  }

  /**
   * Takes an Error object (preferably the ApiError) and response with an error.
   * @param ctx 
   * @param cause 
   */
  protected errorResponse(ctx: ParameterizedContext, cause: any): void {
    const e = cause as IApiError;
    const error = new ApiError(e.message || 'Unknown error', e.code || 400);
    error.detail = e.detail;
    ctx.body = this.wrapError(error);
    ctx.status = error.code;
    ctx.type = this.jsonType;
  }

  protected wrapError(cause: ApiError): IApiError {
    const { code = 500, detail, message } = cause;
    return {
      error: true,
      code,
      message,
      detail: detail || 'There was an error. That is all we know.'
    };
  }

  /**
   * Reads the request body and parses it as a JSON value.
   * @throws an error when no body or invalid JSON value.
   */
  protected async readJsonBody(request: Request): Promise<unknown> {
    const body = await this.readBufferBody(request);
    let data: unknown;
    try {
      data = JSON.parse(body.toString('utf8'));
    } catch (e) {
      throw new Error(`Invalid request body. Expected JSON value.`);
    }
    return data;
  }

  protected readBufferBody(request: Request): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let message: Buffer;
      request.req.on('data', (chunk) => {
        try {
          if (message) {
            message = Buffer.concat([message, chunk]);
          } else {
            message = chunk;
          }
        } catch (e) {
          reject(e);
          throw e;
        }
      });
      request.req.on('end', () => {
        if (!message) {
          reject(new Error(`Invalid request body. Expected a message.`));
          return;
        }
        resolve(message);
      });
    });
  }
}

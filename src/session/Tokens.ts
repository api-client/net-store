/* eslint-disable import/no-named-as-default-member */
import jwt from 'jsonwebtoken';
import { ApiError } from '../ApiError.js';

/**
 * A class that handles JWT in the application.
 */
export class Tokens {
  constructor(protected secret: string, protected expiresIn: string | number) {}

  /**
   * Creates a token with the passed contents.
   * @param contents The contents to put into the token.
   * @returns Generated JWT
   */
  generate(contents: any): string {
    const options = this.getSignOptions();
    return jwt.sign(contents, this.secret, options);
  }

  /**
   * @returns JWT signing options.
   */
  getSignOptions(): jwt.SignOptions {
    const result: jwt.SignOptions = {
      expiresIn: this.expiresIn,
      audience: 'urn:api-client',
      issuer: 'urn:apic-store',
    };
    return result;
  }
  
  /**
   * Reads the contents of the token
   * @param token The token to read.
   * @returns The JWT token contents.
   */
  readContents(token: string): jwt.JwtPayload {
    let contents: any;
    try {
      contents = jwt.verify(token, this.secret) as any;
    } catch (e) {
      // this.logger.error('[Token validation]', e);
      throw new ApiError(`Invalid token.`, 401);
    }
    return contents;
  }
}

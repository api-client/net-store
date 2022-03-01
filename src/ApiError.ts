/**
 * Base API Error class.
 */
export class ApiError extends Error {
  /**
   * The response status code.
   */
  code: number;
  /**
   * @param message The error message
   * @param code The response status code.
   */
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

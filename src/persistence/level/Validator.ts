import { ApiError } from '@api-client/core'

export function validateKinds(kinds: string[]): void {
  if (!Array.isArray(kinds) || !kinds.length) {
    throw new ApiError(`The "kinds" parameter is missing.`, 400);
  }
  const notString = kinds.some(i => typeof i !== 'string');
  if (notString) {
    throw new ApiError(`Only strings are allowed in the "kinds".`, 400);
  }
}

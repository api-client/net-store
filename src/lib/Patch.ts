import { ApiError, IPatchInfo } from '@api-client/core';
import { Patch } from '@api-client/json';

export function validatePatch(info: IPatchInfo): void {
  const { app, appVersion, id, patch } = info;
  const prefix = `Invalid patch schema.`;
  if (!app) {
    throw new ApiError(`${prefix} Missing "app" property.`, 400);
  }
  if (!appVersion) {
    throw new ApiError(`${prefix} Missing "appVersion" property.`, 400);
  }
  if (!id) {
    throw new ApiError(`${prefix} Missing "id" property.`, 400);
  }
  if (!patch) {
    throw new ApiError(`${prefix} Missing "patch" property.`, 400);
  }
  const isValid = Patch.valid(patch);
  if (!isValid) {
    throw new ApiError(`Malformed patch information.`, 400);
  }
}

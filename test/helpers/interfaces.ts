export interface SetupConfig {
  singleUserBaseUri: string;
  multiUserBaseUri: string;
  singleUserWsBaseUri: string;
  multiUserWsBaseUri: string;
  prefix: string;
  singleUserPort: number;
  multiUserPort: number;
  oauthPort: number;
}

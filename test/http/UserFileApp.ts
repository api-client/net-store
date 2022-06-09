import { 
  WorkspaceKind, StoreSdk, RouteBuilder, IBackendEvent, IFile, ProjectKind, IUser, IPatchRevision,
} from '@api-client/core';
import { WebSocket } from 'ws';
import { Patch } from '@api-client/json';
import WsHelper, { RawData } from '../helpers/WsHelper.js';

export class UserFileApp {
  sdk: StoreSdk;
  messages: IBackendEvent[] = [];
  files: IFile[] = [];
  filesClient?: WebSocket;
  fileContentsClient?: WebSocket;
  historyClient?: WebSocket;
  parent?: string;
  ws = new WsHelper();
  verbose = false;
  updateComplete = this.createUpdateComplete();
  private resolver?: (value: void | PromiseLike<void>) => void;
  private rejecter?: (reason?: Error) => void;

  constructor(private user: IUser, private token: string, baseUri: string, private baseUriWs: string) {
    this.sdk = new StoreSdk(baseUri);
    this.sdk.token = this.token;
  }

  async initFiles(): Promise<void> {
    this.filesClient = await this.ws.createAndConnect(`${this.baseUriWs}${RouteBuilder.files()}`, this.token);
    this.filesClient.on('message', this._messageMetaHandler.bind(this));
  }

  async initFileContentsClient(key: string): Promise<void> {
    this.fileContentsClient = await this.ws.createAndConnect(`${this.baseUriWs}${RouteBuilder.file(key)}?alt=media`, this.token);
    this.fileContentsClient.on('message', this._messageRevisionHandler.bind(this));
  }

  async initHistoryClient(): Promise<void> {
    this.historyClient = await this.ws.createAndConnect(`${this.baseUriWs}${RouteBuilder.history()}`, this.token);
    this.historyClient.on('message', this._messageHistoryHandler.bind(this));
  }

  private _messageMetaHandler(data: RawData): void {
    const event: IBackendEvent = JSON.parse(data.toString());
    this.messages.push(event);
    if (this.verbose) {
      console.log('_messageMetaHandler', event);
    }
    if (event.type !== 'event') {
      return;
    }
    switch (event.operation) {
      case 'created': this.handleMetaCreated(event); break;
      case 'deleted': this.handleMetaDeleted(event); break;
      case 'patch': this.handleMetaPatch(event); break;
      case 'access-granted': this.handleMetaAccessGranted(event); break;
      case 'access-removed': this.handleMetaAccessRemoved(event); break;
      default: console.warn(`Unhandled UserFileApp event.operation: ${event.operation}`, event);
    }
  }

  private _messageRevisionHandler(data: RawData): void {
    const event: IBackendEvent = JSON.parse(data.toString());
    this.messages.push(event);
  }

  private _messageHistoryHandler(data: RawData): void {
    const event: IBackendEvent = JSON.parse(data.toString());
    this.messages.push(event);
  }

  async finalize(): Promise<void> {
    if (this.filesClient) {
      await this.ws.disconnect(this.filesClient);
    }
    if (this.fileContentsClient) {
      await this.ws.disconnect(this.fileContentsClient);
    }
    if (this.historyClient) {
      await this.ws.disconnect(this.historyClient);
    }
  }

  reset(): void {
    this.messages = [];
    this.files = [];
    this.parent = undefined;
  }

  async setupSpace(parent?: string): Promise<void> {
    this.reset();
    this.parent = parent;
    const files = await this.sdk.file.list([ProjectKind], { limit: 100, parent });
    this.files = files.items;
  }

  hasMessages(): boolean {
    return this.messages.length > 0;
  }

  hasFiles(): boolean {
    return this.files.length > 0;
  }

  hasFile(id: string): boolean {
    return this.files.some(i => i.key === id);
  }

  getFile(id: string): IFile | undefined {
    return this.files.find(i => i.key === id);
  }

  handleMetaCreated(event: IBackendEvent): void {
    const { parent, kind, data } = event;
    if (parent !== this.parent) {
      return;
    }
    if (![ProjectKind, WorkspaceKind].includes(kind)) {
      return;
    }
    this.files.push(data as IFile);
  }

  handleMetaDeleted(event: IBackendEvent): void {
    const { kind, id } = event;
    if (![ProjectKind, WorkspaceKind].includes(kind)) {
      return;
    }
    const index = this.files.findIndex(i => i.key === id);
    if (index >= 0) {
      this.files.splice(index, 1);
    }
    if (id === this.parent) {
      this.reset();
    }
  }

  handleMetaPatch(event: IBackendEvent): void {
    const { kind, data, id } = event;
    if (![ProjectKind, WorkspaceKind].includes(kind)) {
      return;
    }
    const index = this.files.findIndex(i => i.key === id);
    if (index < 0) {
      return;
    }
    const patch = data as IPatchRevision;
    const file = this.files[index];
    const result = Patch.apply(file, patch.patch);
    this.files[index] = result.doc as IFile;
  }

  async handleMetaAccessGranted(event: IBackendEvent): Promise<void> {
    const { kind, id, parent } = event;
    if (parent !== this.parent) {
      return;
    }
    if (![ProjectKind, WorkspaceKind].includes(kind)) {
      return;
    }
    if (this.hasFile(id as string)) {
      // owner receives this too, however, the update event (should be next) updates the
      // source object.
      return;
    }
    await this.wrapAsync(async () => {
      const file = await this.sdk.file.read(id as string, false)
      this.files.push(file);
    });
  }

  async handleMetaAccessRemoved(event: IBackendEvent): Promise<void> {
    const { kind, id, parent } = event;
    if (parent !== this.parent) {
      return;
    }
    if (![ProjectKind, WorkspaceKind].includes(kind)) {
      return;
    }
    const index = this.files.findIndex(i => i.key === id);
    if (index >= 0) {
      this.files.splice(index, 1);
    }
  }

  private createUpdateComplete(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolver = resolve;
      this.rejecter = reject;
    });
  }

  private async wrapAsync(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      if (this.resolver) {
        this.resolver();
      }
    } catch (e) {
      if (this.rejecter) {
        this.rejecter(e as Error);
      }
    }
    this.updateComplete = this.createUpdateComplete();
  }
}

import Router from '@koa/router';
import { DefaultContext } from 'koa';
import { Logger } from '@api-client/core';
import { IServerConfiguration, IApplicationState } from './definitions.js';
import { BaseRoute, ISpaceConfiguration } from './routes/BaseRoute.js';
import { SocketRoute, ISocketRouteInit } from './routes/SocketRoute.js';
import { SpacesWsRoute } from './routes/SpacesWsRoute.js';
import { RouteBuilder } from './routes/RouteBuilder.js';
import { SpacesHttpRoute } from './routes/SpacesHttpRoute.js';
import { SpaceWsRoute } from './routes/SpaceWsRoute.js';
import { ProjectsHttpRoute } from './routes/ProjectsHttpRoute.js';
import { ProjectsWsRoute } from './routes/ProjectsWsRoute.js';
import { ProjectWsRoute } from './routes/ProjectWsRoute.js';
import { AuthWsRoute } from './routes/AuthWsRoute.js';
import { BackendHttpRoute } from './routes/BackendHttpRoute.js';
import { SessionHttpRoute } from './routes/SessionHttpRoute.js';
import { UsersHttpRoute } from './routes/UsersHttpRoute.js';
import { StorePersistence } from './persistence/StorePersistence.js';
import { AppSession } from './session/AppSession.js';
import { BackendInfo } from './BackendInfo.js';
import { ProjectsCache } from './cache/ProjectsCache.js';

export class ApiRoutes {
  protected routes: BaseRoute[] = [];
  protected wsRoutes: SocketRoute[] = [];
  protected projectsCache = new ProjectsCache();
  /**
   * @param opts Optional server configuration options.
   */
  constructor(
      protected store: StorePersistence, 
      protected router: Router<IApplicationState, DefaultContext>, 
      protected session: AppSession,
      protected info: BackendInfo,
      protected logger: Logger,
      protected opts: IServerConfiguration = {}
    ) {
    this.opts = opts;
    this.store = store;
    this.router = router;
    this.session = session;
  }

  /**
   * @param customRoutes Any custom routes to initialize.
   */
  async setup(...customRoutes: typeof BaseRoute[]): Promise<void> {
    this.projectsCache.initialize();
    const init: ISpaceConfiguration = {
      router: this.router,
      store: this.store,
      info: this.info,
      session: this.session,
      logger: this.logger,
      projectsCache: this.projectsCache,
    };
    // static HTTP routes. WS routes are created on demand.
    this.routes.push(new SessionHttpRoute(init));
    this.routes.push(new BackendHttpRoute(init));
    this.routes.push(new SpacesHttpRoute(init));
    this.routes.push(new ProjectsHttpRoute(init));
    this.routes.push(new UsersHttpRoute(init));
    customRoutes.forEach((custom) => {
      const ctr = custom as new(init: ISpaceConfiguration) => BaseRoute;
      this.routes.push(new ctr(init));
    });
    for (const item of this.routes) {
      await item.setup();
    }
  }

  /**
   * Signals all processes to end.
   */
  async cleanup(): Promise<void> {
    this.projectsCache.cleanup();
    for (const item of this.routes) {
      await item.cleanup();
    }
    for (const item of this.wsRoutes) {
      item.shutDown();
    }
  }

  /**
   * Gets created or creates a WS server for the passed route.
   * @param url The request URL
   * @returns The created route or undefined when the route is not found
   */
  getOrCreateWs(url: string): SocketRoute | undefined {
    const { store, logger, info, projectsCache } = this;
    const init: ISocketRouteInit = {
      store,
      logger,
      info,
      projectsCache,
    };
    if (url.startsWith('/auth/login')) {
      const route = new AuthWsRoute(init);
      this.addWsRoute(route, url);
      return route;
    }
    const spacesRoute = RouteBuilder.buildSpacesRoute();
    const isSpaces = url.startsWith(spacesRoute);
    if (!isSpaces) {
      return;
    }
    const route = this.wsRoutes.find(r => r.routeUrl === url);
    if (route) {
      return route;
    }
    
    if (url === spacesRoute) {
      const route = new SpacesWsRoute(init);
      this.addWsRoute(route, url);
      return route;
    }
    const v4reg = '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[89AB][0-9A-F]{3}-[0-9A-F]{12}';
    if (this.buildRouteRegexp(RouteBuilder.buildSpaceRoute(v4reg)).test(url)) {
      const route = new SpaceWsRoute(init);
      this.addWsRoute(route, url);
      return route;
    }
    if (this.buildRouteRegexp(RouteBuilder.buildSpaceProjectsRoute(v4reg)).test(url)) {
      const route = new ProjectsWsRoute(init);
      this.addWsRoute(route, url);
      return route;
    }
    if (this.buildRouteRegexp(RouteBuilder.buildSpaceProjectRoute(v4reg, v4reg)).test(url)) {
      const route = new ProjectWsRoute(init);
      this.addWsRoute(route, url);
      return route;
    }
  }

  protected buildRouteRegexp(route: string): RegExp {
    const sanitized = route.replaceAll('/', '\\/');
    const pattern = `^${sanitized}$`;
    return new RegExp(pattern, 'i');
  }

  protected addWsRoute(instance: SocketRoute, url: string): void {
    let urlValue = url;
    const queryIndex = urlValue.indexOf('?');
    if (queryIndex >= 0) {
      urlValue = urlValue.substring(0, queryIndex);
    }
    const parts = urlValue.split('/').slice(1);
    instance.route = parts;
    instance.routeUrl = urlValue;
    instance.createServer();
    instance.once('close', () => {
      const index = this.wsRoutes.indexOf(instance);
      if (index >= 0) {
        this.wsRoutes.splice(index, 1);
      }
    });
    this.wsRoutes.push(instance);
  }

  /**
   * Deactivates a WS route.
   */
  removeWsRoute(instance: SocketRoute): void {
    if (instance.server) {
      instance.server.close();
    }
    const index = this.wsRoutes.indexOf(instance);
    if (index >= 0) {
      this.wsRoutes.splice(index, 1);
    }
    instance.removeAllListeners();
  }
}

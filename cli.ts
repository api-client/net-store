#!/usr/bin/env node

import { Command, CommanderError } from 'commander';
import chalk from 'chalk';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { StoreLevelUp, Server } from './index.js';
import { UserPaths } from './src/lib/UserPaths.js';
import { CliOptions, ICommandOptions } from './src/cli/CliOptions.js';
import { CliConfig } from './src/cli/CliConfig.js';

// @ts-ignore
const __dirname = dirname(fileURLToPath(import.meta.url));
// this is relative to the `./build` folder.
const pkgFile = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));

const program = new Command();
program.version(pkg.version);
CliOptions.addOptions(program);

program.addHelpText('after', `

API Client store.
It is the back-end for API Clients suite. Application use the store to exchange the data and to share them with other users.

By default the store runs in the "single-user" mode which expects to be installed locally and only for the single user.
In this model authentication is not required and every API call to create a session is a success.

In contrast, the "multi-user" mode targets environments where the store runs a local network and multiple users can connect to the store.
This requires additional configuration to enable authentication. Users are free to register the account in the store through one of the predefined 
authentication schemes. When configured, the access can be restricted to a specific domain.

Examples:

$ api-store mode "single-user" --port 8080
$ api-store mode "multi-user" --port 8080 --auth-type "oidc" --oidc-issuer-uri "https://accounts.google.com/" --oidc-client-id "..." --oidc-client-secret "..." --oidc-redirect-base "https://..." --session-secret "..."
`);

program.exitOverride();
// program.allowUnknownOption();

let store: StoreLevelUp | undefined;
let server: Server | undefined;

process.on('SIGINT', async function() {
  if (server && store) {
    process.stderr.write('\nGracefully shutting down the server...\n');
    await store.cleanup();
    await server.stop();
    await server.cleanup();
    server = undefined;
    store = undefined;
  }
  process.exit();
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
    const options = program.opts() as ICommandOptions;
    const mode = program.args[0];

    const { prefix, dataPath = UserPaths.dataRoot() } = options;
    const port = CliConfig.getPort(options);
    const config = mode === 'multi-user' ? CliConfig.getMultiModeOptions(options) : CliConfig.getSingleModeOptions(options);
    store = new StoreLevelUp(config.logger!, dataPath);
    server = new Server(store, config);
    await store.initialize();
    await server.initialize();
    await server.start();
    config.logger!.info(`Server started: http://localhost:${port}${prefix || ''}`);
  } catch (err) {
    const cause = err as CommanderError;
    if (['commander.version', 'commander.helpDisplayed'].includes(cause.code)) {
      return;
    }
    const message = cause.message || 'Unknown error';
    let mainMessage = '';
    if (cause.code) {
      mainMessage += `\n[${cause.code}]: `;
    }
    mainMessage += chalk.red(`${message.trim()}\n`);
    process.stderr.write(Buffer.from(mainMessage));
    const hasDebug = process.argv.includes('--debug');
    const { stack } = cause;
    if (hasDebug && stack) {
      const stackMessage = chalk.blackBright(`\n${stack.trim()}\n`);
      process.stderr.write(Buffer.from(stackMessage));
    }
    process.stderr.write(Buffer.from('\n'));
  }
}

main();

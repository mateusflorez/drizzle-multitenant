#!/usr/bin/env node
import { Command } from 'commander';
import {
  migrateCommand,
  statusCommand,
  syncCommand,
  generateCommand,
  tenantCreateCommand,
  tenantDropCommand,
  convertFormatCommand,
  initCommand,
  completionCommand,
} from './commands/index.js';
import { initOutputContext } from './utils/output.js';

const program = new Command();

program
  .name('drizzle-multitenant')
  .description('Multi-tenancy toolkit for Drizzle ORM')
  .version('0.3.0')
  .option('--json', 'Output as JSON (machine-readable)')
  .option('-v, --verbose', 'Show verbose output')
  .option('-q, --quiet', 'Only show errors')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    initOutputContext({
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
      noColor: opts.color === false,
    });
  });

// Customize help output with examples
program.addHelpText('after', `
Examples:
  $ drizzle-multitenant status
  $ drizzle-multitenant migrate --all
  $ drizzle-multitenant migrate --tenant=my-tenant --dry-run
  $ drizzle-multitenant generate --name add-users-table
  $ drizzle-multitenant tenant:create --id new-tenant
  $ drizzle-multitenant status --json | jq '.summary'

Documentation:
  https://github.com/your-repo/drizzle-multitenant
`);

// Register commands
program.addCommand(migrateCommand);
program.addCommand(statusCommand);
program.addCommand(syncCommand);
program.addCommand(generateCommand);
program.addCommand(tenantCreateCommand);
program.addCommand(tenantDropCommand);
program.addCommand(convertFormatCommand);
program.addCommand(initCommand);
program.addCommand(completionCommand);

// Parse arguments
program.parse();

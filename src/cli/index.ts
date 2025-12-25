#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import {
  migrateCommand,
  statusCommand,
  syncCommand,
  diffCommand,
  generateCommand,
  tenantCreateCommand,
  tenantDropCommand,
  convertFormatCommand,
  initCommand,
  completionCommand,
  interactiveCommand,
  seedCommand,
} from './commands/index.js';
import { initOutputContext } from './utils/output.js';
import { mainMenu } from './ui/menu.js';

// Handle graceful exit on SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log(chalk.cyan('\n\n  Goodbye!\n'));
  process.exit(0);
});

// Handle uncaught exceptions from Inquirer prompts
process.on('uncaughtException', (error) => {
  if (error.name === 'ExitPromptError') {
    console.log(chalk.cyan('\n\n  Goodbye!\n'));
    process.exit(0);
  }
  console.error(chalk.red('\nUnexpected error:'), error.message);
  process.exit(1);
});

const program = new Command();

program
  .name('drizzle-multitenant')
  .description('Multi-tenancy toolkit for Drizzle ORM')
  .version('1.1.0')
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
  $ drizzle-multitenant                    # Launch interactive mode
  $ drizzle-multitenant interactive        # Launch interactive mode
  $ drizzle-multitenant status
  $ drizzle-multitenant migrate --all
  $ drizzle-multitenant migrate --tenant=my-tenant --dry-run
  $ drizzle-multitenant generate --name add-users-table
  $ drizzle-multitenant tenant:create --id new-tenant
  $ drizzle-multitenant status --json | jq '.summary'

Documentation:
  https://github.com/mateusflorez/drizzle-multitenant
`);

// Register commands
program.addCommand(migrateCommand);
program.addCommand(statusCommand);
program.addCommand(syncCommand);
program.addCommand(diffCommand);
program.addCommand(generateCommand);
program.addCommand(tenantCreateCommand);
program.addCommand(tenantDropCommand);
program.addCommand(convertFormatCommand);
program.addCommand(initCommand);
program.addCommand(completionCommand);
program.addCommand(interactiveCommand);
program.addCommand(seedCommand);

// Default action: launch interactive mode when no command is specified
program.action(async () => {
  await mainMenu();
});

// Parse arguments
program.parse();

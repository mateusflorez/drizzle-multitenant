import { Command } from 'commander';
import chalk from 'chalk';
import { mainMenu } from '../ui/menu.js';

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

export const interactiveCommand = new Command('interactive')
  .alias('i')
  .description('Launch interactive TUI mode')
  .option('-c, --config <path>', 'Path to config file')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant interactive
  $ drizzle-multitenant i
  $ drizzle-multitenant i --config ./tenant.config.ts

Interactive mode provides a menu-driven interface to:
  - View migration status for all tenants
  - Select and migrate specific tenants
  - Create new tenants
  - Drop existing tenants
  - Generate new migrations
`)
  .action(async (options) => {
    await mainMenu(options.config);
  });

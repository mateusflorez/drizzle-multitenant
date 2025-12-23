#!/usr/bin/env node
import { Command } from 'commander';
import {
  migrateCommand,
  statusCommand,
  generateCommand,
  tenantCreateCommand,
  tenantDropCommand,
} from './commands/index.js';

const program = new Command();

program
  .name('drizzle-multitenant')
  .description('Multi-tenancy toolkit for Drizzle ORM')
  .version('0.3.0');

// Register commands
program.addCommand(migrateCommand);
program.addCommand(statusCommand);
program.addCommand(generateCommand);
program.addCommand(tenantCreateCommand);
program.addCommand(tenantDropCommand);

// Parse arguments
program.parse();

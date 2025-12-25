import { input } from '@inquirer/prompts';
import chalk from 'chalk';
import { MenuRenderer } from '../base/menu-renderer.js';
import type { MenuContext, ScreenAction } from '../types.js';

/**
 * Screen for generating new migrations
 */
export class GenerateScreen {
  private readonly renderer: MenuRenderer;

  constructor(
    _ctx: MenuContext,
    renderer?: MenuRenderer
  ) {
    this.renderer = renderer || new MenuRenderer();
  }

  /**
   * Show generate migration screen
   */
  async show(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Generate Migration');

    const name = await input({
      message: 'Migration name:',
      validate: (value) => {
        if (!value.trim()) return 'Migration name cannot be empty';
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
          return 'Invalid migration name format';
        }
        return true;
      },
    });

    console.log('');
    console.log(chalk.dim('  To generate a migration, run:'));
    console.log('');
    console.log(chalk.cyan(`  npx drizzle-kit generate --name=${name}`));
    console.log('');
    console.log(chalk.dim('  Or use drizzle-multitenant generate:'));
    console.log('');
    console.log(chalk.cyan(`  npx drizzle-multitenant generate --name=${name}`));
    console.log('');

    await this.renderer.pressEnterToContinue();
    return { type: 'back' };
  }

  /**
   * Show generate shared migration screen
   */
  async showShared(): Promise<ScreenAction> {
    this.renderer.clearScreen();
    this.renderer.showHeader('Generate Shared Migration');

    const name = await input({
      message: 'Shared migration name:',
      validate: (value) => {
        if (!value.trim()) return 'Migration name cannot be empty';
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
          return 'Invalid migration name format';
        }
        return true;
      },
    });

    console.log('');
    console.log(chalk.dim('  To generate a shared migration, run:'));
    console.log('');
    console.log(chalk.cyan(`  npx drizzle-multitenant generate:shared --name=${name}`));
    console.log('');
    console.log(chalk.dim('  This will create a migration for the public schema.'));
    console.log('');

    await this.renderer.pressEnterToContinue();
    return { type: 'back' };
  }
}

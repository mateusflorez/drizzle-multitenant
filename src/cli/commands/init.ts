import { Command } from 'commander';
import { select, input, confirm, checkbox } from '@inquirer/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  log,
  success,
  info,
  warning,
  bold,
  dim,
  cyan,
  handleError,
  shouldShowInteractive,
} from '../utils/index.js';
import {
  type ProjectTemplate,
  type FrameworkIntegration,
  type InitFeatures,
  type DatabaseSetup,
  type InitWizardAnswers,
  TEMPLATE_DESCRIPTIONS,
  FRAMEWORK_DESCRIPTIONS,
  FEATURE_DESCRIPTIONS,
  DATABASE_SETUP_DESCRIPTIONS,
} from '../init/types.js';
import {
  generateConfigFile,
  generateFolderStructure,
  generateDockerCompose,
  generateInitDbSql,
  generateFrameworkFiles,
  getFrameworkDependencies,
} from '../init/generators/index.js';

export const initCommand = new Command('init')
  .description('Initialize a new drizzle-multitenant configuration')
  .option('--force', 'Overwrite existing configuration')
  .option('--template <template>', 'Project template (minimal, standard, full, enterprise)')
  .option('--framework <framework>', 'Framework integration (none, express, fastify, nestjs, hono)')
  .option('--typescript', 'Use TypeScript (default: true)')
  .option('--no-typescript', 'Use JavaScript instead of TypeScript')
  .addHelpText(
    'after',
    `
Examples:
  $ drizzle-multitenant init
  $ drizzle-multitenant init --template=full
  $ drizzle-multitenant init --template=enterprise --framework=nestjs
  $ drizzle-multitenant init --force --no-typescript
`
  )
  .action(async (options: InitCommandOptions) => {
    try {
      if (!shouldShowInteractive() && !options.template) {
        log(warning('Interactive mode required. Please run in a terminal or use --template flag.'));
        process.exit(1);
      }

      log(bold('\n🚀 drizzle-multitenant Setup Wizard\n'));

      // Check if config already exists
      const existingConfig = checkExistingConfig();

      if (existingConfig && !options.force) {
        log(warning(`Configuration file already exists: ${existingConfig}`));
        const overwrite = await confirm({
          message: 'Do you want to overwrite it?',
          default: false,
        });

        if (!overwrite) {
          log(info('Setup cancelled.'));
          return;
        }
      }

      // Gather all answers through wizard
      const answers = await runWizard(options);

      // Generate and write all files
      const generatedFiles = await generateAllFiles(answers);

      // Create folders and write files
      await writeGeneratedFiles(generatedFiles, answers);

      // Show next steps
      showNextSteps(answers);
    } catch (err) {
      if ((err as Error).name === 'ExitPromptError') {
        log(info('\nSetup cancelled.'));
        return;
      }
      handleError(err);
    }
  });

interface InitCommandOptions {
  force?: boolean;
  template?: ProjectTemplate;
  framework?: FrameworkIntegration;
  typescript?: boolean;
}

function checkExistingConfig(): string | null {
  const configFiles = [
    'tenant.config.ts',
    'tenant.config.js',
    'drizzle-multitenant.config.ts',
    'drizzle-multitenant.config.js',
  ];

  return configFiles.find(f => existsSync(join(process.cwd(), f))) || null;
}

async function runWizard(options: InitCommandOptions): Promise<InitWizardAnswers> {
  // Template selection
  const template = options.template || (await selectTemplate());

  // Framework integration
  const framework = options.framework || (await selectFramework());

  // Features selection
  const features = await selectFeatures(template);

  // Database setup
  const databaseSetup = await selectDatabaseSetup();

  // Isolation type
  const isolationType = await selectIsolationType();

  // Database environment variable
  const dbEnvVar = await input({
    message: 'Environment variable for database connection:',
    default: 'DATABASE_URL',
  });

  // Existing database URL (if applicable)
  let databaseUrl: string | undefined;
  if (databaseSetup === 'existing-url') {
    databaseUrl = await input({
      message: 'Enter your database URL:',
      default: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/myapp',
    });
  }

  // Migrations folder
  const migrationsFolder = await input({
    message: 'Tenant migrations folder path:',
    default: './drizzle/tenant-migrations',
  });

  // Shared migrations folder (if shared schema enabled)
  let sharedMigrationsFolder = './drizzle/shared-migrations';
  if (features.sharedSchema) {
    sharedMigrationsFolder = await input({
      message: 'Shared migrations folder path:',
      default: './drizzle/shared-migrations',
    });
  }

  // Schema template (only for schema isolation)
  let schemaTemplate = 'tenant_${id}';
  if (isolationType === 'schema') {
    schemaTemplate = await input({
      message: 'Schema name template (use ${id} for tenant ID):',
      default: 'tenant_${id}',
    });
  }

  // TypeScript or JavaScript
  const useTypeScript =
    options.typescript !== undefined
      ? options.typescript
      : await confirm({
          message: 'Use TypeScript for configuration?',
          default: true,
        });

  return {
    template,
    framework,
    features,
    databaseSetup,
    isolationType,
    dbEnvVar,
    databaseUrl,
    migrationsFolder,
    sharedMigrationsFolder,
    schemaTemplate,
    useTypeScript,
  };
}

async function selectTemplate(): Promise<ProjectTemplate> {
  return (await select({
    message: 'Project template:',
    choices: [
      {
        name: TEMPLATE_DESCRIPTIONS.minimal.name,
        value: 'minimal' as ProjectTemplate,
        description: TEMPLATE_DESCRIPTIONS.minimal.description,
      },
      {
        name: TEMPLATE_DESCRIPTIONS.standard.name,
        value: 'standard' as ProjectTemplate,
        description: TEMPLATE_DESCRIPTIONS.standard.description,
      },
      {
        name: TEMPLATE_DESCRIPTIONS.full.name,
        value: 'full' as ProjectTemplate,
        description: TEMPLATE_DESCRIPTIONS.full.description,
      },
      {
        name: TEMPLATE_DESCRIPTIONS.enterprise.name,
        value: 'enterprise' as ProjectTemplate,
        description: TEMPLATE_DESCRIPTIONS.enterprise.description,
      },
    ],
  })) as ProjectTemplate;
}

async function selectFramework(): Promise<FrameworkIntegration> {
  return (await select({
    message: 'Framework integration:',
    choices: [
      {
        name: FRAMEWORK_DESCRIPTIONS.none.name,
        value: 'none' as FrameworkIntegration,
        description: FRAMEWORK_DESCRIPTIONS.none.description,
      },
      {
        name: FRAMEWORK_DESCRIPTIONS.express.name,
        value: 'express' as FrameworkIntegration,
        description: FRAMEWORK_DESCRIPTIONS.express.description,
      },
      {
        name: FRAMEWORK_DESCRIPTIONS.fastify.name,
        value: 'fastify' as FrameworkIntegration,
        description: FRAMEWORK_DESCRIPTIONS.fastify.description,
      },
      {
        name: FRAMEWORK_DESCRIPTIONS.nestjs.name,
        value: 'nestjs' as FrameworkIntegration,
        description: FRAMEWORK_DESCRIPTIONS.nestjs.description,
      },
      {
        name: FRAMEWORK_DESCRIPTIONS.hono.name,
        value: 'hono' as FrameworkIntegration,
        description: FRAMEWORK_DESCRIPTIONS.hono.description,
      },
    ],
  })) as FrameworkIntegration;
}

async function selectFeatures(template: ProjectTemplate): Promise<InitFeatures> {
  // For minimal template, use defaults without asking
  if (template === 'minimal') {
    return {
      sharedSchema: false,
      crossSchemaQueries: false,
      healthChecks: false,
      metrics: false,
      debug: false,
    };
  }

  const featureChoices = Object.entries(FEATURE_DESCRIPTIONS).map(([key, desc]) => ({
    name: `${desc.name}`,
    value: key as keyof InitFeatures,
    checked: desc.default,
  }));

  const selected = await checkbox({
    message: 'Features to include:',
    choices: featureChoices,
  });

  return {
    sharedSchema: selected.includes('sharedSchema'),
    crossSchemaQueries: selected.includes('crossSchemaQueries'),
    healthChecks: selected.includes('healthChecks'),
    metrics: selected.includes('metrics'),
    debug: selected.includes('debug'),
  };
}

async function selectDatabaseSetup(): Promise<DatabaseSetup> {
  return (await select({
    message: 'Database setup:',
    choices: [
      {
        name: DATABASE_SETUP_DESCRIPTIONS.manual.name,
        value: 'manual' as DatabaseSetup,
        description: DATABASE_SETUP_DESCRIPTIONS.manual.description,
      },
      {
        name: DATABASE_SETUP_DESCRIPTIONS['docker-compose'].name,
        value: 'docker-compose' as DatabaseSetup,
        description: DATABASE_SETUP_DESCRIPTIONS['docker-compose'].description,
      },
      {
        name: DATABASE_SETUP_DESCRIPTIONS['existing-url'].name,
        value: 'existing-url' as DatabaseSetup,
        description: DATABASE_SETUP_DESCRIPTIONS['existing-url'].description,
      },
    ],
  })) as DatabaseSetup;
}

async function selectIsolationType(): Promise<'schema' | 'rls'> {
  return (await select({
    message: 'Which isolation strategy do you want to use?',
    choices: [
      {
        name: 'Schema-based isolation (recommended)',
        value: 'schema' as const,
        description: 'Each tenant has its own PostgreSQL schema',
      },
      {
        name: 'Row-level security (RLS)',
        value: 'rls' as const,
        description: 'Shared tables with tenant_id column and RLS policies',
      },
    ],
  })) as 'schema' | 'rls';
}

interface GeneratedOutput {
  folders: string[];
  files: Array<{ path: string; content: string }>;
  dependencies: string[];
  devDependencies: string[];
}

async function generateAllFiles(answers: InitWizardAnswers): Promise<GeneratedOutput> {
  const output: GeneratedOutput = {
    folders: [],
    files: [],
    dependencies: [],
    devDependencies: [],
  };

  // Generate config file
  const configFile = generateConfigFile(answers);
  output.files.push(configFile);

  // Generate folder structure
  const structure = generateFolderStructure(answers);
  output.folders.push(...structure.folders);
  output.files.push(...structure.files);

  // Generate Docker files if needed
  if (answers.databaseSetup === 'docker-compose') {
    output.files.push(generateDockerCompose(answers));
    output.files.push(generateInitDbSql(answers));
  }

  // Generate framework files if needed
  if (answers.framework !== 'none') {
    const frameworkFiles = generateFrameworkFiles(answers);
    output.files.push(...frameworkFiles);

    // Add framework dependencies
    const deps = getFrameworkDependencies(answers.framework);
    output.dependencies.push(...deps.dependencies);
    output.devDependencies.push(...deps.devDependencies);

    // Add folders for framework files
    if (answers.framework === 'express' || answers.framework === 'fastify' || answers.framework === 'hono') {
      output.folders.push('src/middleware');
    }
    if (answers.framework === 'fastify') {
      output.folders.push('src/plugins');
    }
    if (answers.framework === 'nestjs') {
      output.folders.push('src/tenant');
      output.folders.push('src/users');
      output.folders.push('src/health');
    }
  }

  // Add src/db folder for non-minimal templates
  if (answers.template !== 'minimal') {
    output.folders.push('src/db');
  }

  return output;
}

async function writeGeneratedFiles(output: GeneratedOutput, _answers: InitWizardAnswers): Promise<void> {
  const cwd = process.cwd();

  // Create folders
  const uniqueFolders = [...new Set(output.folders)].sort();
  for (const folder of uniqueFolders) {
    const fullPath = join(cwd, folder);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      log(success(`Created folder: ${folder}`));
    }
  }

  // Write files
  let filesWritten = 0;
  for (const file of output.files) {
    const fullPath = join(cwd, file.path);
    const dir = join(cwd, file.path.split('/').slice(0, -1).join('/'));

    // Ensure parent directory exists
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Skip .gitkeep if file already exists in that folder
    if (basename(file.path) === '.gitkeep') {
      if (!existsSync(fullPath)) {
        writeFileSync(fullPath, file.content);
      }
      continue;
    }

    writeFileSync(fullPath, file.content);
    filesWritten++;
    log(success(`Created: ${file.path}`));
  }

  log(dim(`\n${filesWritten} files created\n`));
}

function showNextSteps(answers: InitWizardAnswers): void {
  log(bold('✨ Setup complete!\n'));
  log('Next steps:\n');

  let step = 1;

  // Docker compose step
  if (answers.databaseSetup === 'docker-compose') {
    log(dim(`${step}. Start the database:`));
    log(cyan('   docker-compose up -d'));
    step++;
  }

  // Install dependencies
  if (answers.framework !== 'none') {
    const deps = getFrameworkDependencies(answers.framework);
    if (deps.dependencies.length > 0) {
      log(dim(`${step}. Install framework dependencies:`));
      log(cyan(`   npm install ${deps.dependencies.join(' ')}`));
      step++;
    }
    if (deps.devDependencies.length > 0) {
      log(dim(`${step}. Install dev dependencies:`));
      log(cyan(`   npm install -D ${deps.devDependencies.join(' ')}`));
      step++;
    }
  }

  // Environment setup
  if (answers.template !== 'minimal') {
    log(dim(`${step}. Copy environment file:`));
    log(cyan('   cp .env.example .env'));
    step++;
  }

  // Schema setup
  if (answers.template === 'minimal') {
    log(dim(`${step}. Update your schema definitions in the config file`));
    step++;
  } else {
    log(dim(`${step}. Customize your schemas in src/db/schema/`));
    step++;
  }

  // Tenant discovery
  log(dim(`${step}. Configure tenant discovery function in tenant.config.ts`));
  step++;

  // Generate migration
  log(dim(`${step}. Generate your first migration:`));
  log(cyan('   npx drizzle-multitenant generate --name initial'));
  step++;

  // Shared schema migration (if enabled)
  if (answers.features.sharedSchema) {
    log(dim(`${step}. Generate shared schema migration:`));
    log(cyan('   npx drizzle-multitenant generate:shared --name initial'));
    step++;
  }

  // Create tenant
  log(dim(`${step}. Create a tenant:`));
  log(cyan('   npx drizzle-multitenant tenant:create --id my-first-tenant'));
  step++;

  // Migrate
  log(dim(`${step}. Apply migrations:`));
  if (answers.features.sharedSchema) {
    log(cyan('   npx drizzle-multitenant migrate:shared'));
  }
  log(cyan('   npx drizzle-multitenant migrate --all'));
  step++;

  // Check status
  log(dim(`${step}. Check status:`));
  log(cyan('   npx drizzle-multitenant status'));

  log('');

  // Show documentation link
  log(dim('📖 Documentation: https://drizzle-multitenant.dev'));
  log(dim('💡 Interactive UI: npx drizzle-multitenant'));
  log('');
}

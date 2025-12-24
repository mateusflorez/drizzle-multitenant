import { Command } from 'commander';
import { log, info, warning } from '../utils/index.js';

export const completionCommand = new Command('completion')
  .description('Generate shell completion scripts')
  .argument('<shell>', 'Shell type: bash, zsh, or fish')
  .addHelpText('after', `
Examples:
  $ drizzle-multitenant completion bash >> ~/.bashrc
  $ drizzle-multitenant completion zsh >> ~/.zshrc
  $ drizzle-multitenant completion fish > ~/.config/fish/completions/drizzle-multitenant.fish

After adding the completion script, restart your shell or run:
  $ source ~/.bashrc  # for bash
  $ source ~/.zshrc   # for zsh
`)
  .action((shell: string) => {
    const shellLower = shell.toLowerCase();

    switch (shellLower) {
      case 'bash':
        console.log(generateBashCompletion());
        break;
      case 'zsh':
        console.log(generateZshCompletion());
        break;
      case 'fish':
        console.log(generateFishCompletion());
        break;
      default:
        log(warning(`Unknown shell: ${shell}`));
        log(info('Supported shells: bash, zsh, fish'));
        process.exit(1);
    }
  });

function generateBashCompletion(): string {
  return `# drizzle-multitenant bash completion
# Add this to ~/.bashrc or ~/.bash_completion

_drizzle_multitenant() {
    local cur prev opts commands
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"

    commands="migrate status generate tenant:create tenant:drop convert-format init completion"

    global_opts="--json --verbose --quiet --no-color --help --version"

    migrate_opts="-c --config -a --all -t --tenant --tenants --concurrency --dry-run --migrations-folder"
    status_opts="-c --config --migrations-folder"
    generate_opts="-n --name -c --config --type --migrations-folder"
    tenant_create_opts="--id -c --config --migrations-folder --no-migrate"
    tenant_drop_opts="--id -c --config --migrations-folder -f --force --no-cascade"
    convert_opts="--to -c --config -t --tenant --dry-run --migrations-folder"

    case "\${COMP_WORDS[1]}" in
        migrate)
            COMPREPLY=( \$(compgen -W "\${migrate_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        status)
            COMPREPLY=( \$(compgen -W "\${status_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        generate)
            COMPREPLY=( \$(compgen -W "\${generate_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        tenant:create)
            COMPREPLY=( \$(compgen -W "\${tenant_create_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        tenant:drop)
            COMPREPLY=( \$(compgen -W "\${tenant_drop_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        convert-format)
            COMPREPLY=( \$(compgen -W "\${convert_opts} \${global_opts}" -- \${cur}) )
            return 0
            ;;
        completion)
            COMPREPLY=( \$(compgen -W "bash zsh fish" -- \${cur}) )
            return 0
            ;;
    esac

    if [[ \${cur} == -* ]] ; then
        COMPREPLY=( \$(compgen -W "\${global_opts}" -- \${cur}) )
        return 0
    fi

    COMPREPLY=( \$(compgen -W "\${commands}" -- \${cur}) )
    return 0
}

complete -F _drizzle_multitenant drizzle-multitenant
complete -F _drizzle_multitenant npx drizzle-multitenant
`;
}

function generateZshCompletion(): string {
  return `#compdef drizzle-multitenant
# drizzle-multitenant zsh completion
# Add this to ~/.zshrc or place in a file in your $fpath

_drizzle_multitenant() {
    local -a commands
    local -a global_opts

    commands=(
        'migrate:Apply pending migrations to tenant schemas'
        'status:Show migration status for all tenants'
        'generate:Generate a new migration file'
        'tenant\\:create:Create a new tenant schema'
        'tenant\\:drop:Drop a tenant schema (DESTRUCTIVE)'
        'convert-format:Convert migration table format'
        'init:Initialize a new configuration'
        'completion:Generate shell completion scripts'
    )

    global_opts=(
        '--json[Output as JSON]'
        '(-v --verbose)'{-v,--verbose}'[Show verbose output]'
        '(-q --quiet)'{-q,--quiet}'[Only show errors]'
        '--no-color[Disable colored output]'
        '(-h --help)'{-h,--help}'[Show help]'
        '(-V --version)'{-V,--version}'[Show version]'
    )

    _arguments -C \\
        "\${global_opts[@]}" \\
        '1: :->command' \\
        '*:: :->args'

    case \$state in
        command)
            _describe -t commands 'command' commands
            ;;
        args)
            case \$words[1] in
                migrate)
                    _arguments \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '(-a --all)'{-a,--all}'[Migrate all tenants]' \\
                        '(-t --tenant)'{-t,--tenant}'[Migrate specific tenant]:tenant id:' \\
                        '--tenants[Migrate specific tenants (comma-separated)]:tenant ids:' \\
                        '--concurrency[Number of concurrent migrations]:number:' \\
                        '--dry-run[Show what would be applied]' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        "\${global_opts[@]}"
                    ;;
                status)
                    _arguments \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        "\${global_opts[@]}"
                    ;;
                generate)
                    _arguments \\
                        '(-n --name)'{-n,--name}'[Migration name]:name:' \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '--type[Migration type]:type:(tenant shared)' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        "\${global_opts[@]}"
                    ;;
                tenant:create)
                    _arguments \\
                        '--id[Tenant ID]:tenant id:' \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        '--no-migrate[Skip running migrations]' \\
                        "\${global_opts[@]}"
                    ;;
                tenant:drop)
                    _arguments \\
                        '--id[Tenant ID]:tenant id:' \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        '(-f --force)'{-f,--force}'[Skip confirmation]' \\
                        '--no-cascade[Use RESTRICT instead of CASCADE]' \\
                        "\${global_opts[@]}"
                    ;;
                convert-format)
                    _arguments \\
                        '--to[Target format]:format:(name hash drizzle-kit)' \\
                        '(-c --config)'{-c,--config}'[Path to config file]:file:_files' \\
                        '(-t --tenant)'{-t,--tenant}'[Convert specific tenant]:tenant id:' \\
                        '--dry-run[Show what would be converted]' \\
                        '--migrations-folder[Path to migrations folder]:folder:_directories' \\
                        "\${global_opts[@]}"
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh fish)'
                    ;;
            esac
            ;;
    esac
}

_drizzle_multitenant "\$@"
`;
}

function generateFishCompletion(): string {
  return `# drizzle-multitenant fish completion
# Save to ~/.config/fish/completions/drizzle-multitenant.fish

# Disable file completion by default
complete -c drizzle-multitenant -f

# Commands
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "migrate" -d "Apply pending migrations"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "status" -d "Show migration status"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "generate" -d "Generate new migration"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "tenant:create" -d "Create tenant schema"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "tenant:drop" -d "Drop tenant schema"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "convert-format" -d "Convert migration format"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "init" -d "Initialize configuration"
complete -c drizzle-multitenant -n "__fish_use_subcommand" -a "completion" -d "Generate completions"

# Global options
complete -c drizzle-multitenant -l json -d "Output as JSON"
complete -c drizzle-multitenant -s v -l verbose -d "Verbose output"
complete -c drizzle-multitenant -s q -l quiet -d "Only show errors"
complete -c drizzle-multitenant -l no-color -d "Disable colors"
complete -c drizzle-multitenant -s h -l help -d "Show help"
complete -c drizzle-multitenant -s V -l version -d "Show version"

# migrate options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -s a -l all -d "Migrate all tenants"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -s t -l tenant -r -d "Specific tenant"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -l tenants -r -d "Multiple tenants"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -l concurrency -r -d "Concurrent migrations"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -l dry-run -d "Dry run mode"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from migrate" -l migrations-folder -r -d "Migrations folder"

# status options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from status" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from status" -l migrations-folder -r -d "Migrations folder"

# generate options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from generate" -s n -l name -r -d "Migration name"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from generate" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from generate" -l type -r -a "tenant shared" -d "Migration type"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from generate" -l migrations-folder -r -d "Migrations folder"

# tenant:create options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:create" -l id -r -d "Tenant ID"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:create" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:create" -l migrations-folder -r -d "Migrations folder"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:create" -l no-migrate -d "Skip migrations"

# tenant:drop options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:drop" -l id -r -d "Tenant ID"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:drop" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:drop" -l migrations-folder -r -d "Migrations folder"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:drop" -s f -l force -d "Skip confirmation"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from tenant:drop" -l no-cascade -d "Use RESTRICT"

# convert-format options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from convert-format" -l to -r -a "name hash drizzle-kit" -d "Target format"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from convert-format" -s c -l config -r -d "Config file"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from convert-format" -s t -l tenant -r -d "Specific tenant"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from convert-format" -l dry-run -d "Dry run mode"
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from convert-format" -l migrations-folder -r -d "Migrations folder"

# completion options
complete -c drizzle-multitenant -n "__fish_seen_subcommand_from completion" -a "bash zsh fish" -d "Shell type"
`;
}

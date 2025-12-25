import { defineConfig } from 'vitepress'
import pkg from '../../package.json'

export default defineConfig({
  title: 'drizzle-multitenant',
  description: 'Multi-tenancy toolkit for Drizzle ORM',

  base: '/drizzle-multitenant/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/drizzle-multitenant/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/reference' },
      { text: 'Examples', link: '/examples/' },
      {
        text: `v${pkg.version}`,
        items: [
          { text: 'Changelog', link: 'https://github.com/mateusflorez/drizzle-multitenant/releases' },
          { text: 'npm', link: 'https://www.npmjs.com/package/drizzle-multitenant' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
          ]
        },
        {
          text: 'Frameworks',
          items: [
            { text: 'Express', link: '/guide/frameworks/express' },
            { text: 'Fastify', link: '/guide/frameworks/fastify' },
            { text: 'NestJS', link: '/guide/frameworks/nestjs' },
          ]
        },
        {
          text: 'Features',
          items: [
            { text: 'CLI Commands', link: '/guide/cli' },
            { text: 'Cross-Schema Queries', link: '/guide/cross-schema' },
            { text: 'Advanced', link: '/guide/advanced' },
            { text: 'Migration Formats', link: '/guide/migration-formats' },
          ]
        }
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Reference', link: '/api/reference' },
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Express', link: '/examples/express' },
            { text: 'Fastify', link: '/examples/fastify' },
            { text: 'NestJS', link: '/examples/nestjs' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mateusflorez/drizzle-multitenant' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/drizzle-multitenant' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 Mateus Florez'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/mateusflorez/drizzle-multitenant/edit/main/website/:path',
      text: 'Edit this page on GitHub'
    }
  }
})

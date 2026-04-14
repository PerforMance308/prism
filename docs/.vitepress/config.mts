import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'OpenObs',
  description: 'Docs for OpenObs, the AI-native observability platform.',
  srcDir: '.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],
  themeConfig: {
    logo: '/openobs-logo.svg',
    siteTitle: 'OpenObs',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Install', link: '/install/source' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'GitHub', link: 'https://github.com/openobs/openobs' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Architecture', link: '/architecture' },
        ],
      },
      {
        text: 'Install',
        items: [
          { text: 'Source Mode', link: '/install/source' },
          { text: 'Kubernetes with Helm', link: '/install/kubernetes' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/openobs/openobs' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright (c) OpenObs',
    },
  },
});

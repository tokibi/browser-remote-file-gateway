import { defineConfig } from 'vite'
import { defaultTheme, defineTheme, oxContent } from '@ox-content/vite-plugin'

const base = '/browser-remote-file-gateway/docs/'
const repositoryUrl = 'https://github.com/tokibi/browser-remote-file-gateway'

export default defineConfig({
  base,
  plugins: [
    oxContent({
      srcDir: 'content',
      outDir: '../build/pages/docs',
      base,
      docs: false,
      i18n: {
        enabled: true,
        defaultLocale: 'en',
        locales: [
          { code: 'en', name: 'English' },
          { code: 'ja', name: '日本語' },
        ],
        hideDefaultLocale: true,
        check: false,
      },
      ssg: {
        siteName: 'Remote File Gateway',
        siteUrl: 'https://tokibi.github.io',
        pagination: true,
        breadcrumbs: true,
        localeSwitcher: true,
        notFound: true,
        theme: defineTheme({
          extends: defaultTheme,
          header: {
            showLogo: false,
          },
          css: `
            .header-nav {
              margin-inline-start: 1rem;
            }
          `,
          nav: [
            {
              text: { en: 'Quickstart', ja: 'クイックスタート' },
              link: `${base}getting-started/`,
            },
            { text: 'GitHub', link: repositoryUrl },
          ],
          sidebar: [
            {
              text: { en: 'Gateway guide', ja: 'Gateway ガイド' },
              items: [
                { text: { en: 'Overview', ja: '概要' }, link: '/index.md' },
                { text: { en: 'Quickstart', ja: 'クイックスタート' }, link: '/getting-started.md' },
                { text: { en: 'Concepts', ja: '基本概念' }, link: '/concepts.md' },
                { text: { en: 'Providers', ja: 'プロバイダー' }, link: '/providers.md' },
                { text: { en: 'Cache', ja: 'キャッシュ' }, link: '/cache.md' },
                { text: { en: 'API and HTTP reference', ja: 'API と HTTP リファレンス' }, link: '/reference.md' },
              ],
            },
          ],
        }),
      },
      highlight: true,
      resources: true,
    }),
  ],
})

import { ListView } from '../src/widgets/List/ListView'

/**
 * `?fixture=welcome-cards`: the dashboard's Welcome block exactly as portal's list.onboarding-empty
 * sends it (bordered, a header, a 4-column grid of card tiles with a "Start" call to action), at the
 * width the UX review captured it. welcomeCards.spec.ts measures its margins (review round 3: "the
 * boxes' margins aren't uniform; at the top they overlap the header's line").
 */
const items = [
  { color: 'orange', description: 'Not sure where to start? Ask Agentiko.', icon: 'fa-wand-magic-sparkles', name: 'Help me choose', navigateTo: '/marketplace' },
  { color: 'cyan', description: 'Managed databases and data stores.', icon: 'fa-database', name: 'Databases', navigateTo: '/marketplace?q=database' },
  { color: 'cyan', description: 'Networks and load balancers.', icon: 'fa-network-wired', name: 'Networking', navigateTo: '/marketplace?q=network' },
  { color: 'cyan', description: 'Metrics, logs and dashboards.', icon: 'fa-chart-line', name: 'Observability', navigateTo: '/marketplace?q=observability' },
]

export const welcomeCards = () => (
  <div data-testid='welcome' style={{ width: 1400 }}>
    <ListView
      bordered
      grid={{ column: 4, gutter: 16, lg: 4, md: 2, sm: 2, xs: 1 }}
      header='Welcome to Krateo — what do you want to build?'
      itemTemplate={{
        cardCta: 'Start',
        color: { default: 'cyan', value: '{color}' },
        description: '{description}',
        icon: '{icon}',
        iconVariant: 'tile',
        navigateTo: '{navigateTo}',
        primaryText: '{name}',
        rowVariant: 'card',
      }}
      items={items}
      rowKey='name'
    />
  </div>
)

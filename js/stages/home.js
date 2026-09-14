// Home — what the planner is, its three steps (a screenshot beside each, alternating sides), the
// purpose behind it and why it is free. The logo opens it; it is not one of the stepper tabs.
import { QUADRANTS } from '../store.js';
import { quadrantGlyph } from '../carry.js';

const STEPS = [
  { stage: 1, icon: 'calendar', image: './assets/home/step-calendar.webp' },
  { stage: 2, icon: 'pencil', image: './assets/home/step-write.webp' },
  { stage: 3, icon: 'grid', image: './assets/home/step-prioritize.webp' },
];

// Quotes the studio stands behind, shown under "Free, for everyone" — add a key here (and its
// home.quote.<key>.phrase / .body strings) to publish another.
const QUOTES = ['shared'];

// "Our purpose" as a four-panel mini story: a full head → write it down → focus on the few → room for life.
const STORY_ART = [
  `<svg viewBox="0 0 160 120" fill="none" stroke="#241e16" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 74c-5-28 18-52 48-54s54 16 55 42-20 46-52 46-46-8-51-34z" fill="#fbe1dc" stroke="none"/>
    <path d="M50 110c0-15 12-24 30-24s30 9 30 24"/>
    <circle cx="80" cy="67" r="15" fill="#fefdfa"/>
    <circle cx="74.5" cy="64" r="1.2" fill="#241e16"/><circle cx="85.5" cy="64" r="1.2" fill="#241e16"/>
    <path d="M73 73.5q3.5-2.5 7 0t7 0"/>
    <path d="M54 44c6-17 31-19 35-3s-25 11-13-6 31-12 33 6-21 9-9-8 27-4 23 12" stroke="#d13e38" stroke-width="2"/>
    <circle cx="46" cy="58" r="2" fill="#d13e38" stroke="none"/><circle cx="118" cy="30" r="2" fill="#d13e38" stroke="none"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" fill="none" stroke="#241e16" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28 66c-4-26 20-48 50-48s56 12 56 40-22 50-54 50-48-16-52-42z" fill="#fdefcb" stroke="none"/>
    <rect x="56" y="16" width="48" height="86" rx="8" fill="#fefdfa"/>
    <rect x="66" y="30" width="8" height="8" rx="2"/><path d="M68 34l2 2 3.5-4"/><path d="M80 34h16"/>
    <rect x="66" y="48" width="8" height="8" rx="2"/><path d="M80 52h12"/>
    <rect x="66" y="66" width="8" height="8" rx="2"/><path d="M80 70h16"/>
    <path d="M66 88h14" stroke-dasharray="2 4"/>
    <path d="M118 98l2-8 14-28 6 3-14 28z" fill="#ffcd29" stroke="#e1901f" stroke-width="2"/><path d="M120 90l6 3" stroke="#e1901f" stroke-width="2"/>
    <path d="M30 44q10-4 20 4M34 78q8 2 16-6" stroke="#e1901f" stroke-width="2" stroke-dasharray="2 5"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" fill="none" stroke="#241e16" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M26 64c-2-28 22-48 54-48s54 18 54 44-24 48-54 48-52-16-54-44z" fill="#dcecf7" stroke="none"/>
    <circle cx="60" cy="40" r="24" stroke="#2382ba" stroke-width="1.6" stroke-dasharray="3 5"/>
    <rect x="44" y="24" width="32" height="32" rx="7" fill="#2382ba" stroke="#2382ba"/><path d="M53 40l5 5 9-10" stroke="#fefdfa" stroke-width="2.4"/>
    <rect x="84" y="24" width="32" height="32" rx="7" fill="#fefdfa"/>
    <rect x="44" y="64" width="32" height="32" rx="7" fill="#fefdfa"/>
    <rect x="84" y="64" width="32" height="32" rx="7" fill="#fefdfa"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" fill="none" stroke="#241e16" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28 70c-4-28 20-50 52-50s54 16 54 42-22 46-54 46-48-12-52-38z" fill="#d6f0df" stroke="none"/>
    <circle cx="114" cy="38" r="11" fill="#fefdfa"/>
    <path d="M114 20v-5M114 61v-5M96 38h-5M137 38h-5M101 25l-3-3M127 25l3-3M101 51l-3 3M127 51l3 3"/>
    <path d="M12 98q24-10 48-2t48-2 40-2"/>
    <circle cx="58" cy="50" r="7" fill="#fefdfa"/><path d="M55 51q3 3 6 0"/>
    <path d="M58 57v20M58 64l-10-10M58 64l10-10M58 77l-7 16M58 77l7 16"/>
    <path d="M92 97v-12M92 89q-6-2-8-8 6 0 8 8zM92 86q6-2 8-8-6 0-8 8z" stroke="#2ba162" stroke-width="2" fill="#bfe8cf"/>
    <path d="M124 96v-8M124 91q5-1 6-6-5 1-6 6z" stroke="#2ba162" stroke-width="2" fill="#bfe8cf"/>
  </svg>`,
];

export function mount(container, ctx) {
  const { ui, i18n, store } = ctx;
  const { h } = ui;
  const { t } = i18n;

  const hero = h(
    'header',
    { class: 'home-hero' },
    h('h1', { class: 'stage-title home-hero__title', tabindex: '-1' }, t('home.title')),
    h('p', { class: 'home-hero__lead' }, t('home.lead')),
    h(
      'div',
      { class: 'home-hero__actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => ctx.goTo(1) }, ui.icon('calendar', { size: 16 }), t('home.open')),
    ),
  );

  const steps = h(
    'section',
    { class: 'home-section', 'aria-labelledby': 'home-steps-title' },
    h('h2', { class: 'home-section__title', id: 'home-steps-title' }, t('home.stepsTitle')),
    h(
      'ol',
      { class: 'home-steps' },
      ...STEPS.map(({ stage, icon, image }) =>
        h(
          'li',
          { class: 'home-step' },
          h(
            'div',
            { class: 'home-step__text' },
            h('span', { class: 'home-step__badge', 'aria-hidden': 'true' }, ui.icon(icon, { size: 18 }), String(stage)),
            h('h3', { class: 'home-step__title' }, t(`home.step.${stage}.title`)),
            h('p', { class: 'home-step__body' }, t(`home.step.${stage}.body`)),
            // Prioritize lists the four priorities as bullets with their icons ("No priority" is not one).
            stage === 3 && [
              h('ul', { class: 'home-step__list' }, ...QUADRANTS.map((quadrant) => h('li', null, quadrantGlyph(ctx, quadrant, { size: 18 }), i18n.quadrantLabel(quadrant)))),
              h('p', { class: 'home-step__outro' }, t('home.step.3.outro')),
            ],
          ),
          h(
            'button',
            { class: 'home-step__shot', type: 'button', 'aria-label': t('home.openStep', { label: i18n.stepperLabel(stage) }), onClick: () => ctx.goTo(stage) },
            h('img', { src: image, alt: t(`home.step.${stage}.alt`), width: 1440, height: 938, loading: 'lazy', decoding: 'async' }),
          ),
        ),
      ),
    ),
  );

  const story = h(
    'section',
    { class: 'home-section home-purpose', 'aria-labelledby': 'home-purpose-title' },
    h('h2', { class: 'home-section__title', id: 'home-purpose-title' }, t('home.purpose.title')),
    h('p', { class: 'home-purpose__lead' }, t('home.purpose.lead')),
    h(
      'ol',
      { class: 'home-story' },
      ...STORY_ART.map((art, i) =>
        h(
          'li',
          { class: 'home-story__item' },
          h('span', { class: 'home-story__art', 'aria-hidden': 'true', html: art }),
          h('h3', { class: 'home-story__title' }, t(`home.story.${i + 1}.title`)),
          h('p', { class: 'home-story__body' }, t(`home.story.${i + 1}.body`)),
        ),
      ),
    ),
  );

  // Pricing: a free plan (up to 100 tasks) and Pro, monthly or yearly. Paid checkout is not live yet,
  // so the Pro buttons say "Coming soon".
  const plan = ({ key, featured, features, cta }) =>
    h(
      'li',
      { class: `home-plan${featured ? ' home-plan--featured' : ''}` },
      h('p', { class: 'home-plan__name' }, t(`home.pricing.${key}.name`)),
      h('p', { class: 'home-plan__price' }, h('span', { class: 'home-plan__amount' }, t(`home.pricing.${key}.price`)), h('span', { class: 'home-plan__period' }, t(`home.pricing.${key}.period`))),
      h('p', { class: 'home-plan__note' }, t(`home.pricing.${key}.note`)),
      h('ul', { class: 'home-plan__features' }, ...features.map((feature) => h('li', null, ui.icon('check', { size: 16 }), t(`home.pricing.feature.${feature}`)))),
      cta,
    );
  const proFeatures = ['unlimited', 'timer', 'aiReports', 'voice'];
  const pricing = h(
    'section',
    { class: 'home-section home-pricing', 'aria-labelledby': 'home-pricing-title' },
    h('h2', { class: 'home-section__title', id: 'home-pricing-title' }, t('home.pricing.title')),
    h('p', { class: 'home-pricing__lead' }, t('home.pricing.lead')),
    h(
      'ul',
      { class: 'home-plans' },
      plan({ key: 'free', features: ['tasks100', 'stages', 'noCard'], cta: h('button', { class: 'btn', type: 'button', onClick: () => ctx.goTo(1) }, t('home.pricing.startFree')) }),
      plan({ key: 'monthly', featured: true, features: proFeatures, cta: h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, t('home.pricing.soon')) }),
      plan({ key: 'yearly', features: proFeatures, cta: h('button', { class: 'btn', type: 'button', disabled: true }, t('home.pricing.soon')) }),
    ),
  );

  // "Free, for everyone" is said by the studio, as a quote: a short phrase, then what it means in practice.
  const free = h(
    'section',
    { class: 'home-section home-quote', 'aria-labelledby': 'home-free-title' },
    h('h2', { class: 'home-section__title', id: 'home-free-title' }, t('home.free.title')),
    ...QUOTES.map((key) =>
      h(
        'figure',
        { class: 'home-quote__figure' },
        h(
          'blockquote',
          { class: 'home-quote__text' },
          h('p', { class: 'home-quote__phrase' }, t(`home.quote.${key}.phrase`)),
          h('p', { class: 'home-quote__body' }, t(`home.quote.${key}.body`)),
        ),
        h(
          'figcaption',
          { class: 'home-quote__by' },
          h('span', { class: 'home-quote__avatar', 'aria-hidden': 'true' }, ui.icon('user', { size: 20 })),
          h(
            'span',
            { class: 'home-quote__who' },
            h('a', { class: 'home-quote__name', href: t('home.free.url'), target: '_blank', rel: 'noopener' }, t('home.free.by')),
          ),
        ),
      ),
    ),
  );

  container.append(
    h(
      'div',
      { class: 'home' },
      hero,
      steps,
      story,
      pricing,
      free,
      h('p', { class: 'home-disclaimer' }, t('home.disclaimer')),
    ),
  );
}

export function unmount() {}

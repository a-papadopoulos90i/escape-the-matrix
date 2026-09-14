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
const INK = 'stroke="#241e16" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const STORY_ART = [
  `<svg viewBox="0 0 160 120" ${INK}>
    <path d="M52 112c0-18 12-28 28-28s28 10 28 28"/>
    <circle cx="80" cy="66" r="15" fill="#fefdfa"/>
    <circle cx="74.5" cy="63" r="1.3" fill="#241e16"/><circle cx="85.5" cy="63" r="1.3" fill="#241e16"/>
    <path d="M74 73q6-4 12 0"/>
    <path d="M58 46l-6-5M102 46l6-5" stroke="#877f73"/>
    <rect x="28" y="18" width="24" height="17" rx="3" fill="#fdede8" stroke="#d13e38" transform="rotate(-12 40 26)"/>
    <rect x="108" y="16" width="24" height="17" rx="3" fill="#fef2de" stroke="#e1901f" transform="rotate(10 120 24)"/>
    <rect x="14" y="56" width="22" height="15" rx="3" fill="#e8f4fb" stroke="#2382ba" transform="rotate(8 25 63)"/>
    <circle cx="134" cy="62" r="10" fill="#fefdfa"/><path d="M134 56.5v5.5l3.5 2"/>
    <path d="M75 18a6 6 0 1 1 8.5 5.5c-2 1-2.5 2.2-2.5 4.5"/><circle cx="81" cy="33" r="1.4" fill="#241e16"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" ${INK}>
    <rect x="62" y="14" width="56" height="88" rx="8" fill="#fefdfa"/>
    <rect x="71" y="29" width="9" height="9" rx="2"/><path d="M73 33.5l2 2 3.5-4" stroke="#2ba162"/><path d="M86 33.5h23"/>
    <rect x="71" y="48" width="9" height="9" rx="2"/><path d="M86 52.5h19"/>
    <rect x="71" y="67" width="9" height="9" rx="2"/><path d="M86 71.5h23"/>
    <path d="M86 90h14" stroke="#877f73"/>
    <path d="M125 104l2.5-9 16-33 7 3.4-16 33z" fill="#fef2de" stroke="#e1901f"/>
    <rect x="12" y="30" width="24" height="17" rx="3" fill="#fdede8" stroke="#d13e38" transform="rotate(-10 24 38)"/>
    <rect x="18" y="70" width="22" height="15" rx="3" fill="#e8f4fb" stroke="#2382ba" transform="rotate(8 29 77)"/>
    <path d="M40 42q10 2 16 10M44 76q7-4 12-10" stroke="#877f73" stroke-dasharray="3 5"/>
    <path d="M51 49l5 3.5-1 5.5M51 70l5-4 5 1" stroke="#877f73"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" ${INK}>
    <rect x="84" y="22" width="36" height="36" rx="8" fill="#fef2de" stroke="#e1901f" opacity=".35"/>
    <rect x="42" y="64" width="36" height="36" rx="8" fill="#e8f4fb" stroke="#2382ba" opacity=".35"/>
    <rect x="84" y="64" width="36" height="36" rx="8" fill="#f5f3ed" stroke="#877f73" opacity=".35"/>
    <circle cx="60" cy="40" r="28" stroke="#d13e38" stroke-dasharray="4 5" opacity=".6"/>
    <rect x="42" y="22" width="36" height="36" rx="8" fill="#fdede8" stroke="#d13e38"/>
    <path d="M60 31c5 5 8 9 8 13a8 8 0 0 1-16 0c0-3 2-5 3.5-6.5.5 2.5 2 3.5 3.5 3.5-1-3 0-7 1-10z" fill="#d13e38" stroke="#d13e38" stroke-width="1.5"/>
  </svg>`,
  `<svg viewBox="0 0 160 120" ${INK}>
    <path d="M6 110q40-28 82-12t68-6" fill="#e7f6ec" stroke="#2ba162"/>
    <circle cx="118" cy="34" r="12" fill="#ffcd29" stroke="#e1901f"/>
    <path d="M118 14v-6M118 54v6M98 34h-6M138 34h6M104 20l-4-4M132 20l4-4M104 48l-4 4M132 48l4 4" stroke="#e1901f"/>
    <circle cx="58" cy="50" r="9" fill="#fefdfa"/>
    <path d="M54.5 51.5q3.5 3.5 7 0"/>
    <path d="M58 59v22M58 66l-13-13M58 66l13-13M58 81l-9 14M58 81l9 14"/>
    <path d="M88 74c-3-5-11-2-7.5 4.5L88 86l7.5-7.5C99 72 91 69 88 74z" fill="#d13e38" stroke="#d13e38" stroke-width="1.5"/>
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
      free,
      h('p', { class: 'home-disclaimer' }, t('home.disclaimer')),
    ),
  );
}

export function unmount() {}

// Home — what the planner is, its three steps (a screenshot beside each, alternating sides), the
// purpose behind it and why it is free. The logo opens it; it is not one of the stepper tabs.
import { openTimeReport } from '../report.js';

const STEPS = [
  { stage: 1, icon: 'calendar', image: './assets/home/step-calendar.webp' },
  { stage: 2, icon: 'pencil', image: './assets/home/step-write.webp' },
  { stage: 3, icon: 'grid', image: './assets/home/step-prioritize.webp' },
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
      h('button', { class: 'btn', type: 'button', onClick: () => openTimeReport({ ui, store, i18n }) }, ui.icon('clock', { size: 16 }), t('settings.timeReport')),
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

  const prose = (key, paragraphs) =>
    h(
      'section',
      { class: 'home-section home-prose', 'aria-labelledby': `home-${key}-title` },
      h('h2', { class: 'home-section__title', id: `home-${key}-title` }, t(`home.${key}.title`)),
      ...paragraphs.map((n) => h('p', null, t(`home.${key}.${n}`))),
    );

  const free = prose('free', [1, 2]);
  free.append(
    h('a', { class: 'home-prose__link', href: t('home.free.url'), target: '_blank', rel: 'noopener' }, t('home.free.link'), ui.icon('chevron-right', { size: 16 })),
  );

  container.append(
    h(
      'div',
      { class: 'home' },
      hero,
      steps,
      prose('purpose', [1, 2]),
      free,
      h('p', { class: 'home-disclaimer' }, t('home.disclaimer')),
    ),
  );
}

export function unmount() {}

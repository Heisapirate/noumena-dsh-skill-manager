// Client half. Registers a top-level `settings.section` page and hands the
// injected `connection` service to the panel, which proves the client → host →
// client RPC round trip through the `/skill-manager` health probe.

import type { ComponentType } from 'react';
import type { ClientConnection } from './connection';
import { SkillManagerPanel } from './Panel';

/** Declared cordis service dependencies for the browser half. */
export const inject = ['connection', 'slots'];

interface SettingsSectionOptions {
  name: 'settings.section';
  id: string;
  order: number;
  label: () => string;
  inject: () => { connection: ClientConnection };
}

interface SlotsService {
  inject(slot: string, factory: () => unknown): void;
  register(options: SettingsSectionOptions, component: ComponentType<unknown>): unknown;
}

interface ClientContext {
  get(name: 'connection'): ClientConnection;
  slots: SlotsService;
}

/** Entry point invoked by the DSH client runner. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection');
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'skill-manager',
        order: 15,
        label: () => 'DSH Skill Manager',
        inject: () => ({ connection }),
      },
      SkillManagerPanel as ComponentType<unknown>,
    ),
  );
}

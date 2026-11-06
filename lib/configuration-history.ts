import {
  sameConfiguration,
  type BuilderConfiguration,
} from './builder-configuration';

export const MAX_HISTORY = 30;
export type ConfigurationHistory = {
  past: BuilderConfiguration[];
  present: BuilderConfiguration;
  future: BuilderConfiguration[];
};
export const initialHistory = (
  present: BuilderConfiguration,
): ConfigurationHistory => ({ past: [], present, future: [] });
export function recordConfiguration(
  history: ConfigurationHistory,
  next: BuilderConfiguration,
): ConfigurationHistory {
  if (sameConfiguration(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: next,
    future: [],
  };
}
export function undoConfiguration(
  history: ConfigurationHistory,
): ConfigurationHistory {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1)!,
    future: [history.present, ...history.future],
  };
}
export function redoConfiguration(
  history: ConfigurationHistory,
): ConfigurationHistory {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: history.future[0],
    future: history.future.slice(1),
  };
}

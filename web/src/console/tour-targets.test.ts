import { describe, expect, it } from 'vitest';
import { featureRegistry } from './app/feature-registry';
import { mediaDownloadHelp, toolHelp } from './tool-help';
import { mediaTourTargets, tourTargets } from './tour-targets';

describe('guided step coverage', () => {
  it('defines one valid, distinct selector for every registered guide step', () => {
    for (const feature of featureRegistry) {
      const targets = tourTargets[feature.id];
      expect(targets, feature.id).toHaveLength(toolHelp[feature.id].steps.length);
      expect(new Set(targets).size, feature.id).toBe(targets.length);
      for (const selector of targets) {
        expect(selector.trim(), feature.id).not.toBe('');
        expect(() => document.querySelector(selector), `${feature.id}: ${selector}`).not.toThrow();
      }
    }
  });
  it('covers every media guide step with a valid distinct selector', () => {
    expect(mediaTourTargets).toHaveLength(mediaDownloadHelp.steps.length);
    expect(new Set(mediaTourTargets).size).toBe(mediaTourTargets.length);
    for (const selector of mediaTourTargets)
      expect(() => document.querySelector(selector)).not.toThrow();
  });
});

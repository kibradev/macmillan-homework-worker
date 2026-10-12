import { PlatformAdapter, PlatformDetectionResult } from '../types/platform';
import { MacmillanPlatformAdapter } from './macmillan';
import { GenericPlatformAdapter } from './generic';

const macmillanAdapter = new MacmillanPlatformAdapter();
const genericAdapter = new GenericPlatformAdapter();

export function detectCurrentPlatform(url: string, doc: Document): PlatformDetectionResult {
  if (macmillanAdapter.isPlatformPage(url, doc)) {
    const hasExercise = macmillanAdapter.detectExercise(doc);
    return {
      id: 'macmillan',
      name: macmillanAdapter.name,
      isPlatformPage: true,
      hasExercise,
      confidence: 1.0,
      reason: 'Macmillan Education / Language Hub domain detected.',
    };
  }

  const hasExercise = genericAdapter.detectExercise(doc);
  return {
    id: 'generic',
    name: genericAdapter.name,
    isPlatformPage: false,
    hasExercise,
    confidence: 0.5,
    reason: hasExercise
      ? 'Interactive questions detected via Generic DOM Adapter.'
      : 'No supported platform or interactive exercise detected.',
  };
}

export function getPlatformAdapter(url: string, doc: Document): PlatformAdapter {
  if (macmillanAdapter.isPlatformPage(url, doc)) {
    return macmillanAdapter;
  }
  return genericAdapter;
}

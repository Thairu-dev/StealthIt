import type { StealthItBridge } from '@shared/types';

declare global {
  interface Window {
    stealthit: StealthItBridge;
  }
}

export function getBridge(): StealthItBridge {
  return window.stealthit;
}

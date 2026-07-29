import { describe, it, expect } from 'vitest';
import { directionFromDestinationNaptanId } from '../src/direction.js';

describe('directionFromDestinationNaptanId', () => {
  it('maps Gospel Oak destination to departing', () => {
    expect(directionFromDestinationNaptanId('910GGOSPLOK')).toBe('departing');
  });

  it('maps Barking Riverside destination to arriving (terminating service)', () => {
    expect(directionFromDestinationNaptanId('910GBARKRIV')).toBe('arriving');
  });

  it('returns null for an unrecognised destination', () => {
    expect(directionFromDestinationNaptanId('910GSOMEOTHER')).toBeNull();
  });
});

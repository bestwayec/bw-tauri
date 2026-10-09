import { describe, expect, it, vi } from 'vitest';
import { resolveBackendMediaUrl } from './media-url';

vi.mock('./config', () => ({ API_BASE_URL: 'https://api.example.test/v1' }));

describe('credentialed media URLs', () => {
  it('resolves backend paths without duplicating the API prefix', () => {
    expect(resolveBackendMediaUrl('/v1/mock/groups/42/audio?attemptId=7'))
      .toBe('https://api.example.test/v1/mock/groups/42/audio?attemptId=7');
    expect(resolveBackendMediaUrl('tests/questions/42/audio'))
      .toBe('https://api.example.test/v1/tests/questions/42/audio');
  });

  it('keeps absolute URLs on the exact backend origin', () => {
    expect(resolveBackendMediaUrl('https://api.example.test/v1/media/42')).toBe('https://api.example.test/v1/media/42');
  });

  it.each([
    'http://api.example.test/v1/media/42',
    'https://api.example.test:8443/v1/media/42',
    'https://other.example.test/v1/media/42',
    'http://localhost:3001/v1/media/42',
    'https://student:password@api.example.test/v1/media/42',
    '//other.example.test/media/42',
    'javascript:alert(1)',
    '/v1/../private',
    '/v1/\\other.example.test',
  ])('rejects unsafe destinations: %s', (destination) => {
    expect(resolveBackendMediaUrl(destination)).toBeNull();
  });
});

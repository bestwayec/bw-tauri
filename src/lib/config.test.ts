import { expect, it } from 'vitest';
import { validateApiBaseUrl } from './config';

it.each(['http://api.bestwayec.uz/v1', 'https://user:password@api.bestwayec.uz/v1', 'https://api.bestwayec.uz/v1?next=evil', 'javascript:alert(1)', 'https://api.bestwayec.uz/v1\n'])('rejects unsafe credential destinations: %s', url => {
  expect(() => validateApiBaseUrl(url, false)).toThrow();
});
it.each(['http://localhost:3101/v1', 'http://127.0.0.1:3101/v1', 'http://[::1]:3101/v1'])('permits loopback HTTP only during development: %s', url => {
  expect(validateApiBaseUrl(url, true)).toBe(url);
  expect(() => validateApiBaseUrl(url, false)).toThrow();
});
it('preserves a configured HTTPS API prefix', () => {
  expect(validateApiBaseUrl('https://api.example.test/api/v1/', false)).toBe('https://api.example.test/api/v1');
});

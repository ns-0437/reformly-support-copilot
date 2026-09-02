import { hasConnectionLimit } from './prisma.service';

describe('hasConnectionLimit', () => {
  it('detects an explicit connection_limit param', () => {
    expect(hasConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=5')).toBe(true);
  });

  it('detects connection_limit alongside other params', () => {
    expect(hasConnectionLimit('postgresql://u:p@host:5432/db?schema=public&connection_limit=5&pool_timeout=10')).toBe(true);
  });

  it('flags a URL with no connection_limit at all', () => {
    expect(hasConnectionLimit('postgresql://u:p@host:5432/db?schema=public')).toBe(false);
  });

  it('flags a bare URL with no query string', () => {
    expect(hasConnectionLimit('postgresql://u:p@host:5432/db')).toBe(false);
  });
});

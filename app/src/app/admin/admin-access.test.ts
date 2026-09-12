import { describe, expect, it } from 'vitest';
import { adminAccess } from './admin-access';

const MEMBER = '4ydbVZuNupTPu1cKGCc2cePs95B8iMkrR4TvsCLiwcL1';
const STRANGER = '9EEWtzyu72a3DKJVUkCaeYX4HuBKD59xXCcENnDVe34Z';

describe('who may see an admin page (D-43)', () => {
  it('a signed-in wallet on the reviewer list is a member', () => {
    expect(adminAccess({ status: 'signed-in', walletAddress: MEMBER }, [MEMBER])).toBe('member');
  });

  it('a signed-in wallet off the list is not, whatever else it is', () => {
    expect(adminAccess({ status: 'signed-in', walletAddress: STRANGER }, [MEMBER])).toBe(
      'not-a-member'
    );
    expect(adminAccess({ status: 'signed-in', walletAddress: MEMBER }, [])).toBe('not-a-member');
  });

  it('signed out, or signed in with no active wallet yet, is signed out', () => {
    expect(adminAccess({ status: 'signed-out', walletAddress: null }, [MEMBER])).toBe('signed-out');
    expect(adminAccess({ status: 'signed-in', walletAddress: null }, [MEMBER])).toBe('signed-out');
  });

  it('while the provider is still coming up nothing is decided', () => {
    expect(adminAccess({ status: 'initializing', walletAddress: null }, [MEMBER])).toBe(
      'initializing'
    );
  });
});

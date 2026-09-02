import { EscalationController } from './escalation.controller';
import { AuthenticatedAdminRequest } from '../../common/guards/admin-auth.guard';

describe('EscalationController', () => {
  it('resolve() derives reviewedBy from the authenticated admin identity, never from the request body', async () => {
    const escalations = { resolve: jest.fn().mockResolvedValue({}) };
    const controller = new EscalationController(escalations as any);
    const req = { adminUser: 'founder' } as AuthenticatedAdminRequest;

    // ResolveEscalationDto has no reviewedBy field at all — this proves the
    // service is called with the authenticated identity regardless of
    // whatever the client sent, not that a malicious field was stripped.
    await controller.resolve('esc-1', { action: 'approve' }, req);

    expect(escalations.resolve).toHaveBeenCalledWith('esc-1', { action: 'approve', reviewedBy: 'founder' });
  });
});

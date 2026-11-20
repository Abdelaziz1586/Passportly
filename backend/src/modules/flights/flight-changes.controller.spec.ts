import 'reflect-metadata';
import { Role } from '../../common/enums';
import { FlightChangesController } from './flight-changes.controller';

describe('FlightChangesController', () => {
  const service = {
    preview: jest.fn().mockResolvedValue({ outcome: 'NO_DIFFERENCE' }),
    change: jest.fn().mockResolvedValue({ changeStatus: 'APPLIED' }),
  };
  const controller = new FlightChangesController(service as never);
  const user = { userId: 'u1', role: Role.REGISTERED_USER } as never;
  const dto = { legs: [{ legIndex: 0, flightId: 'f1' }] };

  it('takes the owner from the token and passes the body through', async () => {
    await controller.preview({ id: 'b1' }, dto, user);
    expect(service.preview).toHaveBeenCalledWith('u1', 'b1', dto);
    const full = { ...dto, acceptPolicies: true as const };
    await controller.change({ id: 'b1' }, full, user);
    expect(service.change).toHaveBeenCalledWith('u1', 'b1', full);
  });

  it('is restricted to registered users', () => {
    expect(Reflect.getMetadata('roles', FlightChangesController)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });
});

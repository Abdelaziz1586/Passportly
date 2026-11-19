import 'reflect-metadata';
import { Role } from '../../common/enums';
import { FlightSeatsController } from './flight-seats.controller';

describe('FlightSeatsController', () => {
  const service = {
    selectSeat: jest.fn().mockResolvedValue({ seat: '3C' }),
    getSeatMap: jest.fn().mockResolvedValue({ legs: [] }),
  };
  const controller = new FlightSeatsController(service as never);
  const user = { userId: 'u1', role: Role.REGISTERED_USER } as never;

  it('takes the owner from the token, never from the body', async () => {
    const dto = { passengerId: 'p1', seat: '3C' };
    await controller.selectSeat({ id: 'b1' }, dto, user);
    expect(service.selectSeat).toHaveBeenCalledWith('u1', 'b1', dto);
    await controller.getSeatMap({ id: 'b1' }, user);
    expect(service.getSeatMap).toHaveBeenCalledWith('u1', 'b1');
  });

  it('is restricted to registered users', () => {
    const roles = Reflect.getMetadata('roles', FlightSeatsController) as Role[];
    expect(roles).toEqual([Role.REGISTERED_USER]);
  });
});

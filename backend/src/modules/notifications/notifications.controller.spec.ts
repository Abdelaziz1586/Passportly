import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController (GEN-11 mark all notifications read)', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    markAllAsRead: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('is protected by global JwtAuthGuard (not @Public())', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      NotificationsController.prototype,
      'markAllAsRead',
    )?.value as (...args: never[]) => unknown;
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBeUndefined();
  });

  it('declares markAllAsRead before markAsRead to avoid route shadowing', () => {
    const methodNames = Object.getOwnPropertyNames(
      NotificationsController.prototype,
    );
    expect(methodNames.indexOf('markAllAsRead')).toBeLessThan(
      methodNames.indexOf('markAsRead'),
    );
  });

  it('delegates markAllAsRead to NotificationsService for current user', async () => {
    const expected = {
      message: 'All unread notifications marked as read',
      modifiedCount: 2,
      readAt: new Date('2026-11-19T12:00:00.000Z'),
    };
    mockNotificationsService.markAllAsRead.mockResolvedValue(expected);

    const result = await controller.markAllAsRead({
      userId: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });

    expect(result).toEqual(expected);
    expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
    );
  });
});

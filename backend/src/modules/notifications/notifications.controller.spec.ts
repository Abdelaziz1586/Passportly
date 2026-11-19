import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { NotificationType, Role } from '../../common/enums';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController (GEN-11 mark notification read)', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    markAsRead: jest.fn(),
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
      'markAsRead',
    )?.value as (...args: never[]) => unknown;
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBeUndefined();
  });

  it('delegates markAsRead to NotificationsService with id and current userId', async () => {
    const expected = {
      id: '507f1f77bcf86cd799439022',
      recipient: '507f1f77bcf86cd799439011',
      type: NotificationType.SYSTEM,
      title: 'Title',
      message: 'Body',
      isRead: true,
      readAt: new Date('2026-11-19T12:00:00.000Z'),
    };
    mockNotificationsService.markAsRead.mockResolvedValue(expected);

    const result = await controller.markAsRead('507f1f77bcf86cd799439022', {
      userId: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });

    expect(result).toEqual(expected);
    expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439022',
      '507f1f77bcf86cd799439011',
    );
  });
});

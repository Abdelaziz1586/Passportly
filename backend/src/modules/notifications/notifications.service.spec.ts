import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

describe('NotificationsService (GEN-11 mark all notifications read)', () => {
  let service: NotificationsService;

  const mockNotificationModel = {
    create: jest.fn(),
    updateMany: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(Notification.name),
          useValue: mockNotificationModel,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('marks all unread notifications for the user as read', async () => {
    const userId = '507f1f77bcf86cd799439011';
    mockNotificationModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

    const result = await service.markAllAsRead(userId);

    expect(mockNotificationModel.updateMany).toHaveBeenCalledWith(
      {
        recipient: new Types.ObjectId(userId),
        isRead: false,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          isRead: true,
          readAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
    expect(result.message).toBe('All unread notifications marked as read');
    expect(result.modifiedCount).toBe(3);
    expect(result.readAt).toBeInstanceOf(Date);
  });

  it('returns modifiedCount 0 when user has no unread notifications', async () => {
    const userId = '507f1f77bcf86cd799439011';
    mockNotificationModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const result = await service.markAllAsRead(userId);
    expect(result.modifiedCount).toBe(0);
  });

  it('rejects invalid user ID with BadRequestException', async () => {
    await expect(service.markAllAsRead('invalid')).rejects.toThrow(
      BadRequestException,
    );
  });
});

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationType } from '../../common/enums';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

describe('NotificationsService (GEN-11 mark notification read)', () => {
  let service: NotificationsService;

  const mockNotificationModel = {
    create: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
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

  it('marks an unread owned notification as read and sets readAt', async () => {
    const notifId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const userId = '507f1f77bcf86cd799439011';
    const recipient = new Types.ObjectId(userId);
    const readAt = new Date('2026-11-19T13:00:00.000Z');

    mockNotificationModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: notifId,
        recipient,
        type: NotificationType.SYSTEM,
        title: 'Notice',
        message: 'Hello',
        isRead: false,
      }),
    });
    mockNotificationModel.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: notifId,
        recipient,
        type: NotificationType.SYSTEM,
        title: 'Notice',
        message: 'Hello',
        isRead: true,
        readAt,
      }),
    });

    const result = await service.markAsRead(String(notifId), userId);

    expect(mockNotificationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: notifId, recipient, isRead: false },
      expect.objectContaining({
        $set: expect.objectContaining({
          isRead: true,
          readAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
      { returnDocument: 'after' },
    );
    expect(result.isRead).toBe(true);
    expect(result.readAt).toEqual(readAt);
  });

  it('returns an already-read notification idempotently without re-updating', async () => {
    const notifId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const userId = '507f1f77bcf86cd799439011';
    const readAt = new Date('2026-11-19T12:00:00.000Z');

    mockNotificationModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: notifId,
        recipient: new Types.ObjectId(userId),
        type: NotificationType.SYSTEM,
        title: 'Notice',
        message: 'Hello',
        isRead: true,
        readAt,
      }),
    });

    const result = await service.markAsRead(String(notifId), userId);
    expect(mockNotificationModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(result.isRead).toBe(true);
    expect(result.readAt).toEqual(readAt);
  });

  it('throws BadRequestException for invalid notification ID', async () => {
    await expect(
      service.markAsRead('invalid-id', '507f1f77bcf86cd799439011'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when notification does not exist', async () => {
    mockNotificationModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.markAsRead(
        '507f1f77bcf86cd799439022',
        '507f1f77bcf86cd799439011',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when notification belongs to another user', async () => {
    mockNotificationModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
        recipient: new Types.ObjectId('507f1f77bcf86cd799439099'),
        type: NotificationType.SYSTEM,
        title: 'Notice',
        message: 'Hello',
        isRead: false,
      }),
    });

    await expect(
      service.markAsRead(
        '507f1f77bcf86cd799439022',
        '507f1f77bcf86cd799439011',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

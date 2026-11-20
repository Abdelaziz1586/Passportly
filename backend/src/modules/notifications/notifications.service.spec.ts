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

describe('NotificationsService (GEN-11 list notifications)', () => {
  let service: NotificationsService;

  const mockSort = jest.fn();
  const mockSkip = jest.fn();
  const mockLimit = jest.fn();
  const mockLean = jest.fn();

  const mockNotificationModel = {
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockNotificationModel.find.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ lean: mockLean });

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

  it('lists paginated notifications for the current user with unreadCount', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const notifId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const entityId = new Types.ObjectId('507f1f77bcf86cd799439033');
    const createdAt = new Date('2026-11-19T12:00:00.000Z');

    mockLean.mockResolvedValue([
      {
        _id: notifId,
        recipient: new Types.ObjectId(userId),
        type: NotificationType.BOOKING_CONFIRMED,
        title: 'Booking confirmed',
        message: 'Your flight booking is confirmed.',
        relatedEntityType: 'FlightBooking',
        relatedEntityId: entityId,
        isRead: false,
        createdAt,
      },
    ]);
    mockNotificationModel.countDocuments
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);

    const result = await service.listMyNotifications(userId, {
      page: 2,
      limit: 2,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(mockNotificationModel.find).toHaveBeenCalledWith({
      recipient: new Types.ObjectId(userId),
    });
    expect(mockSort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(mockSkip).toHaveBeenCalledWith(2);
    expect(mockLimit).toHaveBeenCalledWith(2);
    expect(mockNotificationModel.countDocuments).toHaveBeenNthCalledWith(1, {
      recipient: new Types.ObjectId(userId),
    });
    expect(mockNotificationModel.countDocuments).toHaveBeenNthCalledWith(2, {
      recipient: new Types.ObjectId(userId),
      isRead: false,
    });
    expect(result).toEqual({
      data: [
        {
          id: String(notifId),
          recipient: userId,
          type: NotificationType.BOOKING_CONFIRMED,
          title: 'Booking confirmed',
          message: 'Your flight booking is confirmed.',
          relatedEntityType: 'FlightBooking',
          relatedEntityId: String(entityId),
          isRead: false,
          createdAt,
        },
      ],
      unreadCount: 2,
      total: 5,
      page: 2,
      limit: 2,
      totalPages: 3,
    });
  });

  it('applies unreadOnly and type filters when provided', async () => {
    const userId = '507f1f77bcf86cd799439011';
    mockLean.mockResolvedValue([]);
    mockNotificationModel.countDocuments
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await service.listMyNotifications(userId, {
      unreadOnly: true,
      type: NotificationType.SYSTEM,
    });

    expect(mockNotificationModel.find).toHaveBeenCalledWith({
      recipient: new Types.ObjectId(userId),
      isRead: false,
      type: NotificationType.SYSTEM,
    });
    expect(result.totalPages).toBe(0);
    expect(result.unreadCount).toBe(0);
  });

  it('rejects invalid user IDs with BadRequestException', async () => {
    await expect(
      service.listMyNotifications('not-an-object-id', {}),
    ).rejects.toThrow(BadRequestException);
  });
});

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

import { BadRequestException } from '@nestjs/common';
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

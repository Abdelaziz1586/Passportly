import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-14 list accounts)', () => {
  let service: AdminService;

  const mockUserSelect = jest.fn();
  const mockUserSort = jest.fn();
  const mockUserSkip = jest.fn();
  const mockUserLimit = jest.fn();
  const mockUserLean = jest.fn();

  const mockUserModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockAssignPopulate1 = jest.fn();
  const mockAssignPopulate2 = jest.fn();
  const mockAssignLean = jest.fn();

  const mockModeratorAssignmentModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUserModel.find.mockReturnValue({ select: mockUserSelect });
    mockUserSelect.mockReturnValue({ sort: mockUserSort });
    mockUserSort.mockReturnValue({ skip: mockUserSkip });
    mockUserSkip.mockReturnValue({ limit: mockUserLimit });
    mockUserLimit.mockReturnValue({ lean: mockUserLean });

    mockModeratorAssignmentModel.find.mockReturnValue({
      populate: mockAssignPopulate1,
    });
    mockAssignPopulate1.mockReturnValue({ populate: mockAssignPopulate2 });
    mockAssignPopulate2.mockReturnValue({ lean: mockAssignLean });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: mockModeratorAssignmentModel,
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('filters by role, status, search, sorts, paginates, and attaches moderator assignment info', async () => {
    const modId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const airlineId = new Types.ObjectId('507f1f77bcf86cd799439033');
    const assignmentId = new Types.ObjectId('507f1f77bcf86cd799439044');

    mockUserLean.mockResolvedValue([
      {
        _id: modId,
        email: 'mod@egyptair.com',
        firstName: 'Airline',
        lastName: 'Moderator',
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
      },
    ]);
    mockUserModel.countDocuments.mockResolvedValue(1);
    mockAssignLean.mockResolvedValue([
      {
        _id: assignmentId,
        moderator: modId,
        providerType: ProviderType.AIRLINE,
        airline: { _id: airlineId, name: 'EgyptAir', isActive: true },
        hotel: null,
        isActive: true,
      },
    ]);

    const result = await service.listAccounts({
      role: Role.AIRLINE_MODERATOR,
      status: AccountStatus.ACTIVE,
      search: 'Airline Mod',
      sortBy: 'email',
      sortOrder: 'asc',
      page: 1,
      limit: 10,
    });

    expect(mockUserModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        $and: expect.any(Array) as unknown,
      }),
    );
    expect(mockUserSort).toHaveBeenCalledWith({ email: 1, _id: 1 });
    expect(mockModeratorAssignmentModel.find).toHaveBeenCalledWith({
      moderator: { $in: [modId] },
    });
    expect(result).toEqual({
      data: [
        {
          id: String(modId),
          email: 'mod@egyptair.com',
          firstName: 'Airline',
          lastName: 'Moderator',
          role: Role.AIRLINE_MODERATOR,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
          mustChangePassword: false,
          assignment: {
            id: String(assignmentId),
            providerType: ProviderType.AIRLINE,
            providerId: String(airlineId),
            providerName: 'EgyptAir',
            isActive: true,
            providerIsActive: true,
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('skips ModeratorAssignment lookup when no moderators are in the page', async () => {
    const userId = new Types.ObjectId('507f1f77bcf86cd799439011');
    mockUserLean.mockResolvedValue([
      {
        _id: userId,
        email: 'traveler@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
      },
    ]);
    mockUserModel.countDocuments.mockResolvedValue(1);

    const result = await service.listAccounts({});

    expect(mockModeratorAssignmentModel.find).not.toHaveBeenCalled();
    expect(result.data[0].assignment).toBeUndefined();
  });
});

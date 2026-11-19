import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AuditLogActorSummaryDto,
  AuditLogItemDto,
  ListAuditLogsQueryDto,
  PaginatedAuditLogsResponseDto,
} from './dto/list-audit-logs-query.dto';

type PopulatedActor = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: Role;
};

type LeanAuditLog = {
  _id: Types.ObjectId;
  actor?: PopulatedActor | Types.ObjectId | null;
  actorRole?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatActorRef(
  actor: PopulatedActor | Types.ObjectId | null | undefined,
): AuditLogActorSummaryDto | string | null {
  if (!actor) {
    return null;
  }
  if (actor instanceof Types.ObjectId) {
    return actor.toHexString();
  }
  if (
    typeof actor === 'object' &&
    'email' in actor &&
    typeof actor.email === 'string'
  ) {
    return {
      id: actor._id.toHexString(),
      ...(actor.firstName !== undefined ? { firstName: actor.firstName } : {}),
      ...(actor.lastName !== undefined ? { lastName: actor.lastName } : {}),
      email: actor.email,
      ...(actor.role !== undefined ? { role: actor.role } : {}),
    };
  }
  return actor._id.toHexString();
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(AuditLog.name)
    readonly auditLogModel: Model<AuditLogDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Queries administrative audit logs filtered by actor, action, targetType,
   * and createdAt date range with sorting and pagination.
   */
  async listAuditLogs(
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedAuditLogsResponseDto> {
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      throw new BadRequestException(
        'fromDate must be before or equal to toDate',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.actor) {
      if (!isValidObjectId(query.actor)) {
        throw new BadRequestException('Invalid actor ID');
      }
      filter.actor = new Types.ObjectId(query.actor);
    }
    if (query.action && query.action.trim().length > 0) {
      filter.action = new RegExp(`^${escapeRegex(query.action.trim())}$`, 'i');
    }
    if (query.targetType && query.targetType.trim().length > 0) {
      filter.targetType = new RegExp(
        `^${escapeRegex(query.targetType.trim())}$`,
        'i',
      );
    }
    if (query.fromDate || query.toDate) {
      const createdAtRange: Record<string, Date> = {};
      if (query.fromDate) createdAtRange.$gte = query.fromDate;
      if (query.toDate) createdAtRange.$lte = query.toDate;
      filter.createdAt = createdAtRange;
    }

    const [logs, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .populate('actor', 'firstName lastName email role')
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanAuditLog[]>(),
      this.auditLogModel.countDocuments(filter),
    ]);

    return {
      data: logs.map((doc) => this.toAuditLogItem(doc)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private toAuditLogItem(doc: LeanAuditLog): AuditLogItemDto {
    return {
      id: doc._id.toHexString(),
      actor: formatActorRef(doc.actor),
      ...(doc.actorRole !== undefined ? { actorRole: doc.actorRole } : {}),
      action: doc.action,
      targetType: doc.targetType,
      ...(doc.targetId !== undefined ? { targetId: doc.targetId } : {}),
      ...(doc.details !== undefined ? { details: doc.details } : {}),
      ...(doc.ipAddress !== undefined ? { ipAddress: doc.ipAddress } : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }
}

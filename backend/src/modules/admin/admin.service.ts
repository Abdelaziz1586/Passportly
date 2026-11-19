import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AccountStatus,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Report, ReportDocument } from '../reports/schemas/report.schema';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AdminReportItemDto,
  ListReportsQueryDto,
  PaginatedReportsResponseDto,
  ReportUserSummaryDto,
} from './dto/list-reports-query.dto';

type PopulatedReportUser = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: Role;
  status?: AccountStatus;
};

type LeanReport = {
  _id: Types.ObjectId;
  reporter: PopulatedReportUser | Types.ObjectId;
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  reason: string;
  details?: string;
  status: ReportStatus;
  reviewedBy?: PopulatedReportUser | Types.ObjectId | null;
  reviewedAt?: Date;
  resolutionNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function formatReportUser(
  userRef: PopulatedReportUser | Types.ObjectId,
): ReportUserSummaryDto | string {
  if (userRef instanceof Types.ObjectId) {
    return userRef.toHexString();
  }
  if (
    typeof userRef === 'object' &&
    userRef !== null &&
    'email' in userRef &&
    typeof userRef.email === 'string'
  ) {
    return {
      id: userRef._id.toHexString(),
      ...(userRef.firstName !== undefined
        ? { firstName: userRef.firstName }
        : {}),
      ...(userRef.lastName !== undefined ? { lastName: userRef.lastName } : {}),
      email: userRef.email,
      ...(userRef.role !== undefined ? { role: userRef.role } : {}),
      ...(userRef.status !== undefined ? { status: userRef.status } : {}),
    };
  }
  return userRef._id.toHexString();
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Report.name) readonly reportModel: Model<ReportDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Lists submitted content moderation reports filtered by status and targetType
   * with reporter/reviewer details, sorting, and pagination.
   */
  async listReports(
    query: ListReportsQueryDto,
  ): Promise<PaginatedReportsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.targetType) {
      filter.targetType = query.targetType;
    }

    const [reports, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .populate('reporter', 'firstName lastName email role status')
        .populate('reviewedBy', 'firstName lastName email')
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanReport[]>(),
      this.reportModel.countDocuments(filter),
    ]);

    return {
      data: reports.map((doc) => this.toReportItem(doc)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private toReportItem(doc: LeanReport): AdminReportItemDto {
    return {
      id: doc._id.toHexString(),
      reporter: formatReportUser(doc.reporter),
      targetType: doc.targetType,
      targetId: doc.targetId.toHexString(),
      reason: doc.reason,
      ...(doc.details !== undefined ? { details: doc.details } : {}),
      status: doc.status,
      ...(doc.reviewedBy !== undefined
        ? {
            reviewedBy: doc.reviewedBy
              ? formatReportUser(doc.reviewedBy)
              : null,
          }
        : {}),
      ...(doc.reviewedAt !== undefined ? { reviewedAt: doc.reviewedAt } : {}),
      ...(doc.resolutionNotes !== undefined
        ? { resolutionNotes: doc.resolutionNotes }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }
}

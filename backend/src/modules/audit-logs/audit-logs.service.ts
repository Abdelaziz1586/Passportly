import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name)
    readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async log(
    params: {
      actor?: string | Types.ObjectId | null;
      actorRole?: string;
      action: string;
      targetType: string;
      targetId?: string;
      details?: Record<string, unknown>;
      ipAddress?: string;
    },
    session?: ClientSession,
  ) {
    const payload = {
      actor: params.actor ? new Types.ObjectId(params.actor) : null,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      details: params.details,
      ipAddress: params.ipAddress,
    };
    if (session) {
      const [entry] = await this.auditLogModel.create([payload], { session });
      return entry;
    }
    return this.auditLogModel.create(payload);
  }
}

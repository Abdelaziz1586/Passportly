import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { concatMap, Observable } from 'rxjs';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const actions: Readonly<
  Record<string, { action: string; targetType: string }>
> = {
  createHotel: { action: 'HOTEL_CREATED', targetType: 'Hotel' },
  updateHotel: { action: 'HOTEL_UPDATED', targetType: 'Hotel' },
  uploadImages: { action: 'HOTEL_IMAGES_UPDATED', targetType: 'Hotel' },
  createRoom: { action: 'ROOM_CREATED', targetType: 'Room' },
  updateRoom: { action: 'ROOM_UPDATED', targetType: 'Room' },
  deleteRoom: { action: 'ROOM_DELETED', targetType: 'Room' },
  setRoomAvailability: {
    action: 'ROOM_AVAILABILITY_INITIALIZED',
    targetType: 'Room',
  },
  updateRoomAvailability: {
    action: 'ROOM_AVAILABILITY_UPDATED',
    targetType: 'Room',
  },
  updatePolicies: { action: 'HOTEL_POLICIES_UPDATED', targetType: 'Hotel' },
  replyToReview: { action: 'REVIEW_REPLIED', targetType: 'Review' },
  // Review deletion is audited by HotelReviewsService inside its mutation transaction.
};

@Injectable()
export class HotelAdminAuditInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  constructor(private readonly audit: AuditLogsService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    const action = actions[context.getHandler().name];
    if (user?.role !== Role.ADMIN || !action) return next.handle();

    return next.handle().pipe(
      concatMap(async (value: unknown) => {
        let resultId: string | undefined;
        if (typeof value === 'object' && value !== null && '_id' in value) {
          const id = value._id;
          resultId =
            id instanceof Types.ObjectId
              ? id.toHexString()
              : typeof id === 'string'
                ? id
                : undefined;
        }
        const roomId = request.params.roomId;
        const resourceId = request.params.id;
        const targetId =
          resultId ??
          (typeof roomId === 'string'
            ? roomId
            : typeof resourceId === 'string'
              ? resourceId
              : undefined);
        const deactivated =
          typeof value === 'object' &&
          value !== null &&
          'deactivated' in value &&
          value.deactivated === true;
        await this.audit.log({
          actor: user.userId,
          actorRole: user.role,
          ...action,
          action:
            action.action === 'ROOM_DELETED' && deactivated
              ? 'ROOM_DEACTIVATED'
              : action.action,
          targetId,
          details: {
            method: request.method,
            ...(action.action === 'ROOM_DELETED' ? { deactivated } : {}),
          },
        });
        return value;
      }),
    );
  }
}

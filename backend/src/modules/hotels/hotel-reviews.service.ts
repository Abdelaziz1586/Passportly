import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums';
import { HotelAccessService } from './hotel-access.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { todayUtc } from './hotel-utils';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Review, ReviewDocument } from './schemas/review.schema';

export interface RatingSummary {
  averageRating: number;
  reviewCount: number;
  ratingBreakdown: Record<string, number>;
}

@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly access: HotelAccessService,
    private readonly audit: AuditLogsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async completeStays(): Promise<void> {
    await this.bookings.updateMany(
      { status: BookingStatus.CONFIRMED, checkOutDate: { $lte: todayUtc() } },
      { $set: { status: BookingStatus.COMPLETED } },
    );
  }

  async summaries(
    hotelIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, RatingSummary>> {
    const groups = await this.reviews
      .aggregate<{
        _id: { hotel: Types.ObjectId; rating: number };
        count: number;
      }>([
        { $match: { hotel: { $in: hotelIds }, isHidden: false } },
        {
          $group: {
            _id: { hotel: '$hotel', rating: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .session(session ?? null);
    const result = new Map<string, RatingSummary>(
      hotelIds.map((id) => [
        id.toString(),
        {
          averageRating: 0,
          reviewCount: 0,
          ratingBreakdown: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        },
      ]),
    );
    for (const group of groups) {
      const summary = result.get(group._id.hotel.toString());
      if (!summary) continue;
      summary.reviewCount += group.count;
      summary.averageRating += group._id.rating * group.count;
      summary.ratingBreakdown[String(group._id.rating)] = group.count;
    }
    for (const summary of result.values()) {
      summary.averageRating = summary.reviewCount
        ? summary.averageRating / summary.reviewCount
        : 0;
    }
    return result;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums';
import { HotelPaginationDto } from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { paged, pagination, todayUtc } from './hotel-utils';
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

  async list(hotelId: string, query: HotelPaginationDto) {
    const hotel = await this.access.hotel(hotelId, true);
    const { page, limit, skip } = pagination(query.page, query.limit);
    if (query.sortBy && query.sortBy !== 'createdAt')
      throw new BadRequestException('Reviews are ordered by createdAt');
    const summary = (await this.summaries([hotel._id])).get(
      hotelId.toLowerCase(),
    )!;
    const data = await this.reviews.aggregate<{
      _id: Types.ObjectId;
      rating: number;
      title?: string;
      comment: string;
      createdAt: Date;
      updatedAt: Date;
      authorName: string;
      moderatorReply?: { replyText: string; repliedAt: Date };
    }>([
      { $match: { hotel: hotel._id, isHidden: false } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'author',
        },
      },
      { $set: { author: { $arrayElemAt: ['$author', 0] } } },
      {
        $project: {
          rating: 1,
          title: 1,
          comment: 1,
          createdAt: 1,
          updatedAt: 1,
          moderatorReply: {
            $cond: [
              { $ne: [{ $ifNull: ['$moderatorReply', null] }, null] },
              {
                replyText: '$moderatorReply.replyText',
                repliedAt: '$moderatorReply.repliedAt',
              },
              null,
            ],
          },
          authorName: {
            $cond: [
              {
                $or: [
                  { $eq: ['$author.status', 'DEACTIVATED'] },
                  { $eq: [{ $ifNull: ['$author._id', null] }, null] },
                ],
              },
              'Deleted user',
              {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$author.firstName', ''] },
                      ' ',
                      { $ifNull: ['$author.lastName', ''] },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    ]);
    return { ...paged(data, summary.reviewCount, page, limit), ...summary };
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  CreateReviewDto,
  HotelPaginationDto,
  UpdateReviewDto,
} from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  isDuplicateKey,
  objectId,
  paged,
  pagination,
  todayUtc,
} from './hotel-utils';
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

  private async lockHotel(
    hotelId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    // Acquire the hotel write lock BEFORE reading reviews; transaction retries see all committed changes.
    const hotel = await this.hotels.updateOne(
      { _id: hotelId },
      { $inc: { reviewRevision: 1 } },
      { session },
    );
    if (!hotel.matchedCount) throw new NotFoundException('Hotel not found');
  }

  /** Call inside the same transaction as a visibility or review mutation. */
  async recalculateRating(
    hotelId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const summary = (await this.summaries([hotelId], session)).get(
      hotelId.toString(),
    )!;
    await this.hotels.updateOne(
      { _id: hotelId },
      {
        $set: {
          averageRating: summary.averageRating,
          reviewCount: summary.reviewCount,
        },
      },
      { session },
    );
  }

  async createReview(
    bookingId: string,
    dto: CreateReviewDto,
    user: AuthenticatedUser,
  ) {
    const id = objectId(bookingId, 'bookingId');
    if (user.role !== Role.REGISTERED_USER)
      throw new ForbiddenException('Only travelers can review their own stays');
    try {
      return await this.connection.transaction(async (session) => {
        const booking = await this.bookings
          .findById(id)
          .session(session)
          .lean();
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.user.toString() !== user.userId)
          throw new ForbiddenException('You can review only your own booking');
        if (
          ![BookingStatus.CONFIRMED, BookingStatus.COMPLETED].includes(
            booking.status,
          ) ||
          booking.checkOutDate > todayUtc()
        ) {
          throw new BadRequestException(
            'Reviews require a completed, paid stay after check-out',
          );
        }
        await this.lockHotel(booking.hotel, session);
        if (await this.reviews.exists({ booking: id }).session(session))
          throw new ConflictException('This booking already has a review');
        if (booking.status === BookingStatus.CONFIRMED)
          await this.bookings.updateOne(
            { _id: id, status: BookingStatus.CONFIRMED },
            { $set: { status: BookingStatus.COMPLETED } },
            { session },
          );
        const [review] = await this.reviews.create(
          [
            {
              ...dto,
              comment: dto.comment ?? '',
              hotel: booking.hotel,
              booking: id,
              user: objectId(user.userId, 'userId'),
            },
          ],
          { session },
        );
        await this.recalculateRating(booking.hotel, session);
        return review;
      });
    } catch (error) {
      if (isDuplicateKey(error))
        throw new ConflictException('This booking already has a review');
      throw error;
    }
  }

  private async review(id: string, session?: ClientSession) {
    const review = await this.reviews
      .findById(objectId(id, 'reviewId'))
      .session(session ?? null)
      .lean();
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  async updateReview(
    id: string,
    dto: UpdateReviewDto,
    user: AuthenticatedUser,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Provide at least one review field');
    objectId(id, 'reviewId');
    return this.connection.transaction(async (session) => {
      const review = await this.review(id, session);
      if (
        user.role !== Role.REGISTERED_USER ||
        review.user.toString() !== user.userId
      )
        throw new ForbiddenException('You can edit only your own review');
      await this.lockHotel(review.hotel, session);
      const updated = await this.reviews
        .findByIdAndUpdate(
          review._id,
          { $set: dto },
          { session, returnDocument: 'after', runValidators: true },
        )
        .lean();
      await this.recalculateRating(review.hotel, session);
      return updated;
    });
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

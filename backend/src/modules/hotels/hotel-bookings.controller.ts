import { HotelAdminAuditInterceptor } from './hotel-admin-audit.interceptor';
import {
  UseInterceptors,
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingResponseDto } from './dto/hotel-booking-response.dto';
import { HotelBookingListResponseDto } from './dto/hotel-booking-view-response.dto';
import { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import type { HotelBookingResponse } from './hotel-bookings.service';
import { HotelBookingViewService } from './hotel-booking-view.service';
import type { HotelBookingListResponse } from './hotel-booking-view';
import { HotelsService } from './hotels.service';
import {
  CreateReviewDto,
  ReplyReviewDto,
  UpdateReviewDto,
} from './dto/hotel.dto';
import { HotelReviewsService } from './hotel-reviews.service';

@ApiTags('Hotel Bookings & Reviews')
@ApiCookieAuth()
@UseInterceptors(HotelAdminAuditInterceptor)
@Controller()
export class HotelBookingsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly hotelBookingsService: HotelBookingsService,
    private readonly hotelBookingViewService: HotelBookingViewService,
    private readonly reviews: HotelReviewsService,
  ) {}

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings')
  @ApiOperation({
    summary:
      'HTL-16, HTL-18: Create concurrency-safe single or multi-room hotel reservation',
    description:
      "Reserves one or more rooms of the same hotel for the same dates in ONE reservation, with the adults and children (ages 0-17) of each room: at least one adult in the reservation, at least one guest per room, no room above its maximum occupancy. Check-out must be after check-in and check-in cannot be in the past. Every night of every room is held together in one transaction: if any night of any room is unavailable, blocked, or already held or booked, the whole request is rejected (409) and nothing is held. The reservation is PENDING_PAYMENT for 10 minutes (never extended); if payment does not succeed in time it becomes EXPIRED and the rooms are released. The total is the sum over the rooms of the nights x that room's price at booking time (a per-night price override wins over the room's base price). The hotel policies (check-in/check-out times, cancellation tiers) are copied onto the reservation.",
  })
  @ApiCreatedResponse({
    description: 'Rooms held; the reservation is PENDING_PAYMENT',
    type: HotelBookingResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid body, dates (check-out not after check-in, check-in in the past), guests (no adult, empty room, above maximum occupancy) or mixed currencies',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may book' })
  @ApiNotFoundResponse({ description: 'Hotel or room not found in this hotel' })
  @ApiConflictResponse({
    description:
      'A room is not available for the whole stay (blocked, not bookable, held or booked), or the hotel is not accepting bookings',
  })
  createBooking(
    @Body() dto: CreateHotelBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelBookingResponse> {
    return this.hotelBookingsService.createBooking(user.userId, dto);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('hotel-bookings')
  @ApiOperation({
    summary: 'HTL-20: List current user hotel bookings',
    description:
      "Paginated list of the signed-in user's own reservations (admins also see only their own), with reference, hotel, rooms, dates, guests, total and status. `group` shows Upcoming (awaiting payment or confirmed, stay not over), Past (completed or expired) or Cancelled; `status` filters by one or more statuses (repeat or comma-separate); both narrow each other. Sort by createdAt, checkInDate or totalPrice. Statuses are as they are now: a hold that ran out is EXPIRED, a confirmed stay whose check-out date passed is COMPLETED.",
  })
  @ApiOkResponse({
    description: 'One page of reservations and the pagination meta',
    type: HotelBookingListResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid page, limit (1-50), status, group, sortBy or sortOrder, or an unknown query parameter',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description: 'Only registered users and admins may list reservations',
  })
  listBookings(
    @Query() query: ListHotelBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HotelBookingListResponse> {
    return this.hotelBookingViewService.listBookings(user.userId, query);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @Get('hotel-bookings/:id')
  @ApiOperation({ summary: 'HTL-20: Get hotel booking details' })
  getBooking() {
    throw new NotImplementedException(
      'GET /api/hotel-bookings/:id not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings/:id/cancel')
  @ApiOperation({
    summary: 'HTL-21: Cancel hotel booking according to hotel policy',
  })
  cancelBooking() {
    throw new NotImplementedException(
      'POST /api/hotel-bookings/:id/cancel not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings/:id/review')
  @ApiOperation({ summary: 'HTL-23: Submit review for completed hotel stay' })
  createReview(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.createReview(id, dto, user);
  }

  @Roles(Role.REGISTERED_USER)
  @Patch('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Update own review' })
  updateReview(
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.updateReview(id, dto, user);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Delete review' })
  deleteReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.deleteReview(id, user);
  }

  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @Post('reviews/:id/reply')
  @ApiOperation({ summary: 'HTL-26 (Optional): Reply to a hotel review' })
  replyToReview(
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.reply(id, dto, user);
  }
}

import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { HotelsService } from './hotels.service';

@ApiTags('Hotels & Rooms')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post()
  @ApiOperation({ summary: 'HTL-01: Create hotel profile' })
  createHotel() {
    throw new NotImplementedException('POST /api/hotels not implemented yet');
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'HTL-11, HTL-12: Search hotels by destination, dates, and guest count',
  })
  searchHotels() {
    throw new NotImplementedException(
      'GET /api/hotels/search not implemented yet',
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'HTL-02: Get hotel details' })
  getHotel() {
    throw new NotImplementedException(
      'GET /api/hotels/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id')
  @ApiOperation({ summary: 'HTL-01: Update hotel profile' })
  updateHotel() {
    throw new NotImplementedException(
      'PATCH /api/hotels/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post(':id/rooms')
  @ApiOperation({ summary: 'HTL-03: Create room type/unit in hotel' })
  createRoom() {
    throw new NotImplementedException(
      'POST /api/hotels/:id/rooms not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id/rooms/:roomId')
  @ApiOperation({ summary: 'HTL-05: Update room details or pricing' })
  updateRoom() {
    throw new NotImplementedException(
      'PATCH /api/hotels/:id/rooms/:roomId not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Delete(':id/rooms/:roomId')
  @ApiOperation({ summary: 'HTL-06: Delete or deactivate room' })
  deleteRoom() {
    throw new NotImplementedException(
      'DELETE /api/hotels/:id/rooms/:roomId not implemented yet',
    );
  }

  @Public()
  @Get(':id/rooms/available')
  @ApiOperation({ summary: 'HTL-15: List available rooms for stay dates' })
  getAvailableRooms() {
    throw new NotImplementedException(
      'GET /api/hotels/:id/rooms/available not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post(':id/rooms/:roomId/availability')
  @ApiOperation({
    summary: 'HTL-04: Set room availability and pricing for date range',
  })
  setRoomAvailability() {
    throw new NotImplementedException(
      'POST /api/hotels/:id/rooms/:roomId/availability not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id/rooms/:roomId/availability')
  @ApiOperation({
    summary: 'HTL-05, HTL-06: Block/unblock or update room availability',
  })
  updateRoomAvailability() {
    throw new NotImplementedException(
      'PATCH /api/hotels/:id/rooms/:roomId/availability not implemented yet',
    );
  }

  @Public()
  @Get(':id/availability')
  @ApiOperation({ summary: 'HTL-08: Get hotel availability calendar/summary' })
  getHotelAvailability() {
    throw new NotImplementedException(
      'GET /api/hotels/:id/availability not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Put(':id/policies')
  @ApiOperation({
    summary:
      'HTL-09, HTL-10: Update hotel check-in/out & cancellation policies',
  })
  updatePolicies() {
    throw new NotImplementedException(
      'PUT /api/hotels/:id/policies not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Get(':id/reservations')
  @ApiOperation({ summary: 'HTL-22: List reservations for a hotel' })
  getHotelReservations() {
    throw new NotImplementedException(
      'GET /api/hotels/:id/reservations not implemented yet',
    );
  }

  @Public()
  @Get(':id/reviews')
  @ApiOperation({ summary: 'HTL-24: List reviews for a hotel' })
  getHotelReviews() {
    throw new NotImplementedException(
      'GET /api/hotels/:id/reviews not implemented yet',
    );
  }
}

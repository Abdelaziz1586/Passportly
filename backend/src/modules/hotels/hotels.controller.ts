import {
  NotImplementedException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { HotelsService } from './hotels.service';
import { HotelInventoryService } from './hotel-inventory.service';
import { HotelReviewsService } from './hotel-reviews.service';
import {
  AvailabilityFieldsDto,
  CreateHotelDto,
  CreateRoomDto,
  DateRangeDto,
  HotelDetailsQueryDto,
  HotelPaginationDto,
  HotelPoliciesDto,
  HotelReservationsQueryDto,
  SearchHotelsDto,
  StayQueryDto,
  UpdateHotelDto,
  UpdateRoomDto,
} from './dto/hotel.dto';

@ApiTags('Hotels & Rooms')
@Controller('hotels')
export class HotelsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly inventory: HotelInventoryService,
    private readonly reviews: HotelReviewsService,
  ) {}

  @ApiCookieAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'HTL-01: Create hotel profile' })
  createHotel(
    @Body() dto: CreateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hotelsService.createHotel(dto, user);
  }

  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'HTL-11, HTL-12: Search hotels by destination, dates, and guest count',
  })
  searchHotels(@Query() query: SearchHotelsDto) {
    return this.hotelsService.searchHotels(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'HTL-02: Get hotel details' })
  getHotel(@Param('id') id: string, @Query() query: HotelDetailsQueryDto) {
    return this.hotelsService.getHotel(id, query);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id')
  @ApiOperation({ summary: 'HTL-01: Update hotel profile' })
  updateHotel(
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hotelsService.updateHotel(id, dto, user);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post(':id/rooms')
  @ApiOperation({ summary: 'HTL-03: Create room type/unit in hotel' })
  createRoom(
    @Param('id') id: string,
    @Body() dto: CreateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.createRoom(id, dto, user);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id/rooms/:roomId')
  @ApiOperation({ summary: 'HTL-05: Update room details or pricing' })
  updateRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, roomId, dto, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-57 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Delete(':id/rooms/:roomId')
  @ApiOperation({ summary: 'HTL-06: Delete or deactivate room' })
  deleteRoom(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, roomId, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-58 PR in this stack',
    );
  }

  @Public()
  @Get(':id/rooms/available')
  @ApiOperation({ summary: 'HTL-15: List available rooms for stay dates' })
  getAvailableRooms(@Param('id') id: string, @Query() query: StayQueryDto) {
    void [id, query];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-59 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post(':id/rooms/:roomId/availability')
  @ApiOperation({
    summary: 'HTL-04: Set room availability and pricing for date range',
  })
  setRoomAvailability(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: AvailabilityFieldsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, roomId, dto, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-60 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Patch(':id/rooms/:roomId/availability')
  @ApiOperation({
    summary: 'HTL-05, HTL-06: Block/unblock or update room availability',
  })
  updateRoomAvailability(
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: AvailabilityFieldsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, roomId, dto, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-61 PR in this stack',
    );
  }

  @Public()
  @Get(':id/availability')
  @ApiOperation({ summary: 'HTL-08: Get hotel availability calendar/summary' })
  getHotelAvailability(@Param('id') id: string, @Query() query: DateRangeDto) {
    void [id, query];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-62 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Get(':id/availability/management')
  @ApiOperation({
    summary:
      'HTL-08: Assigned moderator calendar with private reservation references',
  })
  getManagementCalendar(
    @Param('id') id: string,
    @Query() query: DateRangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, query, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-62 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Post(':id/images')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          maxItems: 5,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    }),
  )
  @ApiOperation({
    summary:
      'HTL-01, GEN-08: Upload up to five server-stored JPG/PNG hotel photos',
  })
  uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hotelsService.uploadImages(id, files ?? [], user);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Put(':id/policies')
  @ApiOperation({
    summary:
      'HTL-09, HTL-10: Update hotel check-in/out & cancellation policies',
  })
  updatePolicies(
    @Param('id') id: string,
    @Body() dto: HotelPoliciesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, dto, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-63 PR in this stack',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.HOTEL_MODERATOR)
  @Get(':id/reservations')
  @ApiOperation({ summary: 'HTL-22: List reservations for a hotel' })
  getHotelReservations(
    @Param('id') id: string,
    @Query() query: HotelReservationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, query, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-64 PR in this stack',
    );
  }

  @Public()
  @Get(':id/reviews')
  @ApiOperation({ summary: 'HTL-24: List reviews for a hotel' })
  getHotelReviews(@Param('id') id: string, @Query() query: HotelPaginationDto) {
    void [id, query];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-65 PR in this stack',
    );
  }
}

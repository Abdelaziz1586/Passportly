import { maxLogoBytes, UploadsService } from '../uploads/uploads.service';
import {
  NotImplementedException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiOperation,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightsService } from './flights.service';
import { AirlineCreate } from './create-airline.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(
    private readonly flightsService: FlightsService,
    private readonly uploads: UploadsService,
  ) {}

  @ApiCookieAuth()
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        iataCode: { type: 'string', example: 'MS' },
        logo: { type: 'string', format: 'binary' },
      },
    },
  })
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: maxLogoBytes, files: 1 } }),
  )
  @Post()
  @ApiOperation({ summary: 'FLT-01: Create an airline profile' })
  createAirline(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AirlineCreate,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    return this.uploads.withAirlineLogo(logo, (url) =>
      this.flightsService.createAirline(user, input, url),
    );
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'FLT-01: Get airline details' })
  getAirline(@Param('id') id: string) {
    return this.flightsService.getAirline(id);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Patch(':id')
  @ApiOperation({ summary: 'FLT-01: Update airline profile' })
  updateAirline() {
    throw new NotImplementedException(
      'PATCH /api/airlines/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Put(':id/baggage-policy')
  @ApiOperation({ summary: 'FLT-04, FLT-08: Set airline baggage policy' })
  updateBaggagePolicy() {
    throw new NotImplementedException(
      'PUT /api/airlines/:id/baggage-policy not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Put(':id/cancellation-policy')
  @ApiOperation({ summary: 'FLT-09: Set airline cancellation policy' })
  updateCancellationPolicy() {
    throw new NotImplementedException(
      'PUT /api/airlines/:id/cancellation-policy not implemented yet',
    );
  }
}

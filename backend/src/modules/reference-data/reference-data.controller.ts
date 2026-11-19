import {
  Controller,
  Get,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  ListAirportsQueryDto,
  PaginatedAirportsResponseDto,
} from './dto/list-airports-query.dto';
import { ReferenceDataService } from './reference-data.service';

@ApiTags('Reference Data')
@Public()
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Get('airports')
  @ApiOperation({
    summary: 'FLT-02: Search/list reference airports with IANA time zones',
  })
  @ApiOkResponse({
    description: 'Paginated list of reference airports with IANA time zones',
    type: PaginatedAirportsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getAirports(
    @Query() query: ListAirportsQueryDto,
  ): Promise<PaginatedAirportsResponseDto> {
    return this.referenceDataService.getAirports(query);
  }

  @Get('countries')
  @ApiOperation({
    summary: 'List reference countries and supported currencies',
  })
  getCountries() {
    throw new NotImplementedException('GET /api/countries not implemented yet');
  }

  @Get('cities')
  @ApiOperation({ summary: 'Search/list reference cities' })
  getCities() {
    throw new NotImplementedException('GET /api/cities not implemented yet');
  }

  @Get('attractions')
  @ApiOperation({ summary: 'Search/list reference attractions' })
  getAttractions() {
    throw new NotImplementedException(
      'GET /api/attractions not implemented yet',
    );
  }
}

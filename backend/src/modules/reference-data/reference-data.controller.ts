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
  ListAttractionsQueryDto,
  PaginatedAttractionsResponseDto,
} from './dto/list-attractions-query.dto';
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
  getAirports() {
    throw new NotImplementedException('GET /api/airports not implemented yet');
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
  @ApiOperation({ summary: 'REF-03: Search/list reference attractions' })
  @ApiOkResponse({
    description: 'Paginated list of reference attractions',
    type: PaginatedAttractionsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getAttractions(
    @Query() query: ListAttractionsQueryDto,
  ): Promise<PaginatedAttractionsResponseDto> {
    return this.referenceDataService.getAttractions(query);
  }
}

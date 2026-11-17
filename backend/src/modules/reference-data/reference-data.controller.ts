import { Controller, Get, NotImplementedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
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
  @ApiOperation({ summary: 'Search/list reference attractions' })
  getAttractions() {
    throw new NotImplementedException(
      'GET /api/attractions not implemented yet',
    );
  }
}

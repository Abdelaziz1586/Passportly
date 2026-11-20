import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ETicketQueryDto } from './e-ticket-query.dto';
import { FlightBookingIdParamDto } from './flight-booking-id-param.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parseQuery = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'query',
    metatype: ETicketQueryDto,
  }) as Promise<ETicketQueryDto>;

describe('ETicketQueryDto', () => {
  it('defaults to json', async () => {
    expect((await parseQuery({})).format).toBe('json');
  });

  it.each(['json', 'pdf'])('accepts format=%s', async (format) => {
    expect((await parseQuery({ format })).format).toBe(format);
  });

  it.each([
    { format: 'docx' },
    { format: 'PDF' },
    { format: '' },
    { other: 1 },
  ])('rejects %j', async (raw) => {
    await expect(parseQuery(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FlightBookingIdParamDto', () => {
  const parse = (id: unknown) =>
    pipe.transform(
      { id },
      { type: 'param', metatype: FlightBookingIdParamDto },
    ) as Promise<FlightBookingIdParamDto>;

  it('accepts an object id', async () => {
    expect((await parse('665f1c2e8a1b2c3d4e5f6a7b')).id).toBe(
      '665f1c2e8a1b2c3d4e5f6a7b',
    );
  });

  it.each(['abc', '123', '{"$ne":null}'])('rejects %j', async (bad) => {
    await expect(parse(bad)).rejects.toBeInstanceOf(BadRequestException);
  });
});

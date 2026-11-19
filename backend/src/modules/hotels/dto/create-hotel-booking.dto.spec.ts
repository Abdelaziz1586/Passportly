import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateHotelBookingDto } from './create-hotel-booking.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parse = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'body',
    metatype: CreateHotelBookingDto,
  }) as Promise<CreateHotelBookingDto>;

const id = '665f1c2e8a1b2c3d4e5f6a7b';
const valid = () => ({
  hotelId: id,
  checkInDate: '2026-12-10',
  checkOutDate: '2026-12-13',
  rooms: [{ roomId: id, adults: 2, childrenAges: [4, 17] }],
  primaryGuestName: "Layla O'Hassan-Smith",
  primaryGuestEmail: 'layla@example.com',
});

describe('CreateHotelBookingDto', () => {
  it('accepts a valid reservation (children ages 0-17, optional fields)', async () => {
    const dto = await parse({
      ...valid(),
      primaryGuestPhone: '+20 100',
      specialRequests: 'Late arrival',
    });

    expect(dto.rooms[0]).toMatchObject({ adults: 2, childrenAges: [4, 17] });
    expect(dto.rooms[0].roomId).toBe(id);
  });

  it('lower-cases ids so an upper-case id cannot dodge the duplicate-room check', async () => {
    const upper = id.toUpperCase();
    const dto = await parse({
      ...valid(),
      hotelId: upper,
      rooms: [{ roomId: upper, adults: 1 }],
    });

    expect(dto.hotelId).toBe(id);
    expect(dto.rooms[0].roomId).toBe(id);
  });

  it('accepts names with combining marks (decomposed accents)', async () => {
    const dto = await parse({
      ...valid(),
      primaryGuestName: 'Jose\u0301 Garci\u0301a',
    });

    expect(dto.primaryGuestName).toBe('Jose\u0301 Garci\u0301a');
  });

  it('accepts a room without children', async () => {
    const dto = await parse({ ...valid(), rooms: [{ roomId: id, adults: 1 }] });

    expect(dto.rooms[0].childrenAges).toBeUndefined();
  });

  it.each([
    ['no hotel', { hotelId: undefined }],
    ['a bad hotel id', { hotelId: 'abc' }],
    ['an operator-injection hotel id', { hotelId: { $ne: null } }],
    ['a bad date format', { checkInDate: '10/12/2026' }],
    ['a date with a time', { checkOutDate: '2026-12-13T10:00:00Z' }],
    ['no rooms', { rooms: [] }],
    ['rooms not an array', { rooms: { roomId: id, adults: 1 } }],
    ['a room with a bad id', { rooms: [{ roomId: 'x', adults: 1 }] }],
    ['negative adults', { rooms: [{ roomId: id, adults: -1 }] }],
    ['fractional adults', { rooms: [{ roomId: id, adults: 1.5 }] }],
    [
      'a child aged 18',
      { rooms: [{ roomId: id, adults: 1, childrenAges: [18] }] },
    ],
    [
      'a child aged -1',
      { rooms: [{ roomId: id, adults: 1, childrenAges: [-1] }] },
    ],
    [
      'a child age that is not a number',
      { rooms: [{ roomId: id, adults: 1, childrenAges: ['x'] }] },
    ],
    [
      'too many rooms',
      { rooms: Array.from({ length: 51 }, () => ({ roomId: id, adults: 1 })) },
    ],
    ['an empty guest name', { primaryGuestName: '' }],
    ['a guest name with digits', { primaryGuestName: 'Layla 123' }],
    ['a bad email', { primaryGuestEmail: 'not-an-email' }],
    ['a too long request', { specialRequests: 'x'.repeat(501) }],
    // price, status and owner can never come from the client
    ['a client total', { totalPrice: 1 }],
    ['a client status', { status: 'CONFIRMED' }],
    ['a client user', { user: id }],
    ['a client hold time', { holdExpiresAt: '2030-01-01T00:00:00Z' }],
    ['a client nights count', { nights: 1 }],
    [
      'an unknown field inside a room',
      { rooms: [{ roomId: id, adults: 1, quantity: 5 }] },
    ],
  ])('rejects %s', async (_label, override) => {
    const raw: Record<string, unknown> = { ...valid(), ...override };
    for (const key of Object.keys(raw))
      if (raw[key] === undefined) delete raw[key];

    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});

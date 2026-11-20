import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { AttachItineraryDto } from './dto/attach-itinerary.dto';

describe('BlogController (SCRUM-132 BLG-13 attach itinerary)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    attachItinerary: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on attachItinerary', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'attachItinerary',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('validates AttachItineraryDto (ObjectId or null) and delegates to BlogService.attachItinerary', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const itineraryId = '673c1f2a9c4b2d001f8a5555';
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const attachDto = (await validationPipe.transform(
      { itineraryId },
      { type: 'body', metatype: AttachItineraryDto },
    )) as AttachItineraryDto;

    mockBlogService.attachItinerary.mockResolvedValue({
      id: postId,
      attachedItinerary: itineraryId,
    });

    const attachResult = await controller.attachItinerary(
      postId,
      user,
      attachDto,
    );
    expect(attachResult.attachedItinerary).toBe(itineraryId);

    const detachDto = (await validationPipe.transform(
      { itineraryId: null },
      { type: 'body', metatype: AttachItineraryDto },
    )) as AttachItineraryDto;
    expect(detachDto.itineraryId).toBeNull();
  });

  it('rejects missing or invalid itineraryId via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { itineraryId: 'not-a-mongo-id' },
        { type: 'body', metatype: AttachItineraryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        {},
        { type: 'body', metatype: AttachItineraryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

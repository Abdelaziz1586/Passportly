import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { CreatePostDto } from './dto/create-post.dto';

describe('BlogController (SCRUM-117 BLG-01 create post)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    createPost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on createPost', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'createPost',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('validates CreatePostDto and delegates to BlogService.createPost', async () => {
    const dto = (await validationPipe.transform(
      {
        title: '  Cairo Weekend Guide  ',
        content: '  Full guide to visiting Cairo museums and cafes.  ',
        status: PostStatus.PUBLISHED,
        tags: ['  Egypt ', 'Cairo'],
      },
      { type: 'body', metatype: CreatePostDto },
    )) as CreatePostDto;

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const expected = {
      id: '673c1f2a9c4b2d001f8a2222',
      author: user.userId,
      title: 'Cairo Weekend Guide',
      slug: 'cairo-weekend-guide-123abc',
      content: 'Full guide to visiting Cairo museums and cafes.',
      excerpt: 'Full guide to visiting Cairo museums and cafes.',
      status: PostStatus.PUBLISHED,
      isHidden: false,
      tags: ['egypt', 'cairo'],
      tagRefs: ['673c1f2a9c4b2d001f8a3333', '673c1f2a9c4b2d001f8a4444'],
      images: [],
      likesCount: 0,
      commentsCount: 0,
      attachedItinerary: null,
      publishedAt: new Date(),
    };
    mockBlogService.createPost.mockResolvedValue(expected);

    const result = await controller.createPost(user, dto);

    expect(result).toEqual(expected);
    expect(mockBlogService.createPost).toHaveBeenCalledWith(user.userId, dto);
  });

  it('rejects non-whitelisted properties and short title/content via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        {
          title: 'Hi',
          content: 'Short',
          isHidden: false,
        },
        { type: 'body', metatype: CreatePostDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

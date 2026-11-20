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
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';

describe('BlogController', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    createPost: jest.fn(),
    listPosts: jest.fn(),
    listMyPosts: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on listMyPosts', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'listMyPosts',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('marks listPosts endpoint as @Public()', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'listPosts',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('validates ListPostsQueryDto and delegates to BlogService.listPosts', async () => {
    const query = (await validationPipe.transform(
      {
        search: '  Cairo  ',
        tag: '  Travel Tips ',
        author: '673c1f2a9c4b2d001f8a1111',
        page: '2',
        limit: '10',
        sortBy: 'likesCount',
        sortOrder: 'desc',
      },
      { type: 'query', metatype: ListPostsQueryDto },
    )) as ListPostsQueryDto;

    const expected = { data: [], total: 0, page: 2, limit: 10, totalPages: 0 };
    mockBlogService.listPosts.mockResolvedValue(expected);

    const result = await controller.listPosts(query);

    expect(result).toEqual(expected);
    expect(mockBlogService.listPosts).toHaveBeenCalledWith(query);
  });

  it('rejects invalid author ObjectId or unsupported sortBy via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { author: 'not-an-id' },
        { type: 'query', metatype: ListPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { sortBy: 'passwordHash' },
        { type: 'query', metatype: ListPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
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

  it('validates ListMyPostsQueryDto and delegates to BlogService.listMyPosts', async () => {
    const query = (await validationPipe.transform(
      {
        status: PostStatus.DRAFT,
        page: '1',
        limit: '15',
        sortBy: 'createdAt',
        sortOrder: 'asc',
      },
      { type: 'query', metatype: ListMyPostsQueryDto },
    )) as ListMyPostsQueryDto;

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = { data: [], total: 0, page: 1, limit: 15, totalPages: 0 };
    mockBlogService.listMyPosts.mockResolvedValue(expected);

    const result = await controller.listMyPosts(user, query);

    expect(result).toEqual(expected);
    expect(mockBlogService.listMyPosts).toHaveBeenCalledWith(
      user.userId,
      query,
    );
  });

  it('rejects invalid status filter via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { status: 'ARCHIVED' },
        { type: 'query', metatype: ListMyPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
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

  it('rejects invalid author ObjectId or unsupported sortBy via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { author: 'not-an-id' },
        { type: 'query', metatype: ListPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { sortBy: 'passwordHash' },
        { type: 'query', metatype: ListPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

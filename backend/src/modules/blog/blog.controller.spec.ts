import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';

describe('BlogController (SCRUM-119 BLG-03 list my posts)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
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
});

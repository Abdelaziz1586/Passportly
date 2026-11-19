import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';

describe('BlogController (SCRUM-118 BLG-02/BLG-09 list and search posts)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    listPosts: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
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
});

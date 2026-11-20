import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { ListPostsByTagQueryDto } from './dto/list-posts-by-tag-query.dto';

describe('BlogController (SCRUM-130 BLG-08 posts by tag)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    getPostsByTag: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('marks getPostsByTag endpoint as @Public()', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'getPostsByTag',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('validates ListPostsByTagQueryDto and delegates tag and query to BlogService.getPostsByTag', async () => {
    const query = (await validationPipe.transform(
      { page: '1', limit: '10', sortBy: 'likesCount', sortOrder: 'desc' },
      { type: 'query', metatype: ListPostsByTagQueryDto },
    )) as ListPostsByTagQueryDto;

    const expected = {
      tag: { name: 'travel tips', slug: 'travel-tips', usageCount: 2 },
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    };
    mockBlogService.getPostsByTag.mockResolvedValue(expected);

    const result = await controller.getPostsByTag('Travel Tips', query);

    expect(result).toEqual(expected);
    expect(mockBlogService.getPostsByTag).toHaveBeenCalledWith(
      'Travel Tips',
      query,
    );
  });

  it('rejects unsupported sortBy via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { sortBy: 'isHidden' },
        { type: 'query', metatype: ListPostsByTagQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

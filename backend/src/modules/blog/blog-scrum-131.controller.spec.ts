import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { AuthorPostsQueryDto } from './dto/author-posts-query.dto';

describe('BlogController (SCRUM-131 BLG-12 author profile & posts)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    getAuthorPage: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('marks getAuthorPage endpoint as @Public()', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'getAuthorPage',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('validates AuthorPostsQueryDto and delegates id and query to BlogService.getAuthorPage', async () => {
    const authorId = '673c1f2a9c4b2d001f8a1111';
    const query = (await validationPipe.transform(
      { page: '2', limit: '5', sortBy: 'likesCount', sortOrder: 'desc' },
      { type: 'query', metatype: AuthorPostsQueryDto },
    )) as AuthorPostsQueryDto;

    const expected = {
      author: {
        id: authorId,
        firstName: 'Abdullah',
        lastName: 'Emam',
        fullName: 'Abdullah Emam',
      },
      posts: { data: [], total: 0, page: 2, limit: 5, totalPages: 0 },
    };
    mockBlogService.getAuthorPage.mockResolvedValue(expected);

    const result = await controller.getAuthorPage(authorId, query);

    expect(result).toEqual(expected);
    expect(mockBlogService.getAuthorPage).toHaveBeenCalledWith(authorId, query);
  });

  it('rejects unsupported sortBy via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { sortBy: 'passwordHash' },
        { type: 'query', metatype: AuthorPostsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

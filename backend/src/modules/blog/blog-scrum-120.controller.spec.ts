import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';

describe('BlogController (SCRUM-120 BLG-02 get blog post details)', () => {
  let controller: BlogController;

  const mockBlogService = {
    getPost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('marks getPost as @Public() so guests can view published posts', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'getPost',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
  });

  it('OptionalJwtAuthGuard returns undefined instead of throwing when unauthenticated', () => {
    const guard = new OptionalJwtAuthGuard();
    expect(guard.handleRequest(null, false as never)).toBeUndefined();
    expect(
      guard.handleRequest(new Error('invalid'), undefined),
    ).toBeUndefined();
    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'a@b.com',
      role: Role.REGISTERED_USER,
      jti: 'jti',
    };
    expect(guard.handleRequest(null, user)).toEqual(user);
  });

  it('delegates id and optional current user to BlogService.getPost', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const expected = { id: postId, comments: [] };
    mockBlogService.getPost.mockResolvedValue(expected);

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const result = await controller.getPost(postId, user);
    expect(result).toEqual(expected);
    expect(mockBlogService.getPost).toHaveBeenCalledWith(postId, user);
  });
});
